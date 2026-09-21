import numpy as np
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app
from tests.fakes import FakeEngine, face


def recognize(client: TestClient, data: bytes, esperado: str | None = None):
    form = {} if esperado is None else {"esperado": esperado}
    return client.post(
        "/api/reconocimiento", files={"imagen": ("cara.png", data, "image/png")}, data=form
    )


def analysis(client: TestClient, **params):
    return client.get("/api/analisis/resumen", params=params)


def test_with_no_attempts_it_answers_200_with_zeros_and_the_model_in_use(client: TestClient):
    response = analysis(client)
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    result = body["resultado"]
    assert result["modelo"] == "simulated"
    assert result["umbral"] == 0.75
    assert result["total_intentos"] == 0
    assert len(result["curva"]) == 101
    assert len(result["histograma"]) == 20
    assert len(result["por_dia"]) == 14
    assert result["metricas_umbral"] is None
    assert result["muestra_pequena"] is True


def test_the_answer_has_exactly_the_fields_the_screens_need(client: TestClient):
    result = analysis(client).json()["resultado"]
    assert set(result) == {
        "modelo",
        "modelos",
        "umbral",
        "total_intentos",
        "total_coincidencias",
        "tasa_coincidencia",
        "similitud_promedio_coincidencias",
        "similitud_promedio_rechazos",
        "por_dia",
        "histograma",
        "curva",
        "etiquetados",
        "etiquetados_persona",
        "etiquetados_desconocido",
        "muestra_pequena",
        "metricas_umbral",
    }
    assert set(result["curva"][0]) == {
        "umbral",
        "coincidencias",
        "verdaderos_positivos",
        "falsos_positivos",
        "falsos_negativos",
        "verdaderos_negativos",
        "tasa_falsos_positivos",
        "tasa_falsos_negativos",
    }
    assert set(result["por_dia"][0]) == {"fecha", "coincidencias", "rechazos"}
    assert set(result["histograma"][0]) == {"desde", "hasta", "coincidencias", "rechazos"}


def test_it_reflects_what_really_happened_through_the_api(client: TestClient, register, make_image):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1))
    recognize(client, make_image(1), esperado=str(ana["id"]))
    recognize(client, make_image(99), esperado="desconocido")
    result = analysis(client).json()["resultado"]
    assert (result["total_intentos"], result["total_coincidencias"]) == (3, 2)
    assert result["etiquetados"] == 2
    assert (result["etiquetados_persona"], result["etiquetados_desconocido"]) == (1, 1)
    assert result["modelos"] == [{"modelo": "simulated", "intentos": 3}]
    assert result["metricas_umbral"]["matriz_confusion"] == [[1, 0], [0, 1]]
    assert sum(d["coincidencias"] + d["rechazos"] for d in result["por_dia"]) == 3


def test_no_name_and_no_identity_is_in_the_analysis(client: TestClient, register, make_image):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1), esperado=str(ana["id"]))
    text = analysis(client).text
    assert "Ana" not in text
    assert "embedding" not in text


def test_the_model_can_be_chosen_and_an_unknown_one_is_a_404(
    client: TestClient, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1))
    assert analysis(client, modelo="simulated").status_code == 200
    response = analysis(client, modelo="inventado")
    assert response.status_code == 404
    assert response.json() == {"success": False, "error": "No hay intentos de ese modelo."}


def test_the_attempts_of_another_model_are_kept_apart(client: TestClient, register, make_image):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1))
    engine = FakeEngine([face()], vector=np.array([1.0, 0.0, 0.0], dtype=np.float32))
    app.state.face_engine = engine
    register("Luis Ramírez", "luis@example.com", seeds=(2,))
    recognize(client, make_image(2))
    recognize(client, make_image(2))
    active = analysis(client).json()["resultado"]
    assert (active["modelo"], active["total_intentos"]) == ("fake", 2)
    other = analysis(client, modelo="simulated").json()["resultado"]
    assert (other["modelo"], other["total_intentos"]) == ("simulated", 1)
    assert {m["modelo"]: m["intentos"] for m in active["modelos"]} == {"fake": 2, "simulated": 1}


def test_the_threshold_shown_is_the_one_in_use_now(client: TestClient):
    app.dependency_overrides[get_settings] = lambda: Settings(
        _env_file=None, recognition_threshold=0.42
    )
    assert analysis(client).json()["resultado"]["umbral"] == 0.42


def test_it_can_be_looked_at_even_when_the_engine_could_not_load(
    client: TestClient, register, make_image
):
    register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1))
    app.state.face_engine = None
    app.state.face_engine_error = "Faltan los pesos"
    response = analysis(client)
    assert response.status_code == 200
    result = response.json()["resultado"]
    # With no engine the model shown is the one of the last attempt, with the threshold it had
    assert (result["modelo"], result["total_intentos"]) == ("simulated", 1)
    assert result["umbral"] == 0.75


def test_the_offset_of_the_viewer_is_accepted_and_bounded(client: TestClient):
    assert analysis(client, desfase_minutos=-300).status_code == 200
    assert analysis(client, desfase_minutos=840).status_code == 200
    assert analysis(client, desfase_minutos=-840).status_code == 200
    for bad in (841, -841):
        response = analysis(client, desfase_minutos=bad)
        assert response.status_code == 422
        assert response.json() == {
            "success": False,
            "error": "El campo «desfase_minutos» no es válido.",
        }
    assert analysis(client, desfase_minutos="abc").status_code == 422


def test_the_curve_of_the_labeled_attempts_can_be_read_from_the_answer(
    client: TestClient, register, make_image
):
    ana = register("Ana Torres", "ana@example.com", seeds=(1,))
    recognize(client, make_image(1), esperado=str(ana["id"]))
    recognize(client, make_image(99), esperado="desconocido")
    curve = {p["umbral"]: p for p in analysis(client).json()["resultado"]["curva"]}
    assert curve[0.5]["verdaderos_positivos"] == 1
    assert curve[0.5]["verdaderos_negativos"] == 1
    assert curve[0.0]["falsos_positivos"] == 1
    assert curve[1.0]["falsos_negativos"] in (0, 1)
