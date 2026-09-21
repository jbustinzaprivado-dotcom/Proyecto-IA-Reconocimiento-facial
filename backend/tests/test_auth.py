from datetime import timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.constants import LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES, ROLE_ADMIN, ROLE_VIEWER
from app.core.security import create_token
from app.database.types import utcnow
from app.models import Auditoria, Usuario
from app.services import auth_service
from tests.conftest import ADMIN_EMAIL, PASSWORD, make_user, token_of

BAD = "Correo o contraseña incorrectos."
BAD_SESSION = "Tu sesión no es válida o venció. Inicia sesión otra vez."
KEY = Settings(_env_file=None).signing_key


def login(client: TestClient, email: str = ADMIN_EMAIL, password: str = PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "clave": password})


def audit_rows(db: Session, action: str) -> list[Auditoria]:
    db.expire_all()
    return list(db.scalars(select(Auditoria).where(Auditoria.accion == action)).all())


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --- signing in ----------------------------------------------------------------------------


def test_signing_in_gives_a_token_and_the_user_without_the_password(anonymous: TestClient):
    response = login(anonymous)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    session = body["resultado"]
    assert session["tipo"] == "Bearer"
    assert session["expira_en"] == 60 * 60
    assert set(session["usuario"]) == {
        "id",
        "email",
        "nombre",
        "rol",
        "activo",
        "created_at",
        "last_login_at",
    }
    assert session["usuario"]["email"] == ADMIN_EMAIL
    assert session["usuario"]["rol"] == ROLE_ADMIN
    assert "password" not in response.text
    assert "argon2" not in response.text


def test_the_token_of_a_sign_in_opens_the_api(anonymous: TestClient):
    token = login(anonymous).json()["resultado"]["token"]
    response = anonymous.get("/api/auth/yo", headers=bearer(token))
    assert response.status_code == 200
    assert response.json()["resultado"]["email"] == ADMIN_EMAIL


def test_the_address_is_not_case_sensitive_and_spaces_are_ignored(anonymous: TestClient):
    assert login(anonymous, "  ADMIN@Example.COM  ").status_code == 200


def test_the_token_lasts_as_long_as_the_settings_say(anonymous: TestClient, use_settings):
    use_settings(jwt_expire_minutes=5)
    session = login(anonymous).json()["resultado"]
    assert session["expira_en"] == 300
    claims = jwt.decode(session["token"], KEY, algorithms=["HS256"])
    assert claims["exp"] - claims["iat"] == 300


def test_a_sign_in_marks_the_last_time_and_clears_the_failures(anonymous: TestClient, db: Session):
    user = db.scalar(select(Usuario).where(Usuario.email == ADMIN_EMAIL))
    user.failed_attempts = 3
    db.commit()
    assert login(anonymous).status_code == 200
    db.refresh(user)
    assert user.failed_attempts == 0
    assert user.locked_until is None
    assert user.last_login_at is not None
    assert utcnow() - user.last_login_at < timedelta(seconds=30)


def test_a_sign_in_is_written_to_the_audit_log(anonymous: TestClient, db: Session):
    login(anonymous)
    [row] = audit_rows(db, "login")
    assert (row.usuario_email, row.resultado) == (ADMIN_EMAIL, "ok")
    assert row.ip == "testclient"


# --- refusing it ---------------------------------------------------------------------------


def test_a_wrong_password_and_an_unknown_address_get_exactly_the_same_answer(
    anonymous: TestClient,
):
    wrong = login(anonymous, ADMIN_EMAIL, "otra clave distinta 123")
    unknown = login(anonymous, "nadie@example.com", PASSWORD)
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"success": False, "error": BAD}
    assert wrong.headers["www-authenticate"] == "Bearer"


def test_a_deactivated_account_gets_the_same_answer_too(anonymous: TestClient, db: Session):
    make_user(db, "operador", "baja@example.com", "Baja", active=False)
    response = login(anonymous, "baja@example.com")
    assert response.status_code == 401
    assert response.json()["error"] == BAD


