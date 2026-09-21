import hashlib
import json
import logging
import shutil
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import sklearn
from sklearn.calibration import _SigmoidCalibration
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401  (registers the tables in Base.metadata)
from app.core.errors import ApiException
from app.database.connection import Base, make_engine
from app.models import MlTrainingRecord
from app.services import ml_model_service as service
from app.services import probability_service
from app.services.ml_model_service import Examples, NotEnoughToCheck, Scores
from app.services.ml_scores import illumination_score, quality_score
from app.services.quality_service import FaceMeasurements
from tests.ml_data import MODEL, add_evaluated_attempts, add_examples

# Not all of these numbers mean anything: the examples are made up (see ml_data.py). What is checked
# here is that the machinery does what it says, not how well faces are recognized.


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    """Trained once for the whole module: training takes a few seconds."""
    engine = make_engine("sqlite://")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    add_examples(session, correct=40, wrong=40, people=4)
    folder = tmp_path_factory.mktemp("ml")
    metrics = service.train(session, folder, MODEL)
    yield SimpleNamespace(db=session, folder=folder, metrics=metrics)
    session.close()
    engine.dispose()


@pytest.fixture
def copy_of_trained(trained, tmp_path) -> Path:
    """A private copy of the trained folder, to break without spoiling the others."""
    target = tmp_path / "models"
    shutil.copytree(trained.folder, target)
    return target


def examples(correct, groups) -> Examples:
    correct = np.array(correct)
    return Examples(
        features=np.random.default_rng(0).random((len(correct), 3)),
        correct=correct,
        groups=np.array(groups),
    )


# --- examples and splits ---------------------------------------------------------------------


def test_the_examples_keep_the_person_and_give_each_unknown_one_a_group_of_its_own():
    records = [
        MlTrainingRecord(
            id=1, similitud=0.9, calidad_imagen=0.5, iluminacion=0.6, resultado_real=True, grupo=7
        ),
        MlTrainingRecord(
            id=2,
            similitud=0.2,
            calidad_imagen=0.4,
            iluminacion=0.3,
            resultado_real=False,
            grupo=None,
        ),
        MlTrainingRecord(
            id=3,
            similitud=0.1,
            calidad_imagen=0.4,
            iluminacion=0.3,
            resultado_real=False,
            grupo=None,
        ),
    ]
    made = service.examples_from(records)
    assert made.features.tolist() == [[0.9, 0.5, 0.6], [0.2, 0.4, 0.3], [0.1, 0.4, 0.3]]
    assert made.correct.tolist() == [1, 0, 0]
    assert made.groups.tolist() == [7, -2, -3]


def two_kinds_in(groups):
    return [i % 2 for i in range(len(groups))]


def test_no_person_is_on_both_sides_of_a_split():
    groups = [1, 2, 3, 4, 5, 6] * 6
    made = examples(two_kinds_in(groups), groups)
    for train, test in service.grouped_splits(made, 5):
        assert not set(made.groups[train]) & set(made.groups[test])


def test_every_part_of_every_split_has_both_kinds():
    groups = [1, 2, 3, 4, 5, 6] * 6
    made = examples(two_kinds_in(groups), groups)
    for train, test in service.grouped_splits(made, 5):
        assert set(made.correct[train]) == {0, 1}
        assert set(made.correct[test]) == {0, 1}


def test_there_are_as_many_parts_as_asked_when_there_are_enough_people():
    groups = list(range(1, 13)) * 3
    assert len(service.grouped_splits(examples(two_kinds_in(groups), groups), 5)) == 5


def test_with_fewer_people_than_parts_fewer_parts_are_made():
    groups = [1, 2, 3] * 10
    made = examples([0, 1] * 15, groups)
    assert len(service.grouped_splits(made, 5)) == 3


def test_the_split_is_always_the_same_for_the_same_examples():
    groups = list(range(1, 13)) * 3
    made = examples(two_kinds_in(groups), groups)
    first = service.grouped_splits(made, 5)
    second = service.grouped_splits(made, 5)
    assert all(
        (a[0] == b[0]).all() and (a[1] == b[1]).all() for a, b in zip(first, second, strict=True)
    )


