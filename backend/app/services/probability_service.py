"""Calibrated probabilities and the model behind them (Phase 4).

The probability says how likely it is that the closest candidate really is the person in front of
the camera. It is only informative: whether an attempt "coincide" is still decided by the similarity
and the threshold. Until a model has been trained, everything here answers that there is none yet.
"""

from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.constants import ML_MIN_EXAMPLES, ML_MIN_PEOPLE, ML_MIN_PER_CLASS
from app.core.errors import ApiException
from app.schemas.probability_schema import (
    MlStatusOut,
    ModelMetricsOut,
    PredictionIn,
    PredictionOut,
)
from app.services import ml_dataset_service, ml_model_service
from app.services.ml_scores import illumination_score, quality_score
from app.services.quality_service import FaceMeasurements

NO_MODEL = "Modelo no entrenado."
TRAINING_OFF = (
    "El entrenamiento está deshabilitado. Para habilitarlo pon ML_TRAINING_ENABLED=true en el "
    ".env del servidor y reinicia la API."
)
NO_ENGINE = "El motor facial no está disponible, así que no se sabe con qué modelo entrenar."


def predict(data: PredictionIn, models_dir: Path, face_model: str | None) -> PredictionOut:
    if face_model is None:
        return PredictionOut(probabilidad_calibrada=None)
    return PredictionOut(
        probabilidad_calibrada=ml_model_service.predict(
            models_dir, face_model, data.similitud, data.calidad_imagen, data.iluminacion
        )
    )


def probability_for_attempt(
    models_dir: Path, face_model: str, similitud: float, measurements: FaceMeasurements | None
) -> float | None:
    """The probability of an attempt that has just been made, or nothing if there is no model or
    the face was not measured. Whatever goes wrong here must never spoil the recognition."""
    if measurements is None or measurements.nitidez is None or measurements.brillo is None:
        return None
    try:
        return ml_model_service.predict(
            models_dir,
            face_model,
            similitud,
            quality_score(measurements.nitidez, measurements.tamano, measurements.confianza),
            illumination_score(measurements.brillo),
        )
    except Exception:
        ml_model_service.logger.exception("No se pudo calcular la probabilidad calibrada")
        return None


def get_metrics(models_dir: Path, face_model: str | None) -> ModelMetricsOut:
    stored = ml_model_service.load(models_dir, face_model) if face_model else None
    if stored is None:
        raise ApiException(404, NO_MODEL)
    return stored.metrics


def train_model(db: Session, settings: Settings, face_model: str | None) -> ModelMetricsOut:
    if not settings.ml_training_enabled:
        raise ApiException(403, TRAINING_OFF)
    if face_model is None:
        raise ApiException(503, NO_ENGINE)
    return ml_model_service.train(db, settings.models_dir, face_model)


def status(db: Session, settings: Settings, face_model: str | None) -> MlStatusOut:
    common = {
        "entrenamiento_habilitado": settings.ml_training_enabled,
        "minimo_ejemplos": ML_MIN_EXAMPLES,
        "minimo_por_tipo": ML_MIN_PER_CLASS,
        "minimo_personas": ML_MIN_PEOPLE,
    }
    if face_model is None:
        return MlStatusOut(
            modelo_facial=None,
            ejemplos=0,
            ejemplos_correctos=0,
            ejemplos_incorrectos=0,
            personas=0,
            faltan=[NO_ENGINE],
            datos_suficientes=False,
            entrenado=False,
            entrenado_en=None,
            algoritmo=None,
            **common,
        )
    ml_dataset_service.sync_records(db)
    counts = ml_dataset_service.counts(db, face_model)
    stored = ml_model_service.load(settings.models_dir, face_model)
    return MlStatusOut(
        modelo_facial=face_model,
        ejemplos=counts.examples,
        ejemplos_correctos=counts.correct,
        ejemplos_incorrectos=counts.wrong,
        personas=counts.people,
        faltan=counts.missing,
        datos_suficientes=not counts.missing,
        entrenado=stored is not None,
        entrenado_en=stored.metrics.entrenado_en if stored else None,
        algoritmo=stored.metrics.algoritmo if stored else None,
        **common,
    )