def test_a_deactivated_account_is_not_locked_by_trying(anonymous: TestClient, db: Session):
    user = make_user(db, "operador", "baja@example.com", "Baja", active=False)
    for _ in range(LOGIN_MAX_FAILURES + 2):
        assert login(anonymous, "baja@example.com", "otra clave larga").status_code == 401
    db.refresh(user)
    assert user.locked_until is None


def test_an_unknown_address_still_spends_the_time_of_a_check(anonymous: TestClient, monkeypatch):
    spent = []
    monkeypatch.setattr(auth_service, "spend_the_time_of_a_check", spent.append)
    login(anonymous, "nadie@example.com")
    assert spent == [PASSWORD]
    login(anonymous, ADMIN_EMAIL)
    assert spent == [PASSWORD]


def test_a_missing_field_or_an_empty_body_is_a_422_in_spanish(anonymous: TestClient):
    response = anonymous.post("/api/auth/login", json={"email": "a@b.co"})
    assert response.status_code == 422
    assert response.json()["error"] == "Falta el campo «clave»."
    assert anonymous.post("/api/auth/login").status_code == 422


def test_a_failed_attempt_is_counted_and_written_to_the_audit_log(
    anonymous: TestClient, db: Session
):
    login(anonymous, ADMIN_EMAIL, "otra clave distinta 123")
    login(anonymous, "nadie@example.com")
    user = db.scalar(select(Usuario).where(Usuario.email == ADMIN_EMAIL))
    assert user.failed_attempts == 1
    wrong, unknown = audit_rows(db, "login")
    assert (wrong.resultado, wrong.detalle, wrong.usuario_email) == (
        "fallo",
        "contraseña incorrecta",
        ADMIN_EMAIL,
    )
    assert (unknown.resultado, unknown.detalle, unknown.usuario_email, unknown.usuario_id) == (
        "fallo",
        "correo desconocido",
        "nadie@example.com",
        None,
    )


def test_the_wrong_password_typed_is_never_written_anywhere(anonymous: TestClient, db: Session):
    login(anonymous, ADMIN_EMAIL, "esta-clave-equivocada-no-se-guarda")
    for row in db.scalars(select(Auditoria)).all():
        assert "esta-clave-equivocada" not in " ".join(str(v) for v in vars(row).values())


# --- the lock ------------------------------------------------------------------------------


def wrong_logins(client: TestClient, count: int):
    return [login(client, ADMIN_EMAIL, "otra clave distinta 123") for _ in range(count)]


def test_after_the_allowed_failures_the_account_is_locked_for_a_while(
    anonymous: TestClient, db: Session
):
    results = wrong_logins(anonymous, LOGIN_MAX_FAILURES)
    assert [r.status_code for r in results] == [401] * LOGIN_MAX_FAILURES
    user = db.scalar(select(Usuario).where(Usuario.email == ADMIN_EMAIL))
    assert user.locked_until is not None
    assert user.failed_attempts == 0
    remaining = user.locked_until - utcnow()
    assert (
        timedelta(minutes=LOGIN_LOCK_MINUTES - 1)
        < remaining
        <= timedelta(minutes=LOGIN_LOCK_MINUTES)
    )

    locked = login(anonymous, ADMIN_EMAIL, "otra clave distinta 123")
    assert locked.status_code == 429
    assert f"en {LOGIN_LOCK_MINUTES} minutos" in locked.json()["error"]


def test_while_it_is_locked_not_even_the_right_password_gets_in(anonymous: TestClient):
    wrong_logins(anonymous, LOGIN_MAX_FAILURES)
    assert login(anonymous).status_code == 429


def test_one_failure_less_than_the_limit_does_not_lock(anonymous: TestClient):
    wrong_logins(anonymous, LOGIN_MAX_FAILURES - 1)
    assert login(anonymous).status_code == 200


def test_a_right_password_in_between_starts_the_count_over(anonymous: TestClient):
    wrong_logins(anonymous, LOGIN_MAX_FAILURES - 1)
    assert login(anonymous).status_code == 200
    wrong_logins(anonymous, LOGIN_MAX_FAILURES - 1)
    assert login(anonymous).status_code == 200


