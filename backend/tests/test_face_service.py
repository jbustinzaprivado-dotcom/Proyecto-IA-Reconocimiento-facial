import io

import cv2
import numpy as np
import pytest
from fastapi import UploadFile

from app.core.errors import ApiException
from app.services import face_service
from app.services.face_engines import FaceRejectedError
from app.services.face_service import extract_embedding, image_size, read_image
from app.services.quality_service import QualityPolicy
from tests.fakes import FakeEngine, face

MB = 1024 * 1024


def upload(data: bytes, filename: str = "foto.png") -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename=filename)


def noise(seed: int, size: int = 64) -> np.ndarray:
    return np.random.default_rng(seed).integers(0, 256, (size, size, 3), dtype=np.uint8)


class TestImageSize:
    def test_reads_the_size_of_a_png_without_decoding_it(self):
        ok, encoded = cv2.imencode(".png", np.zeros((30, 50, 3), np.uint8))
        assert ok
        assert image_size(encoded.tobytes()) == (50, 30)

    def test_reads_the_size_of_a_jpeg(self):
        ok, encoded = cv2.imencode(".jpg", noise(1, 48))
        assert ok
        assert image_size(encoded.tobytes()) == (48, 48)

    def test_reads_the_size_of_a_non_square_jpeg(self):
        ok, encoded = cv2.imencode(".jpg", np.zeros((30, 50, 3), np.uint8))
        assert ok
        assert image_size(encoded.tobytes()) == (50, 30)

    def test_a_truncated_png_has_no_size(self):
        assert image_size(b"\x89PNG\r\n\x1a\n" + b"\x00" * 5) is None

    def test_a_jpeg_without_a_frame_header_has_no_size(self):
        assert image_size(b"\xff\xd8\xff\xe0\x00\x02") is None


