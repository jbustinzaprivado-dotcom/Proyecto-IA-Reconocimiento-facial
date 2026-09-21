from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import ENGINE_NOT_LOADED, AppSettings
from app.database.connection import get_db
from app.schemas.common_schema import ApiError, ApiResponse, HealthStatus

router = APIRouter(tags=["health"])


def unavailable(message: str) -> JSONResponse:
    return JSONResponse(status_code=503, content=ApiError(error=message).model_dump())


@router.get(
    "/health",
    response_model=ApiResponse[HealthStatus],
    responses={503: {"model": ApiError}},
)
def health(request: Request, db: Annotated[Session, Depends(get_db)], settings: AppSettings):
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return unavailable("Base de datos no disponible")

    engine = getattr(request.app.state, "face_engine", None)
    if engine is None:
        reason = getattr(request.app.state, "face_engine_error", None) or ENGINE_NOT_LOADED
        return unavailable(f"El motor facial no está disponible. {reason}")

    return ApiResponse(
        resultado=HealthStatus(
            estado="ok",
            version=settings.app_version,
            motor=settings.face_engine,
            modelo=engine.name,
            base_de_datos="ok",
        )
    )
