import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.schemas.common_schema import ApiError

logger = logging.getLogger("app.errors")

INTERNAL_ERROR_MESSAGE = "Error interno del servidor."

# FastAPI and Starlette word their own errors in English: they are replaced by status
HTTP_STATUS_MESSAGES = {
    404: "Recurso no encontrado.",
    405: "Método no permitido.",
}

# Loc parts that say where a value came from, not which field it is
LOCATION_PREFIXES = {"body", "query", "path", "header", "cookie"}


class ApiException(Exception):
    """A failure the client can act on, with the status and the text to show."""

    def __init__(self, status_code: int, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.headers = headers


class RequestTooLarge(Exception):
    """The body of a request went over the limit while it was being read."""


class ValidationMessage(ValueError):
    """A validation failure whose text is already written for the user."""


def error_response(status_code: int, message: str, headers: dict[str, str] | None = None):
    return JSONResponse(
        status_code=status_code,
        content=ApiError(error=message).model_dump(),
        headers=headers,
    )


def describe_validation_error(error: dict) -> str:
    kind = error["type"]
    loc = error["loc"]
    names = [str(part) for part in loc if part not in LOCATION_PREFIXES]
    field = names[-1] if names else None

    raised = (error.get("ctx") or {}).get("error")
    if isinstance(raised, ValidationMessage):
        return str(raised)
    if kind == "json_invalid":
        return "El cuerpo de la solicitud no es un JSON válido."
    if kind == "missing":
        return f"Falta el campo «{field}»." if field else "Falta el cuerpo de la solicitud."
    if loc and loc[0] == "path":
        return "El identificador debe ser un número entero."
    if field:
        return f"El campo «{field}» no es válido."
    return "La solicitud no es válida."


def install_error_handling(app: FastAPI) -> None:
    """Make every failure leave as {success: false, error}.

    Call it before adding the CORS middleware: the catch-all must sit inside it, or a 500 would
    reach the browser without CORS headers and look like a network failure.
    """

    @app.exception_handler(ApiException)
    async def handle_api_exception(_request: Request, exc: ApiException):
        return error_response(exc.status_code, exc.message, headers=exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_request: Request, exc: StarletteHTTPException):
        message = HTTP_STATUS_MESSAGES.get(exc.status_code)
        if message is None:
            message = "Solicitud no válida." if exc.status_code < 500 else INTERNAL_ERROR_MESSAGE
        return error_response(exc.status_code, message, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request: Request, exc: RequestValidationError):
        messages = dict.fromkeys(describe_validation_error(error) for error in exc.errors())
        return error_response(422, " ".join(messages))

    app.add_middleware(UnhandledErrorMiddleware)


class UnhandledErrorMiddleware:
    """Turns any uncaught exception into a 500 that does not reveal internals."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        started = False

        async def track_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, track_send)
        except RequestTooLarge:
            # Not a failure of the server: the size limit answers it
            raise
        except Exception:
            logger.exception("Error no controlado en %s %s", scope["method"], scope["path"])
            if started:
                # Part of the response is already on the wire: nothing else can be sent
                raise
            response = error_response(500, INTERNAL_ERROR_MESSAGE)
            await response(scope, receive, send)