def test_the_lock_ends_by_itself_when_its_time_is_up(anonymous: TestClient, db: Session):
    wrong_logins(anonymous, LOGIN_MAX_FAILURES)
    user = db.scalar(select(Usuario).where(Usuario.email == ADMIN_EMAIL))
    user.locked_until = utcnow() - timedelta(seconds=1)
    db.commit()
    assert login(anonymous).status_code == 200
    db.refresh(user)
    assert user.locked_until is None


def test_the_message_of_the_lock_counts_the_minutes_left_rounding_up(
    anonymous: TestClient, db: Session
):
    user = db.scalar(select(Usuario).where(Usuario.email == ADMIN_EMAIL))
    user.locked_until = utcnow() + timedelta(seconds=30)
    db.commit()
    assert "en 1 minutos" in login(anonymous).json()["error"]


def test_the_lock_and_the_locked_attempts_are_in_the_audit_log(anonymous: TestClient, db: Session):
    wrong_logins(anonymous, LOGIN_MAX_FAILURES)
    login(anonymous)
    rows = audit_rows(db, "login")
    assert [r.resultado for r in rows] == ["fallo"] * LOGIN_MAX_FAILURES + ["bloqueado"]
    assert f"cuenta bloqueada {LOGIN_LOCK_MINUTES} minutos" in rows[LOGIN_MAX_FAILURES - 1].detalle
    assert rows[-1].detalle == "cuenta bloqueada"


def test_only_the_account_that_was_attacked_is_locked(anonymous: TestClient, db: Session):
    make_user(db, "operador", "otro@example.com", "Otro")
    wrong_logins(anonymous, LOGIN_MAX_FAILURES)
    assert login(anonymous, "otro@example.com").status_code == 200


# --- the limit per address -----------------------------------------------------------------


def test_too_many_sign_in_attempts_from_one_address_are_refused(
    anonymous: TestClient, use_settings, db: Session
):
    use_settings(login_rate_per_minute=3)
    for _ in range(3):
        assert login(anonymous, "nadie@example.com").status_code == 401
    response = login(anonymous, "nadie@example.com")
    assert response.status_code == 429
    assert response.json()["error"] == "Demasiados intentos de inicio de sesión. Espera un momento."
    assert int(response.headers["retry-after"]) >= 1
    blocked = [r for r in audit_rows(db, "login") if r.resultado == "bloqueado"]
    assert len(blocked) == 1
    assert blocked[0].detalle == "demasiados intentos desde esta dirección"


def test_the_limit_also_stops_the_right_password(anonymous: TestClient, use_settings):
    use_settings(login_rate_per_minute=2)
    login(anonymous, "nadie@example.com")
    login(anonymous, "nadie@example.com")
    assert login(anonymous).status_code == 429


def test_each_address_has_its_own_count_when_the_forwarded_one_is_trusted(
    anonymous: TestClient, use_settings
):
    use_settings(login_rate_per_minute=1, trust_forwarded_for=True)
    first = anonymous.post(
        "/api/auth/login",
        json={"email": "a@b.co", "clave": "x"},
        headers={"X-Forwarded-For": "1.1.1.1"},
    )
    second = anonymous.post(
        "/api/auth/login",
        json={"email": "a@b.co", "clave": "x"},
        headers={"X-Forwarded-For": "2.2.2.2"},
    )
    again = anonymous.post(
        "/api/auth/login",
        json={"email": "a@b.co", "clave": "x"},
        headers={"X-Forwarded-For": "1.1.1.1"},
    )
    assert (first.status_code, second.status_code, again.status_code) == (401, 401, 429)


# --- the session on every request ----------------------------------------------------------


def test_a_request_with_no_token_is_a_401_that_asks_for_one(anonymous: TestClient):
    response = anonymous.get("/api/auth/yo")
    assert response.status_code == 401
    assert response.json() == {"success": False, "error": BAD_SESSION}
    assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize(
    "header",
    ["Bearer", "Bearer ", "Basic abc", "abc", "Token abc", "Bearer not.a.token"],
)
def test_a_header_that_is_not_a_valid_bearer_token_is_a_401(anonymous: TestClient, header: str):
    response = anonymous.get("/api/auth/yo", headers={"Authorization": header})
    assert response.status_code == 401
    assert response.json()["error"] == BAD_SESSION


