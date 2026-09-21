import threading
from pathlib import Path

import cv2
import numpy as np

from app.core.constants import DETECTION_FLOOR
from app.services.face_engines.base import DetectedFace, EngineUnavailableError, unit

DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"
DOWNLOAD_HINT = "Ejecuta: python -m app.scripts.download_models --engine sface"
# YuNet: overlap above which two detections count as the same face, and how many it keeps
NMS_THRESHOLD = 0.3
TOP_K = 5000


def model_dir(models_dir: Path) -> Path:
    return models_dir / "sface"


class SFaceEngine:
    """SFace embeddings with the YuNet detector, both from OpenCV: no extra packages.

    YuNet is MIT and SFace is Apache-2.0.
    """

    name = "sface-2021dec"
    # OpenCV's own recommended cosine threshold for SFace. Not calibrated with our data
    default_threshold = 0.363

    def __init__(self, models_dir: Path) -> None:
        directory = model_dir(models_dir)
        missing = [
            name for name in (DETECTOR_FILE, RECOGNIZER_FILE) if not (directory / name).is_file()
        ]
        if missing:
            raise EngineUnavailableError(
                f"Faltan los pesos de SFace ({', '.join(missing)}) en {directory}. {DOWNLOAD_HINT}"
            )
        self._detector = cv2.FaceDetectorYN.create(
            str(directory / DETECTOR_FILE), "", (320, 320), DETECTION_FLOOR, NMS_THRESHOLD, TOP_K
        )
        self._recognizer = cv2.FaceRecognizerSF.create(str(directory / RECOGNIZER_FILE), "")
        # The OpenCV networks keep state between calls: one request at a time
        self._lock = threading.Lock()

    def detect(self, image: np.ndarray) -> list[DetectedFace]:
        height, width = image.shape[:2]
        with self._lock:
            self._detector.setInputSize((width, height))
            _, rows = self._detector.detect(image)
        if rows is None:
            return []
        faces = []
        for row in rows:
            x, y, w, h = (float(value) for value in row[:4])
            faces.append(
                DetectedFace(
                    box=(round(x), round(y), round(x + w), round(y + h)),
                    score=float(row[14]),
                    raw=row,
                )
            )
        return faces

    def embed(self, image: np.ndarray, face: DetectedFace) -> np.ndarray:
        with self._lock:
            aligned = self._recognizer.alignCrop(image, face.raw)
            feature = self._recognizer.feature(aligned)
        return unit(feature)
