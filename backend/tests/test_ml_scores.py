import pytest

from app.services.ml_scores import clip01, illumination_score, quality_score


@pytest.mark.parametrize(
    ("brightness", "expected"),
    [(130, 1.0), (40, 0.0), (220, 0.0), (85, 0.5), (175, 0.5), (0, 0.0), (255, 0.0)],
)
def test_illumination_is_best_in_the_middle_and_zero_where_the_quality_check_starts_to_refuse(
    brightness, expected
):
    assert illumination_score(brightness) == pytest.approx(expected)


def test_illumination_is_the_same_on_both_sides_of_the_middle():
    assert illumination_score(100) == pytest.approx(illumination_score(160))


def test_a_sharp_big_and_sure_face_is_worth_one():
    assert quality_score(0.10, 200, 1.0) == pytest.approx(1.0)


def test_better_than_good_does_not_count_for_more_than_one():
    assert quality_score(0.5, 1000, 1.0) == pytest.approx(1.0)


def test_a_face_with_nothing_going_for_it_is_worth_zero():
    assert quality_score(0.0, 0, 0.0) == 0.0


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        ((0.05, 100, 0.5), 0.5),
        ((0.10, 0, 0.0), 1 / 3),
        ((0.0, 200, 0.0), 1 / 3),
        ((0.0, 0, 1.0), 1 / 3),
        ((0.02, 80, 0.5), (0.2 + 0.4 + 0.5) / 3),
    ],
)
def test_the_score_is_the_average_of_sharpness_size_and_detection(args, expected):
    assert quality_score(*args) == pytest.approx(expected)


def test_clip_keeps_a_value_between_zero_and_one():
    assert clip01(-0.5) == 0.0
    assert clip01(0.3) == 0.3
    assert clip01(7.0) == 1.0
