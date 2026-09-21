"""Passwords and sessions: how they are stored, checked and made.

A password is only ever kept as an argon2 hash. A session is a signed token (JWT) that says who the
user is and until when; the API still checks on every request that the user exists, is active and
has not had the sessions ended since (see `deps.get_current_user`).
"""

from datetime import datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.constants import (
    JWT_ALGORITHM,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
)
from app.core.errors import ApiException

_hasher = PasswordHasher()
_dummy_hash: str | None = None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True when the hash was made with weaker settings than the current ones."""
    return _hasher.check_needs_rehash(password_hash)


def spend_the_time_of_a_check(password: str) -> None:
    """Check against a hash that matches nothing, so that an address that does not exist takes as
    long to answer as one that does. Otherwise the time would tell which addresses have accounts."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password("una contraseña que nadie usa")
    verify_password(_dummy_hash, password)


def check_password_policy(password: str, email: str) -> str:
    """The password if it is acceptable, otherwise a 422 with the reason in Spanish.

    Only length is asked for (long is better than complicated), and that it is not the address."""
    if len(password) < PASSWORD_MIN_LENGTH:
        raise ApiException(
            422, f"La contraseña debe tener al menos {PASSWORD_MIN_LENGTH} caracteres."
        )
    if len(password) > PASSWORD_MAX_LENGTH:
        raise ApiException(
            422, f"La contraseña no puede tener más de {PASSWORD_MAX_LENGTH} caracteres."
        )
    if not password.strip():
        raise ApiException(422, "La contraseña no puede ser solo espacios.")
    if password.strip().lower() in {email.lower(), email.split("@")[0].lower()}:
        raise ApiException(422, "La contraseña no puede ser igual al correo.")
    return password


def create_token(user_id: int, role: str, key: str, expire_minutes: int, now: datetime) -> str:
    claims = {
        "sub": str(user_id),
        "rol": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expire_minutes)).timestamp()),
    }
    return jwt.encode(claims, key, algorithm=JWT_ALGORITHM)


def decode_token(token: str, key: str) -> dict | None:
    """The claims of a valid token, or nothing if it is forged, altered, expired or incomplete."""
    try:
        return jwt.decode(
            token, key, algorithms=[JWT_ALGORITHM], options={"require": ["exp", "iat", "sub"]}
        )
    except jwt.PyJWTError:
        return None
