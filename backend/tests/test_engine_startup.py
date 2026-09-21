import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy.orm import Session

import app.main as main
from app.api.deps import ENGINE_NOT_LOADED, resolve_threshold
from app.core.config import BACKEND_DIR, Settings, get_settings
from app.core.constants import DETECTION_FLOOR, ROLE_ADMIN
from app.database.connection import get_db
from app.services.face_engines import SimulatedEngine
from tests.conftest import authorization, make_user
from tests.fakes import FakeEngine


def settings(tmp_path: Path, engine: str, **extra) -> Settings:
    return Settings(_env_file=None, face_engine=engine, models_dir=tmp_path / "modelos", **extra)


class TestLoadFaceEngine:
    def test_the_engine_is_kept_in_the_application_state(self, tmp_path):
        application = main.FastAPI()
        main.load_face_engine(application, settings(tmp_path, "simulated"))
        assert isinstance(application.state.face_engine, SimulatedEngine)
        assert application.state.face_engine_error is None

    def test_missing_weights_leave_no_engine_and_keep_the_reason(self, tmp_path, caplog):
        application = main.FastAPI()
        with caplog.at_level(logging.ERROR, logger="app.engine"):
            main.load_face_engine(application, settings(tmp_path, "sface"))
        assert application.state.face_engine is None
        assert "download_models" in application.state.face_engine_error
        assert "download_models" in caplog.text

    def test_an_unexpected_failure_is_logged_but_not_shown(self, tmp_path, monkeypatch, caplog):
        def explode(_settings):
            raise RuntimeError("detalle-interno-del-modelo")

        monkeypatch.setattr(main, "build_engine", explode)
        application = main.FastAPI()
        with caplog.at_level(logging.ERROR, logger="app.engine"):
            main.load_face_engine(application, settings(tmp_path, "simulated"))
        assert application.state.face_engine is None
        assert application.state.face_engine_error == "No se pudo cargar el motor facial."
        assert "detalle-interno-del-modelo" not in application.state.face_engine_error
        assert "detalle-interno-del-modelo" in caplog.text

    def test_a_later_success_clears_an_earlier_failure(self, tmp_path):
        application = main.FastAPI()
        main.load_face_engine(application, settings(tmp_path, "sface"))
        main.load_face_engine(application, settings(tmp_path, "simulated"))
        assert application.state.face_engine is not None
        assert application.state.face_engine_error is None


class TestStartup:
    """The engine is loaded when the API starts, not on the first request."""

    def start(self, monkeypatch, db: Session, engine_settings: Settings) -> TestClient:
        monkeypatch.setattr(main, "get_settings", lambda: engine_settings)
        application = main.create_app()
        application.dependency_overrides[get_db] = lambda: db
        application.dependency_overrides[get_settings] = lambda: engine_settings
        return TestClient(application)

    def test_before_starting_there_is_no_engine(self, monkeypatch, db, tmp_path):
        client = self.start(monkeypatch, db, settings(tmp_path, "simulated"))
        assert client.app.state.face_engine is None
        assert client.app.state.face_engine_error == ENGINE_NOT_LOADED

    def test_starting_loads_the_engine_and_health_names_it(self, monkeypatch, db, tmp_path):
        client = self.start(monkeypatch, db, settings(tmp_path, "simulated"))
        with client:
            assert client.app.state.face_engine.name == "simulated"
            body = client.get("/api/health").json()["resultado"]
            assert (body["motor"], body["modelo"]) == ("simulated", "simulated")

    def test_starting_without_weights_still_works_and_health_explains(
        self, monkeypatch, db, tmp_path
    ):
        client = self.start(monkeypatch, db, settings(tmp_path, "insightface"))
        with client:
            response = client.get("/api/health")
            assert response.status_code == 503
            assert "buffalo_l" in response.json()["error"]
            assert "download_models" in response.json()["error"]
            # The rest of the API still answers, to someone who has signed in
            admin = make_user(db, ROLE_ADMIN)
            client.headers.update(authorization(admin))
            assert client.get("/api/personas").status_code == 200
            recognize = client.post(
                "/api/reconocimiento", files={"imagen": ("a.png", b"x", "image/png")}
            )
            assert recognize.status_code == 503

    def test_without_weights_the_missing_folder_is_not_created(self, monkeypatch, db, tmp_path):
        client = self.start(monkeypatch, db, settings(tmp_path, "sface"))
        with client:
            pass
        assert not (tmp_path / "modelos").exists()


class TestThreshold:
    def test_the_configured_threshold_wins(self, tmp_path):
        engine = FakeEngine([])
        assert (
            resolve_threshold(settings(tmp_path, "simulated", recognition_threshold=0.9), engine)
            == 0.9
        )

    def test_zero_is_a_valid_configured_threshold(self, tmp_path):
        engine = FakeEngine([])
        assert (
            resolve_threshold(settings(tmp_path, "simulated", recognition_threshold=0.0), engine)
            == 0.0
        )

    def test_without_one_the_engine_default_is_used(self, tmp_path):
        engine = FakeEngine([])
        engine.default_threshold = 0.363
        assert resolve_threshold(settings(tmp_path, "simulated"), engine) == 0.363


class TestSettingsForFaces:
    def test_a_relative_models_folder_is_taken_from_backend(self):
        assert (
            Settings(_env_file=None, models_dir=Path("pesos")).models_dir == BACKEND_DIR / "pesos"
        )

    def test_an_absolute_models_folder_is_left_alone(self, tmp_path):
        assert Settings(_env_file=None, models_dir=tmp_path).models_dir == tmp_path

    def test_the_minimum_detection_score_cannot_go_below_the_floor_of_the_engines(self):
        Settings(_env_file=None, min_detection_score=DETECTION_FLOOR)
        with pytest.raises(ValidationError):
            Settings(_env_file=None, min_detection_score=DETECTION_FLOOR - 0.01)

    @pytest.mark.parametrize(
        ("name", "value"),
        [
            ("min_face_size", 0),
            ("min_sharpness", -1),
            ("min_brightness", -1),
            ("max_brightness", 256),
            ("min_detection_score", 1.1),
            ("recognition_threshold", 1.5),
        ],
    )
    def test_the_quality_limits_must_be_in_range(self, name, value):
        with pytest.raises(ValidationError):
            Settings(_env_file=None, **{name: value})

    def test_the_brightness_range_cannot_be_empty(self):
        with pytest.raises(ValidationError, match="MIN_BRIGHTNESS"):
            Settings(_env_file=None, min_brightness=200, max_brightness=100)
        with pytest.raises(ValidationError):
            Settings(_env_file=None, min_brightness=100, max_brightness=100)

    def test_the_quality_defaults_are_the_provisional_ones_of_the_proposal(self):
        defaults = Settings(_env_file=None)
        assert defaults.min_face_size == 80
        assert defaults.min_detection_score == 0.5
        assert defaults.min_sharpness == 0.02
        assert (defaults.min_brightness, defaults.max_brightness) == (40.0, 220.0)
