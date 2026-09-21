"""Made-up examples for the probability model. They only exist so that the machinery can be tested:
no number that comes out of them says anything about how well faces are recognized."""

from datetime import UTC, datetime

import numpy as np
from sqlalchemy.orm import Session

from app.models import MlTrainingRecord, Persona, RecognitionLog

MODEL = "simulated"


def add_examples(
    db: Session,
    correct: int = 40,
    wrong: int = 40,
    people: int = 4,
    model: str = MODEL,
    seed: int = 0,
    unknown_share: float = 0.5,
) -> list[MlTrainingRecord]:
    """`correct` examples with a high similarity and `wrong` ones with a low one, spread over
    `people`. Of the wrong ones, `unknown_share` had no person expected at all."""
    rng = np.random.default_rng(seed)
    records = []
    for index in range(correct):
        records.append(
            MlTrainingRecord(
                modelo=model,
                similitud=float(np.clip(rng.normal(0.78, 0.08), 0, 1)),
                calidad_imagen=float(np.clip(rng.normal(0.7, 0.15), 0, 1)),
                iluminacion=float(np.clip(rng.normal(0.7, 0.15), 0, 1)),
                resultado_real=True,
                grupo=1 + index % people,
            )
        )
    for index in range(wrong):
        unknown = index < round(wrong * unknown_share)
        records.append(
            MlTrainingRecord(
                modelo=model,
                similitud=float(np.clip(rng.normal(0.32, 0.12), 0, 1)),
                calidad_imagen=float(np.clip(rng.normal(0.55, 0.2), 0, 1)),
                iluminacion=float(np.clip(rng.normal(0.55, 0.2), 0, 1)),
                resultado_real=False,
                grupo=None if unknown else 1 + index % people,
            )
        )
    db.add_all(records)
    db.commit()
    return records


def add_evaluated_attempts(db: Session, model: str = MODEL, people: int = 3, each: int = 10) -> int:
    """Evaluated attempts in the history and nothing else, so that turning them into examples is
    left to whatever is being tested. `each` right ones per person and as many wrong ones, half of
    them for an unknown person."""
    rng = np.random.default_rng(1)
    made = 0
    persons = []
    for number in range(people):
        person = Persona(
            nombre=f"Persona {number}",
            email=f"persona{number}@example.com",
            consentimiento_at=datetime.now(UTC),
            consentimiento_version="v0-provisional",
        )
        db.add(person)
        persons.append(person)
    db.commit()
    for person in persons:
        for index in range(each * 2):
            right = index < each
            unknown = not right and index % 2 == 0
            db.add(
                RecognitionLog(
                    similitud=float(rng.uniform(0.7, 0.95) if right else rng.uniform(0.05, 0.4)),
                    distancia=0.4,
                    umbral=0.4,
                    coincide=right,
                    modelo=model,
                    nitidez=float(rng.uniform(0.03, 0.1)),
                    brillo=float(rng.uniform(70, 190)),
                    tamano_rostro=int(rng.integers(90, 260)),
                    confianza_deteccion=float(rng.uniform(0.6, 1.0)),
                    esperado="desconocido" if unknown else "persona",
                    esperado_persona_id=None if unknown else person.id,
                    candidato_correcto=None if unknown else right,
                )
            )
            made += 1
    db.commit()
    return made
