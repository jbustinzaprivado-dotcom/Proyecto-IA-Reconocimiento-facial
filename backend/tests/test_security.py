from datetime import UTC, datetime, timedelta
from typing import get_args

import jwt
import pytest
from pydantic import ValidationError
from starlette.requests import Request

from app.core import security
from app.core.config import DEVELOPMENT_JWT_SECRET, Settings
from app.core.constants import (
    JWT_ALGORITHM,
    JWT_SECRET_MIN_LENGTH,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    ROLES,
)
from app.core.errors import ApiException
from app.core.network import client_ip
from app.schemas.user_schema import Role

KEY = "una-clave-de-prueba-de-al-menos-32-caracteres"
NOW = datetime(2026, 9, 20, 12, 0, tzinfo=UTC)


def request_from(host: str | None, forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded is not None else []
    scope = {"type": "http", "headers": headers, "client": (host, 1234) if host else None}
    return Request(scope)


# --- passwords -----------------------------------------------------------------------------


def test_a_password_is_kept_as_a_hash_that_only_the_same_password_matches():
    hashed = security.hash_password("una clave larga y buena")
    assert hashed != "una clave larga y buena"
    assert hashed.startswith("$argon2id$")
    assert security.verify_password(hashed, "una clave larga y buena") is True
    assert security.verify_password(hashed, "una clave larga y mala") is False


def test_two_hashes_of_the_same_password_are_not_the_same():
    assert security.hash_password("una clave larga y buena") != security.hash_password(
        "una clave larga y buena"
    )


@pytest.mark.parametrize("garbage", ["", "no es un hash", "$argon2id$roto"])
def test_a_stored_value_that_is_not_a_hash_never_matches_and_never_fails(garbage):
    assert security.verify_password(garbage, "una clave larga y buena") is False


def test_a_hash_made_with_weaker_settings_is_marked_for_renewal():
    from argon2 import PasswordHasher

    weak = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash("una clave larga")
    assert security.needs_rehash(weak) is True
    assert security.needs_rehash(security.hash_password("una clave larga")) is False


def test_spending_the_time_of_a_check_needs_no_account_and_never_fails():
    security.spend_the_time_of_a_check("cualquier cosa")
    security.spend_the_time_of_a_check("")


@pytest.mark.parametrize(
    ("password", "reason"),
    [
        ("corta", f"al menos {PASSWORD_MIN_LENGTH} caracteres"),
        ("x" * (PASSWORD_MIN_LENGTH - 1), f"al menos {PASSWORD_MIN_LENGTH} caracteres"),
        ("x" * (PASSWORD_MAX_LENGTH + 1), f"más de {PASSWORD_MAX_LENGTH} caracteres"),
        (" " * 12, "solo espacios"),
        ("ana@example.com", "igual al correo"),
        ("ANA@example.com", "igual al correo"),
        ("ana", None),
    ],
)
def test_the_rules_of_a_password_say_why_it_is_refused(password, reason):
    if reason is None:
        # Too short, so the length rule speaks first
        reason = "al menos"
    with pytest.raises(ApiException) as error:
        security.check_password_policy(password, "ana@example.com")
    assert error.value.status_code == 422
    assert reason in error.value.message


def test_the_local_part_of_the_address_is_not_a_good_password_either():
    with pytest.raises(ApiException) as error:
        security.check_password_policy("anatorres-2026", "anatorres-2026@example.com")
    assert "igual al correo" in error.value.message


def test_a_long_plain_password_is_accepted_at_both_limits():
    for length in (PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH):
        password = "a" * length
        assert security.check_password_policy(password, "ana@example.com") == password


# --- tokens --------------------------------------------------------------------------------


def test_a_token_says_who_it_is_for_and_until_when():
    now = datetime.now(UTC)
    token = security.create_token(7, "operador", KEY, 60, now)
    claims = security.decode_token(token, KEY)
    assert claims is not None
    assert claims["sub"] == "7"
    assert claims["rol"] == "operador"
    assert claims["iat"] == int(now.timestamp())
    assert claims["exp"] == int((now + timedelta(minutes=60)).timestamp())


def test_a_token_from_the_past_that_has_expired_is_refused():
    token = security.create_token(7, "operador", KEY, 60, datetime.now(UTC) - timedelta(hours=2))
    assert security.decode_token(token, KEY) is None


def test_a_token_still_valid_is_accepted():
    token = security.create_token(7, "operador", KEY, 60, datetime.now(UTC))
    assert security.decode_token(token, KEY) is not None


def test_a_token_made_with_another_key_is_refused():
    token = security.create_token(7, "operador", "otra-clave-distinta-de-32-caracteres!!", 60, NOW)
    assert security.decode_token(token, KEY) is None


def test_a_token_that_was_altered_is_refused():
    token = security.create_token(7, "consulta", KEY, 60, datetime.now(UTC))
    header, payload, signature = token.split(".")
    other = jwt.encode(
        {"sub": "7", "rol": "administrador", "iat": 0, "exp": 9999999999}, "x" * 40, "HS256"
    ).split(".")[1]
    assert security.decode_token(f"{header}.{other}.{signature}", KEY) is None
    assert security.decode_token(f"{header}.{payload}.", KEY) is None


def test_a_token_that_says_it_needs_no_signature_is_refused():
    unsigned = jwt.encode({"sub": "1", "iat": 1, "exp": 9999999999}, None, algorithm="none")
    assert security.decode_token(unsigned, KEY) is None


def test_a_token_signed_with_another_algorithm_is_refused():
    other = jwt.encode({"sub": "1", "iat": 1, "exp": 9999999999}, KEY, algorithm="HS512")
    assert JWT_ALGORITHM == "HS256"
    assert security.decode_token(other, KEY) is None


@pytest.mark.parametrize("missing", ["sub", "iat", "exp"])
def test_a_token_missing_a_claim_is_refused(missing):
    claims = {"sub": "1", "iat": 1, "exp": 9999999999}
    del claims[missing]
    assert security.decode_token(jwt.encode(claims, KEY, algorithm="HS256"), KEY) is None


@pytest.mark.parametrize("garbage", ["", "abc", "a.b.c", "Bearer x"])
def test_something_that_is_not_a_token_is_refused_without_failing(garbage):
    assert security.decode_token(garbage, KEY) is None


# --- roles and settings --------------------------------------------------------------------


def test_the_role_names_of_the_schema_are_the_ones_of_the_constants():
    assert set(get_args(Role)) == set(ROLES)
    assert ROLES == ("administrador", "operador", "consulta")


def test_in_development_a_missing_secret_uses_one_of_the_process():
    settings = Settings(_env_file=None)
    assert settings.jwt_secret == ""
    assert settings.signing_key == DEVELOPMENT_JWT_SECRET
    assert len(DEVELOPMENT_JWT_SECRET) >= JWT_SECRET_MIN_LENGTH


def test_a_secret_that_is_set_is_the_one_used():
    assert Settings(_env_file=None, jwt_secret=KEY).signing_key == KEY


def test_production_does_not_start_without_a_real_secret():
    for secret in ("", "corta", "x" * (JWT_SECRET_MIN_LENGTH - 1)):
        with pytest.raises(ValidationError) as error:
            Settings(_env_file=None, environment="production", jwt_secret=secret)
        assert f"JWT_SECRET debe tener al menos {JWT_SECRET_MIN_LENGTH} caracteres" in str(
            error.value
        )


def test_production_starts_with_a_long_enough_secret():
    settings = Settings(
        _env_file=None, environment="production", jwt_secret="x" * JWT_SECRET_MIN_LENGTH
    )
    assert settings.is_production is True


def test_development_is_the_default_and_is_not_production():
    assert Settings(_env_file=None).environment == "development"
    assert Settings(_env_file=None).is_production is False


@pytest.mark.parametrize(
    ("field", "value"),
    [("jwt_expire_minutes", 0), ("jwt_expire_minutes", 1441), ("login_rate_per_minute", 0)],
)
def test_limits_out_of_range_are_refused(field, value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})


