from fastapi import APIRouter

from app.api.deps import AnyUser, DbSession
from app.schemas.common_schema import ApiResponse
from app.schemas.recognition_schema import DashboardOut
from app.services import recognition_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/resumen", response_model=ApiResponse[DashboardOut])
def summary(db: DbSession, user: AnyUser):
    return ApiResponse(resultado=recognition_service.dashboard(db))
