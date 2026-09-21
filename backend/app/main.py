import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import ENGINE_NOT_LOADED
from app.api.routes import (
    analysis,
    audit,
    auth,
    dashboard,
    health,
    personas,
    probabilities,
    recognition,
    reports,
    users,
)
from app.core.config import Settings, get_settings
from app.core.errors import install_error_handling
from app.core.middleware import (
    RateLimitMiddleware,
    RequestSizeLimitMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.rate_limit import SlidingWindowLimiter
from app.services.face_engines import EngineUnavailableError, build_engine

logger = logging.getLogger("app.engine")


def load_face_engine(app: FastAPI, settings: Settings) -> None:
    """Load the engine once, when the API starts, and keep the reason if it cannot be loaded.

    The API starts anyway: `health` and the requests that need the engine explain what is missing.
    """
    app.state.face_engine = None
    app.state.face_engine_error = None
    try:
        app.state.face_engine = build_engine(settings)
        logger.info("Motor facial listo: %s", app.state.face_engine.name)
    except EngineUnavailableError as error:
        app.state.face_engine_error = str(error)
        logger.error("Motor facial no disponible: %s", error)
    except Exception:
        app.state.face_engine_error = "No se pudo cargar el motor facial."
        logger.exception("Falló la carga del motor facial")


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        load_face_engine(app, settings)
        yield

    # The interactive documentation is for development: a production API does not show its map
    docs = (
        {}
        if not settings.is_production
        else {"docs_url": None, "redoc_url": None, "openapi_url": None}
    )
    app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan, **docs)
    app.state.rate_limiter = SlidingWindowLimiter()
    # Until the API starts there is no engine (tests override it one by one)
    app.state.face_engine = None
    app.state.face_engine_error = ENGINE_NOT_LOADED
    # Before CORS: see install_error_handling
    install_error_handling(app)
    # Added after the error handling and before CORS: what they answer still carries the CORS
    # headers, so the browser can read a 413 or a 429 instead of calling it a network failure.
    # The last one added is the first to see the request
    app.add_middleware(RequestSizeLimitMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
    )
    for router in (
        health.router,
        auth.router,
        users.router,
        audit.router,
        personas.router,
        recognition.router,
        dashboard.router,
        probabilities.router,
        analysis.router,
        reports.router,
    ):
        app.include_router(router, prefix="/api")
    return app


app = create_app()
