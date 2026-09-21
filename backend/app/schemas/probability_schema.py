from datetime import datetime

from pydantic import BaseModel, Field


class PredictionIn(BaseModel):
    similitud: float = Field(ge=0, le=1)
    # 2 x (1 - similitud) with the similarity between 0 and 1. The model does not use it: it says
    # nothing that the similarity does not
    distancia: float = Field(ge=0, le=2)
    # Scores from 0 to 1 made from what is measured on the face (see ml_scores.py)
    calidad_imagen: float = Field(ge=0, le=1)
    iluminacion: float = Field(ge=0, le=1)


class PredictionOut(BaseModel):
    # Empty while there is no trained model
    probabilidad_calibrada: float | None


class AlgorithmResultOut(BaseModel):
    """How one of the algorithms did, checked on people it had not seen."""

    algoritmo: str
    nombre: str
    log_loss: float
    brier: float
    # A rate with nothing to divide by is empty, not zero
    precision: float | None
    recall: float | None
    f1: float | None
    tasa_falsos_positivos: float | None
    tasa_falsos_negativos: float | None
    elegido: bool


class ModelMetricsOut(BaseModel):
    """What the chosen model achieves on people it had not seen, cutting at a probability of 0.5."""

    precision: float | None
    recall: float | None
    f1: float | None
    tasa_falsos_positivos: float | None
    tasa_falsos_negativos: float | None
    # [[TN, FP], [FN, TP]], same layout as scikit-learn
    matriz_confusion: list[list[int]]
    n_muestras: int
    algoritmo: str
    modelo_facial: str
    entrenado_en: datetime
    log_loss: float
    brier: float
    ejemplos_correctos: int
    ejemplos_incorrectos: int
    personas: int
    comparacion: list[AlgorithmResultOut]


class MlStatusOut(BaseModel):
    """Whether there is enough data to train, and whether a model already exists."""

    # The face model whose examples and model these are (empty if the engine is not loaded)
    modelo_facial: str | None
    entrenamiento_habilitado: bool
    ejemplos: int
    ejemplos_correctos: int
    ejemplos_incorrectos: int
    personas: int
    minimo_ejemplos: int
    minimo_por_tipo: int
    minimo_personas: int
    # What is still needed, in words. Empty when there is enough
    faltan: list[str]
    datos_suficientes: bool
    entrenado: bool
    entrenado_en: datetime | None
    algoritmo: str | None
