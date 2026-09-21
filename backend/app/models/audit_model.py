from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.connection import Base
from app.database.types import UTCDateTime, utcnow


class Auditoria(Base):
    """What was done, by whom and when. It never holds passwords, tokens, vectors or images, and
    the app has no way to change or delete a row of it."""

    __tablename__ = "auditoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    # The user stays readable in the log even if the account is deleted later
    usuario_id: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL"), index=True
    )
    usuario_email: Mapped[str | None] = mapped_column(String(254))
    accion: Mapped[str] = mapped_column(String(40), index=True)
    recurso: Mapped[str | None] = mapped_column(String(30))
    recurso_id: Mapped[int | None]
    # "ok", "fallo", "denegado" or "bloqueado"
    resultado: Mapped[str] = mapped_column(String(12))
    detalle: Mapped[str | None] = mapped_column(String(500))
    ip: Mapped[str | None] = mapped_column(String(45))
