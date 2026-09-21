import pytest
from pydantic import ValidationError

from app.core.config import BACKEND_DIR, Settings, get_settings

ENV_NAMES = [
    "DATABASE_URL",
    "FACE_ENGINE",
    "RECOGNITION_THRESHOLD",
    "CORS_ORIGINS",
    "MAX_IMAGES_PER_PERSON",
    "MAX_IMAGE_BYTES",
    "MODELS_DIR",
    "INSIGHTFACE_MODEL",
    "MIN_FACE_SIZE",
    "MIN_DETECTION_SCORE",
    "MIN_SHARPNESS",
    "MIN_BRIGHTNESS",
    "MAX_BRIGHTNESS",
]


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in ENV_NAMES:
        monkeypatch.delenv(name, raising=False)


def load() -> Settings:
    # _env_file=None: ignore the developer's own .env so the test is reproducible
    return Settings(_env_file=None)


def test_defaults_match_the_agreed_values():
    settings = load()
    assert settings.face_engine == "insightface"
    assert settings.insightface_model == "buffalo_l"
    # Empty: each engine brings its own threshold, because each model has its own scale
    assert settings.recognition_threshold is None
    assert settings.models_dir == BACKEND_DIR / "models"
    assert settings.max_images_per_person == 5
    assert settings.max_image_bytes == 5 * 1024 * 1024
    assert settings.cors_origin_list == ["http://localhost:5173", "http://127.0.0.1:5173"]


def test_environment_variables_override_the_defaults(monkeypatch):
    monkeypatch.setenv("RECOGNITION_THRESHOLD", "0.5")
    monkeypatch.setenv("FACE_ENGINE", "insightface")
    monkeypatch.setenv("MAX_IMAGES_PER_PERSON", "3")
    settings = load()
    assert settings.recognition_threshold == 0.5
    assert settings.face_engine == "insightface"
    assert settings.max_images_per_person == 3


def test_an_unknown_face_engine_is_rejected(monkeypatch):
    monkeypatch.setenv("FACE_ENGINE", "inventado")
    with pytest.raises(ValidationError):
        load()


@pytest.mark.parametrize("value", ["-0.1", "1.5"])
def test_the_threshold_must_be_between_0_and_1(monkeypatch, value):
    monkeypatch.setenv("RECOGNITION_THRESHOLD", value)
    with pytest.raises(ValidationError):
        load()


@pytest.mark.parametrize("name", ["MAX_IMAGES_PER_PERSON", "MAX_IMAGE_BYTES"])
def test_the_image_limits_must_be_positive(monkeypatch, name):
    monkeypatch.setenv(name, "0")
    with pytest.raises(ValidationError):
        load()


def test_cors_origins_are_split_and_trimmed(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", " http://a.example , http://b.example ,, ")
    assert load().cors_origin_list == ["http://a.example", "http://b.example"]


def test_a_relative_sqlite_path_is_anchored_to_the_backend_folder():
    url = load().database_url
    assert url == "sqlite:///" + (BACKEND_DIR / "dev.db").as_posix()


def test_other_database_urls_are_left_untouched(monkeypatch):
    postgres = "postgresql+psycopg2://usuario:clave@servidor:5432/base"
    monkeypatch.setenv("DATABASE_URL", postgres)
    assert load().database_url == postgres


def test_an_absolute_sqlite_path_is_left_untouched(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///C:/datos/mi.db")
    assert load().database_url == "sqlite:///C:/datos/mi.db"


def test_get_settings_is_cached():
    assert get_settings() is get_settings()
