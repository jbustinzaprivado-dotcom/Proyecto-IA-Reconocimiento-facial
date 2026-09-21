from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import app.database.connection as connection
from app.core.constants import ROLE_ADMIN, ROLE_OPERATOR
from app.core.errors import ApiException
from app.core.security import verify_password
from app.database.types import utcnow
from app.models import Auditoria, Usuario
from app.scripts import create_admin as script
from tests.conftest import PASSWORD, make_user

GOOD = "una-clave-larga-123"


def stored(db: Session, email: str) -> Usuario | None:
    db.expire_all()
    return db.scalar(select(Usuario).where(Usuario.email == email))


def system_rows(db: Session) -> list[Auditoria]:
    db.expire_all()
    return list(db.scalars(select(Auditoria).where(Auditoria.usuario_id.is_(None))).all())


@pytest.fixture
def run(db: Session, monkeypatch, capsys):
    """The command against the database of the test: run(argv, env, typed) -> (code, out, err)."""
    monkeypatch.setattr(
        connection,
        "SessionLocal",
        sessionmaker(bind=db.get_bind(), autoflush=False, expire_on_commit=False),
    )
    for name in ("ADMIN_EMAIL", "ADMIN_NOMBRE", "ADMIN_PASSWORD"):
        monkeypatch.delenv(name, raising=False)

    def go(argv: list[str], env: dict[str, str] | None = None, typed: list[str] | None = None):
        for name, value in (env or {}).items():
            monkeypatch.setenv(name, value)
        answers = iter(typed or [])
        monkeypatch.setattr("builtins.input", lambda _prompt="": next(answers))
        monkeypatch.setattr("getpass.getpass", lambda _prompt="": next(answers))
        code = script.main(argv)
        captured = capsys.readouterr()
        return code, captured.out, captured.err

    return go


# --- the functions -------------------------------------------------------------------------


def test_the_administrator_is_created_with_the_role_active_and_a_hashed_password(db: Session):
    user = script.create_admin(db, " Ana@Example.com ", "  Ana   Torres ", GOOD)
    saved = stored(db, "ana@example.com")
    assert saved is not None and saved.id == user.id
    assert (saved.nombre, saved.rol, saved.activo) == ("Ana Torres", ROLE_ADMIN, True)
    assert saved.password_hash.startswith("$argon2id$")
    assert verify_password(saved.password_hash, GOOD)


@pytest.mark.parametrize(
    ("email", "name", "password", "message"),
    [
        ("no-es-un-correo", "Ana Torres", GOOD, "El correo no tiene un formato válido."),
        ("ana@example.com", "A", GOOD, "El nombre debe tener entre 2 y 100 caracteres."),
        (
            "ana@example.com",
            "Ana Torres",
            "corta",
            "La contraseña debe tener al menos 10 caracteres.",
        ),
        (
            "ana@example.com",
            "Ana Torres",
            "ana@example.com",
            "La contraseña no puede ser igual al correo.",
        ),
    ],
)
def test_what_is_not_acceptable_is_refused_with_the_reason(
    db: Session, email, name, password, message
):
    with pytest.raises(ApiException) as error:
        script.create_admin(db, email, name, password)
    assert error.value.message == message
    assert db.scalar(select(Usuario)) is None
    assert system_rows(db) == []


def test_an_address_already_used_is_refused(db: Session):
    make_user(db, ROLE_OPERATOR, "ana@example.com", "Ana Vieja")
    with pytest.raises(ApiException) as error:
        script.create_admin(db, "ANA@example.com", "Ana Nueva", GOOD)
    assert error.value.status_code == 409
    assert stored(db, "ana@example.com").rol == ROLE_OPERATOR


def test_creating_the_administrator_is_recorded_as_done_by_the_server(db: Session):
    script.create_admin(db, "ana@example.com", "Ana Torres", GOOD)
    [row] = system_rows(db)
    assert (row.accion, row.resultado, row.detalle) == (
        "admin_crear_comando",
        "ok",
        "administrador ana@example.com",
    )
    assert row.usuario_email is None and row.ip is None
    assert GOOD not in (row.detalle or "")


def test_resetting_gives_a_new_password_activates_unlocks_and_ends_sessions(db: Session):
    user = make_user(db, ROLE_OPERATOR, "ana@example.com", "Ana Torres", active=False)
    user.failed_attempts = 4
    user.locked_until = utcnow() + timedelta(minutes=10)
    user.tokens_validos_desde = utcnow() - timedelta(hours=2)
    db.commit()

    script.reset_password(db, " ANA@example.com ", GOOD)

    saved = stored(db, "ana@example.com")
    assert verify_password(saved.password_hash, GOOD)
    assert not verify_password(saved.password_hash, PASSWORD)
    assert saved.activo is True
    assert saved.failed_attempts == 0 and saved.locked_until is None
    assert saved.tokens_validos_desde > utcnow() - timedelta(minutes=1)
    assert saved.rol == ROLE_OPERATOR


def test_resetting_is_recorded_without_the_password(db: Session):
    make_user(db, ROLE_OPERATOR, "ana@example.com", "Ana Torres")
    script.reset_password(db, "ana@example.com", GOOD)
    [row] = system_rows(db)
    assert (row.accion, row.detalle) == ("clave_restablecida_comando", "cuenta ana@example.com")


def test_resetting_an_account_that_does_not_exist_is_refused(db: Session):
    with pytest.raises(ApiException) as error:
        script.reset_password(db, "nadie@example.com", GOOD)
    assert (error.value.status_code, error.value.message) == (404, "El usuario no existe.")
    assert system_rows(db) == []