class TestReadImage:
    def test_decodes_a_png(self, make_image):
        image = read_image(upload(make_image(1)), 5 * MB)
        assert image.shape == (160, 160, 3)

    def test_decodes_a_jpeg(self, make_image):
        image = read_image(upload(make_image(1, ".jpg"), "foto.jpg"), 5 * MB)
        assert image.shape == (160, 160, 3)

    def test_a_file_over_the_limit_is_413_with_its_name_and_the_limit(self):
        with pytest.raises(ApiException) as info:
            read_image(upload(b"\x00" * (5 * MB + 1), "grande.png"), 5 * MB)
        assert info.value.message == "La imagen «grande.png» pesa más de 5 MB."

    def test_a_file_exactly_at_the_limit_is_not_too_big(self, make_image):
        data = make_image(1)
        assert read_image(upload(data), len(data)).shape == (160, 160, 3)

    def test_a_file_one_byte_over_the_limit_is_too_big(self, make_image):
        data = make_image(1)
        with pytest.raises(ApiException) as info:
            read_image(upload(data), len(data) - 1)
        assert info.value.status_code == 413

    def test_the_type_is_judged_by_the_bytes_not_by_the_name(self):
        with pytest.raises(ApiException) as info:
            read_image(upload(b"GIF89a-no-soy-jpeg", "engano.jpg"), 5 * MB)
        assert info.value.status_code == 415
        assert info.value.message == "La imagen «engano.jpg» debe ser JPEG o PNG."

    def test_a_png_with_the_wrong_extension_is_accepted(self, make_image):
        assert read_image(upload(make_image(1), "foto.txt"), 5 * MB) is not None

    def test_an_empty_file_is_refused_as_a_wrong_type(self):
        with pytest.raises(ApiException) as info:
            read_image(upload(b"", "vacio.png"), 5 * MB)
        assert info.value.status_code == 415

    def test_a_truncated_png_is_400(self, make_image):
        with pytest.raises(ApiException) as info:
            read_image(upload(make_image(1)[:40], "cortada.png"), 5 * MB)
        assert info.value.status_code == 400
        assert info.value.message == "No se pudo leer la imagen «cortada.png»."

    def test_a_png_with_a_valid_header_but_broken_data_is_400(self, make_image):
        data = make_image(1)
        broken = data[:33] + b"\x00" * (len(data) - 33)
        with pytest.raises(ApiException) as info:
            read_image(upload(broken, "rota.png"), 5 * MB)
        assert info.value.status_code == 400

    def test_a_truncated_jpeg_is_400(self):
        with pytest.raises(ApiException) as info:
            read_image(upload(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00", "cortada.jpg"), 5 * MB)
        assert info.value.status_code == 400

    def test_a_small_file_that_expands_into_a_huge_image_is_refused_before_decoding(self):
        ok, encoded = cv2.imencode(".png", np.zeros((6000, 6000), np.uint8))
        assert ok and len(encoded) < 5 * MB
        with pytest.raises(ApiException) as info:
            read_image(upload(encoded.tobytes(), "bomba.png"), 5 * MB)
        assert info.value.status_code == 413
        assert (
            info.value.message == "La imagen «bomba.png» tiene demasiados píxeles (máximo 25 MP)."
        )

    def test_an_image_of_zero_size_is_400(self):
        header = (
            b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 8 + b"\x08\x02\x00\x00\x00"
        )
        with pytest.raises(ApiException) as info:
            read_image(upload(header, "cero.png"), 5 * MB)
        assert info.value.status_code == 400

    def test_a_missing_file_name_is_not_invented(self):
        with pytest.raises(ApiException) as info:
            read_image(UploadFile(file=io.BytesIO(b"xx"), filename=None), 5 * MB)
        assert info.value.message == "La imagen debe ser JPEG o PNG."

    def test_the_position_is_named_and_the_name_only_when_it_is_a_real_one(self):
        cases = [
            ("engano.jpg", 2, "La imagen 2 «engano.jpg» debe ser JPEG o PNG."),
            ("blob", 3, "La imagen 3 debe ser JPEG o PNG."),
            ("", 1, "La imagen 1 debe ser JPEG o PNG."),
            ("blob", None, "La imagen debe ser JPEG o PNG."),
        ]
        for name, position, expected in cases:
            with pytest.raises(ApiException) as info:
                read_image(upload(b"no soy imagen", name), 5 * MB, position)
            assert info.value.message == expected

    def test_every_size_and_reading_error_uses_the_same_way_of_naming_the_image(self):
        with pytest.raises(ApiException) as too_big:
            read_image(upload(b"\x00" * (MB + 1), "blob"), MB, 2)
        assert too_big.value.message == "La imagen 2 pesa más de 1 MB."
        with pytest.raises(ApiException) as unreadable:
            read_image(
                upload(bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), "blob"), MB, 3
            )
        assert unreadable.value.message == "No se pudo leer la imagen 3."


POLICY = QualityPolicy(
    min_face_size=80,
    min_detection_score=0.5,
    min_sharpness=0.02,
    min_brightness=40.0,
    max_brightness=220.0,
)
PICTURE = noise(1, 400)


class TestAnalyzeFace:
    def test_the_vector_comes_with_what_was_measured_on_the_face(self):
        wanted = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        engine = FakeEngine([face(size=200, score=0.93)], vector=wanted)
        result = face_service.analyze_face(engine, PICTURE, POLICY)
        assert np.array_equal(result.vector, wanted)
        assert result.measurements.tamano == 200
        assert result.measurements.confianza == 0.93
        assert result.measurements.nitidez > 1.0
        assert 100 < result.measurements.brillo < 155

    def test_extracting_only_the_vector_gives_the_same_vector(self):
        engine = FakeEngine([face(size=200)])
        assert np.array_equal(
            extract_embedding(engine, PICTURE, POLICY),
            face_service.analyze_face(engine, PICTURE, POLICY).vector,
        )

    def test_a_refused_face_gives_no_measurements_either(self):
        with pytest.raises(FaceRejectedError):
            face_service.analyze_face(FakeEngine([]), PICTURE, POLICY)

    def test_the_measures_are_those_of_the_face_that_was_used_and_not_of_a_tiny_one(self):
        engine = FakeEngine([face(size=200, score=0.9), face(size=40, score=0.99, at=(300, 300))])
        assert face_service.analyze_face(engine, PICTURE, POLICY).measurements.confianza == 0.9


class TestExtractEmbedding:
    def rejected(self, engine: FakeEngine, image: np.ndarray = PICTURE) -> str:
        with pytest.raises(FaceRejectedError) as info:
            extract_embedding(engine, image, POLICY)
        assert engine.embedded == [], "no vector may be made from a rejected image"
        return str(info.value)

    def test_one_good_face_gives_the_vector_of_that_face(self):
        wanted = np.array([0.0, 1.0, 0.0], dtype=np.float32)
        engine = FakeEngine([face(size=200)], vector=wanted)
        assert np.array_equal(extract_embedding(engine, PICTURE, POLICY), wanted)
        assert engine.embedded == [engine.faces[0]]

    def test_no_face_is_refused(self):
        assert self.rejected(FakeEngine([])) == face_service.NO_FACE

    def test_two_faces_are_refused_and_counted(self):
        engine = FakeEngine([face(at=(0, 0)), face(at=(200, 0))])
        assert (
            self.rejected(engine) == "Se detectaron 2 rostros. Envía una foto con una sola persona."
        )

    def test_three_faces_are_counted_as_three(self):
        engine = FakeEngine([face(at=(0, 0)), face(at=(100, 0)), face(at=(200, 0))])
        assert "Se detectaron 3 rostros" in self.rejected(engine)

    def test_only_the_faces_that_count_are_counted(self):
        engine = FakeEngine(
            [face(at=(0, 0)), face(at=(200, 0)), face(score=0.4, at=(0, 200)), face(size=30)]
        )
        assert "Se detectaron 2 rostros" in self.rejected(engine)

    def test_a_weak_detection_is_not_another_person(self):
        engine = FakeEngine([face(score=0.99), face(score=0.4, at=(200, 0))])
        assert extract_embedding(engine, PICTURE, POLICY) is not None
        assert engine.embedded == [engine.faces[0]]

    def test_a_tiny_detection_is_not_another_person(self):
        engine = FakeEngine([face(size=200), face(size=40, at=(300, 300))])
        extract_embedding(engine, PICTURE, POLICY)
        assert engine.embedded == [engine.faces[0]]

    def test_only_weak_detections_are_not_trusted(self):
        engine = FakeEngine([face(score=0.45)])
        assert self.rejected(engine) == face_service.NOT_SURE_IT_IS_A_FACE

    def test_only_tiny_faces_are_told_to_come_closer(self):
        engine = FakeEngine([face(size=40), face(size=50, at=(200, 200))])
        assert self.rejected(engine) == "El rostro es muy pequeño. Acércate a la cámara."

    def test_a_blurred_face_is_refused_with_its_own_message(self):
        message = self.rejected(FakeEngine([face()]), soft_picture())
        assert message == "La imagen está borrosa. Mantén la cámara quieta y vuelve a intentarlo."

    def test_the_face_limits_are_inclusive(self):
        assert extract_embedding(FakeEngine([face(size=80)]), PICTURE, POLICY) is not None
        assert "muy pequeño" in self.rejected(FakeEngine([face(size=79)]))
        assert extract_embedding(FakeEngine([face(score=0.5)]), PICTURE, POLICY) is not None
        assert self.rejected(FakeEngine([face(score=0.49)])) == face_service.NOT_SURE_IT_IS_A_FACE

    def test_only_the_face_that_was_checked_is_turned_into_a_vector(self):
        engine = FakeEngine([face(size=200), face(size=30, score=0.9, at=(300, 300))])
        extract_embedding(engine, PICTURE, POLICY)
        assert len(engine.embedded) == 1


def soft_picture() -> np.ndarray:
    grey = np.tile(np.linspace(0, 255, 400, dtype=np.uint8), (400, 1))
    return cv2.cvtColor(grey, cv2.COLOR_GRAY2BGR)