@pytest.mark.parametrize(
    ("correct", "groups"),
    [
        ([1] * 20, list(range(20))),  # only one kind
        ([0, 1] * 10, [1] * 20),  # a single person
        ([1] * 10 + [0] * 10, [1] * 10 + [2] * 5 + [3] * 5),  # each person has only one kind
    ],
)
def test_data_that_cannot_be_split_with_both_kinds_in_every_part_is_refused(correct, groups):
    with pytest.raises(NotEnoughToCheck):
        service.grouped_splits(examples(correct, groups), 5)


def test_the_check_is_made_in_five_parts_when_there_are_enough_people(monkeypatch):
    groups = list(range(1, 13)) * 3
    made = examples(two_kinds_in(groups), groups)
    trained_on = []

    class Constant:
        def predict_proba(self, features):
            return np.full((len(features), 2), 0.5)

    def fit(_algorithm, part):
        trained_on.append(len(part.correct))
        return Constant()

    monkeypatch.setattr(service, "fit_calibrated", fit)
    service.out_of_sample(service.ALGORITHMS[0], made)
    assert len(trained_on) == 5


def test_the_probabilities_come_from_a_model_that_had_not_seen_the_example(monkeypatch):
    """A stand-in for the model says 1 for what it was trained on and 0 for anything else."""
    groups = list(range(1, 13)) * 3
    made = examples(two_kinds_in(groups), groups)

    class Memorizer:
        def __init__(self, rows):
            self.rows = {tuple(row) for row in rows}

        def predict_proba(self, features):
            seen = np.array([tuple(row) in self.rows for row in features], dtype=float)
            return np.column_stack([1 - seen, seen])

    monkeypatch.setattr(
        service, "fit_calibrated", lambda _algorithm, part: Memorizer(part.features)
    )
    probabilities = service.out_of_sample(service.ALGORITHMS[0], made)
    assert probabilities.shape == (len(groups),)
    assert probabilities.tolist() == [0.0] * len(groups)


# --- scores ----------------------------------------------------------------------------------


def test_the_scores_are_worked_out_from_the_counts_and_cut_at_one_half():
    # 0.9 right (hit), 0.6 wrong (false positive), 0.4 right (miss), 0.1 wrong (correct rejection)
    scores = service.score(np.array([1, 0, 1, 0]), np.array([0.9, 0.6, 0.4, 0.1]))
    assert (scores.tn, scores.fp, scores.fn, scores.tp) == (1, 1, 1, 1)
    assert scores.precision == 0.5
    assert scores.recall == 0.5
    assert scores.f1 == 0.5
    assert scores.false_positive_rate == 0.5
    assert scores.false_negative_rate == 0.5


def test_exactly_one_half_counts_as_correct():
    scores = service.score(np.array([1, 0]), np.array([0.5, 0.49]))
    assert (scores.tp, scores.tn) == (1, 1)


def test_the_log_loss_and_the_brier_score_are_the_usual_ones():
    scores = service.score(np.array([1, 0]), np.array([0.9, 0.2]))
    assert scores.log_loss == pytest.approx(-(np.log(0.9) + np.log(0.8)) / 2)
    assert scores.brier == pytest.approx((0.1**2 + 0.2**2) / 2)


def test_a_rate_with_nothing_to_divide_by_is_unknown_and_not_zero():
    # Nobody was called correct: there is no precision, and so no F1
    scores = service.score(np.array([1, 0, 1, 0]), np.array([0.1, 0.2, 0.3, 0.4]))
    assert scores.precision is None
    assert scores.f1 is None
    assert scores.recall == 0.0
    assert scores.false_positive_rate == 0.0


def test_no_f1_when_precision_and_recall_are_both_zero():
    scores = service.score(np.array([1, 0]), np.array([0.1, 0.9]))
    assert scores.precision == 0.0
    assert scores.recall == 0.0
    assert scores.f1 is None


def scores_with(log_loss, brier):
    return Scores(tn=0, fp=0, fn=0, tp=0, log_loss=log_loss, brier=brier)


def test_the_best_is_the_one_with_the_lowest_log_loss():
    assert (
        service.choose([scores_with(0.5, 0.1), scores_with(0.3, 0.9), scores_with(0.4, 0.0)]) == 1
    )


