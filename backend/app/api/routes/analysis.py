from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import AnyUser, AppSettings, DbSession, OptionalEngine, resolve_threshold
from app.schemas.analysis_schema import AnalysisOut
from app.schemas.common_schema import ApiError, ApiResponse
from app.services import analysis_service

router = APIRouter(prefix="/analisis", tags=["analisis"])


@router.get(
    "/resumen",
    response_model=ApiResponse[AnalysisOut],
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def summary(
    db: DbSession,
    user: AnyUser,
    settings: AppSettings,
    engine: OptionalEngine,
    modelo: str | None = None,
    desfase_minutos: Annotated[int, Query(ge=-840, le=840)] = 0,
):
    """Statistics, threshold curve and metrics of one model, over every attempt it made.

    `modelo` is the model to look at (the one in use by default). `desfase_minutos` is how many
    minutes the local time of the viewer is ahead of UTC, to cut the days in the right place."""
    result = analysis_service.summary(
        db,
        requested_model=modelo,
        active_model=engine.name if engine else None,
        active_threshold=resolve_threshold(settings, engine) if engine else None,
        offset_minutes=desfase_minutos,
    )
    return ApiResponse(resultado=result)
