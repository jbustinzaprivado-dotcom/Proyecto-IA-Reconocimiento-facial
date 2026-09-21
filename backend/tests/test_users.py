import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER
from app.models import Auditoria, Usuario
from tests.conftest import ADMIN_EMAIL, PASSWORD, make_user

NEW = {
    "email": "Nuevo@Example.com ",
    "nombre": "  Nuevo   Usuario ",
    "rol": ROLE_OPERATOR,
    "clave": "una-clave-larga-123",
}


def create(client: TestClient, **changes):
    return client.post("/api/usuarios", json={**NEW, **changes})


def patch(client: TestClient, user_id: int, **fields):
    return client.patch(f"/api/usuarios/{user_id}", json=fields)


def user_id(db: Session, email: str) -> int:
    return db.scalar(select(Usuario.id).where(Usuario.email == email))


def login(client: TestClient, email: str, password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "clave": password})


def audit_rows(db: Session, action: str) -> list[Auditoria]:
    db.expire_all()
    return list(db.scalars(select(Auditoria).where(Auditoria.accion == action)).all())


# --- creating ------------------------------------------------------------------------------


def test_creating_a_user_answers_201_with_the_user_and_no_password(client: TestClient):
    response = create(client)
    assert response.status_code == 201
    user = response.json()["resultado"]
    assert set(user) == {"id", "email", "nombre", "rol", "activo", "created_at", "last_login_at"}
    assert user["email"] == "nuevo@example.com"
    assert user["nombre"] == "Nuevo Usuario"
    assert user["rol"] == ROLE_OPERATOR
    assert user["activo"] is True
    assert user["last_login_at"] is None
    assert "una-clave-larga-123" not in response.text and "argon2" not in response.text


def test_the_password_is_stored_only_as_a_hash(client: TestClient, db: Session):
    create(client)
    stored = db.scalar(select(Usuario.password_hash).where(Usuario.email == "nuevo@example.com"))
    assert stored.startswith("$argon2id$")
    assert "una-clave-larga-123" not in stored


def test_a_new_user_can_sign_in_with_the_password_it_was_given(
    client: TestClient, anonymous: TestClient
):
    create(client)
    response = login(anonymous, "nuevo@example.com", "una-clave-larga-123")
    assert response.status_code == 200
    assert response.json()["resultado"]["usuario"]["rol"] == ROLE_OPERATOR


@pytest.mark.parametrize("role", [ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER])
def test_a_user_can_be_created_with_any_of_the_three_roles(client: TestClient, role: str):
    assert create(client, rol=role).json()["resultado"]["rol"] == role


def test_an_address_already_used_is_a_409_whatever_its_case(client: TestClient):
    assert create(client).status_code == 201
    response = create(client, email="NUEVO@example.com", nombre="Otra Persona")
    assert response.status_code == 409
    assert response.json()["error"] == "Ya existe un usuario con ese correo."
    assert create(client, email=ADMIN_EMAIL).status_code == 409


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"rol": "superadministrador"}, "El campo «rol» no es válido."),
        ({"rol": "Administrador"}, "El campo «rol» no es válido."),
        ({"email": "no-es-un-correo"}, "El correo no tiene un formato válido."),
        ({"nombre": "A"}, "El nombre debe tener entre 2 y 100 caracteres."),
        ({"clave": "corta"}, "La contraseña debe tener al menos 10 caracteres."),
        ({"clave": "x" * 129}, "La contraseña no puede tener más de 128 caracteres."),
        ({"clave": "nuevo@example.com"}, "La contraseña no puede ser igual al correo."),
    ],
)
def test_what_is_not_acceptable_is_a_422_in_spanish(client: TestClient, changes, message):
    response = create(client, **changes)
    assert response.status_code == 422
    assert response.json()["error"] == message


def test_nothing_is_created_when_it_is_refused(client: TestClient, db: Session):
    create(client, clave="corta")
    create(client, rol="inventado")
    assert db.scalar(select(func.count()).select_from(Usuario)) == 1


def test_every_field_is_required(client: TestClient):
    for field in NEW:
        body = {k: v for k, v in NEW.items() if k != field}
        response = client.post("/api/usuarios", json=body)
        assert response.status_code == 422
        assert response.json()["error"] == f"Falta el campo «{field}»."


# --- listing -------------------------------------------------------------------------------