def test_resetting_with_a_bad_address_or_password_changes_nothing(db: Session):
    user = make_user(db, ROLE_OPERATOR, "ana@example.com", "Ana Torres")
    before = user.password_hash
    with pytest.raises(ApiException) as bad_address:
        script.reset_password(db, "no-es-un-correo", GOOD)
    assert bad_address.value.message == "El correo no tiene un formato válido."
    with pytest.raises(ApiException) as bad_password:
        script.reset_password(db, "ana@example.com", "corta")
    assert "al menos 10 caracteres" in bad_password.value.message
    assert stored(db, "ana@example.com").password_hash == before
    assert system_rows(db) == []


def test_the_password_asked_twice_must_be_the_same():
    answers = iter([GOOD, GOOD])
    assert script.ask_password(lambda _prompt: next(answers)) == GOOD
    answers = iter([GOOD, "otra-distinta-123"])
    with pytest.raises(ApiException) as error:
        script.ask_password(lambda _prompt: next(answers))
    assert error.value.message == "Las contraseñas no coinciden."


# --- the command ---------------------------------------------------------------------------


def test_the_command_asks_for_what_is_missing_and_creates_the_administrator(run, db: Session):
    code, out, err = run([], typed=["ana@example.com", "Ana Torres", GOOD, GOOD])
    assert (code, err) == (0, "")
    assert out.strip() == "Listo: administrador ana@example.com creado."
    assert stored(db, "ana@example.com").rol == ROLE_ADMIN


def test_what_is_given_as_an_option_is_not_asked_again(run, db: Session):
    code, _, _ = run(["--email", "ana@example.com", "--nombre", "Ana Torres"], typed=[GOOD, GOOD])
    assert code == 0
    assert stored(db, "ana@example.com").nombre == "Ana Torres"


def test_a_password_typed_differently_the_second_time_creates_nothing(run, db: Session):
    code, out, err = run(
        ["--email", "ana@example.com", "--nombre", "Ana Torres"], typed=[GOOD, "otra-clave-123"]
    )
    assert code == 1 and out == ""
    assert err.strip() == "No se pudo: Las contraseñas no coinciden."
    assert stored(db, "ana@example.com") is None


def test_a_refusal_is_told_in_one_line_and_the_code_is_one(run, db: Session):
    code, out, err = run(
        ["--email", "ana@example.com", "--nombre", "Ana Torres"], typed=["corta", "corta"]
    )
    assert (code, out) == (1, "")
    assert err.startswith("No se pudo: ") and err.count("\n") == 1
    assert "Traceback" not in err


def test_from_the_environment_nothing_is_asked(run, db: Session):
    code, out, _ = run(
        ["--desde-entorno"],
        env={
            "ADMIN_EMAIL": "ana@example.com",
            "ADMIN_NOMBRE": "Ana Torres",
            "ADMIN_PASSWORD": GOOD,
        },
    )
    assert code == 0
    assert "ana@example.com" in out
    assert verify_password(stored(db, "ana@example.com").password_hash, GOOD)


def test_from_the_environment_the_name_has_a_default(run, db: Session):
    run(["--desde-entorno"], env={"ADMIN_EMAIL": "ana@example.com", "ADMIN_PASSWORD": GOOD})
    assert stored(db, "ana@example.com").nombre == "Administrador"


def test_from_the_environment_a_missing_password_is_refused(run, db: Session):
    code, _, err = run(["--desde-entorno"], env={"ADMIN_EMAIL": "ana@example.com"})
    assert code == 1 and "al menos 10 caracteres" in err
    assert stored(db, "ana@example.com") is None


def test_from_the_environment_a_missing_address_is_refused(run, db: Session):
    code, _, err = run(["--desde-entorno"], env={"ADMIN_PASSWORD": GOOD})
    assert code == 1 and "correo" in err
    assert db.scalar(select(Usuario)) is None


def test_the_command_resets_a_password_asking_for_it_twice(run, db: Session):
    make_user(db, ROLE_OPERATOR, "ana@example.com", "Ana Torres")
    code, out, _ = run(["--restablecer", "ana@example.com"], typed=[GOOD, GOOD])
    assert code == 0
    assert out.strip() == "Listo: la cuenta ana@example.com tiene contraseña nueva y está activa."
    assert verify_password(stored(db, "ana@example.com").password_hash, GOOD)


def test_the_command_resets_a_password_from_the_environment(run, db: Session):
    make_user(db, ROLE_OPERATOR, "ana@example.com", "Ana Torres")
    code, _, _ = run(
        ["--restablecer", "ana@example.com", "--desde-entorno"], env={"ADMIN_PASSWORD": GOOD}
    )
    assert code == 0
    assert verify_password(stored(db, "ana@example.com").password_hash, GOOD)


def test_the_command_says_when_the_account_to_reset_does_not_exist(run):
    code, _, err = run(["--restablecer", "nadie@example.com"], typed=[GOOD, GOOD])
    assert (code, err.strip()) == (1, "No se pudo: El usuario no existe.")


def test_the_command_records_what_it_did_in_the_audit_log(run, db: Session):
    run(["--email", "ana@example.com", "--nombre", "Ana Torres"], typed=[GOOD, GOOD])
    run(["--restablecer", "ana@example.com"], typed=[GOOD, GOOD])
    assert [row.accion for row in system_rows(db)] == [
        "admin_crear_comando",
        "clave_restablecida_comando",
    ]
