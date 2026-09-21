from datetime import UTC, datetime

import pytest
from sqlalchemy import func, inspect, select
from sqlalchemy.orm import Session

from app.core.constants import ML_MIN_EXAMPLES, ML_MIN_PEOPLE, ML_MIN_PER_CLASS
from app.models import MlTrainingRecord, Persona, RecognitionLog
from app.services import ml_dataset_service
from app.services.ml_scores import illumination_score, quality_score
from tests.ml_data import add_examples

MEASURES = {"nitidez": 0.05, "brillo": 85.0, "tamano_rostro": 100, "confianza_deteccion": 0.5}


def persona(db: Session, number: int) -> Persona:
    person = Persona(
        nombre=f"Persona {number}",
        email=f"p{number}@example.com",
        consentimiento_at=datetime.now(UTC),
        consentimiento_version="v0-provisional",
    )
    db.add(person)
    db.commit()
    return person


def log(db: Session, **fields) -> RecognitionLog:
    values = {
        "similitud": 0.8,
        "distancia": 0.4,
        "umbral": 0.4,
        "coincide": True,
        "modelo": "insightface-buffalo_l",
        **fields,
    }
    row = RecognitionLog(**values)
    db.add(row)
    db.commit()
    return row


def records(db: Session) -> list[MlTrainingRecord]:
    return list(db.scalars(select(MlTrainingRecord).order_by(MlTrainingRecord.id)).all())


def test_an_attempt_without_evaluation_is_not_an_example(db: Session):
    log(db, **MEASURES)
    assert ml_dataset_service.sync_records(db) == 0
    assert records(db) == []


@pytest.mark.parametrize("missing", list(MEASURES))
def test_an_evaluated_attempt_without_measures_cannot_be_an_example(db: Session, missing: str):
    who = persona(db, 1)
    log(
        db,
        esperado="persona",
        esperado_persona_id=who.id,
        candidato_correcto=True,
        **{**MEASURES, missing: None},
    )
    assert ml_dataset_service.sync_records(db) == 0


def test_the_closest_candidate_being_right_is_a_correct_example_of_that_person(db: Session):
    who = persona(db, 1)
    row = log(
        db,
        esperado="persona",
        esperado_persona_id=who.id,
        candidato_correcto=True,
        similitud=0.91,
        **MEASURES,
    )
    assert ml_dataset_service.sync_records(db) == 1
    [record] = records(db)
    assert record.recognition_log_id == row.id
    assert record.resultado_real is True
    assert record.grupo == who.id
    assert record.modelo == "insightface-buffalo_l"
    assert record.similitud == 0.91
    assert record.calidad_imagen == pytest.approx(quality_score(0.05, 100, 0.5))
    assert record.iluminacion == pytest.approx(illumination_score(85.0))


def test_the_closest_candidate_being_someone_else_is_a_wrong_example_of_the_expected_person(
    db: Session,
):
    who = persona(db, 1)
    log(db, esperado="persona", esperado_persona_id=who.id, candidato_correcto=False, **MEASURES)
    ml_dataset_service.sync_records(db)
    [record] = records(db)
    assert record.resultado_real is False
    assert record.grupo == who.id


def test_an_unknown_person_is_a_wrong_example_that_belongs_to_nobody(db: Session):
    log(db, esperado="desconocido", **MEASURES)
    ml_dataset_service.sync_records(db)
    [record] = records(db)
    assert record.resultado_real is False
    assert record.grupo is None


def test_an_attempt_is_turned_into_an_example_only_once(db: Session):
    who = persona(db, 1)
    log(db, esperado="persona", esperado_persona_id=who.id, candidato_correcto=True, **MEASURES)
    assert ml_dataset_service.sync_records(db) == 1
    assert ml_dataset_service.sync_records(db) == 0
    assert len(records(db)) == 1
    log(db, esperado="desconocido", **MEASURES)
    assert ml_dataset_service.sync_records(db) == 1
    assert len(records(db)) == 2


