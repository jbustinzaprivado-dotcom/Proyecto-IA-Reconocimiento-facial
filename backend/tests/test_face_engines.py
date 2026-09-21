import importlib.util
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.core.config import Settings
from app.services.face_engines import (
    EMBEDDING_DIM,
    EngineUnavailableError,
    InsightFaceEngine,
    SFaceEngine,
    SimulatedEngine,
    build_engine,
)
from app.services.face_engines.base import DetectedFace, unit

BACKEND = Path(__file__).resolve().parents[1]
MODELS = Settings(_env_file=None).models_dir
_insightface = importlib.util.find_spec("insightface")
# Sample pictures that ship inside the insightface package: nothing is added to the project
SAMPLES = (
    Path(_insightface.origin).parent / "data" / "images"
    if _insightface and _insightface.origin
    else Path()
)
GROUP_PHOTO = SAMPLES / "t1.jpg"
SINGLE_FACE = SAMPLES / "Tom_Hanks_54745.png"

has_insightface_weights = any((MODELS / "insightface" / "buffalo_l").glob("*.onnx"))
has_sface_weights = all(
    (MODELS / "sface" / name).is_file()
    for name in ("face_detection_yunet_2023mar.onnx", "face_recognition_sface_2021dec.onnx")
)
has_samples = GROUP_PHOTO.is_file() and SINGLE_FACE.is_file()

real_insightface = pytest.mark.skipif(
    not (has_insightface_weights and has_samples),
    reason="faltan los pesos de InsightFace o las imágenes de muestra",
)
real_sface = pytest.mark.skipif(
    not (has_sface_weights and has_samples),
    reason="faltan los pesos de SFace o las imágenes de muestra",
)


def noise(seed: int, size: int = 64) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, 256, (size, size, 3), dtype=np.uint8)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b)


class TestUnit:
    def test_scales_a_vector_to_length_one(self):
        assert np.linalg.norm(unit(np.array([3.0, 4.0]))) == pytest.approx(1.0)

    def test_flattens_a_row_vector(self):
        assert unit(np.array([[3.0, 4.0]])).shape == (2,)

    def test_a_zero_vector_stays_zero_instead_of_dividing_by_zero(self):
        assert np.array_equal(unit(np.zeros(3)), np.zeros(3, dtype=np.float32))


class TestSimulatedEngine:
    engine = SimulatedEngine()

    def face(self, image: np.ndarray) -> DetectedFace:
        faces = self.engine.detect(image)
        assert len(faces) == 1
        return faces[0]

    def vector(self, image: np.ndarray) -> np.ndarray:
        return self.engine.embed(image, self.face(image))

    def test_it_is_named_and_has_the_threshold_of_the_pdf_example(self):
        assert self.engine.name == "simulated"
        assert self.engine.default_threshold == 0.75

    def test_the_whole_image_is_the_face(self):
        face = self.engine.detect(noise(1, 50)[:30])[0]
        assert face.box == (0, 0, 50, 30)
        assert face.score == 1.0

    def test_the_vector_has_512_numbers_and_unit_length(self):
        vector = self.vector(noise(1))
        assert vector.shape == (EMBEDDING_DIM,)
        assert vector.dtype == np.float32
        assert np.linalg.norm(vector) == pytest.approx(1.0, abs=1e-5)

    def test_the_same_image_always_gives_the_same_vector_even_in_a_new_engine(self):
        image = noise(1)
        other = SimulatedEngine()
        assert np.array_equal(self.vector(image), other.embed(image, other.detect(image)[0]))

    def test_the_same_image_matches_itself(self):
        assert cosine(self.vector(noise(1)), self.vector(noise(1))) == pytest.approx(1.0, abs=1e-5)

    def test_brightness_and_contrast_changes_still_match(self):
        image = noise(1)
        altered = np.clip(image.astype(np.float32) * 0.8 + 20, 0, 255).astype(np.uint8)
        assert cosine(self.vector(image), self.vector(altered)) > 0.95

    def test_unrelated_images_do_not_match(self):
        for other in range(2, 12):
            assert cosine(self.vector(noise(1)), self.vector(noise(other))) < 0.5

    def test_an_image_without_any_detail_has_no_face(self):
        assert self.engine.detect(np.full((64, 64, 3), 128, dtype=np.uint8)) == []


