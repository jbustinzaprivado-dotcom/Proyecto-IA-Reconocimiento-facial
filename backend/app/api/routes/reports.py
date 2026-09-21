from fastapi import APIRouter, Response

from app.api.deps import (
    AnyUser,
    AppSettings,
    Auditor,
    DbSession,
    OptionalEngine,
    Staff,
    resolve_threshold,
)
from app.schemas.common_schema import ApiError
from app.services import analysis_service, report_service

router = APIRouter(prefix="/reportes", tags=["reportes"])

CSV = "text/csv; charset=utf-8"


def csv_response(content: bytes, name: str) -> Response:
    return Response(
        content=content,
        media_type=CSV,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/historial.csv", responses={404: {"model": ApiError}})
def history_csv(db: DbSession, user: Staff, audit: Auditor, modelo: str | None = None):
    """Every attempt as a CSV (not only the 200 of the screen). It has names: see the first line."""
    audit.log(user, "csv_historial", resource="historial", detail=f"modelo: {modelo or 'en uso'}")
    return csv_response(
        report_service.history_csv(db, modelo), report_service.file_name("historial")
    )


@router.get("/analisis.csv", responses={404: {"model": ApiError}})
def analysis_csv(
    db: DbSession,
    user: AnyUser,
    audit: Auditor,
    settings: AppSettings,
    engine: OptionalEngine,
    modelo: str | None = None,
):
    """The threshold curve of one model as a CSV."""
    audit.log(user, "csv_analisis", resource="analisis", detail=f"modelo: {modelo or 'en uso'}")
    analysis = analysis_service.summary(
        db,
        requested_model=modelo,
        active_model=engine.name if engine else None,
        active_threshold=resolve_threshold(settings, engine) if engine else None,
    )
    return csv_response(report_service.analysis_csv(analysis), report_service.file_name("analisis"))