def test_users_are_listed_by_name_ignoring_case_and_never_with_a_password(
    client: TestClient, db: Session
):
    make_user(db, ROLE_OPERATOR, "b@example.com", "beatriz")
    make_user(db, ROLE_VIEWER, "c@example.com", "Carlos")
    make_user(db, ROLE_OPERATOR, "a@example.com", "Alvaro")
    response = client.get("/api/usuarios")
    assert response.status_code == 200
    assert [u["nombre"] for u in response.json()["resultado"]] == [
        "Administrador",
        "Alvaro",
        "beatriz",
        "Carlos",
    ]
    assert "argon2" not in response.text and "password" not in response.text


# --- changing ------------------------------------------------------------------------------


def test_the_name_the_role_and_the_active_state_can_be_changed(client: TestClient, db: Session):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    response = patch(client, other.id, nombre=" Nombre  Nuevo ", rol=ROLE_VIEWER, activo=False)
    assert response.status_code == 200
    user = response.json()["resultado"]
    assert (user["nombre"], user["rol"], user["activo"]) == ("Nombre Nuevo", ROLE_VIEWER, False)
    db.refresh(other)
    assert (other.nombre, other.rol, other.activo) == ("Nombre Nuevo", ROLE_VIEWER, False)


def test_only_what_is_sent_is_changed(client: TestClient, db: Session):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    patch(client, other.id, rol=ROLE_VIEWER)
    db.refresh(other)
    assert (other.nombre, other.activo, other.rol) == ("Otro", True, ROLE_VIEWER)


def test_the_address_cannot_be_changed(client: TestClient, db: Session):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    response = patch(client, other.id, email="otro-distinto@example.com")
    assert response.status_code == 422
    assert response.json()["error"] == "No hay nada que cambiar."


def test_sending_nothing_new_is_a_422(client: TestClient, db: Session):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    for fields in ({}, {"nombre": "Otro"}, {"rol": ROLE_OPERATOR}, {"activo": True}):
        response = patch(client, other.id, **fields)
        assert response.status_code == 422
        assert response.json()["error"] == "No hay nada que cambiar."


def test_a_user_that_does_not_exist_is_a_404(client: TestClient):
    response = patch(client, 999, nombre="Alguien Real")
    assert response.status_code == 404
    assert response.json()["error"] == "El usuario no existe."


@pytest.mark.parametrize("fields", [{"rol": "otro"}, {"activo": "quizá"}, {"nombre": "A"}])
def test_a_wrong_value_is_a_422(client: TestClient, db: Session, fields):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    assert patch(client, other.id, **fields).status_code == 422


def test_the_administrator_can_set_a_new_password_for_someone(
    client: TestClient, anonymous: TestClient, db: Session
):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    assert patch(client, other.id, clave="clave-nueva-restablecida").status_code == 200
    assert login(anonymous, "otro@example.com").status_code == 401
    assert login(anonymous, "otro@example.com", "clave-nueva-restablecida").status_code == 200


def test_a_new_password_from_the_administrator_must_follow_the_rules(
    client: TestClient, db: Session
):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    response = patch(client, other.id, clave="corta")
    assert response.status_code == 422
    assert "al menos 10 caracteres" in response.json()["error"]
    db.refresh(other)
    assert other.password_hash != "corta"
    assert login(client, "otro@example.com").status_code == 200


def test_a_new_password_ends_the_sessions_and_the_lock_of_that_user(
    client: TestClient, anonymous: TestClient, db: Session
):
    from datetime import timedelta

    from app.database.types import utcnow

    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    other.failed_attempts = 3
    other.locked_until = utcnow() + timedelta(minutes=10)
    other.tokens_validos_desde = utcnow() - timedelta(hours=1)
    db.commit()
    assert login(anonymous, "otro@example.com").status_code == 429
    patch(client, other.id, clave="clave-nueva-restablecida")
    db.refresh(other)
    assert other.failed_attempts == 0 and other.locked_until is None
    assert other.tokens_validos_desde > utcnow() - timedelta(minutes=1)
    assert login(anonymous, "otro@example.com", "clave-nueva-restablecida").status_code == 200


def test_a_deactivated_user_cannot_sign_in_and_can_again_once_activated(
    client: TestClient, anonymous: TestClient, db: Session
):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    patch(client, other.id, activo=False)
    assert login(anonymous, "otro@example.com").status_code == 401
    patch(client, other.id, activo=True)
    assert login(anonymous, "otro@example.com").status_code == 200


# --- the last administrator ----------------------------------------------------------------


