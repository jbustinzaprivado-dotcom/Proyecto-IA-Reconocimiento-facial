import csv
import io
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Persona, RecognitionLog
from app.services import report_service
from app.services.report_service import WARNING, safe_cell

BOM = b"\xef\xbb\xbf"


def recognize(client: TestClient, data: bytes, esperado: str | None = None):
    form = {} if esperado is None else {"esperado": esperado}
    return client.post(
        "/api/reconocimiento", files={"imagen": ("cara.png", data, "image/png")}, data=form
    )


def rows_of(response) -> list[list[str]]:
    text = response.content.decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


def add_person(db: Session, name: str, email: str) -> Persona:
    persona = Persona(
        nombre=name,
        email=email,
        consentimiento_at=datetime(2026, 9, 1, tzinfo=UTC),
        consentimiento_version="v0-provisional",
    )
    db.add(persona)
    db.commit()
    return persona


def add_log(db: Session, persona_id: int | None, when: datetime, **extra) -> None:
    db.add(
        RecognitionLog(
            persona_id=persona_id,
            similitud=extra.pop("similitud", 0.9),
            distancia=0.2,
            umbral=0.75,
            coincide=persona_id is not None,
            modelo=extra.pop("modelo", "m"),
            probabilidad_calibrada=None,
            created_at=when,
            **extra,
        )
    )
    db.commit()


class TestSafeCell:
    @pytest.mark.parametrize("start", ["=", "+", "-", "@"])
    def test_a_cell_that_would_run_as_a_formula_is_made_plain_text(self, start):
        assert safe_cell(f"{start}HYPERLINK(1)") == f"'{start}HYPERLINK(1)"

    def test_a_tab_or_carriage_return_at_the_start_is_also_neutralized(self):
        assert safe_cell("\tx").startswith("'")
        assert safe_cell("\rx").startswith("'")

    def test_an_ordinary_name_is_left_alone(self):
        assert safe_cell("María José Pérez") == "María José Pérez"
        assert safe_cell("Ana - Torres") == "Ana - Torres"


