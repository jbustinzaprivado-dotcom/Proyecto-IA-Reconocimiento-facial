"""The two scores from 0 to 1 that the probability model receives besides the similarity.

The PDF (section 7) gives "Alta" and "Buena" as examples of illumination and image quality, and does
not say how they are worked out (doubt 8). Here they are made from what is measured on every face.
They are provisional: nobody has checked yet that they are what best tells a good picture from a bad
one, and they are fixed on purpose so that records already made do not change meaning.
"""

from app.core.constants import (
    FACE_SIZE_GOOD,
    ILLUMINATION_CENTER,
    ILLUMINATION_HALF_RANGE,
    SHARPNESS_GOOD,
)


def clip01(value: float) -> float:
    return max(0.0, min(1.0, value))


def illumination_score(brightness: float) -> float:
    """1 with the average grey in the middle of the range, falling to 0 at the edges (40 and 220 by
    default, which are also where the quality check starts to refuse the picture)."""
    return clip01(1 - abs(brightness - ILLUMINATION_CENTER) / ILLUMINATION_HALF_RANGE)


def quality_score(sharpness: float, face_size: int, detection_score: float) -> float:
    """The average of three parts, each one brought to 0 to 1: how sharp the face is, how big it is
    and how sure the detector was."""
    parts = (
        clip01(sharpness / SHARPNESS_GOOD),
        clip01(face_size / FACE_SIZE_GOOD),
        clip01(detection_score),
    )
    return sum(parts) / len(parts)
