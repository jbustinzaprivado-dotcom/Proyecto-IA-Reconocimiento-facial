from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import numpy as np
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiException
from app.models import RecognitionLog
from app.schemas.analysis_schema import (
    AnalysisOut,
    BinOut,
    CurvePointOut,
    DayOut,
    ModelOut,
    ThresholdMetricsOut,
)

DAYS_SHOWN = 14
HISTOGRAM_BINS = 20
# 0.00, 0.01 ... 1.00
CURVE_POINTS = 101
# Below these numbers of labeled attempts the errors are only a first impression
MIN_LABELED = 30
MIN_PER_KIND = 10

PERSON = "persona"
UNKNOWN = "desconocido"


@dataclass(frozen=True)
class Confusion:
    """Counts per threshold, one entry per threshold. TP, FP, FN and TN use the evaluation-mode
    attempts only.

    - Expected person, closest one was that person: TP if it clears the threshold, else FN.
    - Expected person, closest one was someone else: FP if it clears the threshold (a wrong
      identity), else FN.
    - Expected unknown: FP if it clears the threshold, else TN.
    """

    matches: np.ndarray
    tp: np.ndarray
    fp: np.ndarray
    fn: np.ndarray
    tn: np.ndarray


def _ratio(numerator: float, denominator: float) -> float | None:
    return None if denominator == 0 else float(numerator / denominator)


def confusion_at(
    thresholds: np.ndarray,
    similarity: np.ndarray,
    labeled_similarity: np.ndarray,
    person: np.ndarray,
    correct: np.ndarray,
    unknown: np.ndarray,
) -> Confusion:
    every = similarity[None, :] >= thresholds[:, None]
    cleared = labeled_similarity[None, :] >= thresholds[:, None]
    real_hit = (person & correct)[None, :]
    wrong_identity = ((person & ~correct) | unknown)[None, :]
    return Confusion(
        matches=every.sum(axis=1),
        tp=(cleared & real_hit).sum(axis=1),
        fp=(cleared & wrong_identity).sum(axis=1),
        fn=(~cleared & person[None, :]).sum(axis=1),
        tn=(~cleared & unknown[None, :]).sum(axis=1),
    )


def metrics_from(threshold: float, tp: int, fp: int, fn: int, tn: int) -> ThresholdMetricsOut:
    precision = _ratio(tp, tp + fp)
    recall = _ratio(tp, tp + fn)
    if precision is None or recall is None or precision + recall == 0:
        f1 = None
    else:
        f1 = 2 * precision * recall / (precision + recall)
    return ThresholdMetricsOut(
        umbral=threshold,
        precision=precision,
        recall=recall,
        f1=f1,
        tasa_falsos_positivos=_ratio(fp, fp + tn),
        tasa_falsos_negativos=_ratio(fn, fn + tp),
        matriz_confusion=[[tn, fp], [fn, tp]],
        n_muestras=tp + fp + fn + tn,
    )


def _models(db: Session) -> list[ModelOut]:
    rows = db.execute(
        select(RecognitionLog.modelo, func.count())
        .group_by(RecognitionLog.modelo)
        .order_by(func.count().desc(), RecognitionLog.modelo)
    ).all()
    return [ModelOut(modelo=modelo, intentos=intentos) for modelo, intentos in rows]


def _pick_model(
    db: Session, requested: str | None, active: str | None, models: list[ModelOut]
) -> str | None:
    if requested is not None:
        if requested != active and requested not in {m.modelo for m in models}:
            raise ApiException(404, "No hay intentos de ese modelo.")
        return requested
    if active is not None:
        return active
    latest = db.scalar(select(RecognitionLog.modelo).order_by(RecognitionLog.id.desc()).limit(1))
    return latest


def _per_day(db: Session, model: str | None, now: datetime, offset_minutes: int) -> list[DayOut]:
    offset = timedelta(minutes=offset_minutes)
    today = (now + offset).date()
    first = today - timedelta(days=DAYS_SHOWN - 1)
    counts: dict[date, list[int]] = {first + timedelta(days=i): [0, 0] for i in range(DAYS_SHOWN)}
    if model is not None:
        # A little more than the window, so that the edge days are complete in any time zone
        since = now - timedelta(days=DAYS_SHOWN + 2)
        rows = db.execute(
            select(RecognitionLog.created_at, RecognitionLog.coincide).where(
                RecognitionLog.modelo == model, RecognitionLog.created_at >= since
            )
        ).all()
        for created_at, coincide in rows:
            local_day = (created_at + offset).date()
            if local_day in counts:
                counts[local_day][0 if coincide else 1] += 1
    return [DayOut(fecha=day, coincidencias=c, rechazos=r) for day, (c, r) in counts.items()]


