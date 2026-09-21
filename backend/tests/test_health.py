from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.config import Settings
from app.database.connection import get_db
from app.main import app


def test_health_reports_ok_in_the_response_envelope(client: TestClient):
    settings = Settings(_env_file=None)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "resultado": {
            "estado": "ok",
            "version": settings.app_version,
            "motor": settings.face_engine,
            "modelo": "simulated",
            "base_de_datos": "ok",
        },
    }


def test_health_names_the_model_that_is_loaded(client: TestClient):
    from tests.fakes import FakeEngine

    app.state.face_engine = FakeEngine([])
    assert client.get("/api/health").json()["resultado"]["modelo"] == "fake"


def test_health_answers_503_with_the_reason_when_the_engine_could_not_load(client: TestClient):
    app.state.face_engine = None
    app.state.face_engine_error = "Faltan los pesos de SFace. Ejecuta: download_models"
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {
        "success": False,
        "error": "El motor facial no está disponible. Faltan los pesos de SFace. "
        "Ejecuta: download_models",
    }


def test_health_says_so_when_the_engine_has_not_been_loaded_yet(client: TestClient):
    app.state.face_engine = None
    app.state.face_engine_error = None
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json()["error"] == (
        "El motor facial no está disponible. El motor facial todavía no se ha cargado."
    )


def test_health_answers_503_with_the_error_envelope_when_the_database_is_down():
    class BrokenSession:
        def execute(self, *args, **kwargs):
            raise OperationalError("SELECT 1", {}, Exception("connection refused"))

    app.dependency_overrides[get_db] = lambda: BrokenSession()
    try:
        response = TestClient(app).get("/api/health")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert response.json() == {"success": False, "error": "Base de datos no disponible"}


def test_cors_allows_the_frontend_origin(client: TestClient):
    response = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_also_allows_the_frontend_opened_through_127_0_0_1(client: TestClient):
    response = client.options(
        "/api/health",
        headers={"Origin": "http://127.0.0.1:5173", "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_cors_rejects_any_other_origin(client: TestClient):
    response = client.options(
        "/api/health",
        headers={"Origin": "http://sitio-ajeno.example", "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_cors_only_allows_the_methods_the_api_uses(client: TestClient):
    for method in ("PUT", "TRACE", "PROPFIND"):
        response = client.options(
            "/api/health",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": method},
        )
        assert response.status_code == 400, method
    for method in ("GET", "POST", "PATCH", "DELETE"):
        response = client.options(
            "/api/health",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": method},
        )
        assert response.status_code == 200, method


def test_cors_lets_the_browser_send_the_token(client: TestClient):
    response = client.options(
        "/api/personas",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    allowed = response.headers["access-control-allow-headers"].lower()
    assert "authorization" in allowed and "content-type" in allowed
