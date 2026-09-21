from datetime import UTC, datetime, timedelta, timezone

import numpy as np
import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from app.models import FaceEmbedding, Persona, RecognitionLog

NOW = datetime(2026, 9, 20, 10, 0, tzinfo=UTC)


def make_person(email: str = "ana@example.com", **overrides) -> Persona:
    values = {
        "nombre": "Ana Torres",
        "email": email,
        "consentimiento_at": NOW,
        "consentimiento_version": "v0-provisional",
    }
    values.update(overrides)
    return Persona(**values)


def test_a_person_is_active_by_default_and_gets_an_aware_utc_creation_date(db: Session):
    person = make_person()
    db.add(person)
    db.commit()
    db.refresh(person)
    assert person.activo is True
    assert person.created_at.tzinfo is not None
    assert person.created_at.utcoffset() == timedelta(0)


def test_the_email_is_unique(db: Session):
    db.add(make_person("repetido@example.com"))
    db.commit()
    db.add(make_person("repetido@example.com"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_a_date_in_another_time_zone_comes_back_as_the_same_instant_in_utc(db: Session):
    peru = timezone(timedelta(hours=-5))
    person = make_person(consentimiento_at=datetime(2026, 9, 20, 5, 0, tzinfo=peru))
    db.add(person)
    db.commit()
    db.expire_all()

    stored = db.scalars(select(Persona)).one().consentimiento_at
    assert stored.utcoffset() == timedelta(0)
    assert stored == datetime(2026, 9, 20, 10, 0, tzinfo=UTC)


def test_a_date_without_time_zone_is_rejected(db: Session):
    db.add(make_person(consentimiento_at=datetime(2026, 9, 20, 10, 0)))
    with pytest.raises(StatementError, match="zona horaria"):
        db.commit()


def test_an_embedding_survives_as_float32_bytes(db: Session):
    vector = np.random.default_rng(1).standard_normal(512).astype(np.float32)
    person = make_person()
    person.embeddings.append(FaceEmbedding(embedding=vector.tobytes(), modelo="simulado"))
    db.add(person)
    db.commit()
    db.expire_all()

    stored = db.scalars(select(FaceEmbedding)).one()
    assert len(stored.embedding) == 512 * 4
    assert np.array_equal(np.frombuffer(stored.embedding, dtype=np.float32), vector)
    assert stored.modelo == "simulado"


def test_an_embedding_needs_an_existing_person(db: Session):
    db.add(FaceEmbedding(persona_id=999, embedding=b"x", modelo="simulado"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_deleting_a_person_through_the_orm_deletes_its_embeddings(db: Session):
    person = make_person()
    person.embeddings.append(FaceEmbedding(embedding=b"x", modelo="simulado"))
    db.add(person)
    db.commit()

    db.delete(person)
    db.commit()
    assert db.scalars(select(FaceEmbedding)).all() == []


def test_the_database_itself_cascades_the_delete_to_the_embeddings(db: Session):
    """A bulk delete skips the ORM: only an enforced foreign key can do it."""
    person = make_person()
    person.embeddings.append(FaceEmbedding(embedding=b"x", modelo="simulado"))
    db.add(person)
    db.commit()

    db.execute(delete(Persona))
    db.commit()
    assert db.scalars(select(FaceEmbedding)).all() == []


def test_deleting_a_person_keeps_the_recognition_history_without_a_candidate(db: Session):
    person = make_person()
    db.add(person)
    db.commit()
    db.add(
        RecognitionLog(
            persona_id=person.id,
            similitud=0.87,
            distancia=0.26,
            umbral=0.75,
            coincide=True,
            probabilidad_calibrada=None,
        )
    )
    db.commit()

    db.execute(delete(Persona))
    db.commit()
    log = db.scalars(select(RecognitionLog)).one()
    assert log.persona_id is None
    assert log.similitud == 0.87


def test_a_log_may_have_no_candidate_and_no_calibrated_probability(db: Session):
    db.add(
        RecognitionLog(
            persona_id=None,
            similitud=0.31,
            distancia=1.38,
            umbral=0.75,
            coincide=False,
            probabilidad_calibrada=None,
        )
    )
    db.commit()
    log = db.scalars(select(RecognitionLog)).one()
    assert log.persona_id is None
    assert log.probabilidad_calibrada is None
    assert log.created_at.utcoffset() == timedelta(0)
