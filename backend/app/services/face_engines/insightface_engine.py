import threading
from pathlib import Path

import numpy as np

from app.core.constants import DETECTION_FLOOR
from app.services.face_engines.base import DetectedFace, EngineUnavailableError, unit

DOWNLOAD_HINT = "Ejecuta: python -m app.scripts.download_models"


def model_dir(models_dir: Path, model: str) -> Path:
    return models_dir / "insightface" / model


class InsightFaceEngine:
    """ArcFace embeddings with the SCRFD detector, through InsightFace and ONNX Runtime on CPU.

    The pretrained models are for non-commercial research only (see the README).
    """

    # Provisional starting point, not measured: it is replaced when the threshold is calibrated
    default_threshold = 0.40

    def __init__(self, models_dir: Path, model: str = "buffalo_l") -> None:
        directory = model_dir(models_dir, model)
        # FaceAnalysis downloads the model on its own when the folder is missing: check first
        if not directory.is_dir() or not list(directory.glob("*.onnx")):
            raise EngineUnavailableError(
                f"Faltan los pesos de InsightFace «{model}» en {directory}. {DOWNLOAD_HINT}"
            )
        try:
            from insightface.app import FaceAnalysis
        except ImportError as error:
            raise EngineUnavailableError(
                "InsightFace no está instalado. "
                "Ejecuta: pip install --no-deps -r requirements-insightface.txt"
            ) from error

        self.name = f"insightface-{model}"
        # Only detection and recognition: the other models of the pack are not needed
        analysis = FaceAnalysis(
            name=str(directory),
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        analysis.prepare(ctx_id=-1, det_thresh=DETECTION_FLOOR)
        self._detector = analysis.det_model
        self._recognizer = analysis.models["recognition"]
        # ONNX Runtime sessions are shared by every request: one at a time
        self._lock = threading.Lock()

    def detect(self, image: np.ndarray) -> list[DetectedFace]:
        from insightface.app.common import Face

        with self._lock:
            boxes, landmarks = self._detector.detect(image, max_num=0, metric="default")
        faces = []
        for index in range(boxes.shape[0]):
            x1, y1, x2, y2, score = (float(value) for value in boxes[index, :5])
            raw = Face(
                bbox=boxes[index, :4],
                kps=None if landmarks is None else landmarks[index],
                det_score=score,
            )
            faces.append(
                DetectedFace(box=(round(x1), round(y1), round(x2), round(y2)), score=score, raw=raw)
            )
        return faces

    def embed(self, image: np.ndarray, face: DetectedFace) -> np.ndarray:
        with self._lock:
            self._recognizer.get(image, face.raw)
        return unit(face.raw.embedding)
