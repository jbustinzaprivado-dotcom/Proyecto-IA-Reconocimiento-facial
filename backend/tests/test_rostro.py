import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.main import app
from app.models import FaceEmbedding
from app.services import embedding_service
from app.services.face_engines import EMBEDDING_DIM
from tests.fakes import FakeEngine, face

MB = 1024 * 1024


def png(name: str, data: bytes):
    return ("imagenes", (name, data, "image/png"))


def stored(db: Session, persona_id: int) -> list[FaceEmbedding]:
    query = select(FaceEmbedding).where(FaceEmbedding.persona_id == persona_id)
    return list(db.scalars(query))


def test_saving_faces_reports_how_many_were_kept(client: TestClient, register, make_image):
    persona = register("Ana Torres", "ana@example.com")
    response = client.post(
        f"/api/personas/{persona['id']}/rostro",
        files=[png("a.png", make_image(1)), png("b.png", make_image(2))],
    )
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "resultado": {"persona_id": persona["id"], "imagenes_guardadas": 2},
    }


def test_one_vector_is_saved_per_image_with_the_engine_that_made_it(
    client: TestClient, db: Session, register
):
    persona = register("Ana Torres", "ana@example.com", seeds=(1, 2, 3))
    rows = stored(db, persona["id"])
    assert len(rows) == 3
    assert {row.modelo for row in rows} == {"simulated"}
    for row in rows:
        vector = embedding_service.from_bytes(row.embedding)
        assert vector.shape == (EMBEDDING_DIM,)
        assert np.linalg.norm(vector) == pytest.approx(1.0, abs=1e-5)


def test_the_response_never_contains_the_vectors(client: TestClient, register, make_image):
    persona = register("Ana Torres", "ana@example.com")
    response = client.post(
        f"/api/personas/{persona['id']}/rostro", files=[png("a.png", make_image(1))]
    )
    assert set(response.json()["resultado"]) == {"persona_id", "imagenes_guardadas"}


def test_between_one_and_five_images_are_accepted(client: TestClient, register, make_image):
    for count in (1, 5):
        persona = register(f"Persona {count}", f"p{count}@example.com")
        files = [png(f"{n}.png", make_image(n)) for n in range(count)]
        response = client.post(f"/api/personas/{persona['id']}/rostro", files=files)
        assert response.status_code == 200
        assert response.json()["resultado"]["imagenes_guardadas"] == count


def test_six_images_are_refused_and_nothing_is_saved(
    client: TestClient, db: Session, register, make_image
):
    persona = register("Ana Torres", "ana@example.com")
    files = [png(f"{n}.png", make_image(n)) for n in range(6)]
    response = client.post(f"/api/personas/{persona['id']}/rostro", files=files)
    assert response.status_code == 422
    assert response.json() == {"success": False, "error": "Debes enviar entre 1 y 5 imágenes."}
    assert stored(db, persona["id"]) == []


def test_the_limit_of_images_comes_from_the_configuration(client: TestClient, register, make_image):
    persona = register("Ana Torres", "ana@example.com")
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, max_images_per_person=2
    )
    files = [png(f"{n}.png", make_image(n)) for n in range(3)]
    response = client.post(f"/api/personas/{persona['id']}/rostro", files=files)
    assert response.status_code == 422
    assert response.json()["error"] == "Debes enviar entre 1 y 2 imágenes."


def test_sending_no_images_is_refused(client: TestClient, register):
    persona = register("Ana Torres", "ana@example.com")
    response = client.post(f"/api/personas/{persona['id']}/rostro")
    assert response.status_code == 422
    assert response.json() == {"success": False, "error": "Debes enviar entre 1 y 5 imágenes."}


def test_a_person_that_does_not_exist_is_404_before_looking_at_the_images(client: TestClient):
    response = client.post("/api/personas/999/rostro", files=[png("mala.png", b"no soy imagen")])
    assert response.status_code == 404
    assert response.json() == {"success": False, "error": "La persona no existe."}


def test_saving_again_replaces_the_previous_faces(
    client: TestClient, db: Session, register, make_image
):
    persona = register("Ana Torres", "ana@example.com", seeds=(1, 2, 3))
    before = {row.id for row in stored(db, persona["id"])}

    response = client.post(
        f"/api/personas/{persona['id']}/rostro", files=[png("nueva.png", make_image(9))]
    )

    assert response.json()["resultado"]["imagenes_guardadas"] == 1
    rows = stored(db, persona["id"])
    assert len(rows) == 1
    assert rows[0].id not in before