def test_the_brier_score_breaks_a_tie_in_log_loss():
    assert service.choose([scores_with(0.3, 0.2), scores_with(0.3, 0.1)]) == 1


def test_the_simplest_wins_when_everything_ties():
    assert service.choose([scores_with(0.3, 0.1), scores_with(0.3, 0.1)]) == 0


# --- training --------------------------------------------------------------------------------


def test_training_reports_what_it_was_trained_with(trained):
    metrics = trained.metrics
    assert metrics.modelo_facial == MODEL
    assert metrics.n_muestras == 80
    assert metrics.ejemplos_correctos == 40
    assert metrics.ejemplos_incorrectos == 40
    assert metrics.personas == 4
    assert metrics.algoritmo in {a.key for a in service.ALGORITHMS}


def test_the_matrix_and_the_rates_agree(trained):
    metrics = trained.metrics
    (tn, fp), (fn, tp) = metrics.matriz_confusion
    assert tn + fp + fn + tp == metrics.n_muestras
    assert metrics.tasa_falsos_positivos == pytest.approx(fp / (fp + tn))
    assert metrics.tasa_falsos_negativos == pytest.approx(fn / (fn + tp))
    assert metrics.precision == pytest.approx(tp / (tp + fp))
    assert metrics.recall == pytest.approx(tp / (tp + fn))


def test_the_three_algorithms_are_compared_and_exactly_one_is_kept(trained):
    comparison = trained.metrics.comparacion
    assert [c.algoritmo for c in comparison] == [
        "regresion_logistica",
        "random_forest",
        "gradient_boosting",
    ]
    assert [c.nombre for c in comparison] == [
        "Regresión Logística",
        "Random Forest",
        "Gradient Boosting",
    ]
    chosen = [c for c in comparison if c.elegido]
    assert len(chosen) == 1
    assert chosen[0].algoritmo == trained.metrics.algoritmo
    assert chosen[0].log_loss == min(c.log_loss for c in comparison)
    assert trained.metrics.log_loss == chosen[0].log_loss
    assert trained.metrics.brier == chosen[0].brier


def test_the_model_and_what_is_known_about_it_are_saved_where_the_app_looks(trained):
    model_path = trained.folder / "ml" / "simulated.joblib"
    meta_path = trained.folder / "ml" / "simulated.json"
    assert model_path.is_file()
    assert meta_path.is_file()
    assert not list((trained.folder / "ml").glob("*.tmp"))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["sha256"] == hashlib.sha256(model_path.read_bytes()).hexdigest()
    assert meta["sklearn"] == sklearn.__version__
    assert meta["features"] == ["similitud", "calidad_imagen", "iluminacion"]


def test_what_is_loaded_is_what_was_trained(trained):
    stored = service.load(trained.folder, MODEL)
    assert stored is not None
    assert stored.metrics == trained.metrics


def test_a_higher_similarity_gives_a_higher_probability_and_it_stays_between_zero_and_one(trained):
    low = service.predict(trained.folder, MODEL, 0.05, 0.6, 0.6)
    middle = service.predict(trained.folder, MODEL, 0.55, 0.6, 0.6)
    high = service.predict(trained.folder, MODEL, 0.99, 0.6, 0.6)
    assert 0.0 <= low < middle < high <= 1.0
    assert isinstance(high, float)


def test_there_is_no_probability_for_a_face_model_that_was_not_trained(trained):
    assert service.predict(trained.folder, "sface-2021dec", 0.9, 0.6, 0.6) is None
    assert service.load(trained.folder, "sface-2021dec") is None


def test_a_probability_needs_no_model_at_all_in_an_empty_folder(tmp_path):
    assert service.predict(tmp_path, MODEL, 0.9, 0.6, 0.6) is None


def test_training_twice_with_the_same_examples_gives_the_same_result(trained, tmp_path):
    again = service.train(trained.db, tmp_path, MODEL)
    assert again.model_dump(exclude={"entrenado_en"}) == trained.metrics.model_dump(
        exclude={"entrenado_en"}
    )


