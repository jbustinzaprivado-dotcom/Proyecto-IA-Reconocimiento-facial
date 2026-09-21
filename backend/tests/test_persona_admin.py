from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Auditoria,
    FaceEmbedding,
    MlTrainingRecord,
    Persona,
    RecognitionLog,
)
from app.services import ml_dataset_service


def recognize(client: TestClient, data: bytes, expected: str | None = None):
    form = {} if expected is None else {"esperado": expected}
    return client.post(
        "/api/reconocimiento", files={"imagen": ("cara.png", data, "image/png")}, data=form
    )


def count(db: Session, model) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model))


def people(client: TestClient) -> dict[int, dict]:
    return {p["id"]: p for p in client.get("/api/personas").json()["resultado"]}


# --- how many faces each person has ---------------------------------------------------------


def test_the_list_says_how_many_faces_each_person_has(client: TestClient, register):
    ana = register("Ana Torres", "ana@example.com", seeds=(1, 2, 3))
    luis = register("Luis Ramírez", "luis@example.com", seeds=(4,))
    sin = register("Sin Rostro", "sin@example.com")
    listed = people(client)
    assert (listed[ana["id"]]["rostros"], listed[luis["id"]]["rostros"]) == (3, 1)
    assert listed[sin["id"]]["rostros"] == 0


def test_only_the_faces_of_the_model_in_use_are_counted(client: TestClient, db: Session, register):
    ana = register("Ana Torres", "ana@example.com", seeds=(1, 2))
    first = db.scalars(select(FaceEmbedding).order_by(FaceEmbedding.id)).first()
    first.modelo = "insightface"
    db.commit()
    assert people(client)[ana["id"]]["rostros"] == 1


def test_saving_faces_again_replaces_the_count(client: TestClient, register, make_image):
    ana = register("Ana Torres", "ana@example.com", seeds=(1, 2, 3))
    files = [("imagenes", ("x.png", make_image(9), "image/png"))]
    assert client.post(f"/api/personas/{ana['id']}/rostro", files=files).status_code == 200
    assert people(client)[ana["id"]]["rostros"] == 1


# --- activating and deactivating -----------------------------------------------------------


def test_a_person_can_be_deactivated_and_activated_again(client: TestClient, db: Session, register):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    off = client.patch(f"/api/personas/{ana['id']}", json={"activo": False})
    assert off.status_code == 200
    assert off.json()["resultado"]["activo"] is False
    assert db.get(Persona, ana["id"]).activo is False
    on = client.patch(f"/api/personas/{ana['id']}", json={"activo": True})
    assert on.json()["resultado"]["activo"] is True


def test_the_answer_to_a_change_is_the_person_and_keeps_nothing_else(client: TestClient, register):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    person = client.patch(f"/api/personas/{ana['id']}", json={"activo": False}).json()["resultado"]
    assert person["nombre"] == "Ana Torres" and person["email"] == "ana@example.com"
    assert "embedding" not in person and set(person) == set(ana)


def test_a_deactivated_person_is_no_longer_recognized_and_is_again_when_activated(
    client: TestClient, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    register("Luis Ramírez", "luis@example.com", seeds=(2,))
    assert recognize(client, make_image(1)).json()["resultado"]["persona_id"] == ana["id"]
    client.patch(f"/api/personas/{ana['id']}", json={"activo": False})
    assert recognize(client, make_image(1)).json()["resultado"]["persona_id"] != ana["id"]
    client.patch(f"/api/personas/{ana['id']}", json={"activo": True})
    assert recognize(client, make_image(1)).json()["resultado"]["persona_id"] == ana["id"]


def test_a_deactivated_person_keeps_their_faces_and_stays_in_the_list(
    client: TestClient, db: Session, register
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1, 2))
    client.patch(f"/api/personas/{ana['id']}", json={"activo": False})
    assert count(db, FaceEmbedding) == 2
    assert people(client)[ana["id"]]["rostros"] == 2


