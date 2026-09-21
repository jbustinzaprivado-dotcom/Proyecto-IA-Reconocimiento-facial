from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from app.core.errors import ApiException
from app.models import Persona, RecognitionLog
from app.services import analysis_service as analysis
from app.services.analysis_service import CURVE_POINTS, metrics_from

NOW = datetime(2026, 9, 20, 15, 0, tzinfo=UTC)


@pytest.fixture
def ana(db: Session) -> Persona:
    persona = Persona(
        nombre="Ana Torres",
        email="ana@example.com",
        consentimiento_at=NOW,
        consentimiento_version="v0-provisional",
    )
    db.add(persona)
    db.commit()
    return persona


def add(
    db: Session,
    similitud: float,
    *,
    modelo: str = "m",
    coincide: bool | None = None,
    umbral: float = 0.5,
    esperado: str | None = None,
    esperado_id: int | None = None,
    correcto: bool | None = None,
    creado: datetime = NOW,
) -> None:
    db.add(
        RecognitionLog(
            similitud=similitud,
            distancia=2 * (1 - similitud),
            umbral=umbral,
            coincide=similitud >= umbral if coincide is None else coincide,
            modelo=modelo,
            probabilidad_calibrada=None,
            esperado=esperado,
            esperado_persona_id=esperado_id,
            candidato_correcto=correcto,
            created_at=creado,
        )
    )
    db.commit()


def summary(db: Session, **kwargs):
    kwargs.setdefault("requested_model", None)
    kwargs.setdefault("active_model", "m")
    kwargs.setdefault("active_threshold", 0.5)
    kwargs.setdefault("now", NOW)
    return analysis.summary(db, **kwargs)


def labeled_attempts(db: Session, ana: Persona) -> None:
    """Six labeled attempts and one that is not, worked out by hand in the tests below."""
    person = {"esperado": "persona", "esperado_id": ana.id}
    add(db, 0.90, correcto=True, **person)
    add(db, 0.30, correcto=True, **person)
    add(db, 0.70, correcto=False, **person)
    add(db, 0.60, esperado="desconocido")
    add(db, 0.20, esperado="desconocido")
    add(db, 0.55, correcto=True, **person)
    add(db, 0.95)


def point(result, threshold: float):
    return next(p for p in result.curva if p.umbral == threshold)


class TestNothingYet:
    def test_an_empty_database_gives_zeros_and_a_full_curve(self, db):
        result = summary(db, active_model=None, active_threshold=None)
        assert result.modelo is None
        assert result.modelos == []
        assert result.umbral is None
        assert (result.total_intentos, result.total_coincidencias) == (0, 0)
        assert result.tasa_coincidencia == 0.0
        assert result.similitud_promedio_coincidencias is None
        assert result.similitud_promedio_rechazos is None
        assert len(result.curva) == CURVE_POINTS
        assert all(p.coincidencias == 0 for p in result.curva)
        assert result.etiquetados == 0
        assert result.metricas_umbral is None
        assert len(result.por_dia) == 14
        assert all(d.coincidencias == d.rechazos == 0 for d in result.por_dia)

    def test_with_an_active_model_and_no_attempts_it_is_named_but_empty(self, db):
        result = summary(db)
        assert result.modelo == "m"
        assert result.umbral == 0.5
        assert result.total_intentos == 0


class TestTotals:
    def test_totals_rate_and_averages_use_the_stored_decision(self, db):
        add(db, 0.9)
        add(db, 0.7)
        add(db, 0.2)
        add(db, 0.1)
        result = summary(db)
        assert (result.total_intentos, result.total_coincidencias) == (4, 2)
        assert result.tasa_coincidencia == 0.5
        assert result.similitud_promedio_coincidencias == pytest.approx(0.8)
        assert result.similitud_promedio_rechazos == pytest.approx(0.15)

    def test_only_hits_leaves_the_rejection_average_empty(self, db):
        add(db, 0.9)
        result = summary(db)
        assert result.similitud_promedio_rechazos is None
        assert result.tasa_coincidencia == 1.0

    def test_only_rejections_leaves_the_hit_average_empty(self, db):
        add(db, 0.1)
        result = summary(db)
        assert result.similitud_promedio_coincidencias is None
        assert result.tasa_coincidencia == 0.0

    def test_the_decision_taken_at_the_time_is_kept_even_if_the_threshold_changed(self, db):
        add(db, 0.6, umbral=0.5)
        add(db, 0.6, umbral=0.7)
        result = summary(db)
        assert result.total_coincidencias == 1


