from fastapi import APIRouter

from app.api.deps import Admin, AnyUser, AppSettings, Auditor, DbSession, OptionalEngine
from app.core.errors import ApiException
from app.schemas.common_schema import ApiError, ApiResponse
from app.schemas.probability_schema import (
    MlStatusOut,
    ModelMetricsOut,
    PredictionIn,
    PredictionOut,
)
from app.services import probability_service

router = APIRouter(tags=["probabilidades"])


@router.post(
    "/probabilidades/prediccion",
    response_model=ApiResponse[PredictionOut],
    responses={422: {"model": ApiError}},
)
def predict(data: PredictionIn, user: AnyUser, settings: AppSettings, engine: OptionalEngine):
    """The calibrated probability for these values, or nothing while there is no trained model."""
    face_model = engine.name if engine else None
    return ApiResponse(resultado=probability_service.predict(data, settings.models_dir, face_model))


@router.get(
    "/modelos/metricas",
    response_model=ApiResponse[ModelMetricsOut],
    responses={404: {"model": ApiError}},
)
def metrics(user: AnyUser, settings: AppSettings, engine: OptionalEngine):
    face_model = engine.name if engine else None
    return ApiResponse(resultado=probability_service.get_metrics(settings.models_dir, face_model))


@router.get("/modelos/estado", response_model=ApiResponse[MlStatusOut])
def status(db: DbSession, user: AnyUser, settings: AppSettings, engine: OptionalEngine):
    """How many examples there are, how many are missing to train, and whether a model exists."""
    face_model = engine.name if engine else None
    return ApiResponse(resultado=probability_service.status(db, settings, face_model))


@router.post(
    "/modelos/entrenar",
    response_model=ApiResponse[ModelMetricsOut],
    responses={
        403: {"model": ApiError},
        409: {"model": ApiError},
        422: {"model": ApiError},
        503: {"model": ApiError},
    },
)
def train(
    db: DbSession, user: Admin, audit: Auditor, settings: AppSettings, engine: OptionalEngine
):
    """Train and check the three algorithms with the evaluated attempts and keep the best. Only an
    administrator, and only if ML_TRAINING_ENABLED is on in the .env of the server."""
    face_model = engine.name if engine else None
    try:
        result = probability_service.train_model(db, settings, face_model)
    except ApiException as error:
        audit.log(user, "entrenar", result="fallo", resource="modelo", detail=error.message)
        raise
    audit.log(
        user,
        "entrenar",
        resource="modelo",
        detail=f"{result.algoritmo}, {result.n_muestras} ejemplos",
    )
    return ApiResponse(resultado=result)
