from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.constants import ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER, ROLES
from app.core.errors import ApiException
from app.core.security import decode_token
from app.database.connection import get_db
from app.models import Usuario
from app.services.audit_service import AuditTrail
from app.services.auth_service import unauthorized
from app.services.face_engines import FaceEngine
from app.services.quality_service import QualityPolicy

ENGINE_NOT_LOADED = "El motor facial todavía no se ha cargado."
SESSION_INVALID = "Tu sesión no es válida o venció. Inicia sesión otra vez."
NOT_ALLOWED = "No tienes permiso para hacer esto."

DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]


def get_face_engine(request: Request) -> FaceEngine:
    """The engine loaded when the API started, or 503 saying why there is none."""
    engine = getattr(request.app.state, "face_engine", None)
    if engine is None:
        reason = getattr(request.app.state, "face_engine_error", None) or ENGINE_NOT_LOADED
        raise ApiException(503, f"El motor facial no está disponible. {reason}")
    return engine


def get_quality_policy(settings: AppSettings) -> QualityPolicy:
    return QualityPolicy.from_settings(settings)


def resolve_threshold(settings: Settings, engine: FaceEngine) -> float:
    """The threshold set in the environment, or else the default of the engine in use."""
    if settings.recognition_threshold is not None:
        return settings.recognition_threshold
    return engine.default_threshold


def get_optional_engine(request: Request) -> FaceEngine | None:
    """The engine if it is loaded; the analysis can still be looked at without it."""
    return getattr(request.app.state, "face_engine", None)


def get_audit_trail(request: Request, db: DbSession, settings: AppSettings) -> AuditTrail:
    return AuditTrail(db, settings, request)


Engine = Annotated[FaceEngine, Depends(get_face_engine)]
OptionalEngine = Annotated[FaceEngine | None, Depends(get_optional_engine)]
Quality = Annotated[QualityPolicy, Depends(get_quality_policy)]
Auditor = Annotated[AuditTrail, Depends(get_audit_trail)]

bearer_scheme = HTTPBearer(auto_error=False, description="Token que entrega POST /api/auth/login")


def get_current_user(
    db: DbSession,
    settings: AppSettings,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> Usuario:
    """Who is asking. Not only the token is checked: the user must still exist, be active, and not
    have had the sessions ended since the token was made (a new password does that)."""
    if credentials is None:
        raise unauthorized(SESSION_INVALID)
    claims = decode_token(credentials.credentials, settings.signing_key)
    if claims is None:
        raise unauthorized(SESSION_INVALID)
    try:
        user = db.get(Usuario, int(claims["sub"]))
    except ValueError:
        user = None
    if user is None or not user.activo:
        raise unauthorized(SESSION_INVALID)
    if claims["iat"] < int(user.tokens_validos_desde.timestamp()):
        raise unauthorized(SESSION_INVALID)
    return user


CurrentUser = Annotated[Usuario, Depends(get_current_user)]


def require_roles(*roles: str) -> Callable[..., Usuario]:
    """A dependency that lets through only these roles. A refusal is written to the audit log."""

    def check(user: CurrentUser, request: Request, audit: Auditor) -> Usuario:
        if user.rol not in roles:
            audit.log(
                user,
                "denegado",
                result="denegado",
                detail=f"{request.method} {request.url.path}",
            )
            raise ApiException(403, NOT_ALLOWED)
        return user

    return check


# Everyone who is signed in; whoever registers and recognizes; and the administrator alone
AnyUser = Annotated[Usuario, Depends(require_roles(*ROLES))]
Staff = Annotated[Usuario, Depends(require_roles(ROLE_ADMIN, ROLE_OPERATOR))]
Admin = Annotated[Usuario, Depends(require_roles(ROLE_ADMIN))]

__all__ = [
    "Admin",
    "AnyUser",
    "AppSettings",
    "Auditor",
    "CurrentUser",
    "DbSession",
    "Engine",
    "OptionalEngine",
    "Quality",
    "ROLE_VIEWER",
    "Staff",
    "resolve_threshold",
]