def test_the_folder_name_of_a_face_model_cannot_leave_the_folder_of_the_app(tmp_path):
    model_path, meta_path = service._paths(tmp_path, "../../evil/model")
    assert model_path.parent == tmp_path / "ml"
    assert meta_path.parent == tmp_path / "ml"


# --- what refuses to train -------------------------------------------------------------------


def test_too_few_examples_are_refused_and_say_what_is_missing(db, tmp_path):
    add_examples(db, correct=10, wrong=10, people=3)
    with pytest.raises(ApiException) as error:
        service.train(db, tmp_path, MODEL)
    assert error.value.status_code == 422
    assert error.value.message.startswith("No hay datos suficientes para entrenar. ")
    assert "Faltan 30 intentos evaluados (hay 20 de 50)." in error.value.message
    assert not (tmp_path / "ml").exists()


def test_the_examples_of_another_face_model_do_not_count(db, tmp_path):
    add_examples(db, correct=25, wrong=25, people=3, model="sface-2021dec")
    with pytest.raises(ApiException) as error:
        service.train(db, tmp_path, MODEL)
    assert error.value.status_code == 422
    assert "Faltan 50 intentos evaluados" in error.value.message


def test_data_that_cannot_be_checked_on_people_it_has_not_seen_is_refused(db, tmp_path):
    # Enough of everything, but one person has all the right ones and the others all the wrong ones
    add_examples(db, correct=25, wrong=25, people=1, unknown_share=0)
    for record in db.query(MlTrainingRecord).filter(MlTrainingRecord.resultado_real.is_(False)):
        record.grupo = 2 + record.id % 2
    db.commit()
    with pytest.raises(ApiException) as error:
        service.train(db, tmp_path, MODEL)
    assert error.value.status_code == 422
    assert error.value.message == service.NOT_ENOUGH_TO_CHECK
    assert not (tmp_path / "ml").exists()


def test_a_second_training_at_the_same_time_is_refused(db, tmp_path):
    add_examples(db, correct=25, wrong=25, people=3)
    assert service._training_lock.acquire(blocking=False)
    try:
        with pytest.raises(ApiException) as error:
            service.train(db, tmp_path, MODEL)
    finally:
        service._training_lock.release()
    assert error.value.status_code == 409
    assert error.value.message == "Ya hay un entrenamiento en curso. Espera a que termine."
    assert not (tmp_path / "ml").exists()


def test_the_lock_is_free_again_after_a_training_that_failed(db, tmp_path):
    with pytest.raises(ApiException):
        service.train(db, tmp_path, MODEL)
    assert service._training_lock.acquire(blocking=False)
    service._training_lock.release()


# --- a model that cannot be trusted ---------------------------------------------------------


def test_a_model_file_that_is_not_the_one_that_was_saved_is_not_loaded(copy_of_trained, caplog):
    path = copy_of_trained / "ml" / "simulated.joblib"
    path.write_bytes(path.read_bytes() + b"tampered")
    with caplog.at_level(logging.ERROR, logger="app.ml"):
        assert service.load(copy_of_trained, MODEL) is None
    assert "no es el que se guardó" in caplog.text
    assert service.predict(copy_of_trained, MODEL, 0.9, 0.6, 0.6) is None


def test_a_model_made_by_another_version_of_scikit_learn_is_not_loaded(copy_of_trained, caplog):
    meta_path = copy_of_trained / "ml" / "simulated.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["sklearn"] = "0.0.1"
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    with caplog.at_level(logging.WARNING, logger="app.ml"):
        assert service.load(copy_of_trained, MODEL) is None
    assert "hay que reentrenarlo" in caplog.text


def test_unreadable_information_about_the_model_means_no_model(copy_of_trained, caplog):
    (copy_of_trained / "ml" / "simulated.json").write_text("{not json", encoding="utf-8")
    with caplog.at_level(logging.ERROR, logger="app.ml"):
        assert service.load(copy_of_trained, MODEL) is None
    assert "No se pudo cargar el modelo" in caplog.text


@pytest.mark.parametrize("missing", ["simulated.joblib", "simulated.json"])
def test_a_model_with_one_of_its_two_files_missing_is_no_model(copy_of_trained, missing):
    (copy_of_trained / "ml" / missing).unlink()
    assert service.load(copy_of_trained, MODEL) is None


