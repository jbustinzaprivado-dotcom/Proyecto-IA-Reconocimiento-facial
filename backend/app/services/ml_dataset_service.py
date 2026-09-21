"""The examples the probability model learns from, and whether there are enough of them.

Every attempt made in evaluation mode says who was really in front of the camera, so it can be
turned into an example: the features are the similarity and the two scores of the picture, and the
answer is whether the closest candidate was the right person.
"""

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.constants import ML_MIN_EXAMPLES, ML_MIN_PEOPLE, ML_MIN_PER_CLASS
from app.models import MlTrainingRecord, RecognitionLog
from app.services.ml_scores import illumination_score, quality_score

UNKNOWN = "desconocido"


@dataclass(frozen=True)
class DatasetCounts:
    examples: int
    correct: int
    wrong: int
    people: int

    @property
    def missing(self) -> list[str]:
        """What is still needed to train, in words. Empty when there is enough."""
        missing = []
        if self.examples < ML_MIN_EXAMPLES:
            missing.append(
                lack(
                    ML_MIN_EXAMPLES - self.examples,
                    ("intento evaluado", "intentos evaluados"),
                    self.examples,
                    ML_MIN_EXAMPLES,
                )
            )
        if self.correct < ML_MIN_PER_CLASS:
            missing.append(
                lack(
                    ML_MIN_PER_CLASS - self.correct,
                    (
                        "intento en el que el candidato era la persona correcta",
                        "intentos en los que el candidato era la persona correcta",
                    ),
                    self.correct,
                    ML_MIN_PER_CLASS,
                )
            )
        if self.wrong < ML_MIN_PER_CLASS:
            missing.append(
                lack(
                    ML_MIN_PER_CLASS - self.wrong,
                    (
                        "intento en el que el candidato no era la persona correcta",
                        "intentos en los que el candidato no era la persona correcta",
                    ),
                    self.wrong,
                    ML_MIN_PER_CLASS,
                )
            )
        if self.people < ML_MIN_PEOPLE:
            missing.append(
                lack(
                    ML_MIN_PEOPLE - self.people,
                    ("persona distinta evaluada", "personas distintas evaluadas"),
                    self.people,
                    ML_MIN_PEOPLE,
                )
            )
        return missing


def lack(count: int, nouns: tuple[str, str], have: int, need: int) -> str:
    """ "Falta 1 intento" or "Faltan 3 intentos", with how many there are of how many are needed."""
    verb, noun = ("Falta", nouns[0]) if count == 1 else ("Faltan", nouns[1])
    return f"{verb} {count} {noun} (hay {have} de {need})."


def sync_records(db: Session) -> int:
    """Turn every evaluated attempt that has no example yet into one, and say how many were made.

    It can run as often as needed: an attempt is turned into an example only once. Attempts made
    before the measures of the face were kept cannot be used, because they have no scores."""
    logs = db.scalars(
        select(RecognitionLog)
        .outerjoin(MlTrainingRecord, MlTrainingRecord.recognition_log_id == RecognitionLog.id)
        .where(
            MlTrainingRecord.id.is_(None),
            RecognitionLog.esperado.is_not(None),
            RecognitionLog.nitidez.is_not(None),
            RecognitionLog.brillo.is_not(None),
            RecognitionLog.tamano_rostro.is_not(None),
            RecognitionLog.confianza_deteccion.is_not(None),
        )
        .order_by(RecognitionLog.id)
    ).all()
    for log in logs:
        db.add(
            MlTrainingRecord(
                recognition_log_id=log.id,
                modelo=log.modelo,
                similitud=log.similitud,
                calidad_imagen=quality_score(
                    log.nitidez, log.tamano_rostro, log.confianza_deteccion
                ),
                iluminacion=illumination_score(log.brillo),
                # Nobody registered is in front of the camera when an unknown one is expected: the
                # closest candidate is wrong by definition
                resultado_real=bool(log.candidato_correcto) if log.esperado != UNKNOWN else False,
                grupo=log.esperado_persona_id,
                created_at=log.created_at,
            )
        )
    if logs:
        db.commit()
    return len(logs)


def counts(db: Session, model: str) -> DatasetCounts:
    records = MlTrainingRecord
    correct = db.scalar(
        select(func.count()).where(records.modelo == model, records.resultado_real.is_(True))
    )
    wrong = db.scalar(
        select(func.count()).where(records.modelo == model, records.resultado_real.is_(False))
    )
    # An unknown person has no group, and COUNT(DISTINCT) does not count what is empty
    people = db.scalar(
        select(func.count(func.distinct(records.grupo))).where(records.modelo == model)
    )
    correct, wrong = correct or 0, wrong or 0
    return DatasetCounts(examples=correct + wrong, correct=correct, wrong=wrong, people=people or 0)


def load(db: Session, model: str) -> list[MlTrainingRecord]:
    return list(
        db.scalars(
            select(MlTrainingRecord)
            .where(MlTrainingRecord.modelo == model)
            .order_by(MlTrainingRecord.id)
        ).all()
    )
