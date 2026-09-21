from datetime import datetime

from sqlalchemy import ForeignKey, LargeBinary, String, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.connection import Base
from app.database.types import UTCDateTime, utcnow


class Persona(Base):
    __tablename__ = "personas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    activo: Mapped[bool] = mapped_column(default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    consentimiento_at: Mapped[datetime] = mapped_column(UTCDateTime)
    consentimiento_version: Mapped[str] = mapped_column(String(50))

    embeddings: Mapped[list["FaceEmbedding"]] = relationship(
        back_populates="persona", cascade="all, delete-orphan"
    )


class FaceEmbedding(Base):
    """A face vector (float32 bytes). Embeddings of different models are not comparable."""

    __tablename__ = "face_embeddings"

    id: Mapped[int] = mapped_column(primary_key=True)
    persona_id: Mapped[int] = mapped_column(
        ForeignKey("personas.id", ondelete="CASCADE"), index=True
    )
    embedding: Mapped[bytes] = mapped_column(LargeBinary)
    modelo: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    persona: Mapped[Persona] = relationship(back_populates="embeddings")
