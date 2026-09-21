from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app
from tests.ml_data import add_examples

VALID = {"similitud": 0.87, "distancia": 0.26, "calidad_imagen": 0.9, "iluminacion": 0.8}


@pytest.fixture
def ml_settings(client: TestClient, tmp_path) -> Settings:
    """Settings with training turned on and a folder of its own for the models."""
    settings = Settings(_env_file=None, ml_training_enabled=True, models_dir=tmp_path / "models")
    app.dependency_overrides[get_settings] = lambda: settings
    return settings


def attempt(client: TestClient, make_image, seed: int, expected: str | None = None) -> dict:
    data = {"esperado": expected} if expected is not None else None
    response = client.post(
        "/api/reconocimiento",
        files={"imagen": (f"{seed}.png", make_image(seed), "image/png")},
        data=data,
    )
    assert response.status_code == 200, response.text
    return response.json()["resultado"]


# --- status ---------------------------------------------------------------------------------


def test_the_status_of_an_empty_system_says_what_is_missing(client: TestClient):
    response = client.get("/api/modelos/estado")
    assert response.status_code == 200
    status = response.json()["resultado"]
    assert status == {
        "modelo_facial": "simulated",
        "entrenamiento_habilitado": False,
        "ejemplos": 0,
        "ejemplos_correctos": 0,
        "ejemplos_incorrectos": 0,
        "personas": 0,
        "minimo_ejemplos": 50,
        "minimo_por_tipo": 15,
        "minimo_personas": 3,
        "faltan": status["faltan"],
        "datos_suficientes": False,
        "entrenado": False,
        "entrenado_en": None,
        "algoritmo": None,
    }
    assert len(status["faltan"]) == 4


def test_the_status_shows_whether_training_is_turned_on(client: TestClient, ml_settings):
    assert client.get("/api/modelos/estado").json()["resultado"]["entrenamiento_habilitado"] is True


def test_the_status_without_an_engine_says_so_and_does_not_fail(client: TestClient):
    app.state.face_engine = None
    status = client.get("/api/modelos/estado").json()["resultado"]
    assert status["modelo_facial"] is None
    assert status["datos_suficientes"] is False
    assert status["faltan"] == [
        "El motor facial no está disponible, así que no se sabe con qué modelo entrenar."
    ]


def test_an_attempt_made_in_evaluation_mode_becomes_an_example(
    client: TestClient, register: Callable[..., dict], make_image
):
    person = register("Ana Torres", "ana@example.com", seeds=(1,))
    attempt(client, make_image, 1, expected=str(person["id"]))
    attempt(client, make_image, 99, expected="desconocido")
    attempt(client, make_image, 1)  # not evaluated: it says nothing about who was there

    status = client.get("/api/modelos/estado").json()["resultado"]
    assert status["ejemplos"] == 2
    assert status["ejemplos_correctos"] == 1
    assert status["ejemplos_incorrectos"] == 1
    assert status["personas"] == 1


# --- training --------------------------------------------------------------------------------


def test_training_is_refused_while_it_is_turned_off(client: TestClient, db):
    add_examples(db, correct=40, wrong=40, people=4)
    response = client.post("/api/modelos/entrenar")
    assert response.status_code == 403
    assert "ML_TRAINING_ENABLED=true" in response.json()["error"]
    assert client.get("/api/modelos/metricas").status_code == 404


def test_training_without_enough_examples_says_what_is_missing(client: TestClient, ml_settings):
    response = client.post("/api/modelos/entrenar")
    assert response.status_code == 422
    error = response.json()["error"]
    assert error.startswith("No hay datos suficientes para entrenar. Faltan 50 intentos evaluados")
    assert "Faltan 3 personas distintas evaluadas (hay 0 de 3)." in error


def test_training_without_an_engine_is_a_503_and_being_off_still_wins(
    client: TestClient, ml_settings
):
    app.state.face_engine = None
    assert client.post("/api/modelos/entrenar").status_code == 503
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, models_dir=ml_settings.models_dir
    )
    assert client.post("/api/modelos/entrenar").status_code == 403