def test_the_state_needs_a_true_or_a_false(client: TestClient, register):
    ana = register("Ana Torres", "ana@example.com")
    for body in ({}, {"activo": "quizá"}, {"activo": None}):
        assert client.patch(f"/api/personas/{ana['id']}", json=body).status_code == 422
    assert client.patch(f"/api/personas/{ana['id']}", json={"nombre": "Otro"}).status_code == 422


def test_only_the_state_can_be_changed_this_way(client: TestClient, db: Session, register):
    ana = register("Ana Torres", "ana@example.com")
    client.patch(
        f"/api/personas/{ana['id']}",
        json={"activo": False, "nombre": "Otro Nombre", "email": "otro@example.com"},
    )
    saved = db.get(Persona, ana["id"])
    assert (saved.nombre, saved.email) == ("Ana Torres", "ana@example.com")


def test_a_person_that_does_not_exist_cannot_be_changed(client: TestClient):
    response = client.patch("/api/personas/999", json={"activo": False})
    assert response.status_code == 404


# --- deleting ------------------------------------------------------------------------------


def test_deleting_a_person_removes_them_their_faces_and_their_consent(
    client: TestClient, db: Session, register
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1, 2))
    luis = register("Luis Ramírez", "luis@example.com", seeds=(3,))
    response = client.delete(f"/api/personas/{ana['id']}")
    assert response.status_code == 200
    assert response.json() == {"success": True, "resultado": {"persona_id": ana["id"]}}
    assert db.get(Persona, ana["id"]) is None
    assert count(db, Persona) == 1 and count(db, FaceEmbedding) == 1
    assert set(people(client)) == {luis["id"]}


def test_the_address_of_a_deleted_person_can_be_registered_again(client: TestClient, register):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    client.delete(f"/api/personas/{ana['id']}")
    again = register("Ana Torres", "ana@example.com")
    assert again["rostros"] == 0 and again["email"] == "ana@example.com"


def test_a_deleted_person_is_no_longer_recognized(client: TestClient, register, make_image):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    client.delete(f"/api/personas/{ana['id']}")
    assert recognize(client, make_image(1)).status_code == 409


def test_deleting_twice_or_a_person_that_never_existed_is_a_404(client: TestClient, register):
    ana = register("Ana Torres", "ana@example.com")
    assert client.delete(f"/api/personas/{ana['id']}").status_code == 200
    second = client.delete(f"/api/personas/{ana['id']}")
    assert second.status_code == 404
    assert client.delete("/api/personas/999").status_code == 404


def test_what_the_person_did_stays_but_without_them(
    client: TestClient, db: Session, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    luis = register("Luis Ramírez", "luis@example.com", seeds=(2,))
    # One attempt that found Ana, one in evaluation mode saying Ana was expected, one for Luis
    recognize(client, make_image(1))
    recognize(client, make_image(1), expected=str(ana["id"]))
    recognize(client, make_image(2), expected=str(luis["id"]))
    assert count(db, RecognitionLog) == 3
    assert ml_dataset_service.sync_records(db) == 2 and count(db, MlTrainingRecord) == 2

    client.delete(f"/api/personas/{ana['id']}")

    assert count(db, RecognitionLog) == 3
    logs = db.scalars(select(RecognitionLog).order_by(RecognitionLog.id)).all()
    assert [(log.persona_id, log.esperado_persona_id) for log in logs] == [
        (None, None),
        (None, None),
        (luis["id"], luis["id"]),
    ]
    assert logs[1].esperado == "persona" and logs[1].candidato_correcto is not None
    assert count(db, MlTrainingRecord) == 2
    groups = db.scalars(select(MlTrainingRecord.grupo).order_by(MlTrainingRecord.id)).all()
    assert groups == [None, luis["id"]]


def test_the_history_still_lists_the_attempts_of_a_deleted_person(
    client: TestClient, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1))
    client.delete(f"/api/personas/{ana['id']}")
    history = client.get("/api/reconocimiento/historial").json()["resultado"]
    assert len(history) == 1
    assert "Ana Torres" not in str(history) and "ana@example.com" not in str(history)


