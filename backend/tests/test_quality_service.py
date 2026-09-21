import cv2
import numpy as np
import pytest

from app.core.config import Settings
from app.services import quality_service as quality
from app.services.face_engines import DetectedFace

POLICY = quality.QualityPolicy(
    min_face_size=80,
    min_detection_score=0.5,
    min_sharpness=0.02,
    min_brightness=40.0,
    max_brightness=220.0,
)


def noise(seed: int = 1, size: int = 200) -> np.ndarray:
    grey = np.random.default_rng(seed).integers(0, 256, (size, size), dtype=np.uint8)
    return cv2.cvtColor(grey, cv2.COLOR_GRAY2BGR)


def soft(size: int = 200) -> np.ndarray:
    """A smooth gradient: no detail at all, like a badly blurred picture."""
    grey = np.tile(np.linspace(0, 255, size, dtype=np.uint8), (size, 1))
    return cv2.cvtColor(grey, cv2.COLOR_GRAY2BGR)


def whole(image: np.ndarray) -> DetectedFace:
    height, width = image.shape[:2]
    return DetectedFace(box=(0, 0, width, height), score=0.99)


class TestPolicy:
    def test_it_takes_its_values_from_the_settings(self):
        settings = Settings(
            _env_file=None,
            min_face_size=100,
            min_detection_score=0.7,
            min_sharpness=0.05,
            min_brightness=30,
            max_brightness=200,
        )
        policy = quality.QualityPolicy.from_settings(settings)
        assert (policy.min_face_size, policy.min_detection_score) == (100, 0.7)
        assert (policy.min_sharpness, policy.min_brightness, policy.max_brightness) == (
            0.05,
            30,
            200,
        )


class TestSharpness:
    def test_a_picture_with_detail_is_far_above_the_default_limit(self):
        assert quality.sharpness(noise()[:, :, 0]) > 1.0

    def test_a_picture_without_detail_is_far_below_it(self):
        assert quality.sharpness(soft()[:, :, 0]) < 0.001

    def test_a_flat_picture_is_zero_instead_of_dividing_by_zero(self):
        assert quality.sharpness(np.full((100, 100), 100, dtype=np.uint8)) == 0.0

    def test_blurring_lowers_it_step_by_step(self):
        grey = noise()[:, :, 0]
        values = [quality.sharpness(cv2.GaussianBlur(grey, (0, 0), s)) for s in (1, 2, 3)]
        assert quality.sharpness(grey) > values[0] > values[1] > values[2]

    def test_darkening_a_picture_does_not_make_it_look_blurred(self):
        grey = noise()[:, :, 0]
        dark = (grey * 0.1).astype(np.uint8)
        assert quality.sharpness(dark) == pytest.approx(quality.sharpness(grey), rel=0.2)

    def test_crops_of_any_size_are_measured_on_the_same_side(self):
        small = noise(size=120)[:, :, 0]
        big = cv2.resize(small, (480, 480), interpolation=cv2.INTER_NEAREST)
        assert quality.sharpness(big) > 1.0
        assert quality.sharpness(small) > 1.0


class TestFaceCrop:
    def test_cuts_the_box_and_makes_it_grey(self):
        image = noise()
        crop = quality.face_crop(image, DetectedFace(box=(10, 20, 60, 100), score=0.9))
        assert crop.shape == (80, 50)

    def test_a_box_partly_outside_the_image_is_cut_to_it(self):
        crop = quality.face_crop(noise(), DetectedFace(box=(-30, -30, 50, 50), score=0.9))
        assert crop.shape == (50, 50)

    def test_a_box_fully_outside_the_image_gives_nothing(self):
        crop = quality.face_crop(noise(), DetectedFace(box=(500, 500, 600, 600), score=0.9))
        assert crop.size == 0


class TestMeasurements:
    def test_the_measures_of_a_face_are_the_size_the_score_and_what_the_crop_looks_like(self):
        image = noise()
        face = DetectedFace(box=(10, 20, 110, 170), score=0.87)
        measurements = quality.measure(image, face)
        assert measurements.tamano == 100
        assert measurements.confianza == 0.87
        assert measurements.nitidez == pytest.approx(
            quality.sharpness(quality.face_crop(image, face))
        )
        assert measurements.brillo == pytest.approx(float(quality.face_crop(image, face).mean()))

    def test_a_box_outside_the_image_has_no_sharpness_or_brightness(self):
        measurements = quality.measure(noise(), DetectedFace(box=(500, 500, 600, 600), score=0.9))
        assert measurements.tamano == 100
        assert measurements.nitidez is None
        assert measurements.brillo is None

    def test_the_checks_are_worked_out_from_the_measures_alone(self):
        good = quality.FaceMeasurements(tamano=100, confianza=0.9, nitidez=1.0, brillo=120.0)
        assert quality.problems_from(good, POLICY) == []
        blurry = quality.FaceMeasurements(tamano=100, confianza=0.9, nitidez=0.001, brillo=120.0)
        assert quality.problems_from(blurry, POLICY) == [quality.TOO_BLURRY]
        small = quality.FaceMeasurements(tamano=79, confianza=0.9, nitidez=1.0, brillo=120.0)
        assert quality.problems_from(small, POLICY) == [quality.TOO_SMALL]

    def test_a_measure_that_could_not_be_taken_counts_as_too_small(self):
        nothing = quality.FaceMeasurements(tamano=100, confianza=0.9, nitidez=None, brillo=None)
        assert quality.problems_from(nothing, POLICY) == [quality.TOO_SMALL]

    def test_a_missing_sharpness_alone_is_enough_to_count_as_too_small(self):
        no_sharpness = quality.FaceMeasurements(
            tamano=100, confianza=0.9, nitidez=None, brillo=120.0
        )
        assert quality.problems_from(no_sharpness, POLICY) == [quality.TOO_SMALL]
        no_brightness = quality.FaceMeasurements(
            tamano=100, confianza=0.9, nitidez=1.0, brillo=None
        )
        assert quality.problems_from(no_brightness, POLICY) == [quality.TOO_SMALL]

    def test_the_two_ways_to_check_a_face_agree(self):
        for image in (noise(), soft(), (noise() * 0.1).astype(np.uint8)):
            face = whole(image)
            assert quality.problems_with(image, face, POLICY) == quality.problems_from(
                quality.measure(image, face), POLICY
            )


