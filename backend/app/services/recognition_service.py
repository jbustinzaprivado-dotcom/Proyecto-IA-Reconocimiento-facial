from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import HIGH_CONFIDENCE_MARGIN, HISTORY_LIMIT
from app.core.errors import ApiException
from app.models import FaceEmbedding, Persona, RecognitionLog
from app.schemas.recognition_schema import (
    ConfidenceLevel,
    DashboardOut,
    HistoryItemOut,
    Label,
    RecognitionOut,
)
from app.services import embedding_service, probability_service
from app.services.quality_service import FaceMeasurements

# Absorbs float error, so that 0.85 against a 0.75 threshold counts as a margin of 0.10
MARGIN_TOLERANCE = 1e-9
UNKNOWN = "desconocido"


@dataclass(frozen=True)
class Expected:
    """Who the operator said was in front of the camera (evaluation mode)."""

    tipo: Literal["persona", "desconocido"]
    persona_id: int | None = None


def confidence_level(
    similitud: float, umbral: float, coincide: bool, margin: float = HIGH_CONFIDENCE_MARGIN
) -> ConfidenceLevel:
    """A rule, not a probability: it says how far the similarity is from the threshold."""
    if not coincide:
        return "baja"
    if similitud - umbral >= margin - MARGIN_TOLERANCE:
        return "alta"
    return "media"


def label_of(
    esperado: str | None,
    esperado_persona_id: int | None,
    coincide: bool,
    persona_id: int | None,
) -> Label | None:
    """What the attempt turned out to be, given who was really there. Empty in a normal attempt."""
    if esperado == UNKNOWN:
        return "falso_positivo" if coincide else "rechazo_correcto"
    if esperado != "persona" or esperado_persona_id is None:
        return None
    if not coincide:
        return "falso_negativo"
    return "acierto" if persona_id == esperado_persona_id else "falso_positivo"


def parse_expected(db: Session, raw: str | None, model: str) -> Expected | None:
    """The `esperado` field of a recognition: nothing, "desconocido" or the id of a person who has
    faces of the model in use (otherwise the attempt could never be a hit)."""
    value = (raw or "").strip()
    if not value:
        return None
    if value.lower() == UNKNOWN:
        return Expected(tipo="desconocido")
    if not value.isdigit():
        raise ApiException(
            422, "El valor de «esperado» no es válido. Usa «desconocido» o el id de una persona."
        )
    persona = db.get(Persona, int(value))
    if persona is None:
        raise ApiException(422, "La persona esperada no existe.")
    has_faces = db.scalar(
        select(FaceEmbedding.id)
        .where(FaceEmbedding.persona_id == persona.id, FaceEmbedding.modelo == model)
        .limit(1)
    )
    if not persona.activo or has_faces is None:
        raise ApiException(422, "La persona esperada no tiene rostros registrados con este modelo.")
    return Expected(tipo="persona", persona_id=persona.id)


def recognize(
    db: Session,
    model: str,
    vector: np.ndarray,
    threshold: float,
    measurements: FaceMeasurements | None = None,
    expected: Expected | None = None,
    margin: float = HIGH_CONFIDENCE_MARGIN,
    models_dir: Path | None = None,
) -> RecognitionOut:
    # Only vectors of the running engine can be compared, and only people who are active
    rows = db.execute(
        select(FaceEmbedding.persona_id, FaceEmbedding.embedding)
        .join(Persona)
        .where(Persona.activo.is_(True), FaceEmbedding.modelo == model)
    ).all()
    if not rows:
        raise ApiException(409, "Aún no hay rostros registrados. Registra a una persona primero.")

    persona_id, similitud = embedding_service.best_match(
        vector, [(row.persona_id, embedding_service.from_bytes(row.embedding)) for row in rows]
    )
    distancia = 2 * (1 - similitud)
    coincide = similitud >= threshold
    # Informative only: whether it "coincide" is still decided by the similarity and the threshold.
    # Empty while there is no trained model
    probability = (
        probability_service.probability_for_attempt(models_dir, model, similitud, measurements)
        if models_dir is not None
        else None
    )

    # Without a match the candidate is dropped: neither the answer nor the history names anyone.
    # In evaluation mode only "was the closest one the expected person" is kept, not who it was
    matched = db.get(Persona, persona_id) if coincide else None
    matched_id = matched.id if matched else None
    expected_id = expected.persona_id if expected else None
    db.add(
        RecognitionLog(
            persona_id=matched_id,
            similitud=similitud,
            distancia=distancia,
            umbral=threshold,
            coincide=coincide,
            modelo=model,
            probabilidad_calibrada=probability,
            nitidez=measurements.nitidez if measurements else None,
            brillo=measurements.brillo if measurements else None,
            tamano_rostro=measurements.tamano if measurements else None,
            confianza_deteccion=measurements.confianza if measurements else None,
            esperado=expected.tipo if expected else None,
            esperado_persona_id=expected_id,
            candidato_correcto=(persona_id == expected_id) if expected_id is not None else None,
        )
    )
    db.commit()

    return RecognitionOut(
        persona_id=matched_id,
        nombre=matched.nombre if matched else None,
        similitud=similitud,
        distancia=distancia,
        umbral=threshold,
        coincide=coincide,
        probabilidad_calibrada=probability,
        confianza=confidence_level(similitud, threshold, coincide, margin),
        etiqueta=label_of(expected.tipo if expected else None, expected_id, coincide, matched_id),
    )


def history(db: Session) -> list[HistoryItemOut]:
    rows = db.execute(
        select(RecognitionLog, Persona.nombre)
        .outerjoin(Persona, RecognitionLog.persona_id == Persona.id)
        .order_by(RecognitionLog.created_at.desc(), RecognitionLog.id.desc())
        .limit(HISTORY_LIMIT)
    ).all()
    return [
        HistoryItemOut(
            id=log.id,
            persona_id=log.persona_id,
            nombre=nombre,
            similitud=log.similitud,
            distancia=log.distancia,
            umbral=log.umbral,
            coincide=log.coincide,
            probabilidad_calibrada=log.probabilidad_calibrada,
            created_at=log.created_at,
            modelo=log.modelo,
            etiqueta=label_of(log.esperado, log.esperado_persona_id, log.coincide, log.persona_id),
        )
        for log, nombre in rows
    ]


def dashboard(db: Session) -> DashboardOut:
    def count(table, *conditions) -> int:
        return db.scalar(select(func.count()).select_from(table).where(*conditions)) or 0

    return DashboardOut(
        total_personas=count(Persona),
        total_reconocimientos=count(RecognitionLog),
        total_coincidencias=count(RecognitionLog, RecognitionLog.coincide.is_(True)),
    )
