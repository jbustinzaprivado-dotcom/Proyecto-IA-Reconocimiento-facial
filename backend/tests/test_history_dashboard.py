from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.constants import HISTORY_LIMIT
from app.models import Persona, RecognitionLog


def recognize(client: TestClient, data: bytes):
    return client.post("/api/reconocimiento", files={"imagen": ("cara.png", data, "image/png")})


def log(db: Session, minutes: int, coincide: bool = False, persona_id: int | None = None):
    db.add(
        RecognitionLog(
            persona_id=persona_id,
            similitud=0.5,
            distancia=1.0,
            umbral=0.75,
            coincide=coincide,
            probabilidad_calibrada=None,
            created_at=datetime(2026, 9, 1, tzinfo=UTC) + timedelta(minutes=minutes),
        )
    )


class TestHistory:
    def test_it_is_empty_at_the_start(self, client: TestClient):
        response = client.get("/api/reconocimiento/historial")
        assert response.status_code == 200
        assert response.json() == {"success": True, "resultado": []}

    def test_each_attempt_shows_what_was_decided_with_the_name_when_there_was_a_match(
        self, client: TestClient, register, make_image
    ):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        recognize(client, make_image(1))
        recognize(client, make_image(99))

        items = client.get("/api/reconocimiento/historial").json()["resultado"]

        miss, hit = items
        assert set(hit) == {
            "id",
            "persona_id",
            "nombre",
            "similitud",
            "distancia",
            "umbral",
            "coincide",
            "probabilidad_calibrada",
            "created_at",
            "modelo",
            "etiqueta",
        }
        assert hit["persona_id"] == ana["id"]
        assert hit["nombre"] == "Ana Torres"
        assert hit["coincide"] is True
        assert hit["umbral"] == 0.75
        assert hit["probabilidad_calibrada"] is None
        assert miss["persona_id"] is None
        assert miss["nombre"] is None
        assert miss["coincide"] is False

    def test_each_attempt_says_which_model_made_it(self, client: TestClient, db: Session):
        log(db, 0)
        db.add(
            RecognitionLog(
                similitud=0.5,
                distancia=1.0,
                umbral=0.363,
                coincide=True,
                modelo="sface-2021dec",
                probabilidad_calibrada=None,
            )
        )
        db.commit()
        items = client.get("/api/reconocimiento/historial").json()["resultado"]
        assert sorted(item["modelo"] for item in items) == ["sface-2021dec", "simulated"]

    def test_the_most_recent_attempt_comes_first(self, client: TestClient, db: Session):
        for minutes in (5, 30, 10, 20):
            log(db, minutes)
        db.commit()
        dates = [
            item["created_at"]
            for item in client.get("/api/reconocimiento/historial").json()["resultado"]
        ]
        assert dates == sorted(dates, reverse=True)
        assert dates[0].startswith("2026-09-01T00:30:00")

    def test_attempts_at_the_same_instant_keep_the_latest_saved_first(
        self, client: TestClient, db: Session
    ):
        for _ in range(3):
            log(db, 0)
        db.commit()
        ids = [
            item["id"] for item in client.get("/api/reconocimiento/historial").json()["resultado"]
        ]
        assert ids == sorted(ids, reverse=True)

    def test_dates_are_utc(self, client: TestClient, db: Session):
        log(db, 0)
        db.commit()
        item = client.get("/api/reconocimiento/historial").json()["resultado"][0]
        assert item["created_at"] == "2026-09-01T00:00:00Z"

    def test_only_the_most_recent_200_are_returned(self, client: TestClient, db: Session):
        assert HISTORY_LIMIT == 200
        for minutes in range(HISTORY_LIMIT + 25):
            log(db, minutes)
        db.commit()

        items = client.get("/api/reconocimiento/historial").json()["resultado"]

        assert len(items) == HISTORY_LIMIT
        newest = datetime(2026, 9, 1, tzinfo=UTC) + timedelta(minutes=HISTORY_LIMIT + 24)
        assert items[0]["created_at"] == newest.strftime("%Y-%m-%dT%H:%M:%SZ")
        oldest_kept = newest - timedelta(minutes=HISTORY_LIMIT - 1)
        assert items[-1]["created_at"] == oldest_kept.strftime("%Y-%m-%dT%H:%M:%SZ")

    def test_exactly_200_attempts_are_all_returned(self, client: TestClient, db: Session):
        for minutes in range(HISTORY_LIMIT):
            log(db, minutes)
        db.commit()
        assert len(client.get("/api/reconocimiento/historial").json()["resultado"]) == HISTORY_LIMIT

    def test_the_name_of_a_person_who_no_longer_exists_is_empty_not_an_error(
        self, client: TestClient, db: Session, register
    ):
        ana = register("Ana Torres", "ana@example.com")
        log(db, 0, coincide=True, persona_id=ana["id"])
        db.commit()
        db.delete(db.get(Persona, ana["id"]))
        db.commit()

        item = client.get("/api/reconocimiento/historial").json()["resultado"][0]

        assert item["persona_id"] is None
        assert item["nombre"] is None
        assert item["coincide"] is True


class TestDashboard:
    def test_everything_is_zero_at_the_start(self, client: TestClient):
        response = client.get("/api/dashboard/resumen")
        assert response.status_code == 200
        assert response.json() == {
            "success": True,
            "resultado": {
                "total_personas": 0,
                "total_reconocimientos": 0,
                "total_coincidencias": 0,
            },
        }

    def test_the_three_totals_count_people_attempts_and_matches(
        self, client: TestClient, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        register("Luis Ramírez", "luis@example.com", seeds=(2,))
        register("Sin Rostro", "sin@example.com")
        for seed in (1, 1, 2, 99, 98):
            recognize(client, make_image(seed))

        result = client.get("/api/dashboard/resumen").json()["resultado"]

        assert result == {"total_personas": 3, "total_reconocimientos": 5, "total_coincidencias": 3}

    def test_the_totals_count_everything_not_only_what_the_history_shows(
        self, client: TestClient, db: Session
    ):
        for minutes in range(HISTORY_LIMIT + 50):
            log(db, minutes, coincide=minutes % 2 == 0)
        db.commit()

        result = client.get("/api/dashboard/resumen").json()["resultado"]

        assert result["total_reconocimientos"] == HISTORY_LIMIT + 50
        assert result["total_coincidencias"] == (HISTORY_LIMIT + 50) // 2

    def test_a_person_without_faces_counts_as_registered(self, client: TestClient, register):
        register("Sin Rostro", "sin@example.com")
        assert client.get("/api/dashboard/resumen").json()["resultado"]["total_personas"] == 1