def summary(
    db: Session,
    requested_model: str | None,
    active_model: str | None,
    active_threshold: float | None,
    offset_minutes: int = 0,
    now: datetime | None = None,
) -> AnalysisOut:
    """Statistics, threshold curve and metrics of one model, over all of its attempts."""
    now = now or datetime.now(UTC)
    models = _models(db)
    model = _pick_model(db, requested_model, active_model, models)

    rows = []
    if model is not None:
        rows = db.execute(
            select(
                RecognitionLog.similitud,
                RecognitionLog.coincide,
                RecognitionLog.esperado,
                RecognitionLog.esperado_persona_id,
                RecognitionLog.candidato_correcto,
                RecognitionLog.umbral,
            )
            .where(RecognitionLog.modelo == model)
            .order_by(RecognitionLog.id)
        ).all()

    similarity = np.array([r.similitud for r in rows], dtype=float)
    matched = np.array([r.coincide for r in rows], dtype=bool)
    expected = np.array([r.esperado or "" for r in rows], dtype=object)
    has_person = np.array([r.esperado_persona_id is not None for r in rows], dtype=bool)
    correct = np.array([bool(r.candidato_correcto) for r in rows], dtype=bool)

    person = (expected == PERSON) & has_person
    unknown = expected == UNKNOWN
    labeled = person | unknown

    if model is not None and model == active_model and active_threshold is not None:
        threshold = active_threshold
    else:
        threshold = rows[-1].umbral if rows else None

    total = len(rows)
    hits = int(matched.sum())

    # The small extra keeps 0.15 in the bin that starts at 0.15 instead of the one before it
    bins = np.minimum((similarity * HISTOGRAM_BINS + 1e-9).astype(int), HISTOGRAM_BINS - 1)
    hit_bins = np.bincount(bins[matched], minlength=HISTOGRAM_BINS)
    miss_bins = np.bincount(bins[~matched], minlength=HISTOGRAM_BINS)
    width = 1 / HISTOGRAM_BINS
    histogram = [
        BinOut(
            desde=round(i * width, 4),
            hasta=round((i + 1) * width, 4),
            coincidencias=int(hit_bins[i]),
            rechazos=int(miss_bins[i]),
        )
        for i in range(HISTOGRAM_BINS)
    ]

    grid = np.round(np.linspace(0, 1, CURVE_POINTS), 2)
    curve_counts = confusion_at(
        grid, similarity, similarity[labeled], person[labeled], correct[labeled], unknown[labeled]
    )
    curve = [
        CurvePointOut(
            umbral=float(t),
            coincidencias=int(curve_counts.matches[i]),
            verdaderos_positivos=int(curve_counts.tp[i]),
            falsos_positivos=int(curve_counts.fp[i]),
            falsos_negativos=int(curve_counts.fn[i]),
            verdaderos_negativos=int(curve_counts.tn[i]),
            tasa_falsos_positivos=_ratio(
                curve_counts.fp[i], curve_counts.fp[i] + curve_counts.tn[i]
            ),
            tasa_falsos_negativos=_ratio(
                curve_counts.fn[i], curve_counts.fn[i] + curve_counts.tp[i]
            ),
        )
        for i, t in enumerate(grid)
    ]

    n_labeled = int(labeled.sum())
    n_person = int(person.sum())
    n_unknown = int(unknown.sum())
    metrics = None
    if n_labeled > 0 and threshold is not None:
        at = confusion_at(
            np.array([threshold]),
            similarity,
            similarity[labeled],
            person[labeled],
            correct[labeled],
            unknown[labeled],
        )
        metrics = metrics_from(
            threshold, int(at.tp[0]), int(at.fp[0]), int(at.fn[0]), int(at.tn[0])
        )

    return AnalysisOut(
        modelo=model,
        modelos=models,
        umbral=threshold,
        total_intentos=total,
        total_coincidencias=hits,
        tasa_coincidencia=hits / total if total else 0.0,
        similitud_promedio_coincidencias=float(similarity[matched].mean()) if hits else None,
        similitud_promedio_rechazos=float(similarity[~matched].mean()) if total > hits else None,
        por_dia=_per_day(db, model, now, offset_minutes),
        histograma=histogram,
        curva=curve,
        etiquetados=n_labeled,
        etiquetados_persona=n_person,
        etiquetados_desconocido=n_unknown,
        muestra_pequena=n_labeled < MIN_LABELED
        or n_person < MIN_PER_KIND
        or n_unknown < MIN_PER_KIND,
        metricas_umbral=metrics,
    )
