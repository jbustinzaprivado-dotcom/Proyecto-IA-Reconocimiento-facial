import cv2
import numpy as np

from app.services.face_engines.base import DetectedFace, unit

EMBEDDING_DIM = 512
THUMBNAIL_SIZE = 16
# Fixed, so that the same image always gives the same vector, also after a restart
PROJECTION_SEED = 20260920


class SimulatedEngine:
    """A stand-in that does NOT recognize faces.

    It shrinks the image to a grey thumbnail and projects it to a fixed vector, so the same photo
    (or the same photo with other brightness or contrast) gives a matching vector and unrelated
    images do not. The whole image counts as one face, except an image without detail.
    """

    name = "simulated"
    default_threshold = 0.75

    def __init__(self) -> None:
        rng = np.random.default_rng(PROJECTION_SEED)
        self._projection = rng.standard_normal((THUMBNAIL_SIZE**2, EMBEDDING_DIM)).astype(
            np.float32
        )

    def _thumbnail(self, image: np.ndarray) -> np.ndarray:
        grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        small = cv2.resize(grey, (THUMBNAIL_SIZE, THUMBNAIL_SIZE), interpolation=cv2.INTER_AREA)
        return small.astype(np.float32).ravel()

    def detect(self, image: np.ndarray) -> list[DetectedFace]:
        # A vector cannot be built from an image with no detail (a single colour)
        if float(np.ptp(self._thumbnail(image))) == 0.0:
            return []
        height, width = image.shape[:2]
        return [DetectedFace(box=(0, 0, width, height), score=1.0)]

    def embed(self, image: np.ndarray, face: DetectedFace) -> np.ndarray:
        thumbnail = self._thumbnail(image)
        # Centering makes the vector ignore the overall brightness of the photo
        return unit((thumbnail - thumbnail.mean()) @ self._projection)
