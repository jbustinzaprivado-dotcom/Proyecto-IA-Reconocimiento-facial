from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.fields import clean_email, clean_name

# The names are the ones of ROLES in constants.py (a test keeps them together)
Role = Literal["administrador", "operador", "consulta"]


class LoginIn(BaseModel):
    email: str
    clave: str

    @field_validator("email")
    @classmethod
    def lowercase_email(cls, value: str) -> str:
        # Not validated as an address: a wrong one must get the same answer as a wrong password
        return value.strip().lower()


class UsuarioCreate(BaseModel):
    email: str
    nombre: str
    rol: Role
    clave: str

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        return clean_email(value)

    @field_validator("nombre")
    @classmethod
    def valid_name(cls, value: str) -> str:
        return clean_name(value)


class UsuarioUpdate(BaseModel):
    """Every field is optional: only what is sent is changed. `clave` sets a new password."""

    nombre: str | None = None
    rol: Role | None = None
    activo: bool | None = None
    clave: str | None = None

    @field_validator("nombre")
    @classmethod
    def valid_name(cls, value: str | None) -> str | None:
        return None if value is None else clean_name(value)


class UsuarioOut(BaseModel):
    """A user. The password hash is never part of it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    nombre: str
    rol: Role
    activo: bool
    created_at: datetime
    last_login_at: datetime | None


class SesionOut(BaseModel):
    token: str
    tipo: Literal["Bearer"] = "Bearer"
    # Seconds until the token stops being valid
    expira_en: int
    usuario: UsuarioOut


class CambiarClaveIn(BaseModel):
    clave_actual: str
    clave_nueva: str
