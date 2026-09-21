from datetime import datetime

from sqlalchemy import CheckConstraint, String, true
from sqlalchemy.orm import Mapped, mapped_column

from app.database.connection import Base
from app.database.types import UTCDateTime, utcnow


class Usuario(Base):
    """Someone who can sign in. The password is only ever kept as a hash."""

    __tablename__ = "usuarios"
    __table_args__ = (
        CheckConstraint("rol IN ('administrador', 'operador', 'consulta')", name="ck_usuarios_rol"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    nombre: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    rol: Mapped[str] = mapped_column(String(20))
    activo: Mapped[bool] = mapped_column(default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # Wrong passwords in a row, and until when the account is locked because of them
    failed_attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # A session made before this moment is no longer valid (a new password ends the old sessions)
    tokens_validos_desde: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