class TestHistogram:
    def test_there_are_20_bins_of_0_05_covering_0_to_1(self, db):
        bins = summary(db).histograma
        assert len(bins) == 20
        assert (bins[0].desde, bins[0].hasta) == (0.0, 0.05)
        assert (bins[19].desde, bins[19].hasta) == (0.95, 1.0)

    def test_a_value_on_the_edge_goes_to_the_bin_that_starts_there(self, db):
        add(db, 0.15)
        bins = summary(db).histograma
        assert bins[2].rechazos + bins[2].coincidencias == 0
        assert bins[3].coincidencias == 0
        assert bins[3].rechazos == 1

    def test_a_value_a_hair_below_an_edge_still_goes_to_the_bin_that_starts_there(self, db):
        # 0.35 - 0.2 is 0.14999999999999997 in floating point: it is the edge 0.15 for any purpose
        add(db, 0.35 - 0.2)
        bins = summary(db).histograma
        assert bins[2].rechazos == 0
        assert bins[3].rechazos == 1

    def test_zero_and_one_land_in_the_first_and_last_bins(self, db):
        add(db, 0.0)
        add(db, 1.0)
        bins = summary(db).histograma
        assert bins[0].rechazos == 1
        assert bins[19].coincidencias == 1

    def test_hits_and_rejections_are_counted_apart(self, db):
        add(db, 0.52)
        add(db, 0.53, coincide=False)
        bin_ = summary(db).histograma[10]
        assert (bin_.coincidencias, bin_.rechazos) == (1, 1)

    def test_every_attempt_is_in_exactly_one_bin(self, db):
        for value in (0.0, 0.05, 0.33, 0.5, 0.749, 0.75, 0.999, 1.0):
            add(db, value)
        bins = summary(db).histograma
        assert sum(b.coincidencias + b.rechazos for b in bins) == 8


