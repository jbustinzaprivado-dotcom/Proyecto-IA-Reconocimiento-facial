from datetime import datetime
from typing import Literal

from pydantic import BaseModel

ConfidenceLevel = Literal["alta", "media", "baja"]
# What an attempt of the evaluation mode turned out to be, given who was really there
Label = Literal["acierto", "falso_positivo", "falso_negativo", "rechazo_correcto"]


class RecognitionOut(BaseModel):
    """Who the face belongs to. Without a match there is no name: the closest candidate is not
    revealed, so the endpoint cannot be used to find out who is registered."""

    persona_id: int | None
    nombre: str | None
    similitud: float
    distancia: float
    umbral: float
    coincide: bool
    probabilidad_calibrada: float | None
    confianza: ConfidenceLevel
    # Only when the attempt was made in the evaluation mode
    etiqueta: Label | None = None


class HistoryItemOut(BaseModel):
    id: int
    persona_id: int | None
    nombre: str | None
    similitud: float
    distancia: float
    umbral: float
    coincide: bool
    probabilidad_calibrada: float | None
    created_at: datetime
    modelo: str
    etiqueta: Label | None


class DashboardOut(BaseModel):
    total_personas: int
    total_reconocimientos: int
    total_coincidencias: int
