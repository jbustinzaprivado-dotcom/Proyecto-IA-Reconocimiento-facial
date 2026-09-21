from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import Admin, DbSession
from app.core.constants import AUDIT_PAGE_DEFAULT, AUDIT_PAGE_MAX
from app.schemas.audit_schema import AuditPageOut
from app.schemas.common_schema import ApiError, ApiResponse
from app.services import audit_service

router = APIRouter(prefix="/auditoria", tags=["auditoria"])


@router.get(
    "",
    response_model=ApiResponse[AuditPageOut],
    responses={403: {"model": ApiError}, 422: {"model": ApiError}},
)
def list_audit(
    db: DbSession,
    admin: Admin,
    usuario: str | None = None,
    accion: str | None = None,
    resultado: str | None = None,
    desde: datetime | None = None,
    antes_de_id: int | None = None,
    limite: Annotated[int, Query(ge=1, le=AUDIT_PAGE_MAX)] = AUDIT_PAGE_DEFAULT,
):
    """The audit log, newest first. Read only: nothing in the API changes or deletes a row of it.

    `usuario` is part of an address, `desde` a date and time, and `antes_de_id` the `siguiente` of
    the previous page."""
    page = audit_service.list_page(
        db,
        email=usuario,
        action=accion,
        result=resultado,
        since=desde,
        before_id=antes_de_id,
        limit=limite,
    )
    return ApiResponse(resultado=page)
