import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import FaceEmbedding, Persona, RecognitionLog
from app.services import embedding_service
from app.services.recognition_service import confidence_level
from tests.fakes import FakeEngine, face


def recognize(client: TestClient, data: bytes, name: str = "cara.png"):
    return client.post("/api/reconocimiento", files={"imagen": (name, data, "image/png")})


def logs(db: Session) -> list[RecognitionLog]:
    return list(db.scalars(select(RecognitionLog).order_by(RecognitionLog.id)))


def test_a_registered_face_is_recognized_with_the_name_and_a_perfect_similarity(
    client: TestClient, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    response = recognize(client, make_image(1))
    assert response.status_code == 200
    result = response.json()["resultado"]
    assert response.json()["success"] is True
    assert result["persona_id"] == ana["id"]
    assert result["nombre"] == "Ana Torres"
    assert result["coincide"] is True
    assert result["similitud"] == pytest.approx(1.0, abs=1e-4)
    assert result["distancia"] == pytest.approx(0.0, abs=1e-3)
    assert result["umbral"] == 0.75
    assert result["probabilidad_calibrada"] is None
    assert result["confianza"] == "alta"


def test_the_answer_has_exactly_the_fields_of_the_contract(
    client: TestClient, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    result = recognize(client, make_image(1)).json()["resultado"]
    assert set(result) == {
        "persona_id",
        "nombre",
        "similitud",
        "distancia",
        "umbral",
        "coincide",
        "probabilidad_calibrada",
        "confianza",
        "etiqueta",
    }


def test_the_distance_is_two_times_one_minus_the_similarity(
    client: TestClient, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    for seed in (1, 2, 3):
        result = recognize(client, make_image(seed)).json()["resultado"]
        assert result["distancia"] == pytest.approx(2 * (1 - result["similitud"]))


def test_the_right_person_is_picked_among_several(client: TestClient, register, make_image):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    luis = register("Luis Ramírez", "luis@example.com", seeds=(2,))
    register("Carlos Ruiz", "carlos@example.com", seeds=(3,))
    result = recognize(client, make_image(2)).json()["resultado"]
    assert result["persona_id"] == luis["id"]
    assert result["nombre"] == "Luis Ramírez"


def test_a_person_is_matched_by_the_best_of_their_faces(client: TestClient, register, make_image):
    ana = register("Ana Torres", "ana@example.com", seeds=(1, 2, 3, 4, 5))
    register("Luis Ramírez", "luis@example.com", seeds=(6,))
    result = recognize(client, make_image(4)).json()["resultado"]
    assert result["persona_id"] == ana["id"]
    assert result["similitud"] == pytest.approx(1.0, abs=1e-4)


def test_the_same_photo_with_other_brightness_is_still_recognized(
    client: TestClient, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    pixels = np.random.default_rng(1).integers(0, 256, (160, 160, 3), dtype=np.uint8)
    darker = np.clip(pixels.astype(np.float32) * 0.8 + 15, 0, 255).astype(np.uint8)
    ok, encoded = cv2.imencode(".png", darker)
    assert ok
    result = recognize(client, encoded.tobytes()).json()["resultado"]
    assert result["persona_id"] == ana["id"]
    assert result["coincide"] is True


def test_an_unknown_face_is_rejected_without_naming_anyone(
    client: TestClient, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    response = recognize(client, make_image(99))
    assert response.status_code == 200
    result = response.json()["resultado"]
    assert result["coincide"] is False
    assert result["persona_id"] is None
    assert result["nombre"] is None
    assert result["confianza"] == "baja"
    assert result["similitud"] < 0.75
    assert "Ana" not in response.text


def test_a_rejection_still_reports_how_similar_the_closest_face_was(client: TestClient, register):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    known = (
        np.random.default_rng(1).integers(0, 256, (160, 160, 3), dtype=np.uint8).astype(np.float32)
    )
    other = (
        np.random.default_rng(99).integers(0, 256, (160, 160, 3), dtype=np.uint8).astype(np.float32)
    )
    # 40 % of Ana's picture in a picture of something else: similar, but not enough
    ok, encoded = cv2.imencode(".png", (0.4 * known + 0.6 * other).astype(np.uint8))
    assert ok

    result = recognize(client, encoded.tobytes()).json()["resultado"]

    assert 0.1 < result["similitud"] < 0.75
    assert result["coincide"] is False
    assert result["persona_id"] is None
    assert result["distancia"] == pytest.approx(2 * (1 - result["similitud"]))


def test_without_registered_faces_the_answer_is_409_and_nothing_is_logged(
    client: TestClient, db: Session, make_image
):
    response = recognize(client, make_image(1))
    assert response.status_code == 409
    assert response.json() == {
        "success": False,
        "error": "Aún no hay rostros registrados. Registra a una persona primero.",
    }
    assert logs(db) == []


def test_people_without_faces_do_not_count_as_registered_faces(
    client: TestClient, db: Session, register, make_image
):
    register("Sin Rostro", "sin@example.com")
    assert recognize(client, make_image(1)).status_code == 409


def test_every_attempt_is_logged_with_what_was_decided(
    client: TestClient, db: Session, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1))
    recognize(client, make_image(99))

    hit, miss = logs(db)
    assert hit.persona_id == ana["id"]
    assert hit.coincide is True
    assert hit.similitud == pytest.approx(1.0, abs=1e-4)
    assert hit.umbral == 0.75
    assert hit.probabilidad_calibrada is None
    assert hit.created_at.tzinfo is not None
    # The rejection keeps the score but not the candidate
    assert miss.persona_id is None
    assert miss.coincide is False
    assert miss.similitud < 0.75
    assert miss.distancia == pytest.approx(2 * (1 - miss.similitud))


def test_a_failed_request_is_not_logged(client: TestClient, db: Session, register, make_image):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, b"no soy una imagen")
    recognize(client, make_image(1)[:40])
    assert logs(db) == []


def use_threshold(value: float) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, recognition_threshold=value
    )


def test_the_threshold_comes_from_the_configuration(client: TestClient, register):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    pixels = np.random.default_rng(1).integers(0, 256, (160, 160, 3), dtype=np.uint8)
    ok, lossy = cv2.imencode(".jpg", pixels)
    assert ok

    # The same picture after JPEG compression: very similar, but not identical
    default = recognize(client, lossy.tobytes(), "cara.jpg").json()["resultado"]
    assert default["umbral"] == 0.75
    assert 0.9 < default["similitud"] < 0.999999
    assert default["coincide"] is True

    use_threshold(0.999999)
    strict = recognize(client, lossy.tobytes(), "cara.jpg").json()["resultado"]
    assert strict["umbral"] == 0.999999
    assert strict["similitud"] == default["similitud"]
    assert strict["coincide"] is False
    assert strict["persona_id"] is None


def test_the_match_flips_exactly_at_the_threshold(client: TestClient, register, make_image):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    similarity = recognize(client, make_image(2)).json()["resultado"]["similitud"]

    use_threshold(similarity)
    assert recognize(client, make_image(2)).json()["resultado"]["coincide"] is True
    use_threshold(similarity + 1e-6)
    assert recognize(client, make_image(2)).json()["resultado"]["coincide"] is False


def test_people_marked_inactive_are_not_recognized(
    client: TestClient, db: Session, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    db.get(Persona, ana["id"]).activo = False
    db.commit()
    assert recognize(client, make_image(1)).status_code == 409


def test_faces_saved_by_another_engine_are_not_compared(
    client: TestClient, db: Session, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    for row in db.scalars(select(FaceEmbedding)):
        row.modelo = "insightface"
    db.commit()
    assert recognize(client, make_image(1)).status_code == 409


def test_faces_of_another_engine_do_not_get_in_the_way_of_the_right_ones(
    client: TestClient, db: Session, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    luis = register("Luis Ramírez", "luis@example.com", seeds=(2,))
    for row in db.scalars(select(FaceEmbedding).where(FaceEmbedding.persona_id != luis["id"])):
        row.modelo = "insightface"
        # A vector of a different size: comparing it would fail
        row.embedding = b"\x00" * 8
    db.commit()
    result = recognize(client, make_image(2)).json()["resultado"]
    assert result["persona_id"] == luis["id"]


def test_the_image_field_is_required(client: TestClient, register):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    response = client.post("/api/reconocimiento")
    assert response.status_code == 422
    assert response.json() == {"success": False, "error": "Falta la imagen."}


def test_a_text_value_in_place_of_the_image_is_refused(client: TestClient, register):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    response = client.post("/api/reconocimiento", data={"imagen": "hola"})
    assert response.status_code == 422
    assert response.json() == {"success": False, "error": "El campo «imagen» no es válido."}


def test_a_file_that_is_not_an_image_is_415(client: TestClient, register):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    response = recognize(client, b"%PDF-1.7 no soy una imagen", "doc.png")
    assert response.status_code == 415
    assert response.json()["error"] == "La imagen «doc.png» debe ser JPEG o PNG."


def test_a_corrupt_image_is_400(client: TestClient, register, make_image):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    response = recognize(client, make_image(1)[:40], "rota.png")
    assert response.status_code == 400
    assert response.json()["error"] == "No se pudo leer la imagen «rota.png»."


def test_an_image_over_the_size_limit_is_413(client: TestClient, register, make_image):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    data = make_image(1)
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, max_image_bytes=len(data) - 1
    )
    assert recognize(client, data).status_code == 413


def test_an_image_without_detail_has_no_face(client: TestClient, db: Session, register):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    ok, flat = cv2.imencode(".png", np.full((160, 160, 3), 90, dtype=np.uint8))
    assert ok
    response = recognize(client, flat.tobytes())
    assert response.status_code == 422
    assert response.json() == {
        "success": False,
        "error": "No se detectó un rostro.",
    }
    assert logs(db) == []


def test_without_an_engine_the_answer_is_503_and_nothing_is_logged(
    client: TestClient, db: Session, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    app.state.face_engine = None
    app.state.face_engine_error = "No se pudo cargar el motor facial."
    response = recognize(client, make_image(1))
    assert response.status_code == 503
    assert response.json() == {
        "success": False,
        "error": "El motor facial no está disponible. No se pudo cargar el motor facial.",
    }
    assert logs(db) == []


def test_several_faces_are_refused_and_nobody_is_identified(
    client: TestClient, db: Session, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    app.state.face_engine = FakeEngine([face(at=(0, 0)), face(at=(200, 0))])
    response = recognize(client, make_image(1))
    assert response.status_code == 422
    assert response.json()["error"] == (
        "Se detectaron 2 rostros. Envía una foto con una sola persona."
    )
    assert logs(db) == []


def test_a_low_quality_face_is_refused_and_not_logged(
    client: TestClient, db: Session, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    app.state.face_engine = FakeEngine([face(size=30)])
    response = recognize(client, make_image(1))
    assert response.status_code == 422
    assert response.json()["error"] == "El rostro es muy pequeño. Acércate a la cámara."
    assert logs(db) == []


def embedding_from_db(db: Session) -> np.ndarray:
    row = db.scalars(select(FaceEmbedding)).first()
    return embedding_service.from_bytes(row.embedding)


def engine_with_the_stored_vector(db: Session, threshold: float) -> FakeEngine:
    """A fake engine that finds the stored vector again: a perfect match."""
    engine = FakeEngine([face()], vector=embedding_from_db(db))
    engine.default_threshold = threshold
    # The stored vectors carry the simulated name: the fake one takes it to compare with them
    engine.name = "simulated"
    return engine


def test_the_threshold_of_the_engine_is_used_when_none_is_configured(
    client: TestClient, db: Session, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    app.state.face_engine = engine_with_the_stored_vector(db, threshold=0.3)
    result = recognize(client, make_image(1)).json()["resultado"]
    assert result["umbral"] == 0.3


def test_a_threshold_in_the_environment_overrides_the_one_of_the_engine(
    client: TestClient, db: Session, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    app.state.face_engine = engine_with_the_stored_vector(db, threshold=0.3)
    use_threshold(0.9)
    assert recognize(client, make_image(1)).json()["resultado"]["umbral"] == 0.9


def test_each_attempt_is_logged_with_the_model_that_made_the_comparison(
    client: TestClient, db: Session, register, make_image
):
    # A fake engine with its own name, so that the name cannot come from the column default
    app.state.face_engine = FakeEngine([face()])
    register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1))
    (attempt,) = logs(db)
    assert attempt.modelo == "fake"


def test_the_response_never_contains_vectors(client: TestClient, register, make_image):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    for seed in (1, 99):
        text = recognize(client, make_image(seed)).text
        assert "embedding" not in text
        assert "modelo" not in text


@pytest.mark.parametrize(
    ("similitud", "umbral", "coincide", "expected"),
    [
        # Not a match: low, whatever the number
        (0.74, 0.75, False, "baja"),
        (0.10, 0.75, False, "baja"),
        # A match by less than 0.10: media
        (0.75, 0.75, True, "media"),
        (0.84, 0.75, True, "media"),
        (0.8499, 0.75, True, "media"),
        # A match by 0.10 or more: alta. 0.85 - 0.75 is 0.0999999... in floating point
        (0.85, 0.75, True, "alta"),
        (0.86, 0.75, True, "alta"),
        (1.0, 0.75, True, "alta"),
        (0.60, 0.50, True, "alta"),
        (0.59, 0.50, True, "media"),
    ],
)
def test_confidence_is_a_rule_on_how_far_the_similarity_is_from_the_threshold(
    similitud: float, umbral: float, coincide: bool, expected: str
):
    assert confidence_level(similitud, umbral, coincide) == expected
