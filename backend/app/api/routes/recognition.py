from typing import Annotated

from fastapi import APIRouter, File, Form, UploadFile

from app.api.deps import (
    AnyUser,
    AppSettings,
    Auditor,
    DbSession,
    Engine,
    Quality,
    Staff,
    resolve_threshold,
)
from app.core.errors import ApiException
from app.schemas.common_schema import ApiError, ApiResponse
from app.schemas.recognition_schema import HistoryItemOut, RecognitionOut
from app.services import recognition_service
from app.services.face_engines import FaceRejectedError
from app.services.face_service import analyze_face, read_image

router = APIRouter(prefix="/reconocimiento", tags=["reconocimiento"])


@router.post(
    "",
    response_model=ApiResponse[RecognitionOut],
    responses={
        400: {"model": ApiError},
        409: {"model": ApiError},
        413: {"model": ApiError},
        415: {"model": ApiError},
        422: {"model": ApiError},
        503: {"model": ApiError},
    },
)
def recognize(
    db: DbSession,
    settings: AppSettings,
    engine: Engine,
    quality: Quality,
    user: Staff,
    audit: Auditor,
    imagen: Annotated[UploadFile | None, File()] = None,
    esperado: Annotated[str | None, Form()] = None,
):
    """Compare one face against every registered person. The image is not stored.

    `esperado` is optional (evaluation mode): "desconocido" or the id of the person who is really
    in front of the camera. With it the attempt is labeled as a hit or a mistake."""
    if imagen is None:
        raise ApiException(422, "Falta la imagen.")
    expected = recognition_service.parse_expected(db, esperado, engine.name)

    image = read_image(imagen, settings.max_image_bytes)
    try:
        face = analyze_face(engine, image, quality)
    except FaceRejectedError as error:
        raise ApiException(422, str(error)) from None

    result = recognition_service.recognize(
        db,
        engine.name,
        face.vector,
        resolve_threshold(settings, engine),
        measurements=face.measurements,
        expected=expected,
        margin=settings.confidence_margin,
        models_dir=settings.models_dir,
    )
    # No name goes into the audit log: only whether it matched and, in evaluation mode, the label
    detail = "coincide" if result.coincide else "no coincide"
    if result.etiqueta:
        detail += f"; evaluación: {result.etiqueta}"
    audit.log(user, "reconocimiento", detail=detail)
    return ApiResponse(resultado=result)


@router.get("/historial", response_model=ApiResponse[list[HistoryItemOut]])
def history(db: DbSession, user: AnyUser):
    return ApiResponse(resultado=recognition_service.history(db))
