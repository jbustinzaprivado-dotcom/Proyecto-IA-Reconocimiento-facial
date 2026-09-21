from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from app.api.deps import (
    Admin,
    AppSettings,
    Auditor,
    DbSession,
    Engine,
    OptionalEngine,
    Quality,
    Staff,
)
from app.core.errors import ApiException
from app.schemas.common_schema import ApiError, ApiResponse
from app.schemas.persona_schema import (
    EliminadaOut,
    PersonaCreate,
    PersonaOut,
    PersonaUpdate,
    PurgeOut,
    RostroOut,
)
from app.services import persona_service
from app.services.face_engines import FaceRejectedError
from app.services.face_service import extract_embedding, image_noun, read_image

router = APIRouter(prefix="/personas", tags=["personas"])


@router.post(
    "",
    status_code=201,
    response_model=ApiResponse[PersonaOut],
    responses={409: {"model": ApiError}, 422: {"model": ApiError}},
)
def create_persona(data: PersonaCreate, db: DbSession, user: Staff, audit: Auditor):
    persona = persona_service.create_persona(db, data)
    audit.log(user, "persona_crear", resource="persona", resource_id=persona.id)
    return ApiResponse(resultado=PersonaOut.model_validate(persona))


@router.get("", response_model=ApiResponse[list[PersonaOut]])
def list_personas(db: DbSession, user: Staff, engine: OptionalEngine):
    """Every person, with how many faces of the model in use each one has saved."""
    counts = persona_service.face_counts(db, engine.name if engine else None)
    return ApiResponse(
        resultado=[
            PersonaOut.model_validate(persona).model_copy(
                update={"rostros": counts.get(persona.id, 0)}
            )
            for persona in persona_service.list_personas(db)
        ]
    )


@router.post(
    "/{persona_id}/rostro",
    response_model=ApiResponse[RostroOut],
    responses={
        400: {"model": ApiError},
        404: {"model": ApiError},
        413: {"model": ApiError},
        415: {"model": ApiError},
        422: {"model": ApiError},
        503: {"model": ApiError},
    },
)
def register_faces(
    persona_id: int,
    db: DbSession,
    settings: AppSettings,
    engine: Engine,
    quality: Quality,
    user: Staff,
    audit: Auditor,
    imagenes: Annotated[list[UploadFile] | None, File()] = None,
):
    """Replace the person's face vectors with the ones from these images. Nothing is kept unless
    every image is valid, and the images themselves are never stored."""
    persona = persona_service.get_persona(db, persona_id)

    files = imagenes or []
    if not 1 <= len(files) <= settings.max_images_per_person:
        raise ApiException(
            422, f"Debes enviar entre 1 y {settings.max_images_per_person} imágenes."
        )

    vectors = []
    for position, upload in enumerate(files, start=1):
        image = read_image(upload, settings.max_image_bytes, position)
        try:
            vectors.append(extract_embedding(engine, image, quality))
        except FaceRejectedError as error:
            noun = image_noun(upload, position)
            raise ApiException(422, f"{noun[0].upper()}{noun[1:]}: {error}") from None

    saved = persona_service.replace_faces(db, persona, vectors, engine.name)
    audit.log(
        user,
        "rostros_registrar",
        resource="persona",
        resource_id=persona.id,
        detail=f"{saved} imágenes",
    )
    return ApiResponse(resultado=RostroOut(persona_id=persona.id, imagenes_guardadas=saved))


@router.patch(
    "/{persona_id}",
    response_model=ApiResponse[PersonaOut],
    responses={404: {"model": ApiError}, 422: {"model": ApiError}},
)
def update_persona(
    persona_id: int,
    data: PersonaUpdate,
    db: DbSession,
    user: Admin,
    audit: Auditor,
    engine: OptionalEngine,
):
    """Deactivate a person (they are no longer recognized) or activate them again."""
    persona = persona_service.set_active(
        db, persona_service.get_persona(db, persona_id), data.activo
    )
    audit.log(
        user,
        "persona_activar" if data.activo else "persona_desactivar",
        resource="persona",
        resource_id=persona.id,
    )
    # The same person as the list gives them, with how many faces they have: without it the screen
    # would show "no faces" for somebody who has them
    counts = persona_service.face_counts(db, engine.name if engine else None)
    return ApiResponse(
        resultado=PersonaOut.model_validate(persona).model_copy(
            update={"rostros": counts.get(persona.id, 0)}
        )
    )


@router.delete(
    "/{persona_id}",
    response_model=ApiResponse[EliminadaOut],
    responses={404: {"model": ApiError}},
)
def delete_persona(persona_id: int, db: DbSession, user: Admin, audit: Auditor):
    """Delete a person, their face vectors and their consent. Their attempts stay without them.
    It cannot be undone."""
    persona = persona_service.get_persona(db, persona_id)
    persona_service.delete_persona(db, persona)
    audit.log(user, "persona_eliminar", resource="persona", resource_id=persona_id)
    return ApiResponse(resultado=EliminadaOut(persona_id=persona_id))


@router.post("/limpiar-sin-rostros", response_model=ApiResponse[PurgeOut])
def purge_without_faces(db: DbSession, user: Admin, audit: Auditor):
    """Delete every person who never got a face saved (a registration that was left half done)."""
    deleted = persona_service.purge_without_faces(db)
    audit.log(
        user, "personas_limpiar", resource="persona", detail=f"{deleted} personas sin rostros"
    )
    return ApiResponse(resultado=PurgeOut(eliminadas=deleted))