class TestMessages:
    def test_each_problem_has_its_own_message_in_spanish(self):
        assert quality.TOO_SMALL == "El rostro es muy pequeño. Acércate a la cámara."
        assert quality.TOO_BLURRY == (
            "La imagen está borrosa. Mantén la cámara quieta y vuelve a intentarlo."
        )
        assert quality.TOO_DARK == "La imagen está muy oscura. Busca más luz."
        assert quality.TOO_BRIGHT == (
            "La imagen está muy iluminada. Evita la luz directa sobre el rostro."
        )


class TestProblems:
    def test_a_sharp_well_lit_face_has_no_problems(self):
        image = noise()
        assert quality.problems_with(image, whole(image), POLICY) == []

    def test_a_small_face_is_told_to_come_closer(self):
        image = noise()
        face = DetectedFace(box=(0, 0, 60, 60), score=0.9)
        assert quality.problems_with(image, face, POLICY) == [quality.TOO_SMALL]

    def test_the_size_limit_is_inclusive_and_uses_the_smaller_side(self):
        image = noise()
        assert quality.problems_with(image, DetectedFace((0, 0, 80, 150), 0.9), POLICY) == []
        assert quality.problems_with(image, DetectedFace((0, 0, 79, 150), 0.9), POLICY) == [
            quality.TOO_SMALL
        ]
        assert quality.problems_with(image, DetectedFace((0, 0, 150, 79), 0.9), POLICY) == [
            quality.TOO_SMALL
        ]

    def test_a_small_face_gets_only_that_message_even_if_it_is_dark_too(self):
        image = (noise() * 0.05).astype(np.uint8)
        face = DetectedFace(box=(0, 0, 60, 60), score=0.9)
        assert quality.problems_with(image, face, POLICY) == [quality.TOO_SMALL]

    def test_a_box_outside_the_image_counts_as_too_small(self):
        face = DetectedFace(box=(500, 500, 700, 700), score=0.9)
        assert quality.problems_with(noise(), face, POLICY) == [quality.TOO_SMALL]

    def test_a_blurred_face_is_told_to_hold_still(self):
        image = soft()
        # The gradient has a good average brightness, so blur is the only problem
        assert quality.problems_with(image, whole(image), POLICY) == [quality.TOO_BLURRY]

    def test_a_dark_face_is_told_to_find_more_light_and_not_that_it_is_blurred(self):
        image = (noise() * 0.1).astype(np.uint8)
        assert quality.problems_with(image, whole(image), POLICY) == [quality.TOO_DARK]

    def test_an_overexposed_face_is_told_to_avoid_direct_light(self):
        image = np.clip(noise().astype(np.float32) * 0.2 + 215, 0, 255).astype(np.uint8)
        assert quality.problems_with(image, whole(image), POLICY) == [quality.TOO_BRIGHT]

    def test_every_problem_is_reported_at_once(self):
        image = (soft() * 0.1).astype(np.uint8)
        assert quality.problems_with(image, whole(image), POLICY) == [
            quality.TOO_BLURRY,
            quality.TOO_DARK,
        ]

    def test_the_brightness_limits_are_inclusive(self):
        low = np.full((200, 200, 3), 40, dtype=np.uint8)
        high = np.full((200, 200, 3), 220, dtype=np.uint8)
        # Flat pictures are also blurred: only the brightness message matters here
        assert quality.TOO_DARK not in quality.problems_with(low, whole(low), POLICY)
        assert quality.TOO_BRIGHT not in quality.problems_with(high, whole(high), POLICY)
        just_low = np.full((200, 200, 3), 39, dtype=np.uint8)
        just_high = np.full((200, 200, 3), 221, dtype=np.uint8)
        assert quality.TOO_DARK in quality.problems_with(just_low, whole(just_low), POLICY)
        assert quality.TOO_BRIGHT in quality.problems_with(just_high, whole(just_high), POLICY)

    def test_the_limits_come_from_the_policy(self):
        image = noise()
        strict = quality.QualityPolicy(
            min_face_size=300,
            min_detection_score=0.5,
            min_sharpness=1000.0,
            min_brightness=200.0,
            max_brightness=210.0,
        )
        assert quality.problems_with(image, whole(image), strict) == [quality.TOO_SMALL]
        big = noise(size=400)
        problems = quality.problems_with(big, whole(big), strict)
        assert set(problems) == {quality.TOO_BLURRY, quality.TOO_DARK}
