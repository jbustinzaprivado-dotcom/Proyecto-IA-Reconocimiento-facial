import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import ApiException, install_error_handling
from app.main import create_app


def test_unknown_route_answers_404_in_the_error_envelope(client: TestClient):
    response = client.get("/api/no-existe")
    assert response.status_code == 404
    assert response.json() == {"success": False, "error": "Recurso no encontrado."}


def test_wrong_method_answers_405_in_the_error_envelope_and_keeps_the_allow_header(
    client: TestClient,
):
    response = client.delete("/api/personas")
    assert response.status_code == 405
    assert response.json() == {"success": False, "error": "Método no permitido."}
    # Starlette names only one of the allowed methods here; what matters is that it is not lost
    assert response.headers["allow"] in ("GET", "POST")


def test_every_validation_failure_is_reported_at_once_in_a_single_text(client: TestClient):
    response = client.post(
        "/api/personas",
        json={"nombre": "A", "email": "no-es-un-correo", "consentimiento_version": "v9"},
    )
    assert response.status_code == 422
    assert response.json() == {
        "success": False,
        "error": (
            "El nombre debe tener entre 2 y 100 caracteres. "
            "El correo no tiene un formato válido. "
            "Versión de consentimiento no válida."
        ),
    }


def test_missing_fields_are_named(client: TestClient):
    response = client.post("/api/personas", json={"nombre": "Ana Torres"})
    assert response.status_code == 422
    assert response.json()["error"] == (
        "Falta el campo «email». Falta el campo «consentimiento_version»."
    )


def test_a_body_that_is_not_json_is_refused_with_its_own_message(client: TestClient):
    response = client.post(
        "/api/personas", content="{esto no es json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 422
    assert response.json()["error"] == "El cuerpo de la solicitud no es un JSON válido."


def test_a_body_that_is_not_an_object_is_refused(client: TestClient):
    response = client.post("/api/personas", json=["Ana"])
    assert response.status_code == 422
    assert response.json() == {"success": False, "error": "La solicitud no es válida."}


def test_a_field_of_the_wrong_type_is_named_without_echoing_the_value(client: TestClient):
    response = client.post(
        "/api/personas",
        json={"nombre": 123, "email": "a@b.co", "consentimiento_version": "v0-provisional"},
    )
    assert response.status_code == 422
    assert response.json() == {"success": False, "error": "El campo «nombre» no es válido."}


def test_a_path_id_that_is_not_a_number_is_refused_in_spanish(client: TestClient):
    response = client.post("/api/personas/abc/rostro")
    assert response.status_code == 422
    assert response.json() == {
        "success": False,
        "error": "El identificador debe ser un número entero.",
    }


def test_validation_errors_never_use_the_english_text_of_fastapi(client: TestClient):
    response = client.post("/api/probabilidades/prediccion", json={"similitud": "alta"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert "field required" not in error.lower()
    assert "input" not in error.lower()
    assert "Falta el campo «distancia»." in error


def test_an_api_exception_leaves_with_its_own_status_and_text():
    small = FastAPI()
    install_error_handling(small)

    @small.get("/falla")
    def fails():
        raise ApiException(418, "Soy una tetera.")

    response = TestClient(small).get("/falla")
    assert response.status_code == 418
    assert response.json() == {"success": False, "error": "Soy una tetera."}


def app_that_explodes() -> FastAPI:
    exploding = create_app()

    @exploding.get("/api/prueba-explota")
    def explodes():
        raise RuntimeError("clave-secreta-interna")

    return exploding


def test_an_unexpected_exception_answers_500_without_revealing_it(caplog):
    with caplog.at_level(logging.ERROR, logger="app.errors"):
        response = TestClient(app_that_explodes()).get("/api/prueba-explota")

    assert response.status_code == 500
    assert response.json() == {"success": False, "error": "Error interno del servidor."}
    assert "clave-secreta-interna" not in response.text
    # It is not lost: the traceback goes to the log
    assert "clave-secreta-interna" in caplog.text


def test_a_500_still_carries_the_cors_headers_so_the_browser_can_read_it():
    response = TestClient(app_that_explodes()).get(
        "/api/prueba-explota", headers={"Origin": "http://localhost:5173"}
    )

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


@pytest.mark.parametrize("path", ["/api/no-existe", "/api/personas/abc/rostro"])
def test_client_errors_also_carry_the_cors_headers(path: str, client: TestClient):
    response = client.post(path, headers={"Origin": "http://localhost:5173"})
    assert response.status_code in (404, 405, 422)
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