def test_retrying_the_same_upload_does_not_duplicate_anything(
    client: TestClient, db: Session, register, make_image
):
    persona = register("Ana Torres", "ana@example.com")
    files = [png("a.png", make_image(1)), png("b.png", make_image(2))]
    for _ in range(3):
        client.post(f"/api/personas/{persona['id']}/rostro", files=files)
    assert len(stored(db, persona["id"])) == 2


def test_replacing_the_faces_of_one_person_leaves_the_others_alone(
    client: TestClient, db: Session, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1, 2))
    luis = register("Luis Ramírez", "luis@example.com", seeds=(3, 4, 5))
    ana_before = {row.id for row in stored(db, ana["id"])}

    client.post(f"/api/personas/{luis['id']}/rostro", files=[png("nueva.png", make_image(9))])

    assert {row.id for row in stored(db, ana["id"])} == ana_before
    assert len(stored(db, luis["id"])) == 1


def test_one_bad_image_means_nothing_is_saved_not_even_the_good_ones(
    client: TestClient, db: Session, register, make_image
):
    persona = register("Ana Torres", "ana@example.com", seeds=(1,))
    old_ids = {row.id for row in stored(db, persona["id"])}

    response = client.post(
        f"/api/personas/{persona['id']}/rostro",
        files=[png("buena.png", make_image(2)), png("mala.png", b"no soy una imagen")],
    )

    assert response.status_code == 415
    assert {row.id for row in stored(db, persona["id"])} == old_ids


def test_photos_without_a_name_are_told_apart_by_their_position(
    client: TestClient, db: Session, register, make_image
):
    persona = register("Ana Torres", "ana@example.com")
    flat = np.full((160, 160, 3), 130, dtype=np.uint8)
    ok, lisa = cv2.imencode(".png", flat)
    assert ok
    files = [
        ("imagenes", ("blob", make_image(1), "image/png")),
        ("imagenes", ("blob", lisa.tobytes(), "image/png")),
        ("imagenes", ("blob", make_image(3), "image/png")),
    ]
    response = client.post(f"/api/personas/{persona['id']}/rostro", files=files)
    assert response.status_code == 422
    assert response.json()["error"] == "Imagen 2: No se detectó un rostro."
    assert stored(db, persona["id"]) == []


def test_a_file_that_is_not_a_jpeg_or_png_is_415_with_its_name(client: TestClient, register):
    persona = register("Ana Torres", "ana@example.com")
    response = client.post(
        f"/api/personas/{persona['id']}/rostro",
        files=[png("engano.jpg", b"GIF89a esto no es un jpeg")],
    )
    assert response.status_code == 415
    assert response.json() == {
        "success": False,
        "error": "La imagen 1 «engano.jpg» debe ser JPEG o PNG.",
    }


def test_a_jpeg_is_accepted(client: TestClient, register, make_image):
    persona = register("Ana Torres", "ana@example.com")
    response = client.post(
        f"/api/personas/{persona['id']}/rostro",
        files=[("imagenes", ("foto.jpg", make_image(1, ".jpg"), "image/jpeg"))],
    )
    assert response.status_code == 200


def test_the_type_sent_by_the_client_is_not_trusted(client: TestClient, register, make_image):
    persona = register("Ana Torres", "ana@example.com")
    response = client.post(
        f"/api/personas/{persona['id']}/rostro",
        files=[("imagenes", ("foto.png", make_image(1), "text/plain"))],
    )
    assert response.status_code == 200


def test_a_corrupt_image_is_400(client: TestClient, register, make_image):
    persona = register("Ana Torres", "ana@example.com")
    response = client.post(
        f"/api/personas/{persona['id']}/rostro", files=[png("rota.png", make_image(1)[:40])]
    )
    assert response.status_code == 400
    assert response.json() == {"success": False, "error": "No se pudo leer la imagen 1 «rota.png»."}


def test_an_image_over_the_size_limit_is_413(client: TestClient, register, make_image):
    persona = register("Ana Torres", "ana@example.com")
    data = make_image(1)
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, max_image_bytes=len(data) - 1
    )
    response = client.post(f"/api/personas/{persona['id']}/rostro", files=[png("grande.png", data)])
    assert response.status_code == 413
    assert response.json()["error"].startswith("La imagen 1 «grande.png» pesa más de ")


