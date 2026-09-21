from fastapi import APIRouter

from app.api.deps import Admin, Auditor, DbSession
from app.schemas.common_schema import ApiError, ApiResponse
from app.schemas.user_schema import UsuarioCreate, UsuarioOut, UsuarioUpdate
from app.services import user_service

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


@router.get("", response_model=ApiResponse[list[UsuarioOut]])
def list_users(db: DbSession, admin: Admin):
    users = user_service.list_users(db)
    return ApiResponse(resultado=[UsuarioOut.model_validate(user) for user in users])


@router.post(
    "",
    status_code=201,
    response_model=ApiResponse[UsuarioOut],
    responses={409: {"model": ApiError}, 422: {"model": ApiError}},
)
def create_user(data: UsuarioCreate, db: DbSession, admin: Admin, audit: Auditor):
    user = user_service.create_user(db, data)
    audit.log(
        admin, "usuario_crear", resource="usuario", resource_id=user.id, detail=f"rol: {user.rol}"
    )
    return ApiResponse(resultado=UsuarioOut.model_validate(user))


@router.patch(
    "/{user_id}",
    response_model=ApiResponse[UsuarioOut],
    responses={404: {"model": ApiError}, 409: {"model": ApiError}, 422: {"model": ApiError}},
)
def update_user(user_id: int, data: UsuarioUpdate, db: DbSession, admin: Admin, audit: Auditor):
    """Change the name, the role, whether the account is active, or set a new password. The last
    active administrator cannot be removed, and nobody can deactivate their own account."""
    user, changes = user_service.update_user(db, user_id, data, admin)
    audit.log(
        admin,
        "usuario_actualizar",
        resource="usuario",
        resource_id=user.id,
        detail="; ".join(changes),
    )
    return ApiResponse(resultado=UsuarioOut.model_validate(user))
