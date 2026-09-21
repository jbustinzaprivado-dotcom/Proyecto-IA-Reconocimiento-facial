import pytest
from fastapi.testclient import TestClient

VALID = {"similitud": 0.87, "distancia": 0.26, "calidad_imagen": 0.9, "iluminacion": 0.8}


def test_a_prediction_answers_200_with_no_probability_until_there_is_a_model(client: TestClient):
    response = client.post("/api/probabilidades/prediccion", json=VALID)
    assert response.status_code == 200
    assert response.json() == {"success": True, "resultado": {"probabilidad_calibrada": None}}


def test_the_prediction_input_is_still_validated(client: TestClient):
    response = client.post(
        "/api/probabilidades/prediccion", json={**VALID, "similitud": 1.5, "distancia": -1}
    )
    assert response.status_code == 422
    assert response.json() == {
        "success": False,
        "error": "El campo «similitud» no es válido. El campo «distancia» no es válido.",
    }


@pytest.mark.parametrize(
    "overrides",
    [{"similitud": 1.01}, {"similitud": -0.01}, {"distancia": 2.01}, {"distancia": -0.01}],
)
def test_similarity_and_distance_outside_their_range_are_refused(
    client: TestClient, overrides: dict
):
    response = client.post("/api/probabilidades/prediccion", json={**VALID, **overrides})
    assert response.status_code == 422


@pytest.mark.parametrize("field", list(VALID))
def test_every_field_of_the_prediction_is_required(client: TestClient, field: str):
    body = {key: value for key, value in VALID.items() if key != field}
    response = client.post("/api/probabilidades/prediccion", json=body)
    assert response.status_code == 422
    assert response.json()["error"] == f"Falta el campo «{field}»."


def test_the_prediction_input_limits_are_inclusive(client: TestClient):
    for body in (
        {**VALID, "similitud": 0, "distancia": 2},
        {**VALID, "similitud": 1, "distancia": 0},
    ):
        assert client.post("/api/probabilidades/prediccion", json=body).status_code == 200


def test_non_finite_numbers_are_refused(client: TestClient):
    response = client.post(
        "/api/probabilidades/prediccion",
        content='{"similitud": 0.5, "distancia": 1, "calidad_imagen": NaN, "iluminacion": 0.5}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422


def test_metrics_say_there_is_no_model_yet(client: TestClient):
    response = client.get("/api/modelos/metricas")
    assert response.status_code == 404
    assert response.json() == {"success": False, "error": "Modelo no entrenado."}


def test_training_is_off_unless_the_env_of_the_server_turns_it_on(client: TestClient):
    response = client.post("/api/modelos/entrenar")
    assert response.status_code == 403
    assert response.json() == {
        "success": False,
        "error": (
            "El entrenamiento está deshabilitado. Para habilitarlo pon ML_TRAINING_ENABLED=true "
            "en el .env del servidor y reinicia la API."
        ),
    }


def test_the_documentation_lists_exactly_the_endpoints_of_the_api(
    client: TestClient,
):
    paths = client.get("/openapi.json").json()["paths"]
    listed = {(method.upper(), path) for path, methods in paths.items() for method in methods}
    assert listed == {
        ("GET", "/api/health"),
        ("POST", "/api/personas"),
        ("GET", "/api/personas"),
        ("POST", "/api/personas/{persona_id}/rostro"),
        ("POST", "/api/reconocimiento"),
        ("GET", "/api/reconocimiento/historial"),
        ("GET", "/api/dashboard/resumen"),
        ("POST", "/api/probabilidades/prediccion"),
        ("GET", "/api/modelos/metricas"),
        ("POST", "/api/modelos/entrenar"),
        ("GET", "/api/modelos/estado"),
        ("POST", "/api/auth/login"),
        ("GET", "/api/auth/yo"),
        ("POST", "/api/auth/cambiar-clave"),
        ("GET", "/api/usuarios"),
        ("POST", "/api/usuarios"),
        ("PATCH", "/api/usuarios/{user_id}"),
        ("GET", "/api/auditoria"),
        ("PATCH", "/api/personas/{persona_id}"),
        ("DELETE", "/api/personas/{persona_id}"),
        ("POST", "/api/personas/limpiar-sin-rostros"),
        ("GET", "/api/analisis/resumen"),
        ("GET", "/api/reportes/historial.csv"),
        ("GET", "/api/reportes/analisis.csv"),
    }
