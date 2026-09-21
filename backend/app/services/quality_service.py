from dataclasses import dataclass

import cv2
import numpy as np

from app.core.config import Settings
from app.services.face_engines import DetectedFace

# Sharpness is measured on the face resized to this side, so it does not depend on how close the
# camera was
SHARPNESS_SIDE = 112

TOO_SMALL = "El rostro es muy pequeño. Acércate a la cámara."
TOO_BLURRY = "La imagen está borrosa. Mantén la cámara quieta y vuelve a intentarlo."
TOO_DARK = "La imagen está muy oscura. Busca más luz."
TOO_BRIGHT = "La imagen está muy iluminada. Evita la luz directa sobre el rostro."


@dataclass(frozen=True)
class QualityPolicy:
    min_face_size: int
    min_detection_score: float
    min_sharpness: float
    min_brightness: float
    max_brightness: float

    @classmethod
    def from_settings(cls, settings: Settings) -> "QualityPolicy":
        return cls(
            min_face_size=settings.min_face_size,
            min_detection_score=settings.min_detection_score,
            min_sharpness=settings.min_sharpness,
            min_brightness=settings.min_brightness,
            max_brightness=settings.max_brightness,
        )


def face_crop(image: np.ndarray, face: DetectedFace) -> np.ndarray:
    """The grey crop of the face, cut to the image. Empty when the box falls outside of it."""
    height, width = image.shape[:2]
    left, top, right, bottom = face.box
    crop = image[max(top, 0) : min(bottom, height), max(left, 0) : min(right, width)]
    if crop.size == 0:
        return np.empty((0, 0), dtype=np.uint8)
    return cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)


def sharpness(grey: np.ndarray) -> float:
    """Variance of the Laplacian divided by the variance of the pixels: high for a crisp face and
    low for a blurred one, and it does not fall just because the picture is dark (a dark picture
    has little contrast, which alone would make the plain Laplacian variance look blurred)."""
    resized = cv2.resize(grey, (SHARPNESS_SIDE, SHARPNESS_SIDE), interpolation=cv2.INTER_AREA)
    contrast = float(resized.var())
    if contrast == 0.0:
        return 0.0
    return float(cv2.Laplacian(resized, cv2.CV_64F).var()) / contrast


def is_big_enough(face: DetectedFace, policy: QualityPolicy) -> bool:
    return min(face.width, face.height) >= policy.min_face_size


@dataclass(frozen=True)
class FaceMeasurements:
    """What was measured on a face: numbers that are kept with each attempt for the analysis."""

    # The smaller side of the face box, in pixels
    tamano: int
    # How sure the detector was that it is a face, from 0 to 1
    confianza: float
    # Empty when the box falls outside the image
    nitidez: float | None
    brillo: float | None


def measure(image: np.ndarray, face: DetectedFace) -> FaceMeasurements:
    grey = face_crop(image, face)
    size = min(face.width, face.height)
    if grey.size == 0:
        return FaceMeasurements(tamano=size, confianza=face.score, nitidez=None, brillo=None)
    return FaceMeasurements(
        tamano=size,
        confianza=face.score,
        nitidez=sharpness(grey),
        brillo=float(grey.mean()),
    )


def problems_from(measurements: FaceMeasurements, policy: QualityPolicy) -> list[str]:
    """Every quality check the face fails, as messages for the user. Empty when it is usable."""
    if (
        measurements.tamano < policy.min_face_size
        or measurements.nitidez is None
        or measurements.brillo is None
    ):
        # A tiny face upscaled always looks blurred: the other checks would only add noise
        return [TOO_SMALL]

    problems = []
    if measurements.nitidez < policy.min_sharpness:
        problems.append(TOO_BLURRY)
    if measurements.brillo < policy.min_brightness:
        problems.append(TOO_DARK)
    elif measurements.brillo > policy.max_brightness:
        problems.append(TOO_BRIGHT)
    return problems


def problems_with(image: np.ndarray, face: DetectedFace, policy: QualityPolicy) -> list[str]:
    return problems_from(measure(image, face), policy)