def test_an_expired_token_is_a_401(anonymous: TestClient, db: Session):
    user = db.scalar(select(Usuario).where(Usuario.email == ADMIN_EMAIL))
    expired = create_token(user.id, user.rol, KEY, 1, utcnow() - timedelta(hours=1))
    assert anonymous.get("/api/auth/yo", headers=bearer(expired)).status_code == 401


def test_a_token_signed_with_another_key_is_a_401(anonymous: TestClient, db: Session):
    user = db.scalar(select(Usuario).where(Usuario.email == ADMIN_EMAIL))
    forged = create_token(
        user.id, user.rol, "otra-clave-de-mas-de-treinta-y-dos-letras", 60, utcnow()
    )
    assert anonymous.get("/api/auth/yo", headers=bearer(forged)).status_code == 401


def test_a_token_that_says_it_is_for_no_one_real_is_a_401(anonymous: TestClient):
    odd = jwt.encode(
        {"sub": "abc", "iat": int(utcnow().timestamp()), "exp": 9999999999}, KEY, "HS256"
    )
    assert anonymous.get("/api/auth/yo", headers=bearer(odd)).status_code == 401
    missing = create_token(99999, ROLE_ADMIN, KEY, 60, utcnow())
    assert anonymous.get("/api/auth/yo", headers=bearer(missing)).status_code == 401


def test_the_token_of_a_user_who_was_deleted_stops_working(anonymous: TestClient, db: Session):
    user = make_user(db, "operador", "temp@example.com", "Temporal")
    token = token_of(user)
    assert anonymous.get("/api/auth/yo", headers=bearer(token)).status_code == 200
    db.delete(user)
    db.commit()
    assert anonymous.get("/api/auth/yo", headers=bearer(token)).status_code == 401


def test_the_token_of_a_user_who_was_deactivated_stops_working_at_once(
    anonymous: TestClient, db: Session
):
    user = make_user(db, "operador", "temp@example.com", "Temporal")
    token = token_of(user)
    assert anonymous.get("/api/auth/yo", headers=bearer(token)).status_code == 200
    user.activo = False
    db.commit()
    response = anonymous.get("/api/auth/yo", headers=bearer(token))
    assert response.status_code == 401
    assert response.json()["error"] == BAD_SESSION


def test_the_role_is_the_one_of_the_database_not_the_one_the_token_says(
    anonymous: TestClient, db: Session
):
    viewer = make_user(db, ROLE_VIEWER, "mirar@example.com", "Mirar")
    claims_admin = create_token(viewer.id, ROLE_ADMIN, KEY, 60, utcnow())
    response = anonymous.get("/api/usuarios", headers=bearer(claims_admin))
    assert response.status_code == 403


def test_a_role_that_changes_takes_effect_on_the_next_request(anonymous: TestClient, db: Session):
    user = make_user(db, "operador", "cambio@example.com", "Cambio")
    token = token_of(user)
    assert anonymous.get("/api/personas", headers=bearer(token)).status_code == 200
    user.rol = ROLE_VIEWER
    db.commit()
    assert anonymous.get("/api/personas", headers=bearer(token)).status_code == 403


def test_a_token_made_before_the_sessions_were_ended_stops_working(
    anonymous: TestClient, db: Session
):
    user = make_user(db, "operador", "sesion@example.com", "Sesión")
    user.tokens_validos_desde = utcnow() - timedelta(hours=1)
    db.commit()
    old = create_token(user.id, user.rol, KEY, 60, utcnow() - timedelta(minutes=10))
    assert anonymous.get("/api/auth/yo", headers=bearer(old)).status_code == 200
    user.tokens_validos_desde = utcnow()
    db.commit()
    assert anonymous.get("/api/auth/yo", headers=bearer(old)).status_code == 401
    fresh = create_token(user.id, user.rol, KEY, 60, utcnow())
    assert anonymous.get("/api/auth/yo", headers=bearer(fresh)).status_code == 200


