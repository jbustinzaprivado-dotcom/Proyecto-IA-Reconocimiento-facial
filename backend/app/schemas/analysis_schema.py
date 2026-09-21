from datetime import date

from pydantic import BaseModel


class ModelOut(BaseModel):
    modelo: str
    intentos: int


class DayOut(BaseModel):
    fecha: date
    coincidencias: int
    rechazos: int


class BinOut(BaseModel):
    desde: float
    hasta: float
    coincidencias: int
    rechazos: int


class CurvePointOut(BaseModel):
    """What would have happened with this threshold, over every attempt of the model.

    The counts of errors only use the attempts of the evaluation mode (the ones whose real
    identity is known); they are 0 when there are none."""

    umbral: float
    coincidencias: int
    verdaderos_positivos: int
    falsos_positivos: int
    falsos_negativos: int
    verdaderos_negativos: int
    tasa_falsos_positivos: float | None
    tasa_falsos_negativos: float | None


class ThresholdMetricsOut(BaseModel):
    umbral: float
    precision: float | None
    recall: float | None
    f1: float | None
    tasa_falsos_positivos: float | None
    tasa_falsos_negativos: float | None
    # [[TN, FP], [FN, TP]], same layout as scikit-learn
    matriz_confusion: list[list[int]]
    n_muestras: int


class AnalysisOut(BaseModel):
    # The model the numbers are about: each model has its own similarity scale
    modelo: str | None
    modelos: list[ModelOut]
    # The threshold in use for that model, if it is known
    umbral: float | None
    total_intentos: int
    total_coincidencias: int
    tasa_coincidencia: float
    similitud_promedio_coincidencias: float | None
    similitud_promedio_rechazos: float | None
    por_dia: list[DayOut]
    histograma: list[BinOut]
    curva: list[CurvePointOut]
    # Attempts of the evaluation mode, and how many were of a known person or of an unknown one
    etiquetados: int
    etiquetados_persona: int
    etiquetados_desconocido: int
    # True when there are too few labeled attempts for the errors to mean much
    muestra_pequena: bool
    # With the current threshold, only when there are labeled attempts
    metricas_umbral: ThresholdMetricsOut | None
