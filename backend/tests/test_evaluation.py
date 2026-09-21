import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import FaceEmbedding, Persona, RecognitionLog
from app.services.recognition_service import confidence_level, label_of
from tests.fakes import FakeEngine, face


def recognize(client: TestClient, data: bytes, esperado: str | None = None):
    form = {} if esperado is None else {"esperado": esperado}
    return client.post(
        "/api/reconocimiento", files={"imagen": ("cara.png", data, "image/png")}, data=form
    )


def attempts(db: Session) -> list[RecognitionLog]:
    return list(db.scalars(select(RecognitionLog).order_by(RecognitionLog.id)))


@pytest.mark.parametrize(
    ("esperado", "esperado_id", "coincide", "persona_id", "expected"),
    [
        (None, None, True, 1, None),
        (None, None, False, None, None),
        ("desconocido", None, True, 5, "falso_positivo"),
        ("desconocido", None, False, None, "rechazo_correcto"),
        ("persona", 1, True, 1, "acierto"),
        ("persona", 1, True, 2, "falso_positivo"),
        ("persona", 1, False, None, "falso_negativo"),
        ("persona", None, True, 1, None),
        ("persona", None, False, None, None),
        ("otra cosa", 1, True, 1, None),
    ],
)
def test_what_an_attempt_turned_out_to_be_given_who_was_really_there(
    esperado, esperado_id, coincide, persona_id, expected
):
    assert label_of(esperado, esperado_id, coincide, persona_id) == expected