# --- changing your own password ------------------------------------------------------------


NEW = "una-clave-nueva-y-larga-456"


def change(client: TestClient, current: str = PASSWORD, new: str = NEW, headers=None):
    return client.post(
        "/api/auth/cambiar-clave",
        json={"clave_actual": current, "clave_nueva": new},
        headers=headers,
    )


def test_changing_the_password_gives_a_new_session_and_the_new_password_works(
    client: TestClient, anonymous: TestClient
):
    response = change(client)
    assert response.status_code == 200
    session = response.json()["resultado"]
    assert session["usuario"]["email"] == ADMIN_EMAIL
    assert anonymous.get("/api/auth/yo", headers=bearer(session["token"])).status_code == 200
    assert login(anonymous, ADMIN_EMAIL, NEW).status_code == 200
    assert login(anonymous, ADMIN_EMAIL, PASSWORD).status_code == 401


def test_changing_the_password_ends_the_sessions_made_before(anonymous: TestClient, db: Session):
    user = make_user(db, "operador", "sesion@example.com", "Sesión")
    user.tokens_validos_desde = utcnow() - timedelta(hours=1)
    db.commit()
    old = create_token(user.id, user.rol, KEY, 60, utcnow() - timedelta(minutes=10))
    # It works until the password changes
    assert anonymous.get("/api/auth/yo", headers=bearer(old)).status_code == 200
    response = change(anonymous, headers=bearer(old))
    assert response.status_code == 200
    assert anonymous.get("/api/auth/yo", headers=bearer(old)).status_code == 401


def test_the_current_password_must_be_right(client: TestClient, db: Session):
    response = change(client, current="no es la clave actual")
    assert response.status_code == 422
    assert response.json()["error"] == "La contraseña actual no es correcta."
    row = audit_rows(db, "cambio_clave")[0]
    assert (row.resultado, row.detalle) == ("fallo", "contraseña actual incorrecta")


@pytest.mark.parametrize(
    ("new", "reason"),
    [
        ("corta", "al menos 10 caracteres"),
        ("x" * 200, "más de 128 caracteres"),
        (ADMIN_EMAIL, "igual al correo"),
    ],
)
def test_the_new_password_must_follow_the_rules(client: TestClient, new: str, reason: str):
    response = change(client, new=new)
    assert response.status_code == 422
    assert reason in response.json()["error"]


def test_changing_the_password_needs_a_session(anonymous: TestClient):
    assert change(anonymous).status_code == 401


def test_a_password_change_is_in_the_audit_log_without_the_passwords(
    client: TestClient, db: Session
):
    change(client)
    [row] = [r for r in audit_rows(db, "cambio_clave") if r.resultado == "ok"]
    assert row.usuario_email == ADMIN_EMAIL
    text = " ".join(str(v) for v in vars(row).values())
    assert NEW not in text and PASSWORD not in text


def test_the_lock_of_the_approved_rules_is_five_failures_and_fifteen_minutes():
    assert (LOGIN_MAX_FAILURES, LOGIN_LOCK_MINUTES) == (5, 15)


def test_a_password_hashed_with_weaker_settings_is_renewed_when_the_user_signs_in(
    anonymous: TestClient, db: Session
):
    from argon2 import PasswordHasher

    from app.core.security import needs_rehash, verify_password

    weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash(PASSWORD)
    user = db.scalar(select(Usuario).where(Usuario.email == ADMIN_EMAIL))
    user.password_hash = weak
    db.commit()
    assert needs_rehash(weak)

    assert login(anonymous).status_code == 200

    db.refresh(user)
    assert user.password_hash != weak
    assert needs_rehash(user.password_hash) is False
    assert verify_password(user.password_hash, PASSWORD)
    assert login(anonymous).status_code == 200


def test_a_hash_that_is_up_to_date_is_left_as_it_is(anonymous: TestClient, db: Session):
    user = db.scalar(select(Usuario).where(Usuario.email == ADMIN_EMAIL))
    before = user.password_hash
    login(anonymous)
    db.refresh(user)
    assert user.password_hash == before