def test_the_example_keeps_the_date_of_the_attempt(db: Session):
    when = datetime(2026, 9, 1, 10, 30, tzinfo=UTC)
    log(db, esperado="desconocido", created_at=when, **MEASURES)
    ml_dataset_service.sync_records(db)
    [record] = records(db)
    assert record.created_at == when


def test_the_example_stays_when_the_attempt_it_came_from_is_deleted(db: Session):
    row = log(db, esperado="desconocido", **MEASURES)
    ml_dataset_service.sync_records(db)
    db.delete(row)
    db.commit()
    [record] = records(db)
    assert record.recognition_log_id is None


def test_an_example_carries_no_name_or_email(db: Session):
    columns = {
        column["name"] for column in inspect(db.get_bind()).get_columns("ml_training_records")
    }
    assert not columns & {"nombre", "email", "persona_id", "esperado_persona_id"}


def test_the_examples_of_each_face_model_are_kept_apart(db: Session):
    add_examples(db, correct=3, wrong=2, people=3, model="sface-2021dec")
    add_examples(db, correct=4, wrong=1, people=2, model="insightface-buffalo_l")
    sface = ml_dataset_service.counts(db, "sface-2021dec")
    insight = ml_dataset_service.counts(db, "insightface-buffalo_l")
    assert (sface.examples, sface.correct, sface.wrong) == (5, 3, 2)
    assert (insight.examples, insight.correct, insight.wrong) == (5, 4, 1)
    assert ml_dataset_service.counts(db, "other") == ml_dataset_service.DatasetCounts(0, 0, 0, 0)
    assert len(ml_dataset_service.load(db, "sface-2021dec")) == 5


def test_people_are_counted_once_each_and_unknown_ones_do_not_count(db: Session):
    add_examples(db, correct=8, wrong=8, people=4, unknown_share=0.5)
    counts = ml_dataset_service.counts(db, "simulated")
    assert counts.people == 4
    assert db.scalar(select(func.count()).where(MlTrainingRecord.grupo.is_(None))) == 4


def test_with_nothing_everything_is_missing_and_it_is_said_in_words(db: Session):
    counts = ml_dataset_service.counts(db, "simulated")
    assert counts.missing == [
        f"Faltan {ML_MIN_EXAMPLES} intentos evaluados (hay 0 de {ML_MIN_EXAMPLES}).",
        f"Faltan {ML_MIN_PER_CLASS} intentos en los que el candidato era la persona correcta "
        f"(hay 0 de {ML_MIN_PER_CLASS}).",
        f"Faltan {ML_MIN_PER_CLASS} intentos en los que el candidato no era la persona correcta "
        f"(hay 0 de {ML_MIN_PER_CLASS}).",
        f"Faltan {ML_MIN_PEOPLE} personas distintas evaluadas (hay 0 de {ML_MIN_PEOPLE}).",
    ]


def test_with_enough_of_everything_nothing_is_missing(db: Session):
    add_examples(db, correct=25, wrong=25, people=3)
    assert ml_dataset_service.counts(db, "simulated").missing == []


@pytest.mark.parametrize(
    ("kwargs", "needle"),
    [
        (dict(correct=25, wrong=24, people=3), "Falta 1 intento evaluado (hay 49 de 50)"),
        (dict(correct=36, wrong=14, people=3), "Falta 1 intento en el que el candidato no era"),
        (dict(correct=14, wrong=36, people=3), "Falta 1 intento en el que el candidato era"),
        (
            dict(correct=25, wrong=25, people=2),
            "Falta 1 persona distinta evaluada (hay 2 de 3)",
        ),
    ],
)
def test_each_shortage_is_reported_on_its_own(db: Session, kwargs: dict, needle: str):
    add_examples(db, **kwargs)
    missing = ml_dataset_service.counts(db, "simulated").missing
    assert len(missing) == 1
    assert needle in missing[0]