def test_the_default_size_limit_is_5_mb(client: TestClient, register):
    persona = register("Ana Torres", "ana@example.com")
    response = client.post(
        f"/api/personas/{persona['id']}/rostro",
        files=[png("enorme.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * MB))],
    )
    assert response.status_code == 413
    assert response.json()["error"] == "La imagen 1 «enorme.png» pesa más de 5 MB."


def test_an_image_without_detail_has_no_face_and_nothing_is_saved(
    client: TestClient, db: Session, register, make_image
):
    persona = register("Ana Torres", "ana@example.com")
    ok, flat = cv2.imencode(".png", np.full((64, 64, 3), 200, dtype=np.uint8))
    assert ok
    response = client.post(
        f"/api/personas/{persona['id']}/rostro",
        files=[png("buena.png", make_image(1)), png("lisa.png", flat.tobytes())],
    )
    assert response.status_code == 422
    assert response.json() == {
        "success": False,
        "error": "Imagen 2 «lisa.png»: No se detectó un rostro.",
    }
    assert stored(db, persona["id"]) == []


def test_without_an_engine_the_answer_is_503_with_the_reason(
    client: TestClient, db: Session, register, make_image
):
    persona = register("Ana Torres", "ana@example.com")
    app.state.face_engine = None
    app.state.face_engine_error = "Faltan los pesos de InsightFace. Ejecuta: download_models"
    response = client.post(
        f"/api/personas/{persona['id']}/rostro", files=[png("a.png", make_image(1))]
    )
    assert response.status_code == 503
    assert response.json() == {
        "success": False,
        "error": "El motor facial no está disponible. Faltan los pesos de InsightFace. "
        "Ejecuta: download_models",
    }
    assert stored(db, persona["id"]) == []


def use_engine(engine: FakeEngine) -> None:
    app.state.face_engine = engine


def test_the_vectors_are_saved_with_the_name_of_the_engine_that_made_them(
    client: TestClient, db: Session, register, make_image
):
    persona = register("Ana Torres", "ana@example.com")
    use_engine(FakeEngine([face()], vector=np.array([0.0, 0.0, 1.0], dtype=np.float32)))
    client.post(f"/api/personas/{persona['id']}/rostro", files=[png("a.png", make_image(1))])
    (row,) = stored(db, persona["id"])
    assert row.modelo == "fake"
    assert np.array_equal(embedding_service.from_bytes(row.embedding), [0.0, 0.0, 1.0])


def test_an_image_with_several_faces_is_refused_by_name_and_nothing_is_saved(
    client: TestClient, db: Session, register, make_image
):
    persona = register("Ana Torres", "ana@example.com", seeds=(1,))
    old_ids = {row.id for row in stored(db, persona["id"])}
    use_engine(FakeEngine([face(at=(0, 0)), face(at=(200, 0))]))
    response = client.post(
        f"/api/personas/{persona['id']}/rostro", files=[png("grupo.png", make_image(2))]
    )
    assert response.status_code == 422
    assert response.json() == {
        "success": False,
        "error": "Imagen 1 «grupo.png»: Se detectaron 2 rostros. "
        "Envía una foto con una sola persona.",
    }
    assert {row.id for row in stored(db, persona["id"])} == old_ids


def test_a_face_that_is_too_small_is_refused_by_name(client: TestClient, register, make_image):
    persona = register("Ana Torres", "ana@example.com")
    use_engine(FakeEngine([face(size=40)]))
    response = client.post(
        f"/api/personas/{persona['id']}/rostro", files=[png("lejos.png", make_image(1))]
    )
    assert response.status_code == 422
    assert response.json()["error"] == (
        "Imagen 1 «lejos.png»: El rostro es muy pequeño. Acércate a la cámara."
    )


def test_the_quality_limits_come_from_the_configuration(client: TestClient, register, make_image):
    persona = register("Ana Torres", "ana@example.com")
    app.dependency_overrides[get_settings] = lambda: Settings(_env_file=None, min_face_size=300)
    response = client.post(
        f"/api/personas/{persona['id']}/rostro", files=[png("a.png", make_image(1))]
    )
    assert response.status_code == 422
    assert "muy pequeño" in response.json()["error"]