def test_information_that_does_not_fit_the_metrics_means_no_model(copy_of_trained):
    meta_path = copy_of_trained / "ml" / "simulated.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    del meta["metricas"]["algoritmo"]
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    assert service.load(copy_of_trained, MODEL) is None


# --- cache and saving ------------------------------------------------------------------------


def test_the_model_is_read_from_disk_once_and_again_only_when_the_files_change(
    trained, copy_of_trained
):
    first = service.load(copy_of_trained, MODEL)
    assert service.load(copy_of_trained, MODEL) is first
    service.train(trained.db, copy_of_trained, MODEL)
    second = service.load(copy_of_trained, MODEL)
    assert second is not first
    assert second.metrics.entrenado_en > first.metrics.entrenado_en


def test_a_failure_while_saving_keeps_the_old_model_and_leaves_no_leftovers(
    trained, copy_of_trained, monkeypatch
):
    before = service.load(copy_of_trained, MODEL)

    def boom(*_args, **_kwargs):
        raise OSError("disco lleno")

    monkeypatch.setattr(service.json, "dumps", boom)
    with pytest.raises(OSError):
        service.save(copy_of_trained, MODEL, before.model, before.metrics)
    monkeypatch.undo()

    assert not list((copy_of_trained / "ml").glob("*.tmp"))
    after = service.load(copy_of_trained, MODEL)
    assert after is not None
    assert after.metrics == before.metrics


# --- the probability of an attempt that has just been made -----------------------------------


def measured(**changes) -> FaceMeasurements:
    values = {"tamano": 120, "confianza": 0.9, "nitidez": 0.06, "brillo": 110.0, **changes}
    return FaceMeasurements(**values)


def test_the_probability_of_an_attempt_is_made_from_its_scores(trained):
    face = measured()
    expected = service.predict(
        trained.folder, MODEL, 0.8, quality_score(0.06, 120, 0.9), illumination_score(110.0)
    )
    assert expected is not None
    assert probability_service.probability_for_attempt(trained.folder, MODEL, 0.8, face) == expected


@pytest.mark.parametrize(
    "face",
    [None, measured(nitidez=None), measured(brillo=None), measured(nitidez=None, brillo=None)],
)
def test_an_attempt_whose_face_was_not_measured_has_no_probability(trained, face):
    assert probability_service.probability_for_attempt(trained.folder, MODEL, 0.8, face) is None


def test_nothing_that_goes_wrong_while_working_out_the_probability_is_ever_raised(
    trained, monkeypatch, caplog
):
    def boom(*_args):
        raise RuntimeError("sklearn se rompio")

    monkeypatch.setattr(service, "predict", boom)
    with caplog.at_level(logging.ERROR, logger="app.ml"):
        assert (
            probability_service.probability_for_attempt(trained.folder, MODEL, 0.8, measured())
            is None
        )
    assert "No se pudo calcular la probabilidad calibrada" in caplog.text


# --- what was decided about the model ------------------------------------------------------


BASE_OF = {
    "regresion_logistica": "LogisticRegression",
    "random_forest": "RandomForestClassifier",
    "gradient_boosting": "GradientBoostingClassifier",
}


def test_the_probabilities_are_adjusted_with_the_sigmoid_method(trained):
    stored = service.load(trained.folder, MODEL)
    calibrators = [
        calibrator
        for member in stored.model.calibrated_classifiers_
        for calibrator in member.calibrators
    ]
    assert calibrators
    assert all(isinstance(calibrator, _SigmoidCalibration) for calibrator in calibrators)


def test_the_kept_model_is_the_algorithm_that_the_metrics_say(trained):
    stored = service.load(trained.folder, MODEL)
    assert type(stored.model.estimator).__name__ == BASE_OF[trained.metrics.algoritmo]


def test_training_first_turns_the_evaluated_attempts_into_examples(db, tmp_path):
    made = add_evaluated_attempts(db, people=3, each=10)
    assert made == 60
    assert db.query(MlTrainingRecord).count() == 0
    metrics = service.train(db, tmp_path, MODEL)
    assert metrics.n_muestras == 60
    assert metrics.personas == 3
    assert db.query(MlTrainingRecord).count() == 60
