import numpy as np

from app.services.face_engines import DetectedFace


def face(size: int = 200, score: float = 0.99, at: tuple[int, int] = (0, 0)) -> DetectedFace:
    """A detection of a square face of `size` pixels, whose top left corner is at `at`."""
    left, top = at
    return DetectedFace(box=(left, top, left + size, top + size), score=score)


class FakeEngine:
    """An engine that reports the detections it was given and records what it was asked to embed.

    It lets the rules around the engine (one face, quality, thresholds) be tested without weights.
    """

    name = "fake"
    default_threshold = 0.5

    def __init__(self, faces: list[DetectedFace], vector: np.ndarray | None = None):
        self.faces = faces
        self.vector = np.array([1.0, 0.0, 0.0], dtype=np.float32) if vector is None else vector
        self.embedded: list[DetectedFace] = []

    def detect(self, image: np.ndarray) -> list[DetectedFace]:
        return list(self.faces)

    def embed(self, image: np.ndarray, face: DetectedFace) -> np.ndarray:
        self.embedded.append(face)
        return self.vector
