"""Training, checking and using the probability model.

Three algorithms are trained with the same examples and checked the same way, and the one whose
probabilities are best is kept. The check leaves out whole people: the photos of one person look
alike, so a model that had seen some of them would look better than it is with someone new.
"""

import hashlib
import json
import logging
import os
import re
import threading
import warnings
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.base import BaseEstimator
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
from sklearn.model_selection import StratifiedGroupKFold
from sqlalchemy.orm import Session

from app.core.constants import (
    ML_CALIBRATION_FOLDS,
    ML_DECISION_CUT,
    ML_MAX_FOLDS,
    ML_SEED,
)
from app.core.errors import ApiException
from app.database.types import utcnow
from app.models import MlTrainingRecord
from app.schemas.probability_schema import AlgorithmResultOut, ModelMetricsOut
from app.services import ml_dataset_service
from app.services.ml_scores import clip01

logger = logging.getLogger("app.ml")

FEATURES = ("similitud", "calidad_imagen", "iluminacion")
ML_DIR_NAME = "ml"
NOT_ENOUGH_TO_CHECK = (
    "No se pudo comprobar el modelo con estos datos. Hacen falta intentos de más personas "
    "y de los dos tipos, repartidos entre ellas."
)


@dataclass(frozen=True)
class Algorithm:
    key: str
    name: str
    build: Callable[[], BaseEstimator]


# In order of simplicity: when two are equally good, the simpler one is kept
ALGORITHMS = (
    Algorithm(
        "regresion_logistica",
        "Regresión Logística",
        lambda: LogisticRegression(max_iter=1000),
    ),
    Algorithm(
        "random_forest",
        "Random Forest",
        lambda: RandomForestClassifier(n_estimators=100, min_samples_leaf=3, random_state=ML_SEED),
    ),
    Algorithm(
        "gradient_boosting",
        "Gradient Boosting",
        lambda: GradientBoostingClassifier(n_estimators=100, max_depth=2, random_state=ML_SEED),
    ),
)


class NotEnoughToCheck(Exception):
    """The examples cannot be split so that every part has both kinds."""


@dataclass(frozen=True)
class Examples:
    features: np.ndarray
    correct: np.ndarray
    groups: np.ndarray


def examples_from(records: list[MlTrainingRecord]) -> Examples:
    features = np.array(
        [[r.similitud, r.calidad_imagen, r.iluminacion] for r in records], dtype=float
    )
    correct = np.array([1 if r.resultado_real else 0 for r in records], dtype=int)
    # An unknown person has no identity: every such example is a group of its own
    groups = np.array([r.grupo if r.grupo is not None else -r.id for r in records], dtype=int)
    return Examples(features, correct, groups)


