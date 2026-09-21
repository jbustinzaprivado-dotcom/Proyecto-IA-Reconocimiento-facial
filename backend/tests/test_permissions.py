"""Who may call what. Every route of the API is here, with the roles that may call it: adding a
route without deciding who may call it makes a test fail."""

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.constants import ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER
from app.models import Auditoria

NOT_ALLOWED = "No tienes permiso para hacer esto."
BAD_SESSION = "Tu sesión no es válida o venció. Inicia sesión otra vez."

EVERYONE = {ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER}
STAFF = {ROLE_ADMIN, ROLE_OPERATOR}
ADMIN = {ROLE_ADMIN}
PUBLIC = None

PERSON = {
    "nombre": "Ana Torres",
    "email": "ana@example.com",
    "consentimiento_version": "v0-provisional",
}
PREDICTION = {"similitud": 0.8, "distancia": 0.4, "calidad_imagen": 0.7, "iluminacion": 0.7}
NEW_USER = {
    "email": "nuevo@example.com",
    "nombre": "Nuevo Usuario",
    "rol": ROLE_VIEWER,
    "clave": "una-clave-larga-123",
}

# (method, path as documented, path to call, body, roles that may call it)
ROUTES = [
    ("GET", "/api/health", "/api/health", None, PUBLIC),
    ("POST", "/api/auth/login", "/api/auth/login", {"email": "x@y.co", "clave": "x"}, PUBLIC),
    ("GET", "/api/auth/yo", "/api/auth/yo", None, EVERYONE),
    (
        "POST",
        "/api/auth/cambiar-clave",
        "/api/auth/cambiar-clave",
        {"clave_actual": "x", "clave_nueva": "y"},
        EVERYONE,
    ),
    ("POST", "/api/personas", "/api/personas", PERSON, STAFF),
    ("GET", "/api/personas", "/api/personas", None, STAFF),
    ("POST", "/api/personas/{persona_id}/rostro", "/api/personas/999/rostro", None, STAFF),
    ("PATCH", "/api/personas/{persona_id}", "/api/personas/999", {"activo": False}, ADMIN),
    ("DELETE", "/api/personas/{persona_id}", "/api/personas/999", None, ADMIN),
    ("POST", "/api/personas/limpiar-sin-rostros", "/api/personas/limpiar-sin-rostros", None, ADMIN),
    ("POST", "/api/reconocimiento", "/api/reconocimiento", None, STAFF),
    ("GET", "/api/reconocimiento/historial", "/api/reconocimiento/historial", None, EVERYONE),
    ("GET", "/api/dashboard/resumen", "/api/dashboard/resumen", None, EVERYONE),
    ("GET", "/api/analisis/resumen", "/api/analisis/resumen", None, EVERYONE),
    ("GET", "/api/reportes/historial.csv", "/api/reportes/historial.csv", None, STAFF),
    ("GET", "/api/reportes/analisis.csv", "/api/reportes/analisis.csv", None, EVERYONE),
    (
        "POST",
        "/api/probabilidades/prediccion",
        "/api/probabilidades/prediccion",
        PREDICTION,
        EVERYONE,
    ),
    ("GET", "/api/modelos/metricas", "/api/modelos/metricas", None, EVERYONE),
    ("GET", "/api/modelos/estado", "/api/modelos/estado", None, EVERYONE),
    ("POST", "/api/modelos/entrenar", "/api/modelos/entrenar", None, ADMIN),
    ("GET", "/api/usuarios", "/api/usuarios", None, ADMIN),
    ("POST", "/api/usuarios", "/api/usuarios", NEW_USER, ADMIN),
    ("PATCH", "/api/usuarios/{user_id}", "/api/usuarios/999", {"nombre": "Otro Nombre"}, ADMIN),
    ("GET", "/api/auditoria", "/api/auditoria", None, ADMIN),
]

IDS = [f"{method} {documented}" for method, documented, *_ in ROUTES]


def call(client: TestClient, method: str, path: str, body):
    return client.request(method, path, json=body)


def was_refused_for_the_role(response) -> bool:
    return response.status_code == 403 and response.json().get("error") == NOT_ALLOWED


def was_refused_for_no_session(response) -> bool:
    return response.status_code == 401 and response.json().get("error") == BAD_SESSION


def test_every_route_of_the_api_has_a_rule_here(client: TestClient):
    paths = client.get("/openapi.json").json()["paths"]
    documented = {(m.upper(), path) for path, methods in paths.items() for m in methods}
    ruled = {(method, path) for method, path, *_ in ROUTES}
    assert documented == ruled


@pytest.mark.parametrize(("method", "documented", "path", "body", "roles"), ROUTES, ids=IDS)
def test_someone_who_has_not_signed_in_is_refused_except_where_the_route_is_public(
    anonymous: TestClient, method, documented, path, body, roles
):
    response = call(anonymous, method, path, body)
    if roles is PUBLIC:
        assert not was_refused_for_no_session(response)
    else:
        assert was_refused_for_no_session(response)
        assert response.headers["www-authenticate"] == "Bearer"


@pytest.mark.parametrize("role", [ROLE_ADMIN, ROLE_OPERATOR, ROLE_VIEWER])
@pytest.mark.parametrize(("method", "documented", "path", "body", "roles"), ROUTES, ids=IDS)
def test_each_role_may_call_only_what_it_is_meant_to(
    client_as: Callable[..., TestClient], db: Session, role, method, documented, path, body, roles
):
    response = call(client_as(role), method, path, body)
    allowed = roles is PUBLIC or role in roles
    assert was_refused_for_the_role(response) is not allowed
    assert not was_refused_for_no_session(response)

    refusals = db.scalars(select(Auditoria).where(Auditoria.accion == "denegado")).all()
    if allowed:
        assert refusals == []
    else:
        [row] = refusals
        assert (row.resultado, row.detalle) == ("denegado", f"{method} {path}")
        assert row.usuario_email == f"{role}@example.com"


def test_a_refused_call_changes_nothing(client_as: Callable[..., TestClient], db: Session):
    viewer = client_as(ROLE_VIEWER)
    assert viewer.post("/api/personas", json=PERSON).status_code == 403
    assert viewer.post("/api/usuarios", json=NEW_USER).status_code == 403
    assert client_as(ROLE_ADMIN).get("/api/personas").json()["resultado"] == []
    emails = [u["email"] for u in client_as(ROLE_ADMIN).get("/api/usuarios").json()["resultado"]]
    assert "nuevo@example.com" not in emails


def test_the_role_check_comes_before_the_body_is_read(client_as: Callable[..., TestClient]):
    # A viewer sending garbage is told about permissions, not about the garbage
    response = client_as(ROLE_VIEWER).post("/api/usuarios", json={"basura": True})
    assert response.status_code == 403
    assert response.json()["error"] == NOT_ALLOWED
