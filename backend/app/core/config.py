import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.constants import DETECTION_FLOOR, JWT_SECRET_MIN_LENGTH

BACKEND_DIR = Path(__file__).resolve().parents[2]
# Only for development, when JWT_SECRET is empty: one secret per process, so the sessions end when
# the API restarts. Production refuses to start without a real one
DEVELOPMENT_JWT_SECRET = secrets.token_urlsafe(48)
SQLITE_RELATIVE_PREFIX = "sqlite:///./"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Sistema Inteligente de Reconocimiento Facial"
    app_version: str = "0.1.0"
    database_url: str = "sqlite:///./dev.db"
    face_engine: Literal["simulated", "insightface", "sface"] = "insightface"
    # Where the model weights live. A relative path is taken from backend/
    models_dir: Path = BACKEND_DIR / "models"
    insightface_model: str = "buffalo_l"
    # Empty means the default of the active engine: every model has its own similarity scale
    recognition_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_images_per_person: int = Field(default=5, ge=1)
    max_image_bytes: int = Field(default=5 * 1024 * 1024, ge=1)
    # How far above the threshold a match has to be to count as "alta" confidence
    confidence_margin: float = Field(default=0.10, ge=0.0, le=1.0)
    # Training the probability model changes what every later attempt shows and the API has no login
    # until Phase 5, so it is off unless the .env of the server turns it on
    ml_training_enabled: bool = False

    # Access (Phase 5). The API never runs without login: there is no switch to turn it off
    environment: Literal["development", "production"] = "development"
    jwt_secret: str = ""
    jwt_expire_minutes: int = Field(default=60, ge=1, le=1440)
    # Behind a proxy every request seems to come from the proxy: with this on, the address is the
    # last one that X-Forwarded-For says. Turn it on only if exactly one proxy of yours is in front
    trust_forwarded_for: bool = False
    # Limits that live in the memory of one process: with several processes each one counts alone
    login_rate_per_minute: int = Field(default=10, ge=1)
    api_rate_per_minute: int = Field(default=120, ge=1)
    max_request_bytes: int = Field(default=26 * 1024 * 1024, ge=1024)

    # Quality of the face before its vector is made. Provisional values until they are calibrated
    min_face_size: int = Field(default=80, ge=1)
    min_detection_score: float = Field(default=0.5, ge=DETECTION_FLOOR, le=1.0)
    min_sharpness: float = Field(default=0.02, ge=0.0)
    min_brightness: float = Field(default=40.0, ge=0.0, le=255.0)
    max_brightness: float = Field(default=220.0, ge=0.0, le=255.0)

    @field_validator("database_url")
    @classmethod
    def anchor_relative_sqlite_path(cls, value: str) -> str:
        # A relative SQLite path depends on where the process is started: anchor it to backend/
        if value.startswith(SQLITE_RELATIVE_PREFIX):
            return "sqlite:///" + (BACKEND_DIR / value[len(SQLITE_RELATIVE_PREFIX) :]).as_posix()
        return value

    @field_validator("models_dir")
    @classmethod
    def anchor_relative_models_dir(cls, value: Path) -> Path:
        return value if value.is_absolute() else BACKEND_DIR / value

    @model_validator(mode="after")
    def production_needs_a_real_secret(self) -> "Settings":
        if self.environment == "production" and len(self.jwt_secret) < JWT_SECRET_MIN_LENGTH:
            raise ValueError(
                f"En producción JWT_SECRET debe tener al menos {JWT_SECRET_MIN_LENGTH} caracteres"
            )
        return self

    @model_validator(mode="after")
    def brightness_range_is_not_empty(self) -> "Settings":
        if self.min_brightness >= self.max_brightness:
            raise ValueError("MIN_BRIGHTNESS debe ser menor que MAX_BRIGHTNESS")
        return self

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def signing_key(self) -> str:
        return self.jwt_secret or DEVELOPMENT_JWT_SECRET

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