def test_deleting_a_person_writes_only_their_number_in_the_audit_log(
    client: TestClient, db: Session, register
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    client.delete(f"/api/personas/{ana['id']}")
    db.expire_all()
    [row] = db.scalars(select(Auditoria).where(Auditoria.accion == "persona_eliminar")).all()
    assert (row.recurso, row.recurso_id, row.detalle) == ("persona", ana["id"], None)
    assert "Ana" not in str(vars(row))


# --- cleaning up the ones that never got a face --------------------------------------------


def test_only_the_people_without_any_face_are_removed(client: TestClient, db: Session, register):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    register("Sin Rostro Uno", "uno@example.com")
    register("Sin Rostro Dos", "dos@example.com")
    response = client.post("/api/personas/limpiar-sin-rostros")
    assert response.status_code == 200
    assert response.json() == {"success": True, "resultado": {"eliminadas": 2}}
    assert list(people(client)) == [ana["id"]]
    assert count(db, FaceEmbedding) == 1


def test_a_person_with_faces_of_another_model_is_not_removed(
    client: TestClient, db: Session, register
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    db.scalars(select(FaceEmbedding)).first().modelo = "insightface"
    db.commit()
    assert client.post("/api/personas/limpiar-sin-rostros").json()["resultado"]["eliminadas"] == 0
    assert list(people(client)) == [ana["id"]]


def test_a_deactivated_person_without_faces_is_removed_too(client: TestClient, register):
    sin = register("Sin Rostro", "sin@example.com")
    client.patch(f"/api/personas/{sin['id']}", json={"activo": False})
    assert client.post("/api/personas/limpiar-sin-rostros").json()["resultado"]["eliminadas"] == 1


def test_cleaning_up_with_nothing_to_clean_removes_nothing(client: TestClient, register):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    assert client.post("/api/personas/limpiar-sin-rostros").json()["resultado"]["eliminadas"] == 0
    assert client.post("/api/personas/limpiar-sin-rostros").json()["resultado"]["eliminadas"] == 0


def test_what_a_cleaned_up_person_did_is_kept_without_them(
    client: TestClient, db: Session, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1), expected=str(ana["id"]))
    ml_dataset_service.sync_records(db)
    # The faces are lost (say, cleaned by hand in the database): the person now counts as empty
    for face in db.scalars(select(FaceEmbedding)).all():
        db.delete(face)
    db.commit()

    assert client.post("/api/personas/limpiar-sin-rostros").json()["resultado"]["eliminadas"] == 1

    db.expire_all()
    log = db.scalars(select(RecognitionLog)).one()
    assert (log.persona_id, log.esperado_persona_id, log.esperado) == (None, None, "persona")
    assert db.scalars(select(MlTrainingRecord.grupo)).one() is None


def test_cleaning_up_is_written_to_the_audit_log_with_how_many(
    client: TestClient, db: Session, register
):
    register("Sin Rostro", "sin@example.com")
    client.post("/api/personas/limpiar-sin-rostros")
    db.expire_all()
    [row] = db.scalars(select(Auditoria).where(Auditoria.accion == "personas_limpiar")).all()
    assert row.detalle == "1 personas sin rostros" and row.recurso == "persona"
    assert "Sin Rostro" not in str(vars(row))


def test_deactivating_and_activating_are_told_apart_in_the_audit_log(
    client: TestClient, db: Session, register
):
    ana = register("Ana Torres", "ana@example.com")
    client.patch(f"/api/personas/{ana['id']}", json={"activo": False})
    client.patch(f"/api/personas/{ana['id']}", json={"activo": True})
    db.expire_all()
    rows = db.scalars(select(Auditoria).order_by(Auditoria.id)).all()
    assert [(r.accion, r.recurso, r.recurso_id) for r in rows] == [
        ("persona_crear", "persona", ana["id"]),
        ("persona_desactivar", "persona", ana["id"]),
        ("persona_activar", "persona", ana["id"]),
    ]