class TestEvaluationMode:
    def test_the_right_person_in_front_of_the_camera_is_a_hit(
        self, client: TestClient, db: Session, register, make_image
    ):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        response = recognize(client, make_image(1), esperado=str(ana["id"]))
        assert response.status_code == 200
        assert response.json()["resultado"]["etiqueta"] == "acierto"
        (attempt,) = attempts(db)
        assert attempt.esperado == "persona"
        assert attempt.esperado_persona_id == ana["id"]
        assert attempt.candidato_correcto is True
        assert attempt.persona_id == ana["id"]

    def test_a_stranger_who_is_rejected_is_a_correct_rejection(
        self, client: TestClient, db: Session, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        response = recognize(client, make_image(99), esperado="desconocido")
        assert response.json()["resultado"]["etiqueta"] == "rechazo_correcto"
        (attempt,) = attempts(db)
        assert attempt.esperado == "desconocido"
        assert attempt.esperado_persona_id is None
        assert attempt.candidato_correcto is None

    def test_a_registered_person_who_was_said_to_be_a_stranger_is_a_false_positive(
        self, client: TestClient, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        response = recognize(client, make_image(1), esperado="desconocido")
        assert response.json()["resultado"]["etiqueta"] == "falso_positivo"

    def test_being_taken_for_someone_else_is_a_false_positive_and_the_other_one_is_named(
        self, client: TestClient, db: Session, register, make_image
    ):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        luis = register("Luis Ramírez", "luis@example.com", seeds=(2,))
        response = recognize(client, make_image(2), esperado=str(ana["id"]))
        result = response.json()["resultado"]
        assert result["etiqueta"] == "falso_positivo"
        assert result["persona_id"] == luis["id"]
        (attempt,) = attempts(db)
        assert attempt.candidato_correcto is False

    def test_a_missed_person_is_a_false_negative_and_nobody_is_named(
        self, client: TestClient, db: Session, register, make_image
    ):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        response = recognize(client, make_image(99), esperado=str(ana["id"]))
        result = response.json()["resultado"]
        assert result["etiqueta"] == "falso_negativo"
        assert result["persona_id"] is None
        assert result["nombre"] is None

    def two_people_with_known_vectors(self, register) -> tuple[dict, dict, FakeEngine]:
        """Ana is [1, 0, 0] and Luis is [0, 1, 0]; what the camera sees is set by each test."""
        engine = FakeEngine([face()])
        app.state.face_engine = engine
        engine.vector = np.array([1.0, 0.0, 0.0], dtype=np.float32)
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        engine.vector = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        luis = register("Luis Ramírez", "luis@example.com", seeds=(2,))
        return ana, luis, engine

    def strict(self) -> None:
        app.dependency_overrides[get_settings] = lambda: Settings(
            _env_file=None, recognition_threshold=0.99
        )

    def test_below_the_threshold_it_is_kept_whether_the_closest_was_the_expected_person(
        self, client: TestClient, db: Session, register, make_image
    ):
        ana, luis, engine = self.two_people_with_known_vectors(register)
        engine.vector = np.array([0.9, 0.3, 0.0], dtype=np.float32)  # the closest one is Ana
        self.strict()
        for expected in (ana, luis):
            response = recognize(client, make_image(3), esperado=str(expected["id"]))
            assert response.json()["resultado"]["etiqueta"] == "falso_negativo"
        first, second = attempts(db)
        assert first.candidato_correcto is True
        assert second.candidato_correcto is False

    def test_the_wrong_closest_candidate_is_never_kept_only_that_it_was_wrong(
        self, client: TestClient, db: Session, register, make_image
    ):
        ana, luis, engine = self.two_people_with_known_vectors(register)
        engine.vector = np.array([0.3, 0.9, 0.0], dtype=np.float32)  # the closest one is Luis
        self.strict()
        recognize(client, make_image(3), esperado=str(ana["id"]))
        recognize(client, make_image(3), esperado="desconocido")
        for attempt in attempts(db):
            assert attempt.persona_id is None
            assert attempt.esperado_persona_id in (ana["id"], None)
        assert attempts(db)[0].candidato_correcto is False
        assert attempts(db)[1].candidato_correcto is None

    def test_a_hit_and_a_wrong_identity_are_told_apart_with_known_vectors(
        self, client: TestClient, db: Session, register, make_image
    ):
        ana, luis, engine = self.two_people_with_known_vectors(register)
        engine.vector = np.array([0.9, 0.3, 0.0], dtype=np.float32)
        assert (
            recognize(client, make_image(3), esperado=str(ana["id"])).json()["resultado"][
                "etiqueta"
            ]
            == "acierto"
        )
        wrong = recognize(client, make_image(3), esperado=str(luis["id"])).json()["resultado"]
        assert wrong["etiqueta"] == "falso_positivo"
        assert wrong["nombre"] == "Ana Torres"

    def test_a_normal_attempt_has_no_label_and_no_evaluation_data(
        self, client: TestClient, db: Session, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        response = recognize(client, make_image(1))
        assert response.json()["resultado"]["etiqueta"] is None
        (attempt,) = attempts(db)
        assert (attempt.esperado, attempt.esperado_persona_id, attempt.candidato_correcto) == (
            None,
            None,
            None,
        )

    @pytest.mark.parametrize("blank", ["", "   "])
    def test_an_empty_value_means_no_evaluation(
        self, client: TestClient, db: Session, register, make_image, blank
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        response = recognize(client, make_image(1), esperado=blank)
        assert response.status_code == 200
        assert response.json()["resultado"]["etiqueta"] is None
        assert attempts(db)[0].esperado is None

    def test_the_word_and_the_number_are_read_forgivingly(
        self, client: TestClient, register, make_image
    ):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        assert recognize(client, make_image(99), esperado=" DESCONOCIDO ").status_code == 200
        assert recognize(client, make_image(1), esperado=f" {ana['id']} ").status_code == 200

    @pytest.mark.parametrize("value", ["abc", "-1", "1.5", "1 2", "desconocida", "0x1"])
    def test_a_value_that_is_not_understood_is_refused_in_spanish(
        self, client: TestClient, db: Session, register, make_image, value
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        response = recognize(client, make_image(1), esperado=value)
        assert response.status_code == 422
        assert response.json() == {
            "success": False,
            "error": "El valor de «esperado» no es válido. "
            "Usa «desconocido» o el id de una persona.",
        }
        assert attempts(db) == []

    def test_a_person_that_does_not_exist_is_refused(
        self, client: TestClient, db: Session, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        response = recognize(client, make_image(1), esperado="999")
        assert response.status_code == 422
        assert response.json()["error"] == "La persona esperada no existe."
        assert attempts(db) == []

    def test_a_person_without_faces_cannot_be_expected(
        self, client: TestClient, db: Session, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        sin_rostro = register("Sin Rostro", "sin@example.com")
        response = recognize(client, make_image(1), esperado=str(sin_rostro["id"]))
        assert response.status_code == 422
        assert response.json()["error"] == (
            "La persona esperada no tiene rostros registrados con este modelo."
        )
        assert attempts(db) == []

    def test_faces_of_another_model_do_not_count_as_registered_faces(
        self, client: TestClient, db: Session, register, make_image
    ):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        luis = register("Luis Ramírez", "luis@example.com", seeds=(2,))
        for row in db.scalars(select(FaceEmbedding).where(FaceEmbedding.persona_id == ana["id"])):
            row.modelo = "insightface-buffalo_l"
        db.commit()
        response = recognize(client, make_image(2), esperado=str(ana["id"]))
        assert response.status_code == 422
        assert "no tiene rostros registrados con este modelo" in response.json()["error"]
        assert recognize(client, make_image(2), esperado=str(luis["id"])).status_code == 200

    def test_an_inactive_person_cannot_be_expected(
        self, client: TestClient, db: Session, register, make_image
    ):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        register("Luis Ramírez", "luis@example.com", seeds=(2,))
        db.get(Persona, ana["id"]).activo = False
        db.commit()
        assert recognize(client, make_image(2), esperado=str(ana["id"])).status_code == 422

    def test_the_value_is_checked_before_the_image_is_read(self, client: TestClient, register):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        response = recognize(client, b"no soy una imagen", esperado="999")
        assert response.status_code == 422
        assert response.json()["error"] == "La persona esperada no existe."

    def test_a_request_that_fails_afterwards_leaves_no_label_behind(
        self, client: TestClient, db: Session, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        assert recognize(client, b"no soy una imagen", esperado="desconocido").status_code == 415
        app.state.face_engine = FakeEngine([face(at=(0, 0)), face(at=(200, 0))])
        assert recognize(client, make_image(1), esperado="desconocido").status_code == 422
        assert attempts(db) == []

    def test_without_registered_faces_it_is_still_a_409_and_nothing_is_kept(
        self, client: TestClient, db: Session, make_image
    ):
        response = recognize(client, make_image(1), esperado="desconocido")
        assert response.status_code == 409
        assert attempts(db) == []

    def test_the_history_shows_the_model_and_the_label_of_each_attempt(
        self, client: TestClient, register, make_image
    ):
        ana = register("Ana Torres", "ana@example.com", seeds=(1,))
        recognize(client, make_image(1))
        recognize(client, make_image(1), esperado=str(ana["id"]))
        recognize(client, make_image(99), esperado="desconocido")
        items = client.get("/api/reconocimiento/historial").json()["resultado"]
        assert [i["etiqueta"] for i in items] == ["rechazo_correcto", "acierto", None]
        assert {i["modelo"] for i in items} == {"simulated"}


class TestMeasurementsAreKept:
    def test_size_sharpness_brightness_and_confidence_of_each_attempt_are_saved(
        self, client: TestClient, db: Session, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        recognize(client, make_image(1))
        (attempt,) = attempts(db)
        assert attempt.tamano_rostro == 160
        assert attempt.confianza_deteccion == 1.0
        assert attempt.nitidez > 1.0
        assert 100 < attempt.brillo < 155

    def test_what_the_engine_reports_is_what_is_saved(
        self, client: TestClient, db: Session, register, make_image
    ):
        app.state.face_engine = FakeEngine([face(size=120, score=0.87)])
        register("Ana Torres", "ana@example.com", seeds=(1,))
        recognize(client, make_image(3))
        (attempt,) = attempts(db)
        assert attempt.tamano_rostro == 120
        assert attempt.confianza_deteccion == pytest.approx(0.87)

    def test_registering_a_face_keeps_no_attempt(self, client: TestClient, db: Session, register):
        register("Ana Torres", "ana@example.com", seeds=(1, 2))
        assert attempts(db) == []


class TestConfidenceMargin:
    def test_the_margin_defaults_to_0_10_as_before(self):
        assert confidence_level(0.85, 0.75, True) == "alta"
        assert confidence_level(0.84, 0.75, True) == "media"

    def test_another_margin_moves_the_line_between_media_and_alta(self):
        assert confidence_level(0.85, 0.75, True, margin=0.20) == "media"
        assert confidence_level(0.95, 0.75, True, margin=0.20) == "alta"
        assert confidence_level(0.80, 0.75, True, margin=0.05) == "alta"

    def test_a_zero_margin_makes_every_match_alta(self):
        assert confidence_level(0.75, 0.75, True, margin=0.0) == "alta"

    def test_a_rejection_is_baja_whatever_the_margin(self):
        assert confidence_level(0.1, 0.75, False, margin=0.0) == "baja"

    def test_the_margin_comes_from_the_configuration(
        self, client: TestClient, register, make_image
    ):
        register("Ana Torres", "ana@example.com", seeds=(1,))
        assert recognize(client, make_image(1)).json()["resultado"]["confianza"] == "alta"
        app.dependency_overrides[get_settings] = lambda: Settings(
            _env_file=None, confidence_margin=0.5
        )
        # The same photo: similarity 1.0 against the threshold 0.75 clears it by 0.25 only
        assert recognize(client, make_image(1)).json()["resultado"]["confianza"] == "media"

    def test_the_margin_must_be_between_0_and_1(self):
        with pytest.raises(ValueError):
            Settings(_env_file=None, confidence_margin=-0.1)
        with pytest.raises(ValueError):
            Settings(_env_file=None, confidence_margin=1.1)
