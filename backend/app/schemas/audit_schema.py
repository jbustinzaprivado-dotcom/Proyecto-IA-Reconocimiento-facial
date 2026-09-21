from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    usuario_email: str | None
    accion: str
    recurso: str | None
    recurso_id: int | None
    resultado: str
    detalle: str | None
    ip: str | None


class AuditPageOut(BaseModel):
    registros: list[AuditItemOut]
    # Pass it as `antes_de_id` to get the next (older) page; empty on the last one
    siguiente: int | None
