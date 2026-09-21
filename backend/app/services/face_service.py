from dataclasses import dataclass

import cv2
import numpy as np
from fastapi import UploadFile

from app.core.constants import MAX_IMAGE_PIXELS
from app.core.errors import ApiException
from app.services.face_engines import FaceEngine, FaceRejectedError
from app.services.quality_service import (
    FaceMeasurements,
    QualityPolicy,
    is_big_enough,
    measure,
    problems_from,
)

# The first bytes of a JPEG and of a PNG, written as numbers so that nothing can mangle them
JPEG_SIGNATURE = bytes([0xFF, 0xD8, 0xFF])
PNG_SIGNATURE = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
BYTES_PER_MB = 1024 * 1024
# What a browser calls a file that has no name of its own (a photo taken with the camera)
GENERIC_FILE_NAMES = {"", "blob"}
# JPEG start-of-frame markers, the ones that carry the image size
JPEG_FRAME_MARKERS = set(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}

NO_FACE = "No se detectó un rostro."
NOT_SURE_IT_IS_A_FACE = "No se pudo confirmar que la imagen tenga un rostro. Prueba con otra foto."


def image_noun(upload: UploadFile, position: int | None = None) -> str:
    """How a message calls an uploaded image: "imagen 2 «yo.png»", "imagen 2", "imagen «yo.png»"
    or just "imagen". The position is what the person can recognize among several pictures; the
    name is added only when it is a real one."""
    parts = ["imagen"]
    if position is not None:
        parts.append(str(position))
    if (upload.filename or "") not in GENERIC_FILE_NAMES:
        parts.append(f"«{upload.filename}»")
    return " ".join(parts)


def several_faces(count: int) -> str:
    return f"Se detectaron {count} rostros. Envía una foto con una sola persona."


@dataclass(frozen=True)
class ExtractedFace:
    vector: np.ndarray
    measurements: FaceMeasurements


def extract_embedding(engine: FaceEngine, image: np.ndarray, policy: QualityPolicy) -> np.ndarray:
    return analyze_face(engine, image, policy).vector


def analyze_face(engine: FaceEngine, image: np.ndarray, policy: QualityPolicy) -> ExtractedFace:
    """The vector of the one face in the image, with what was measured on it, or
    FaceRejectedError saying why it cannot be used.

    Exactly one confident face that is big enough to be identified is needed, and it has to pass
    the quality checks: a person in the background is never identified or registered by mistake.
    Detections too weak or too small to be a person do not count as another face.
    """
    faces = engine.detect(image)
    if not faces:
        raise FaceRejectedError(NO_FACE)
    confident = [face for face in faces if face.score >= policy.min_detection_score]
    if not confident:
        raise FaceRejectedError(NOT_SURE_IT_IS_A_FACE)
    identifiable = [face for face in confident if is_big_enough(face, policy)]
    if len(identifiable) > 1:
        raise FaceRejectedError(several_faces(len(identifiable)))

    # With none big enough, the biggest one is judged and fails with the "too small" message
    chosen = identifiable[0] if identifiable else max(confident, key=lambda f: f.width * f.height)
    measurements = measure(image, chosen)
    problems = problems_from(measurements, policy)
    if problems:
        raise FaceRejectedError(" ".join(problems))
    return ExtractedFace(vector=engine.embed(image, chosen), measurements=measurements)


def image_size(data: bytes) -> tuple[int, int] | None:
    """Width and height read from the header of a PNG or JPEG, without decoding it."""
    if data.startswith(PNG_SIGNATURE):
        if len(data) < 24:
            return None
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")

    position = 2
    while position + 9 <= len(data):
        if data[position] != 0xFF:
            position += 1
            continue
        marker = data[position + 1]
        if marker == 0xFF:
            position += 1
        elif marker in JPEG_FRAME_MARKERS:
            height = int.from_bytes(data[position + 5 : position + 7], "big")
            width = int.from_bytes(data[position + 7 : position + 9], "big")
            return width, height
        elif marker == 0x01 or 0xD0 <= marker <= 0xD8:
            position += 2
        else:
            position += 2 + int.from_bytes(data[position + 2 : position + 4], "big")
    return None


def read_image(upload: UploadFile, max_bytes: int, position: int | None = None) -> np.ndarray:
    """Check an uploaded file and decode it to a BGR image.

    Checked from cheapest to costliest: size, real type (the bytes, not the name), pixel count,
    and finally the decoding.
    """
    noun = image_noun(upload, position)
    # One byte more than allowed is enough to know it is too big
    data = upload.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ApiException(413, f"La {noun} pesa más de {max_bytes / BYTES_PER_MB:g} MB.")
    if not data.startswith((JPEG_SIGNATURE, PNG_SIGNATURE)):
        raise ApiException(415, f"La {noun} debe ser JPEG o PNG.")

    unreadable = ApiException(400, f"No se pudo leer la {noun}.")
    size = image_size(data)
    if size is None or 0 in size:
        raise unreadable
    if size[0] * size[1] > MAX_IMAGE_PIXELS:
        raise ApiException(
            413,
            f"La {noun} tiene demasiados píxeles (máximo {MAX_IMAGE_PIXELS // 10**6} MP).",
        )

    try:
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    except cv2.error:
        image = None
    if image is None:
        raise unreadable
    return image