class TestThresholdCurve:
    def test_it_goes_from_0_to_1_in_steps_of_0_01(self, db):
        curve = summary(db).curva
        assert [p.umbral for p in curve[:3]] == [0.0, 0.01, 0.02]
        assert curve[-1].umbral == 1.0
        assert len(curve) == 101

    def test_the_matches_count_every_attempt_that_clears_each_threshold(self, db, ana):
        labeled_attempts(db, ana)
        result = summary(db)
        assert point(result, 0.0).coincidencias == 7
        assert point(result, 0.5).coincidencias == 5
        assert point(result, 0.65).coincidencias == 3
        assert point(result, 0.8).coincidencias == 2
        assert point(result, 1.0).coincidencias == 0

    def test_every_point_of_the_curve_is_a_clean_hundredth(self, db):
        # Without rounding, 0.35 would come out as 0.35000000000000003 and no one could look it up
        assert [p.umbral for p in summary(db).curva] == [round(i / 100, 2) for i in range(101)]

    def test_a_threshold_equal_to_the_similarity_counts_as_a_match(self, db):
        add(db, 0.5)
        assert point(summary(db), 0.5).coincidencias == 1
        assert point(summary(db), 0.51).coincidencias == 0

    def test_the_errors_are_worked_out_from_the_labeled_attempts_only(self, db, ana):
        labeled_attempts(db, ana)
        result = summary(db)
        at_half = point(result, 0.5)
        assert (at_half.verdaderos_positivos, at_half.falsos_positivos) == (2, 2)
        assert (at_half.falsos_negativos, at_half.verdaderos_negativos) == (1, 1)
        assert at_half.tasa_falsos_positivos == pytest.approx(2 / 3)
        assert at_half.tasa_falsos_negativos == pytest.approx(1 / 3)

    def test_a_stricter_threshold_trades_false_positives_for_false_negatives(self, db, ana):
        labeled_attempts(db, ana)
        result = summary(db)
        stricter = point(result, 0.8)
        assert (stricter.verdaderos_positivos, stricter.falsos_positivos) == (1, 0)
        assert (stricter.falsos_negativos, stricter.verdaderos_negativos) == (3, 2)
        assert stricter.tasa_falsos_positivos == 0.0
        assert stricter.tasa_falsos_negativos == 0.75

    def test_at_the_extremes_everything_or_nothing_is_accepted(self, db, ana):
        labeled_attempts(db, ana)
        result = summary(db)
        everything = point(result, 0.0)
        assert (everything.verdaderos_positivos, everything.falsos_positivos) == (3, 3)
        assert (everything.falsos_negativos, everything.verdaderos_negativos) == (0, 0)
        nothing = point(result, 1.0)
        assert (nothing.verdaderos_positivos, nothing.falsos_positivos) == (0, 0)
        assert (nothing.falsos_negativos, nothing.verdaderos_negativos) == (4, 2)

    def test_a_wrong_identity_below_the_threshold_is_a_miss_not_a_false_positive(self, db, ana):
        add(db, 0.7, esperado="persona", esperado_id=ana.id, correcto=False)
        result = summary(db)
        assert point(result, 0.6).falsos_positivos == 1
        assert point(result, 0.6).falsos_negativos == 0
        assert point(result, 0.8).falsos_positivos == 0
        assert point(result, 0.8).falsos_negativos == 1

    def test_the_rates_are_empty_when_there_is_nothing_to_divide_by(self, db):
        add(db, 0.9, esperado="desconocido")
        result = summary(db)
        assert point(result, 0.5).tasa_falsos_negativos is None
        assert point(result, 0.5).tasa_falsos_positivos == 1.0

    def test_without_labels_the_error_columns_are_all_zero_and_the_rates_empty(self, db):
        add(db, 0.9)
        add(db, 0.1)
        for p in summary(db).curva:
            assert (p.verdaderos_positivos, p.falsos_positivos) == (0, 0)
            assert (p.falsos_negativos, p.verdaderos_negativos) == (0, 0)
            assert p.tasa_falsos_positivos is None
            assert p.tasa_falsos_negativos is None

    def test_an_attempt_that_says_a_person_but_lost_the_person_is_not_counted(self, db):
        # The expected person was removed afterwards: the label cannot be worked out any more
        add(db, 0.9, esperado="persona", esperado_id=None, correcto=None)
        result = summary(db)
        assert result.etiquetados == 0


class TestMetricsAtTheCurrentThreshold:
    def test_they_follow_the_confusion_matrix_of_the_threshold_in_use(self, db, ana):
        labeled_attempts(db, ana)
        metrics = summary(db, active_threshold=0.5).metricas_umbral
        assert metrics.umbral == 0.5
        assert metrics.matriz_confusion == [[1, 2], [1, 2]]
        assert metrics.n_muestras == 6
        assert metrics.precision == pytest.approx(0.5)
        assert metrics.recall == pytest.approx(2 / 3)
        assert metrics.f1 == pytest.approx(4 / 7)
        assert metrics.tasa_falsos_positivos == pytest.approx(2 / 3)
        assert metrics.tasa_falsos_negativos == pytest.approx(1 / 3)

    def test_another_threshold_gives_other_numbers_from_the_same_attempts(self, db, ana):
        labeled_attempts(db, ana)
        metrics = summary(db, active_threshold=0.8).metricas_umbral
        assert metrics.matriz_confusion == [[2, 0], [3, 1]]
        assert metrics.precision == 1.0
        assert metrics.recall == 0.25

    def test_the_threshold_is_the_exact_one_and_not_the_nearest_of_the_curve(self, db, ana):
        add(db, 0.554, esperado="persona", esperado_id=ana.id, correcto=True)
        assert summary(db, active_threshold=0.555).metricas_umbral.matriz_confusion == [
            [0, 0],
            [1, 0],
        ]
        assert summary(db, active_threshold=0.554).metricas_umbral.matriz_confusion == [
            [0, 0],
            [0, 1],
        ]

    def test_they_are_empty_without_labeled_attempts(self, db):
        add(db, 0.9)
        assert summary(db).metricas_umbral is None

    def test_they_are_empty_when_the_threshold_is_not_known(self, db, ana):
        labeled_attempts(db, ana)
        result = summary(db, requested_model="m", active_model=None, active_threshold=None)
        # Not the active model: the threshold is the one of its last attempt
        assert result.umbral == 0.5
        assert result.metricas_umbral is not None

    def test_a_ratio_with_nothing_to_divide_by_is_empty_not_zero(self):
        metrics = metrics_from(0.5, tp=0, fp=0, fn=0, tn=3)
        assert metrics.precision is None
        assert metrics.recall is None
        assert metrics.f1 is None
        assert metrics.tasa_falsos_positivos == 0.0
        assert metrics.tasa_falsos_negativos is None

    def test_f1_is_empty_when_precision_and_recall_are_both_zero(self):
        metrics = metrics_from(0.5, tp=0, fp=2, fn=2, tn=0)
        assert metrics.precision == 0.0
        assert metrics.recall == 0.0
        assert metrics.f1 is None


