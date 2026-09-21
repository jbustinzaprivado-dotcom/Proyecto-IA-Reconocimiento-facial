from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np


class EngineUnavailableError(Exception):
    """The engine cannot run here: no weights, no package or a model that will not load."""


class FaceRejectedError(Exception):
    """The image cannot be used: no face, several faces or a face of poor quality.

    The message is written for the user and is shown as it is.
    """


@dataclass(frozen=True)
class DetectedFace:
    # Left, top, right and bottom in pixels of the original image
    box: tuple[int, int, int, int]
    score: float
    # What the engine needs to build the embedding of this face; opaque to everyone else
    raw: Any = None

    @property
    def width(self) -> int:
        return self.box[2] - self.box[0]

    @property
    def height(self) -> int:
        return self.box[3] - self.box[1]


class FaceEngine(Protocol):
    """Finds faces and turns one of them into a vector. Every real engine has this same shape."""

    # Saved with every vector: vectors of different models cannot be compared
    name: str
    # Similarity from which two vectors count as the same person. Each model has its own scale
    default_threshold: float

    def detect(self, image: np.ndarray) -> list[DetectedFace]:
        """Every face found in the BGR image, with a score between 0 and 1."""
        ...

    def embed(self, image: np.ndarray, face: DetectedFace) -> np.ndarray:
        """The unit vector of one face returned by `detect` for this same image."""
        ...


def unit(vector: np.ndarray) -> np.ndarray:
    flat = np.asarray(vector, dtype=np.float32).ravel()
    norm = float(np.linalg.norm(flat))
    return flat if norm == 0 else flat / norm
