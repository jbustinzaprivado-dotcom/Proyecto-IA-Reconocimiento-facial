from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.connection import Base
from app.database.types import UTCDateTime, utcnow


class MlTrainingRecord(Base):
    """One evaluated attempt, as the probability model learns from it. It carries no name or email.

    `resultado_real` is whether the closest candidate really was who stood in front of the camera.
    `grupo` is the person who was expected (empty for an unknown one): it keeps the photos of one
    person together when the model is checked, and it is a number, not a name.
    """

    __tablename__ = "ml_training_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    # The attempt it was made from. If the history is ever cleaned the record stays
    recognition_log_id: Mapped[int | None] = mapped_column(
        ForeignKey("recognition_logs.id", ondelete="SET NULL"), unique=True
    )
    # The model that made the vectors: each one has its own similarity scale
    modelo: Mapped[str] = mapped_column(String(50), index=True)
    similitud: Mapped[float]
    calidad_imagen: Mapped[float]
    iluminacion: Mapped[float]
    resultado_real: Mapped[bool]
    grupo: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