class TestHistoryCsv:
    def test_the_download_is_a_csv_attachment_named_after_the_day(self, client: TestClient):
        response = client.get("/api/reportes/historial.csv")
        assert response.status_code == 200
        assert response.headers["content-type"] == "text/csv; charset=utf-8"
        disposition = response.headers["content-disposition"]
        today = f"{datetime.now(UTC):%Y-%m-%d}"
        assert disposition == f'attachment; filename="historial_{today}.csv"'

    def test_it_starts_with_the_byte_order_mark_so_excel_reads_the_accents(self, client):
        assert client.get("/api/reportes/historial.csv").content.startswith(BOM)

    def test_the_first_line_warns_that_it_has_names_and_the_second_is_the_header(self, client):
        rows = rows_of(client.get("/api/reportes/historial.csv"))
        assert rows[0] == [WARNING]
        assert rows[0][0].startswith("AVISO: este archivo contiene nombres de personas")
        assert rows[1] == [
            "fecha",
            "persona",
            "similitud",
            "distancia",
            "umbral",
            "resultado",
            "modelo",
            "etiqueta",
        ]
        assert len(rows) == 2

    def test_each_attempt_is_a_row_newest_first_with_its_decision(
        self, client: TestClient, db: Session
    ):
        ana = add_person(db, "María José Pérez", "maria@example.com")
        add_log(db, ana.id, datetime(2026, 9, 18, 10, 0, tzinfo=UTC))
        add_log(db, None, datetime(2026, 9, 19, 12, 30, tzinfo=UTC), similitud=0.1234567)
        rows = rows_of(client.get("/api/reportes/historial.csv"))
        assert rows[2] == [
            "2026-09-19T12:30:00Z",
            "Sin candidato",
            "0.1235",
            "0.2000",
            "0.7500",
            "No coincide",
            "m",
            "",
        ]
        assert rows[3][:2] == ["2026-09-18T10:00:00Z", "María José Pérez"]
        assert rows[3][5] == "Coincide"

    def test_it_holds_every_attempt_and_not_only_the_200_of_the_screen(
        self, client: TestClient, db: Session
    ):
        base = datetime(2026, 9, 1, tzinfo=UTC)
        db.add_all(
            RecognitionLog(
                similitud=0.5,
                distancia=1.0,
                umbral=0.75,
                coincide=False,
                modelo="m",
                probabilidad_calibrada=None,
                created_at=base + timedelta(minutes=i),
            )
            for i in range(250)
        )
        db.commit()
        assert len(rows_of(client.get("/api/reportes/historial.csv"))) == 2 + 250
        assert len(client.get("/api/reconocimiento/historial").json()["resultado"]) == 200

    def test_the_label_of_an_evaluation_attempt_is_in_its_row(
        self, client: TestClient, register, make_image
    ):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        recognize(client, make_image(1), esperado=str(ana["id"]))
        rows = rows_of(client.get("/api/reportes/historial.csv"))
        assert rows[2][7] == "acierto"
        assert rows[2][1] == "Ana Torres"

    def test_a_name_that_starts_like_a_formula_is_not_one_when_the_file_is_opened(
        self, client: TestClient, db: Session
    ):
        evil = add_person(db, '=HYPERLINK("http://x.example","clic")', "evil@example.com")
        add_log(db, evil.id, datetime(2026, 9, 18, tzinfo=UTC))
        rows = rows_of(client.get("/api/reportes/historial.csv"))
        assert rows[2][1].startswith("'=")

    def test_a_name_with_a_comma_or_a_quote_keeps_the_columns_in_place(
        self, client: TestClient, db: Session
    ):
        ana = add_person(db, 'Ana "la Grande", Torres', "ana@example.com")
        add_log(db, ana.id, datetime(2026, 9, 18, tzinfo=UTC))
        rows = rows_of(client.get("/api/reportes/historial.csv"))
        assert rows[2][1] == 'Ana "la Grande", Torres'
        assert len(rows[2]) == 8

    def test_it_can_be_limited_to_one_model(self, client: TestClient, db: Session):
        add_log(db, None, datetime(2026, 9, 18, tzinfo=UTC), modelo="a")
        add_log(db, None, datetime(2026, 9, 19, tzinfo=UTC), modelo="b")
        rows = rows_of(client.get("/api/reportes/historial.csv", params={"modelo": "b"}))
        assert [r[6] for r in rows[2:]] == ["b"]

    def test_the_dates_are_in_utc_with_a_z(self, client: TestClient, db: Session):
        add_log(db, None, datetime(2026, 9, 18, 3, 4, 5, tzinfo=UTC))
        assert rows_of(client.get("/api/reportes/historial.csv"))[2][0] == "2026-09-18T03:04:05Z"

    def test_no_vector_no_photo_and_no_quality_number_is_in_the_file(
        self, client: TestClient, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        recognize(client, make_image(1))
        text = client.get("/api/reportes/historial.csv").content.decode("utf-8-sig").lower()
        assert "embedding" not in text
        assert "nitidez" not in text
        assert "brillo" not in text

    def test_the_line_ends_are_the_ones_excel_expects(self, client: TestClient):
        assert b"\r\n" in client.get("/api/reportes/historial.csv").content


class TestAnalysisCsv:
    def test_it_has_the_header_and_one_row_per_threshold(self, client: TestClient):
        response = client.get("/api/reportes/analisis.csv")
        assert response.status_code == 200
        assert response.headers["content-type"] == "text/csv; charset=utf-8"
        assert response.headers["content-disposition"].startswith('attachment; filename="analisis_')
        rows = rows_of(response)
        assert rows[0] == report_service.ANALYSIS_HEADER
        assert len(rows) == 1 + 101
        assert rows[1][:2] == ["simulated", "0.00"]
        assert rows[-1][1] == "1.00"

    def test_the_error_columns_are_empty_when_there_is_nothing_to_divide_by(self, client):
        rows = rows_of(client.get("/api/reportes/analisis.csv"))
        assert rows[1][7:] == ["", ""]

    def test_it_has_no_names_and_no_warning_line(self, client: TestClient, register, make_image):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        recognize(client, make_image(1), esperado=str(ana["id"]))
        content = client.get("/api/reportes/analisis.csv").content.decode("utf-8-sig")
        assert "Ana" not in content
        assert "AVISO" not in content

    def test_the_numbers_are_those_of_the_curve(self, client: TestClient, register, make_image):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        recognize(client, make_image(1), esperado=str(ana["id"]))
        recognize(client, make_image(99), esperado="desconocido")
        rows = rows_of(client.get("/api/reportes/analisis.csv"))
        at_half = next(r for r in rows[1:] if r[1] == "0.50")
        assert at_half[2:7] == ["1", "1", "0", "0", "1"]

    def test_an_unknown_model_is_a_404_with_the_error_envelope(self, client: TestClient):
        response = client.get("/api/reportes/analisis.csv", params={"modelo": "inventado"})
        assert response.status_code == 404
        assert response.json() == {"success": False, "error": "No hay intentos de ese modelo."}

    def test_the_history_csv_of_an_unknown_model_is_just_empty(self, client: TestClient):
        rows = rows_of(client.get("/api/reportes/historial.csv", params={"modelo": "inventado"}))
        assert len(rows) == 2


def test_the_file_name_uses_the_given_day():
    assert report_service.file_name("historial", datetime(2026, 1, 5, tzinfo=UTC)) == (
        "historial_2026-01-05.csv"
    )