class TestSmallSample:
    def fill(self, db: Session, ana: Persona, persons: int, unknown: int) -> None:
        for i in range(persons):
            add(db, 0.5 + i / 1000, esperado="persona", esperado_id=ana.id, correcto=True)
        for i in range(unknown):
            add(db, 0.2 + i / 1000, esperado="desconocido")

    def test_thirty_labeled_attempts_with_ten_of_each_kind_are_enough(self, db, ana):
        self.fill(db, ana, persons=15, unknown=15)
        result = summary(db)
        assert result.etiquetados == 30
        assert (result.etiquetados_persona, result.etiquetados_desconocido) == (15, 15)
        assert result.muestra_pequena is False

    def test_one_less_is_still_small(self, db, ana):
        self.fill(db, ana, persons=15, unknown=14)
        assert summary(db).muestra_pequena is True

    def test_thirty_with_too_few_of_one_kind_is_small(self, db, ana):
        self.fill(db, ana, persons=21, unknown=9)
        assert summary(db).muestra_pequena is True
        assert summary(db).etiquetados == 30

    def test_ten_of_the_smaller_kind_is_the_least_that_counts(self, db, ana):
        self.fill(db, ana, persons=20, unknown=10)
        assert summary(db).muestra_pequena is False

    def test_no_labels_at_all_is_small(self, db):
        assert summary(db).muestra_pequena is True


class TestModels:
    def test_each_model_is_looked_at_on_its_own(self, db):
        add(db, 0.9, modelo="a")
        add(db, 0.1, modelo="b")
        add(db, 0.2, modelo="b")
        first = summary(db, active_model="a")
        assert (first.modelo, first.total_intentos) == ("a", 1)
        second = summary(db, requested_model="b", active_model="a")
        assert (second.modelo, second.total_intentos) == ("b", 2)

    def test_the_list_of_models_is_ordered_by_number_of_attempts(self, db):
        add(db, 0.9, modelo="a")
        add(db, 0.1, modelo="b")
        add(db, 0.2, modelo="b")
        assert [(m.modelo, m.intentos) for m in summary(db).modelos] == [("b", 2), ("a", 1)]

    def test_a_model_with_no_attempts_is_refused_by_name(self, db):
        add(db, 0.9, modelo="a")
        with pytest.raises(ApiException) as info:
            summary(db, requested_model="inventado")
        assert info.value.status_code == 404
        assert info.value.message == "No hay intentos de ese modelo."

    def test_the_model_in_use_can_be_asked_for_before_it_has_attempts(self, db):
        add(db, 0.9, modelo="a")
        result = summary(db, requested_model="nuevo", active_model="nuevo")
        assert (result.modelo, result.total_intentos) == ("nuevo", 0)

    def test_without_an_active_model_the_one_of_the_last_attempt_is_shown(self, db):
        add(db, 0.9, modelo="a")
        add(db, 0.1, modelo="b")
        result = summary(db, active_model=None, active_threshold=None)
        assert result.modelo == "b"

    def test_the_threshold_of_the_active_model_is_the_one_in_use_now(self, db):
        add(db, 0.9, umbral=0.3)
        assert summary(db, active_threshold=0.7).umbral == 0.7

    def test_the_threshold_of_another_model_is_the_one_of_its_last_attempt(self, db):
        add(db, 0.9, modelo="a", umbral=0.4)
        add(db, 0.9, modelo="a", umbral=0.45)
        add(db, 0.9, modelo="b", umbral=0.9)
        result = summary(db, requested_model="a", active_model="b", active_threshold=0.9)
        assert result.umbral == 0.45

    def test_attempts_of_other_models_never_reach_the_curve_or_the_labels(self, db, ana):
        add(db, 0.9, modelo="a", esperado="desconocido")
        result = summary(db, active_model="b")
        assert result.etiquetados == 0
        assert point(result, 0.5).coincidencias == 0


