from fastapi import APIRouter, Request

from app.api.deps import AnyUser, AppSettings, Auditor, DbSession
from app.core.errors import ApiException
from app.core.network import client_ip
from app.schemas.common_schema import ApiError, ApiResponse
from app.schemas.user_schema import CambiarClaveIn, LoginIn, SesionOut, UsuarioOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

TOO_MANY_LOGINS = "Demasiados intentos de inicio de sesión. Espera un momento."


@router.post(
    "/login",
    response_model=ApiResponse[SesionOut],
    responses={401: {"model": ApiError}, 422: {"model": ApiError}, 429: {"model": ApiError}},
)
def login(data: LoginIn, request: Request, db: DbSession, settings: AppSettings, audit: Auditor):
    """Sign in with the address and the password. The token it returns goes in every request as
    `Authorization: Bearer <token>`. It is the only route (besides `health`) that needs no token."""
    ip = client_ip(request, settings.trust_forwarded_for) or "desconocida"
    allowed, wait = request.app.state.rate_limiter.allow(
        f"login:{ip}", settings.login_rate_per_minute
    )
    if not allowed:
        audit.log(
            None,
            "login",
            result="bloqueado",
            detail="demasiados intentos desde esta dirección",
            email=data.email,
        )
        raise ApiException(429, TOO_MANY_LOGINS, headers={"Retry-After": str(wait)})
    user = auth_service.login(db, data.email, data.clave, audit)
    return ApiResponse(resultado=auth_service.issue_session(user, settings))


@router.get("/yo", response_model=ApiResponse[UsuarioOut], responses={401: {"model": ApiError}})
def me(user: AnyUser):
    return ApiResponse(resultado=UsuarioOut.model_validate(user))


@router.post(
    "/cambiar-clave",
    response_model=ApiResponse[SesionOut],
    responses={401: {"model": ApiError}, 422: {"model": ApiError}},
)
def change_password(
    data: CambiarClaveIn, user: AnyUser, db: DbSession, settings: AppSettings, audit: Auditor
):
    """Change your own password. Every session made before ends, and a new one comes back."""
    changed = auth_service.change_password(db, user, data.clave_actual, data.clave_nueva, audit)
    return ApiResponse(resultado=auth_service.issue_session(changed, settings))
