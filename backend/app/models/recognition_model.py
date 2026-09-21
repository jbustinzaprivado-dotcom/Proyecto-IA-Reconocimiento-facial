from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.connection import Base
from app.database.types import UTCDateTime, utcnow


class RecognitionLog(Base):
    __tablename__ = "recognition_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Empty when there was no candidate at all
    persona_id: Mapped[int | None] = mapped_column(
        ForeignKey("personas.id", ondelete="SET NULL"), index=True
    )
    similitud: Mapped[float]
    distancia: Mapped[float]
    umbral: Mapped[float]
    coincide: Mapped[bool]
    # The model that made the vectors: similarities of different models are on different scales
    modelo: Mapped[str] = mapped_column(String(50), server_default="simulated")
    # Empty while the model is not calibrated
    probabilidad_calibrada: Mapped[float | None]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)

    # What was measured on the face of this attempt. Empty in the attempts made before it was kept
    nitidez: Mapped[float | None]
    brillo: Mapped[float | None]
    tamano_rostro: Mapped[int | None]
    confianza_deteccion: Mapped[float | None]

    # Evaluation mode: who the operator said was in front of the camera. Empty in a normal attempt
    # ("persona" or "desconocido"). The wrong candidate is never kept: only whether the closest
    # one was the expected person
    esperado: Mapped[str | None] = mapped_column(String(12))
    esperado_persona_id: Mapped[int | None] = mapped_column(
        ForeignKey("personas.id", ondelete="SET NULL")
    )
    candidato_correcto: Mapped[bool | None]