def grouped_splits(
    examples: Examples, folds: int, seed: int = ML_SEED
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Split by person into as many parts as possible (up to `folds`), with both kinds in every
    part. With fewer people than parts, fewer parts are made."""
    groups = np.unique(examples.groups)
    for count in range(min(folds, len(groups)), 1, -1):
        splitter = StratifiedGroupKFold(n_splits=count, shuffle=True, random_state=seed)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                splits = list(splitter.split(examples.features, examples.correct, examples.groups))
            except ValueError:
                continue
        if all(len(np.unique(examples.correct[part])) == 2 for pair in splits for part in pair):
            return splits
    raise NotEnoughToCheck


def subset(examples: Examples, indexes: np.ndarray) -> Examples:
    return Examples(examples.features[indexes], examples.correct[indexes], examples.groups[indexes])


def fit_calibrated(algorithm: Algorithm, examples: Examples) -> CalibratedClassifierCV:
    """The algorithm with its probabilities adjusted (sigmoid, or Platt) so that a 90 % means that
    nine out of ten like it are right. The adjustment is learned on parts left out by person too."""
    model = CalibratedClassifierCV(
        algorithm.build(), method="sigmoid", cv=grouped_splits(examples, ML_CALIBRATION_FOLDS)
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        model.fit(examples.features, examples.correct)
    return model


def out_of_sample(algorithm: Algorithm, examples: Examples) -> np.ndarray:
    """The probability given to every example by a model that had not seen that person."""
    probabilities = np.empty(len(examples.correct))
    for train, test in grouped_splits(examples, ML_MAX_FOLDS):
        model = fit_calibrated(algorithm, subset(examples, train))
        probabilities[test] = model.predict_proba(examples.features[test])[:, 1]
    return probabilities


def ratio(numerator: int, denominator: int) -> float | None:
    """A rate with nothing to divide by is unknown, not zero."""
    return None if denominator == 0 else numerator / denominator


@dataclass(frozen=True)
class Scores:
    tn: int
    fp: int
    fn: int
    tp: int
    log_loss: float
    brier: float

    @property
    def precision(self) -> float | None:
        return ratio(self.tp, self.tp + self.fp)

    @property
    def recall(self) -> float | None:
        return ratio(self.tp, self.tp + self.fn)

    @property
    def f1(self) -> float | None:
        precision, recall = self.precision, self.recall
        if precision is None or recall is None or precision + recall == 0:
            return None
        return 2 * precision * recall / (precision + recall)

    @property
    def false_positive_rate(self) -> float | None:
        return ratio(self.fp, self.fp + self.tn)

    @property
    def false_negative_rate(self) -> float | None:
        return ratio(self.fn, self.fn + self.tp)


def score(correct: np.ndarray, probabilities: np.ndarray) -> Scores:
    predicted = probabilities >= ML_DECISION_CUT
    actual = correct == 1
    return Scores(
        tn=int((~predicted & ~actual).sum()),
        fp=int((predicted & ~actual).sum()),
        fn=int((~predicted & actual).sum()),
        tp=int((predicted & actual).sum()),
        log_loss=float(log_loss(correct, probabilities, labels=[0, 1])),
        brier=float(brier_score_loss(correct, probabilities)),
    )


def choose(results: list[Scores]) -> int:
    """The position of the best: lowest log-loss, then lowest Brier, then the simplest."""
    return min(
        range(len(results)),
        key=lambda i: (round(results[i].log_loss, 9), round(results[i].brier, 9), i),
    )


# --- storing the trained model ---------------------------------------------------------------


@dataclass(frozen=True)
class StoredModel:
    model: CalibratedClassifierCV
    metrics: ModelMetricsOut


_cache: dict[Path, tuple[tuple[int, int], StoredModel]] = {}
_training_lock = threading.Lock()


def _paths(models_dir: Path, face_model: str) -> tuple[Path, Path]:
    stem = re.sub(r"[^A-Za-z0-9_.-]", "_", face_model)
    folder = models_dir / ML_DIR_NAME
    return folder / f"{stem}.joblib", folder / f"{stem}.json"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(
    models_dir: Path, face_model: str, model: CalibratedClassifierCV, metrics: ModelMetricsOut
) -> None:
    """Write the model and what is known about it. Each file is written whole and then moved in
    place, so a failure half-way does not leave a model that is only partly there."""
    model_path, meta_path = _paths(models_dir, face_model)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    temp_model = model_path.with_suffix(".joblib.tmp")
    temp_meta = meta_path.with_suffix(".json.tmp")
    try:
        joblib.dump(model, temp_model)
        meta = {
            "sha256": _sha256(temp_model),
            "sklearn": sklearn.__version__,
            "features": list(FEATURES),
            "metricas": metrics.model_dump(mode="json"),
        }
        temp_meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp_model, model_path)
        os.replace(temp_meta, meta_path)
    finally:
        temp_model.unlink(missing_ok=True)
        temp_meta.unlink(missing_ok=True)


def load(models_dir: Path, face_model: str) -> StoredModel | None:
    """The trained model of this face model, or nothing if there is none or it cannot be trusted.

    A file is loaded only from the folder of the app, only if it is the one that was saved (same
    hash) and only by the version of scikit-learn that made it: `joblib` files can run code, so
    nothing else is ever read. A failure is logged and the answer is "no model", never an error
    for whoever was recognizing a face."""
    model_path, meta_path = _paths(models_dir, face_model)
    try:
        stamp = (model_path.stat().st_mtime_ns, meta_path.stat().st_mtime_ns)
    except OSError:
        return None
    cached = _cache.get(meta_path)
    if cached is not None and cached[0] == stamp:
        return cached[1]
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if meta.get("sklearn") != sklearn.__version__:
            logger.warning(
                "El modelo guardado se hizo con scikit-learn %s y hay %s: hay que reentrenarlo",
                meta.get("sklearn"),
                sklearn.__version__,
            )
            return None
        if meta.get("sha256") != _sha256(model_path):
            logger.error("El archivo del modelo de probabilidad no es el que se guardó")
            return None
        stored = StoredModel(
            model=joblib.load(model_path),
            metrics=ModelMetricsOut.model_validate(meta["metricas"]),
        )
    except Exception:
        logger.exception("No se pudo cargar el modelo de probabilidad")
        return None
    _cache[meta_path] = (stamp, stored)
    return stored


def predict(
    models_dir: Path, face_model: str, similitud: float, calidad_imagen: float, iluminacion: float
) -> float | None:
    """The calibrated probability, or nothing while there is no model."""
    stored = load(models_dir, face_model)
    if stored is None:
        return None
    features = np.array([[similitud, calidad_imagen, iluminacion]], dtype=float)
    return clip01(float(stored.model.predict_proba(features)[0, 1]))


# --- training ---------------------------------------------------------------------------------


def train(db: Session, models_dir: Path, face_model: str) -> ModelMetricsOut:
    """Train, check and keep the best model for this face model. Slow: a few seconds."""
    if not _training_lock.acquire(blocking=False):
        raise ApiException(409, "Ya hay un entrenamiento en curso. Espera a que termine.")
    try:
        ml_dataset_service.sync_records(db)
        counts = ml_dataset_service.counts(db, face_model)
        if counts.missing:
            raise ApiException(
                422, "No hay datos suficientes para entrenar. " + " ".join(counts.missing)
            )
        examples = examples_from(ml_dataset_service.load(db, face_model))
        try:
            outcomes = [
                (algorithm, score(examples.correct, out_of_sample(algorithm, examples)))
                for algorithm in ALGORITHMS
            ]
            best = choose([scores for _, scores in outcomes])
            final = fit_calibrated(outcomes[best][0], examples)
        except NotEnoughToCheck:
            raise ApiException(422, NOT_ENOUGH_TO_CHECK) from None

        chosen, chosen_scores = outcomes[best]
        metrics = ModelMetricsOut(
            precision=chosen_scores.precision,
            recall=chosen_scores.recall,
            f1=chosen_scores.f1,
            tasa_falsos_positivos=chosen_scores.false_positive_rate,
            tasa_falsos_negativos=chosen_scores.false_negative_rate,
            matriz_confusion=[
                [chosen_scores.tn, chosen_scores.fp],
                [chosen_scores.fn, chosen_scores.tp],
            ],
            n_muestras=len(examples.correct),
            algoritmo=chosen.key,
            modelo_facial=face_model,
            entrenado_en=utcnow(),
            log_loss=chosen_scores.log_loss,
            brier=chosen_scores.brier,
            ejemplos_correctos=counts.correct,
            ejemplos_incorrectos=counts.wrong,
            personas=counts.people,
            comparacion=[
                AlgorithmResultOut(
                    algoritmo=algorithm.key,
                    nombre=algorithm.name,
                    log_loss=scores.log_loss,
                    brier=scores.brier,
                    precision=scores.precision,
                    recall=scores.recall,
                    f1=scores.f1,
                    tasa_falsos_positivos=scores.false_positive_rate,
                    tasa_falsos_negativos=scores.false_negative_rate,
                    elegido=index == best,
                )
                for index, (algorithm, scores) in enumerate(outcomes)
            ],
        )
        save(models_dir, face_model, final, metrics)
        return metrics
    finally:
        _training_lock.release()
