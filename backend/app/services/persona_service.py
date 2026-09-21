import unicodedata

import numpy as np
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import ApiException
from app.database.types import utcnow
from app.models import FaceEmbedding, MlTrainingRecord, Persona
from app.schemas.persona_schema import PersonaCreate
from app.services import embedding_service


def _alphabetical_key(persona: Persona) -> tuple[str, int]:
    # Ignore case and accents, so that "Álvaro" is listed with the A's on any database
    decomposed = unicodedata.normalize("NFKD", persona.nombre)
    letters = "".join(char for char in decomposed if not unicodedata.combining(char))
    return letters.casefold(), persona.id


def create_persona(db: Session, data: PersonaCreate) -> Persona:
    """Register a person. If the mailbox belongs to someone who never got a face saved (a
    registration that failed at the photos), that record is completed instead of refused: otherwise
    the person could never finish registering with that address."""
    existing = db.scalar(select(Persona).where(Persona.email == data.email))
    if existing is not None:
        if db.scalar(select(FaceEmbedding.id).where(FaceEmbedding.persona_id == existing.id)):
            raise ApiException(409, "Ya existe una persona registrada con ese correo.")
        existing.nombre = data.nombre
        existing.consentimiento_at = utcnow()
        existing.consentimiento_version = data.consentimiento_version
        db.commit()
        return existing

    persona = Persona(
        nombre=data.nombre,
        email=data.email,
        consentimiento_at=utcnow(),
        consentimiento_version=data.consentimiento_version,
    )
    db.add(persona)
    try:
        db.commit()
    except IntegrityError:
        # The unique constraint decides, so two simultaneous requests cannot both succeed
        db.rollback()
        raise ApiException(409, "Ya existe una persona registrada con ese correo.") from None
    return persona


def list_personas(db: Session) -> list[Persona]:
    return sorted(db.scalars(select(Persona)), key=_alphabetical_key)


def get_persona(db: Session, persona_id: int) -> Persona:
    persona = db.get(Persona, persona_id)
    if persona is None:
        raise ApiException(404, "La persona no existe.")
    return persona


def replace_faces(db: Session, persona: Persona, vectors: list[np.ndarray], model: str) -> int:
    """Keep only the given vectors for the person, all or nothing."""
    persona.embeddings = [
        FaceEmbedding(embedding=embedding_service.to_bytes(vector), modelo=model)
        for vector in vectors
    ]
    db.commit()
    return len(vectors)


def face_counts(db: Session, model: str | None) -> dict[int, int]:
    """How many faces each person has saved, for the model in use (or for every model if none)."""
    query = select(FaceEmbedding.persona_id, func.count()).group_by(FaceEmbedding.persona_id)
    if model is not None:
        query = query.where(FaceEmbedding.modelo == model)
    return {persona_id: count for persona_id, count in db.execute(query).all()}


def set_active(db: Session, persona: Persona, active: bool) -> Persona:
    persona.activo = active
    db.commit()
    return persona


def delete_persona(db: Session, persona: Persona) -> None:
    """Delete the person, their face vectors and their consent. What they did stays, without them:
    their attempts and the examples of the probability model lose the number of the person (the
    database clears it in the history, and here it is cleared in the examples). Cannot be undone."""
    db.execute(
        update(MlTrainingRecord).where(MlTrainingRecord.grupo == persona.id).values(grupo=None)
    )
    db.delete(persona)
    db.commit()


def purge_without_faces(db: Session) -> int:
    """Delete every person who has no face saved with any model, and say how many there were."""
    ids = db.scalars(
        select(Persona.id).where(
            ~select(FaceEmbedding.id).where(FaceEmbedding.persona_id == Persona.id).exists()
        )
    ).all()
    for persona_id in ids:
        delete_persona(db, db.get(Persona, persona_id))
    return len(ids)
