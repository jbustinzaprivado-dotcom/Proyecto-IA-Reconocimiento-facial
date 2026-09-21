from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.core.constants import CONSENT_VERSIONS
from app.core.errors import ValidationMessage
from app.schemas.fields import clean_email, clean_name


class PersonaCreate(BaseModel):
    nombre: str
    email: str
    consentimiento_version: str

    @field_validator("nombre")
    @classmethod
    def valid_name(cls, value: str) -> str:
        return clean_name(value)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        return clean_email(value)

    @field_validator("consentimiento_version")
    @classmethod
    def known_consent_version(cls, value: str) -> str:
        if value not in CONSENT_VERSIONS:
            raise ValidationMessage("Versión de consentimiento no válida.")
        return value


class PersonaUpdate(BaseModel):
    """What an administrator can change about a person: only whether they take part."""

    activo: bool


class PersonaOut(BaseModel):
    """A registered person. The face vectors are never part of it (PDF section 15)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    nombre: str
    email: str
    activo: bool
    created_at: datetime
    consentimiento_at: datetime
    consentimiento_version: str
    # How many faces of the model in use are saved. Someone with none can never be recognized
    rostros: int = 0


class RostroOut(BaseModel):
    persona_id: int
    imagenes_guardadas: int


class EliminadaOut(BaseModel):
    persona_id: int


class PurgeOut(BaseModel):
    """How many people were deleted for having no face saved."""

    eliminadas: int