def test_training_gives_a_model_that_the_other_endpoints_then_use(
    client: TestClient, ml_settings, db, register, make_image
):
    add_examples(db, correct=40, wrong=40, people=4)
    assert client.get("/api/modelos/metricas").status_code == 404
    assert client.post("/api/probabilidades/prediccion", json=VALID).json()["resultado"] == {
        "probabilidad_calibrada": None
    }

    response = client.post("/api/modelos/entrenar")
    assert response.status_code == 200, response.text
    metrics = response.json()["resultado"]
    assert metrics["n_muestras"] == 80
    assert metrics["modelo_facial"] == "simulated"
    assert [c["elegido"] for c in metrics["comparacion"]].count(True) == 1
    assert (ml_settings.models_dir / "ml" / "simulated.joblib").is_file()

    # The metrics are the ones that were just worked out
    assert client.get("/api/modelos/metricas").json()["resultado"] == metrics

    status = client.get("/api/modelos/estado").json()["resultado"]
    assert status["entrenado"] is True
    assert status["algoritmo"] == metrics["algoritmo"]
    assert status["entrenado_en"] == metrics["entrenado_en"]
    assert status["datos_suficientes"] is True

    # The prediction now gives a probability, higher for a higher similarity
    low = client.post("/api/probabilidades/prediccion", json={**VALID, "similitud": 0.05})
    high = client.post("/api/probabilidades/prediccion", json={**VALID, "similitud": 0.95})
    assert 0 <= low.json()["resultado"]["probabilidad_calibrada"]
    assert (
        low.json()["resultado"]["probabilidad_calibrada"]
        < high.json()["resultado"]["probabilidad_calibrada"]
        <= 1
    )

    # ... and so does every recognition, without changing who it says it is
    person = register("Ana Torres", "ana@example.com", seeds=(1,))
    match = attempt(client, make_image, 1)
    miss = attempt(client, make_image, 99)
    assert match["coincide"] is True and match["persona_id"] == person["id"]
    assert miss["coincide"] is False and miss["nombre"] is None
    assert match["probabilidad_calibrada"] > miss["probabilidad_calibrada"]
    for result in (match, miss):
        assert 0 <= result["probabilidad_calibrada"] <= 1

    history = client.get("/api/reconocimiento/historial").json()["resultado"]
    assert [item["probabilidad_calibrada"] for item in history] == [
        miss["probabilidad_calibrada"],
        match["probabilidad_calibrada"],
    ]


def test_the_whole_way_from_evaluated_attempts_to_a_probability(
    client: TestClient, ml_settings, register, make_image
):
    """Made-up pictures of noise, so it proves that the parts are joined and nothing else."""
    people = [register(f"Persona {n}", f"p{n}@example.com", seeds=(n,)) for n in (1, 2, 3)]
    for person, seed in zip(people, (1, 2, 3), strict=True):
        for _ in range(10):
            attempt(client, make_image, seed, expected=str(person["id"]))
    for seed in range(100, 130):
        attempt(client, make_image, seed, expected="desconocido")

    status = client.get("/api/modelos/estado").json()["resultado"]
    assert (status["ejemplos"], status["ejemplos_correctos"], status["ejemplos_incorrectos"]) == (
        60,
        30,
        30,
    )
    assert status["personas"] == 3
    assert status["datos_suficientes"] is True
    assert status["faltan"] == []

    trained = client.post("/api/modelos/entrenar")
    assert trained.status_code == 200, trained.text
    assert trained.json()["resultado"]["n_muestras"] == 60

    after = attempt(client, make_image, 1)
    assert after["probabilidad_calibrada"] is not None


# --- what must not break ---------------------------------------------------------------------


def test_a_recognition_without_a_model_has_no_probability(client: TestClient, register, make_image):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    result = attempt(client, make_image, 1)
    assert result["probabilidad_calibrada"] is None
    history = client.get("/api/reconocimiento/historial").json()["resultado"]
    assert history[0]["probabilidad_calibrada"] is None


def test_a_broken_model_never_spoils_a_recognition(
    client: TestClient, ml_settings, db, register, make_image
):
    add_examples(db, correct=25, wrong=25, people=3)
    assert client.post("/api/modelos/entrenar").status_code == 200
    (ml_settings.models_dir / "ml" / "simulated.joblib").write_bytes(b"not a model")

    register("Ana Torres", "ana@example.com", seeds=(1,))
    result = attempt(client, make_image, 1)
    assert result["coincide"] is True
    assert result["probabilidad_calibrada"] is None
    assert client.get("/api/modelos/metricas").status_code == 404
    assert client.get("/api/modelos/estado").json()["resultado"]["entrenado"] is False


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("calidad_imagen", 1.5),
        ("calidad_imagen", -0.1),
        ("iluminacion", 1.5),
        ("iluminacion", -0.1),
    ],
)
def test_the_two_scores_of_a_prediction_must_be_between_zero_and_one(
    client: TestClient, field: str, value: float
):
    response = client.post("/api/probabilidades/prediccion", json={**VALID, field: value})
    assert response.status_code == 422
    assert response.json()["error"] == f"El campo «{field}» no es válido."


def test_the_scores_of_a_prediction_may_be_exactly_zero_or_one(client: TestClient):
    for value in (0, 1):
        body = {**VALID, "calidad_imagen": value, "iluminacion": value}
        assert client.post("/api/probabilidades/prediccion", json=body).status_code == 200
