from app.core.config import Settings
from app.services.face_engines.base import (
    DetectedFace,
    EngineUnavailableError,
    FaceEngine,
    FaceRejectedError,
)
from app.services.face_engines.insightface_engine import InsightFaceEngine
from app.services.face_engines.sface_engine import SFaceEngine
from app.services.face_engines.simulated import EMBEDDING_DIM, SimulatedEngine

__all__ = [
    "EMBEDDING_DIM",
    "DetectedFace",
    "EngineUnavailableError",
    "FaceEngine",
    "FaceRejectedError",
    "InsightFaceEngine",
    "SFaceEngine",
    "SimulatedEngine",
    "build_engine",
]


def build_engine(settings: Settings) -> FaceEngine:
    """Create the engine chosen by FACE_ENGINE. Raises EngineUnavailableError if it cannot run."""
    if settings.face_engine == "simulated":
        return SimulatedEngine()
    if settings.face_engine == "sface":
        return SFaceEngine(settings.models_dir)
    return InsightFaceEngine(settings.models_dir, settings.insightface_model)