def test_the_last_active_administrator_cannot_lose_the_role(client: TestClient, db: Session):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    admin = user_id(db, ADMIN_EMAIL)
    response = patch(client, admin, rol=ROLE_OPERATOR)
    assert response.status_code == 409
    assert response.json()["error"] == "Debe quedar al menos un administrador activo."
    assert other.rol == ROLE_OPERATOR
    assert db.scalar(select(Usuario.rol).where(Usuario.id == admin)) == ROLE_ADMIN


def test_the_last_active_administrator_cannot_be_deactivated_by_someone_else(
    client: TestClient, db: Session
):
    from tests.conftest import authorization

    second = make_user(db, ROLE_ADMIN, "segundo@example.com", "Segundo")
    admin = user_id(db, ADMIN_EMAIL)
    # With two active, the second may deactivate the first; after that, nobody may remove the last
    as_second = TestClient(client.app, headers=authorization(second))
    assert patch(as_second, admin, activo=False).status_code == 200
    response = patch(as_second, second.id, rol=ROLE_VIEWER)
    assert response.status_code == 409
    assert response.json()["error"] == "Debe quedar al menos un administrador activo."


def test_with_two_administrators_one_can_step_down(client: TestClient, db: Session):
    second = make_user(db, ROLE_ADMIN, "segundo@example.com", "Segundo")
    assert patch(client, second.id, rol=ROLE_OPERATOR).status_code == 200


def test_an_inactive_administrator_does_not_count_as_one(client: TestClient, db: Session):
    make_user(db, ROLE_ADMIN, "dormido@example.com", "Dormido", active=False)
    response = patch(client, user_id(db, ADMIN_EMAIL), rol=ROLE_VIEWER)
    assert response.status_code == 409


def test_nobody_can_deactivate_their_own_account(client: TestClient, db: Session):
    make_user(db, ROLE_ADMIN, "segundo@example.com", "Segundo")
    response = patch(client, user_id(db, ADMIN_EMAIL), activo=False)
    assert response.status_code == 409
    assert response.json()["error"] == "No puedes desactivar tu propia cuenta."


def test_someone_can_change_their_own_name_or_password_through_the_administrator(
    client: TestClient, db: Session
):
    admin = user_id(db, ADMIN_EMAIL)
    assert patch(client, admin, nombre="Administrador Principal").status_code == 200


# --- the audit log -------------------------------------------------------------------------


def test_creating_and_changing_users_is_written_to_the_audit_log(client: TestClient, db: Session):
    created = create(client).json()["resultado"]
    patch(client, created["id"], rol=ROLE_VIEWER, activo=False)
    [made] = audit_rows(db, "usuario_crear")
    assert (made.usuario_email, made.recurso, made.recurso_id, made.resultado) == (
        ADMIN_EMAIL,
        "usuario",
        created["id"],
        "ok",
    )
    assert made.detalle == "rol: operador"
    [changed] = audit_rows(db, "usuario_actualizar")
    assert changed.recurso_id == created["id"]
    assert changed.detalle == "rol: operador → consulta; cuenta desactivada"


def test_a_password_reset_says_so_and_never_the_password(client: TestClient, db: Session):
    other = make_user(db, ROLE_OPERATOR, "otro@example.com", "Otro")
    patch(client, other.id, clave="clave-nueva-restablecida")
    [row] = audit_rows(db, "usuario_actualizar")
    assert row.detalle == "contraseña restablecida"
    for every in db.scalars(select(Auditoria)).all():
        assert "clave-nueva-restablecida" not in " ".join(str(v) for v in vars(every).values())


def test_a_refused_change_leaves_no_trace_of_a_success(client: TestClient, db: Session):
    patch(client, 999, nombre="Alguien Real")
    create(client, clave="corta")
    assert audit_rows(db, "usuario_crear") == []
    assert audit_rows(db, "usuario_actualizar") == []


def test_an_inactive_administrator_can_be_changed_while_one_is_active(
    client: TestClient, db: Session
):
    sleeping = make_user(db, ROLE_ADMIN, "dormido@example.com", "Dormido", active=False)
    response = patch(client, sleeping.id, rol=ROLE_VIEWER)
    assert response.status_code == 200
    assert response.json()["resultado"]["rol"] == ROLE_VIEWER
    # And the active one is still the last one
    assert patch(client, user_id(db, ADMIN_EMAIL), rol=ROLE_VIEWER).status_code == 409
