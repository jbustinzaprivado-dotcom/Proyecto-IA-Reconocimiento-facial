"""Signing in, and changing your own password.

An unknown address, a wrong password and a deactivated account all get the same answer, so that
nobody can find out which addresses have an account."""

from datetime import timedelta
from math import ceil

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.constants import LOGIN_LOCK_MINUTES, LOGIN_MAX_FAILURES
from app.core.errors import ApiException
from app.core.security import (
    check_password_policy,
    create_token,
    hash_password,
    needs_rehash,
    spend_the_time_of_a_check,
    verify_password,
)
from app.database.types import utcnow
from app.models import Usuario
from app.schemas.user_schema import SesionOut, UsuarioOut
from app.services.audit_service import AuditTrail

BAD_CREDENTIALS = "Correo o contraseña incorrectos."


def unauthorized(message: str = BAD_CREDENTIALS) -> ApiException:
    return ApiException(401, message, headers={"WWW-Authenticate": "Bearer"})


def login(db: Session, email: str, password: str, audit: AuditTrail) -> Usuario:
    now = utcnow()
    user = db.scalar(select(Usuario).where(Usuario.email == email))

    if user is None:
        spend_the_time_of_a_check(password)
        audit.log(None, "login", result="fallo", detail="correo desconocido", email=email)
        raise unauthorized()

    if user.locked_until is not None and user.locked_until > now:
        minutes = ceil((user.locked_until - now).total_seconds() / 60)
        audit.log(user, "login", result="bloqueado", detail="cuenta bloqueada")
        raise ApiException(
            429, f"Demasiados intentos fallidos. Vuelve a intentarlo en {minutes} minutos."
        )

    correct = verify_password(user.password_hash, password)
    if not correct or not user.activo:
        if not user.activo:
            audit.log(user, "login", result="fallo", detail="cuenta desactivada")
        else:
            user.failed_attempts += 1
            detail = "contraseña incorrecta"
            if user.failed_attempts >= LOGIN_MAX_FAILURES:
                user.locked_until = now + timedelta(minutes=LOGIN_LOCK_MINUTES)
                user.failed_attempts = 0
                detail = f"contraseña incorrecta; cuenta bloqueada {LOGIN_LOCK_MINUTES} minutos"
            db.commit()
            audit.log(user, "login", result="fallo", detail=detail)
        raise unauthorized()

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    db.commit()
    audit.log(user, "login")
    return user


def issue_session(user: Usuario, settings: Settings) -> SesionOut:
    token = create_token(
        user.id, user.rol, settings.signing_key, settings.jwt_expire_minutes, utcnow()
    )
    return SesionOut(
        token=token,
        expira_en=settings.jwt_expire_minutes * 60,
        usuario=UsuarioOut.model_validate(user),
    )


def change_password(
    db: Session, user: Usuario, current: str, new: str, audit: AuditTrail
) -> Usuario:
    if not verify_password(user.password_hash, current):
        audit.log(user, "cambio_clave", result="fallo", detail="contraseña actual incorrecta")
        raise ApiException(422, "La contraseña actual no es correcta.")
    check_password_policy(new, user.email)
    user.password_hash = hash_password(new)
    # Every session made before now ends. The caller gets a new one
    user.tokens_validos_desde = utcnow()
    db.commit()
    audit.log(user, "cambio_clave")
    return user