class TestBuildEngine:
    def settings(self, tmp_path: Path, engine: str, **extra) -> Settings:
        return Settings(_env_file=None, face_engine=engine, models_dir=tmp_path, **extra)

    def test_builds_the_simulated_engine(self, tmp_path):
        assert isinstance(build_engine(self.settings(tmp_path, "simulated")), SimulatedEngine)

    def test_without_weights_sface_is_unavailable_and_says_how_to_get_them(self, tmp_path):
        with pytest.raises(EngineUnavailableError) as info:
            build_engine(self.settings(tmp_path, "sface"))
        assert "download_models" in str(info.value)
        assert "face_recognition_sface_2021dec.onnx" in str(info.value)

    def test_without_weights_insightface_is_unavailable_and_says_how_to_get_them(self, tmp_path):
        with pytest.raises(EngineUnavailableError) as info:
            build_engine(self.settings(tmp_path, "insightface"))
        assert "buffalo_l" in str(info.value)
        assert "download_models" in str(info.value)

    def test_a_missing_insightface_folder_is_never_created_or_downloaded(self, tmp_path):
        with pytest.raises(EngineUnavailableError):
            InsightFaceEngine(tmp_path, "buffalo_l")
        assert list(tmp_path.iterdir()) == []

    def test_an_empty_insightface_folder_counts_as_missing_weights(self, tmp_path):
        (tmp_path / "insightface" / "buffalo_l").mkdir(parents=True)
        with pytest.raises(EngineUnavailableError):
            InsightFaceEngine(tmp_path, "buffalo_l")

    def test_one_sface_file_is_not_enough(self, tmp_path):
        folder = tmp_path / "sface"
        folder.mkdir()
        (folder / "face_detection_yunet_2023mar.onnx").write_bytes(b"x")
        with pytest.raises(EngineUnavailableError) as info:
            SFaceEngine(tmp_path)
        assert "face_recognition_sface_2021dec.onnx" in str(info.value)
        assert "face_detection_yunet_2023mar.onnx" not in str(info.value)


def check_real_engine(engine, dimension: int) -> None:
    group = cv2.imread(str(GROUP_PHOTO))
    single = cv2.imread(str(SINGLE_FACE))

    faces = engine.detect(group)
    assert len(faces) == 6
    assert all(0.0 < face.score <= 1.0 for face in faces)
    assert all(face.width > 0 and face.height > 0 for face in faces)
    assert len(engine.detect(single)) == 1
    assert engine.detect(np.full((200, 200, 3), 90, dtype=np.uint8)) == []

    first, second = faces[0], faces[1]
    vector = engine.embed(group, first)
    assert vector.shape == (dimension,)
    assert np.linalg.norm(vector) == pytest.approx(1.0, abs=1e-4)
    # The same face gives the same vector; another person's face does not
    assert cosine(vector, engine.embed(group, first)) == pytest.approx(1.0, abs=1e-4)
    assert cosine(vector, engine.embed(group, second)) < engine.default_threshold


@pytest.mark.real_models
class TestRealEngines:
    @real_insightface
    def test_insightface_finds_the_faces_and_builds_512_number_vectors(self):
        engine = InsightFaceEngine(MODELS, "buffalo_l")
        assert engine.name == "insightface-buffalo_l"
        check_real_engine(engine, 512)

    @real_sface
    def test_sface_finds_the_faces_and_builds_128_number_vectors(self):
        engine = SFaceEngine(MODELS)
        assert engine.name == "sface-2021dec"
        assert engine.default_threshold == 0.363
        check_real_engine(engine, 128)

    @real_insightface
    def test_the_same_person_in_a_different_photo_is_closer_than_a_stranger(self):
        engine = InsightFaceEngine(MODELS, "buffalo_l")
        group = cv2.imread(str(GROUP_PHOTO))
        first = engine.detect(group)[0]
        vector = engine.embed(group, first)
        # The same face, a bit darker and smaller, in another picture
        altered = cv2.resize((group * 0.8).astype(np.uint8), None, fx=0.75, fy=0.75)
        # Among the faces of the altered picture, the one where the first face now is
        center = (
            np.array([(first.box[0] + first.box[2]) / 2, (first.box[1] + first.box[3]) / 2]) * 0.75
        )
        again = min(
            engine.detect(altered),
            key=lambda face: np.linalg.norm(
                np.array([(face.box[0] + face.box[2]) / 2, (face.box[1] + face.box[3]) / 2])
                - center
            ),
        )
        stranger = engine.detect(group)[1]
        same = cosine(vector, engine.embed(altered, again))
        other = cosine(vector, engine.embed(group, stranger))
        assert same > other