# --- the address of the caller -------------------------------------------------------------


def test_the_address_is_the_one_of_the_connection():
    assert client_ip(request_from("10.0.0.5"), trust_forwarded=False) == "10.0.0.5"


def test_a_forwarded_address_is_ignored_unless_it_is_trusted():
    request = request_from("10.0.0.5", "1.2.3.4")
    assert client_ip(request, trust_forwarded=False) == "10.0.0.5"


def test_when_trusted_the_last_forwarded_address_is_used_because_it_is_ours():
    request = request_from("10.0.0.5", "6.6.6.6, 1.2.3.4")
    assert client_ip(request, trust_forwarded=True) == "1.2.3.4"


def test_without_a_forwarded_header_the_connection_is_used_even_when_trusted():
    assert client_ip(request_from("10.0.0.5"), trust_forwarded=True) == "10.0.0.5"
    assert client_ip(request_from("10.0.0.5", ""), trust_forwarded=True) == "10.0.0.5"


def test_with_no_connection_at_all_there_is_no_address():
    assert client_ip(request_from(None), trust_forwarded=False) is None


def test_a_huge_forwarded_value_is_cut_to_what_an_address_can_be():
    assert len(client_ip(request_from("10.0.0.5", "9" * 300), trust_forwarded=True)) == 45


def test_the_time_of_a_check_is_really_spent_verifying_a_hash(monkeypatch):
    calls = []

    def fake_verify(password_hash, password):
        calls.append((password_hash, password))
        return False

    monkeypatch.setattr(security, "verify_password", fake_verify)
    security.spend_the_time_of_a_check("lo que se escribió")
    security.spend_the_time_of_a_check("otra")
    assert [password for _hash, password in calls] == ["lo que se escribió", "otra"]
    assert all(password_hash.startswith("$argon2id$") for password_hash, _ in calls)
    # The hash is made once and reused
    assert calls[0][0] == calls[1][0]


def test_the_defaults_are_the_ones_that_were_approved():
    settings = Settings(_env_file=None)
    assert settings.jwt_expire_minutes == 60
    assert settings.trust_forwarded_for is False
    assert settings.environment == "development"