class TestPerDay:
    def test_it_lists_the_last_14_days_oldest_first_ending_today(self, db):
        days = summary(db).por_dia
        assert len(days) == 14
        assert days[-1].fecha.isoformat() == "2026-09-20"
        assert days[0].fecha.isoformat() == "2026-09-07"
        assert [d.fecha for d in days] == sorted(d.fecha for d in days)

    def test_hits_and_rejections_are_counted_on_their_day(self, db):
        add(db, 0.9, creado=NOW)
        add(db, 0.1, creado=NOW)
        add(db, 0.1, creado=NOW - timedelta(days=2))
        days = {d.fecha.isoformat(): d for d in summary(db).por_dia}
        assert (days["2026-09-20"].coincidencias, days["2026-09-20"].rechazos) == (1, 1)
        assert (days["2026-09-18"].coincidencias, days["2026-09-18"].rechazos) == (0, 1)

    def test_attempts_older_than_the_window_are_left_out(self, db):
        add(db, 0.9, creado=NOW - timedelta(days=14))
        assert all(d.coincidencias == d.rechazos == 0 for d in summary(db).por_dia)

    def test_the_oldest_day_of_the_window_is_included(self, db):
        add(db, 0.9, creado=NOW - timedelta(days=13))
        days = summary(db).por_dia
        assert days[0].coincidencias == 1

    def test_the_offset_of_the_viewer_moves_the_cut_between_days(self, db):
        # 03:00 UTC on the 20th is 22:00 on the 19th in Peru (UTC-5)
        add(db, 0.9, creado=datetime(2026, 9, 20, 3, 0, tzinfo=UTC))
        utc_days = {d.fecha.isoformat(): d for d in summary(db).por_dia}
        peru_days = {d.fecha.isoformat(): d for d in summary(db, offset_minutes=-300).por_dia}
        assert utc_days["2026-09-20"].coincidencias == 1
        assert peru_days["2026-09-19"].coincidencias == 1
        assert peru_days["2026-09-20"].coincidencias == 0

    def test_today_itself_depends_on_the_offset(self, db):
        late = datetime(2026, 9, 20, 23, 30, tzinfo=UTC)
        assert (
            summary(db, now=late, offset_minutes=120).por_dia[-1].fecha.isoformat() == "2026-09-21"
        )
        assert summary(db, now=late).por_dia[-1].fecha.isoformat() == "2026-09-20"

    def test_only_the_selected_model_is_counted(self, db):
        add(db, 0.9, modelo="a")
        add(db, 0.9, modelo="b")
        assert sum(d.coincidencias for d in summary(db, active_model="a").por_dia) == 1


def test_it_copes_with_thousands_of_attempts(db, ana):
    db.add_all(
        RecognitionLog(
            similitud=(i % 100) / 100,
            distancia=0.5,
            umbral=0.5,
            coincide=(i % 100) >= 50,
            modelo="m",
            probabilidad_calibrada=None,
            esperado="desconocido" if i % 3 == 0 else None,
            created_at=NOW,
        )
        for i in range(5000)
    )
    db.commit()
    result = summary(db)
    assert result.total_intentos == 5000
    assert result.etiquetados == 1667
    assert point(result, 0.0).coincidencias == 5000
