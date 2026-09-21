"""The audit log: who did what and when.

Every row is written after the thing it records, in a transaction of its own. Never put a password,
a token, a vector, an image or the name of a person in it."""

from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.constants import AUDIT_DETAIL_MAX_LENGTH, AUDIT_PAGE_DEFAULT, AUDIT_PAGE_MAX
from app.core.network import client_ip
from app.models import Auditoria, Usuario
from app.schemas.audit_schema import AuditItemOut, AuditPageOut


class AuditTrail:
    """Writes to the audit log with the address the request came from."""

    def __init__(self, db: Session, settings: Settings, request: Request):
        self.db = db
        self.settings = settings
        self.request = request

    def log(
        self,
        user: Usuario | None,
        action: str,
        *,
        result: str = "ok",
        resource: str | None = None,
        resource_id: int | None = None,
        detail: str | None = None,
        email: str | None = None,
    ) -> None:
        """`email` is for when there is no user (a failed sign-in): what was typed."""
        self.db.add(
            Auditoria(
                usuario_id=user.id if user else None,
                usuario_email=user.email if user else (email[:254] if email else None),
                accion=action,
                recurso=resource,
                recurso_id=resource_id,
                resultado=result,
                detalle=detail[:AUDIT_DETAIL_MAX_LENGTH] if detail else None,
                ip=client_ip(self.request, self.settings.trust_forwarded_for),
            )
        )
        self.db.commit()


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def list_page(
    db: Session,
    *,
    email: str | None = None,
    action: str | None = None,
    result: str | None = None,
    since: datetime | None = None,
    before_id: int | None = None,
    limit: int = AUDIT_PAGE_DEFAULT,
) -> AuditPageOut:
    """The newest rows first, `limit` at a time. One more than needed is asked for, to know if there
    is another page."""
    limit = max(1, min(limit, AUDIT_PAGE_MAX))
    query = select(Auditoria).order_by(Auditoria.id.desc())
    if email and email.strip():
        query = query.where(
            Auditoria.usuario_email.ilike(f"%{_escape_like(email.strip())}%", escape="\\")
        )
    if action:
        query = query.where(Auditoria.accion == action)
    if result:
        query = query.where(Auditoria.resultado == result)
    if since:
        query = query.where(
            Auditoria.created_at >= (since if since.tzinfo else since.replace(tzinfo=UTC))
        )
    if before_id is not None:
        query = query.where(Auditoria.id < before_id)
    rows = list(db.scalars(query.limit(limit + 1)).all())
    page = rows[:limit]
    return AuditPageOut(
        registros=[AuditItemOut.model_validate(row) for row in page],
        siguiente=page[-1].id if len(rows) > limit else None,
    )


def log_system(db: Session, action: str, *, detail: str | None = None) -> None:
    """A row for something done from the server itself (a command): no user and no address."""
    db.add(
        Auditoria(
            accion=action,
            resultado="ok",
            detalle=detail[:AUDIT_DETAIL_MAX_LENGTH] if detail else None,
        )
    )
    db.commit()
