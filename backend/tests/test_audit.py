import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.requests import Request

from app.core.config import Settings
from app.core.constants import (
    AUDIT_DETAIL_MAX_LENGTH,
    AUDIT_PAGE_DEFAULT,
    AUDIT_PAGE_MAX,
    ROLE_OPERATOR,
    ROLE_VIEWER,
)
from app.models import Auditoria
from app.services import audit_service
from app.services.audit_service import AuditTrail
from tests.conftest import ADMIN_EMAIL, PASSWORD, authorization, make_user

NOON = datetime(2026, 9, 1, 12, 0, tzinfo=UTC)


def add(db: Session, action: str = "login", **fields) -> Auditoria:
    fields.setdefault("created_at", NOON)
    fields.setdefault("resultado", "ok")
    row = Auditoria(accion=action, **fields)
    db.add(row)
    db.commit()
    return row


def listing(client: TestClient, **params) -> dict:
    response = client.get("/api/auditoria", params=params)
    assert response.status_code == 200, response.text
    return response.json()["resultado"]


def actions(client: TestClient, **params) -> list[str]:
    return [row["accion"] for row in listing(client, **params)["registros"]]


def everything_written(db: Session) -> str:
    db.expire_all()
    rows = db.scalars(select(Auditoria)).all()
    return json.dumps(
        [{k: str(v) for k, v in vars(row).items() if not k.startswith("_")} for row in rows],
        ensure_ascii=False,
    )


# --- reading -------------------------------------------------------------------------------


def test_an_empty_log_is_an_empty_page(client: TestClient):
    assert listing(client) == {"registros": [], "siguiente": None}


def test_the_rows_come_newest_first_with_all_their_fields(client: TestClient, db: Session):
    add(db, "login", usuario_email="a@example.com", ip="10.0.0.1")
    add(
        db,
        "persona_crear",
        usuario_email="b@example.com",
        recurso="persona",
        recurso_id=7,
        detalle="algo",
        created_at=NOON + timedelta(hours=1),
    )
    first, second = listing(client)["registros"]
    assert first == {
        "id": 2,
        "created_at": "2026-09-01T13:00:00Z",
        "usuario_email": "b@example.com",
        "accion": "persona_crear",
        "recurso": "persona",
        "recurso_id": 7,
        "resultado": "ok",
        "detalle": "algo",
        "ip": None,
    }
    assert second["ip"] == "10.0.0.1" and second["accion"] == "login"


def test_reading_the_log_is_not_written_to_the_log(client: TestClient, db: Session):
    listing(client)
    listing(client, accion="login")
    assert db.scalars(select(Auditoria)).all() == []


# --- filters -------------------------------------------------------------------------------


def test_filtering_by_a_part_of_the_address_ignores_case(client: TestClient, db: Session):
    add(db, "login", usuario_email="Ana.Torres@Example.com")
    add(db, "login", usuario_email="luis@example.com")
    add(db, "login")
    for term in ("ana", "TORRES", "torres@example", " ana "):
        assert [r["usuario_email"] for r in listing(client, usuario=term)["registros"]] == [
            "Ana.Torres@Example.com"
        ]
    assert len(listing(client, usuario="example")["registros"]) == 2


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_address_filter_filters_nothing(client: TestClient, db: Session, blank):
    add(db, "login", usuario_email="a@example.com")
    add(db, "login")
    assert len(listing(client, usuario=blank)["registros"]) == 2


def test_the_percent_and_the_underscore_of_a_filter_are_literal(client: TestClient, db: Session):
    add(db, "login", usuario_email="ana_torres@example.com")
    add(db, "login", usuario_email="anaXtorres@example.com")
    add(db, "login", usuario_email="100%@example.com")
    assert [r["usuario_email"] for r in listing(client, usuario="a_t")["registros"]] == [
        "ana_torres@example.com"
    ]
    assert [r["usuario_email"] for r in listing(client, usuario="%")["registros"]] == [
        "100%@example.com"
    ]
    assert listing(client, usuario="\\")["registros"] == []


def test_the_backslash_of_a_filter_is_literal_too(client: TestClient, db: Session):
    add(db, "login", usuario_email="a\\b@example.com")
    add(db, "login", usuario_email="ab@example.com")
    assert [r["usuario_email"] for r in listing(client, usuario="a\\b")["registros"]] == [
        "a\\b@example.com"
    ]
    assert [r["usuario_email"] for r in listing(client, usuario="ab")["registros"]] == [
        "ab@example.com"
    ]


def test_filtering_by_action_and_by_result_is_exact(client: TestClient, db: Session):
    add(db, "login", resultado="ok")
    add(db, "login", resultado="fallo")
    add(db, "login", resultado="bloqueado")
    add(db, "persona_crear", resultado="ok")
    add(db, "login_extra", resultado="ok")
    assert actions(client, accion="login") == ["login", "login", "login"]
    assert actions(client, accion="log") == []
    assert [r["resultado"] for r in listing(client, resultado="fallo")["registros"]] == ["fallo"]
    assert actions(client, accion="login", resultado="ok") == ["login"]
    assert actions(client, accion="persona_crear", resultado="fallo") == []


def test_filtering_since_a_date_keeps_that_moment_and_what_comes_after(
    client: TestClient, db: Session
):
    add(db, "antes", created_at=NOON - timedelta(seconds=1))
    add(db, "justo", created_at=NOON)
    add(db, "despues", created_at=NOON + timedelta(days=1))
    assert actions(client, desde="2026-09-01T12:00:00Z") == ["despues", "justo"]
    assert actions(client, desde="2026-09-01T12:00:01Z") == ["despues"]
    assert actions(client, desde="2026-09-02T00:00:00Z") == ["despues"]


def test_a_date_with_no_zone_is_taken_as_utc(client: TestClient, db: Session):
    add(db, "antes", created_at=NOON - timedelta(seconds=1))
    add(db, "justo", created_at=NOON)
    assert actions(client, desde="2026-09-01T12:00:00") == ["justo"]
    assert actions(client, desde="2026-09-01T12:00:01") == []
    # A date alone is midnight of that day
    assert actions(client, desde="2026-09-01") == ["justo", "antes"]
    assert actions(client, desde="2026-09-02") == []


def test_a_date_with_a_zone_is_converted(client: TestClient, db: Session):
    add(db, "justo", created_at=NOON)
    # 12:00 UTC is 07:00 in a zone five hours behind
    assert actions(client, desde="2026-09-01T07:00:00-05:00") == ["justo"]
    assert actions(client, desde="2026-09-01T07:00:01-05:00") == []


def test_every_filter_at_once_narrows_down(client: TestClient, db: Session):
    add(db, "login", resultado="fallo", usuario_email="ana@example.com", created_at=NOON)
    add(db, "login", resultado="fallo", usuario_email="luis@example.com", created_at=NOON)
    add(db, "login", resultado="ok", usuario_email="ana@example.com", created_at=NOON)
    add(
        db,
        "login",
        resultado="fallo",
        usuario_email="ana@example.com",
        created_at=NOON - timedelta(days=2),
    )
    found = listing(
        client, usuario="ana", accion="login", resultado="fallo", desde="2026-09-01T00:00:00Z"
    )["registros"]
    assert [r["id"] for r in found] == [1]


@pytest.mark.parametrize(
    "params",
    [{"desde": "ayer"}, {"desde": "2026-13-45"}, {"antes_de_id": "abc"}, {"limite": "muchos"}],
)
def test_a_filter_that_makes_no_sense_is_a_422_in_spanish(client: TestClient, params):
    response = client.get("/api/auditoria", params=params)
    assert response.status_code == 422
    assert isinstance(response.json()["error"], str) and response.json()["success"] is False


# --- pages ---------------------------------------------------------------------------------


def seed(db: Session, count: int) -> None:
    for number in range(count):
        add(db, "login", detalle=f"fila {number + 1}")


def test_the_pages_are_walked_with_the_next_that_each_one_gives(client: TestClient, db: Session):
    seed(db, 5)
    first = listing(client, limite=2)
    assert [r["id"] for r in first["registros"]] == [5, 4] and first["siguiente"] == 4
    second = listing(client, limite=2, antes_de_id=first["siguiente"])
    assert [r["id"] for r in second["registros"]] == [3, 2] and second["siguiente"] == 2
    third = listing(client, limite=2, antes_de_id=second["siguiente"])
    assert [r["id"] for r in third["registros"]] == [1] and third["siguiente"] is None


def test_a_last_page_that_is_exactly_full_says_there_is_no_next(client: TestClient, db: Session):
    seed(db, 4)
    second = listing(client, limite=2, antes_de_id=listing(client, limite=2)["siguiente"])
    assert [r["id"] for r in second["registros"]] == [2, 1]
    assert second["siguiente"] is None


def test_a_page_that_fits_everything_has_no_next(client: TestClient, db: Session):
    seed(db, 3)
    assert listing(client, limite=3)["siguiente"] is None
    assert listing(client, limite=3)["registros"][0]["id"] == 3


def test_new_rows_do_not_shift_the_pages_that_were_being_read(client: TestClient, db: Session):
    seed(db, 4)
    first = listing(client, limite=2)
    seed(db, 3)
    second = listing(client, limite=2, antes_de_id=first["siguiente"])
    assert [r["id"] for r in second["registros"]] == [2, 1]


def test_a_filter_is_kept_while_the_pages_are_walked(client: TestClient, db: Session):
    for number in range(6):
        add(db, "login" if number % 2 == 0 else "otra")
    first = listing(client, accion="login", limite=2)
    assert [r["id"] for r in first["registros"]] == [5, 3] and first["siguiente"] == 3
    last = listing(client, accion="login", limite=2, antes_de_id=first["siguiente"])
    assert [r["id"] for r in last["registros"]] == [1] and last["siguiente"] is None


def test_the_default_page_is_a_hundred_rows(client: TestClient, db: Session):
    assert AUDIT_PAGE_DEFAULT == 100
    seed(db, AUDIT_PAGE_DEFAULT + 5)
    page = listing(client)
    assert len(page["registros"]) == AUDIT_PAGE_DEFAULT
    assert page["siguiente"] == page["registros"][-1]["id"]


def test_the_biggest_page_is_two_hundred_rows(client: TestClient, db: Session):
    assert AUDIT_PAGE_MAX == 200
    seed(db, AUDIT_PAGE_MAX + 1)
    assert len(listing(client, limite=AUDIT_PAGE_MAX)["registros"]) == AUDIT_PAGE_MAX


@pytest.mark.parametrize("limit", [0, -1, AUDIT_PAGE_MAX + 1, 100000])
def test_a_page_size_out_of_range_is_a_422(client: TestClient, limit: int):
    assert client.get("/api/auditoria", params={"limite": limit}).status_code == 422


def test_the_service_never_returns_more_than_the_biggest_page(db: Session):
    seed(db, AUDIT_PAGE_MAX + 5)
    assert len(audit_service.list_page(db, limit=10_000).registros) == AUDIT_PAGE_MAX
    assert len(audit_service.list_page(db, limit=0).registros) == 1


# --- nothing can change it -----------------------------------------------------------------


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_the_api_offers_no_way_to_write_or_delete_the_log(client: TestClient, db: Session, method):
    add(db, "login")
    for path in ("/api/auditoria", "/api/auditoria/1"):
        assert client.request(method, path, json={"accion": "x"}).status_code in (404, 405)
    assert db.scalars(select(Auditoria)).all()[0].accion == "login"


def test_only_a_get_of_the_log_exists_in_the_documented_api(client: TestClient):
    paths = client.get("/openapi.json").json()["paths"]
    assert [p for p in paths if "auditoria" in p] == ["/api/auditoria"]
    assert list(paths["/api/auditoria"]) == ["get"]


# --- what is written -----------------------------------------------------------------------


def trail(db: Session, forwarded: str | None = None, **settings) -> AuditTrail:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    scope = {"type": "http", "headers": headers, "client": ("10.0.0.5", 1234)}
    return AuditTrail(db, Settings(_env_file=None, **settings), Request(scope))


def test_a_row_written_by_the_trail_keeps_who_what_and_from_where(db: Session):
    user = make_user(db, ROLE_OPERATOR, "luis@example.com", "Luis")
    trail(db).log(user, "persona_crear", resource="persona", resource_id=3, detail="algo")
    [row] = db.scalars(select(Auditoria)).all()
    assert (row.usuario_id, row.usuario_email, row.accion, row.resultado) == (
        user.id,
        "luis@example.com",
        "persona_crear",
        "ok",
    )
    assert (row.recurso, row.recurso_id, row.detalle, row.ip) == ("persona", 3, "algo", "10.0.0.5")
    assert row.created_at is not None


def test_with_no_user_the_typed_address_is_kept_and_cut_to_what_an_address_can_be(db: Session):
    trail(db).log(None, "login", result="fallo", email="x" * 300 + "@example.com")
    [row] = db.scalars(select(Auditoria)).all()
    assert row.usuario_id is None and len(row.usuario_email) == 254


def test_a_long_detail_is_cut(db: Session):
    trail(db).log(None, "login", detail="d" * 2000)
    audit_service.log_system(db, "admin_crear_comando", detail="s" * 2000)
    assert [len(r.detalle) for r in db.scalars(select(Auditoria))] == [AUDIT_DETAIL_MAX_LENGTH] * 2


def test_the_address_is_the_connection_unless_the_forwarded_one_is_trusted(db: Session):
    trail(db, forwarded="6.6.6.6, 1.2.3.4").log(None, "a")
    trail(db, forwarded="6.6.6.6, 1.2.3.4", trust_forwarded_for=True).log(None, "b")
    assert [r.ip for r in db.scalars(select(Auditoria))] == ["10.0.0.5", "1.2.3.4"]


def test_a_command_of_the_server_has_no_user_and_no_address(db: Session):
    audit_service.log_system(db, "admin_crear_comando")
    [row] = db.scalars(select(Auditoria)).all()
    assert (row.usuario_id, row.usuario_email, row.ip, row.detalle) == (None, None, None, None)


def test_the_requests_of_the_test_client_are_recorded_from_its_address(
    client: TestClient, anonymous: TestClient, db: Session
):
    anonymous.post("/api/auth/login", json={"email": ADMIN_EMAIL, "clave": PASSWORD})
    assert db.scalars(select(Auditoria.ip)).all() == ["testclient"]


def test_a_forwarded_address_is_only_believed_when_the_server_is_told_to(
    anonymous: TestClient, db: Session, use_settings
):
    body = {"email": ADMIN_EMAIL, "clave": PASSWORD}
    anonymous.post("/api/auth/login", json=body, headers={"X-Forwarded-For": "6.6.6.6, 1.2.3.4"})
    use_settings(trust_forwarded_for=True)
    anonymous.post("/api/auth/login", json=body, headers={"X-Forwarded-For": "6.6.6.6, 1.2.3.4"})
    assert db.scalars(select(Auditoria.ip).order_by(Auditoria.id)).all() == [
        "testclient",
        "1.2.3.4",
    ]


# --- every kind of event, and nothing private in any of them ---------------------------------

NAME = "Zulema Quispe Huamán"
PERSON_EMAIL = "zulema.quispe@example.com"
NEW_PASSWORD = "otra-clave-muy-larga-456"
USER_PASSWORD = "clave-del-usuario-789"


@pytest.fixture
def a_busy_day(client: TestClient, anonymous: TestClient, db: Session, register, make_image):
    """Every action the API audits, done once by someone who did not sign in as an operator."""
    anonymous.post("/api/auth/login", json={"email": ADMIN_EMAIL, "clave": "no-es-esta-clave"})
    signed = anonymous.post("/api/auth/login", json={"email": ADMIN_EMAIL, "clave": PASSWORD})
    assert signed.status_code == 200, (signed.status_code, signed.text)
    token = signed.json()["resultado"]["token"]
    changed = client.post(
        "/api/auth/cambiar-clave", json={"clave_actual": PASSWORD, "clave_nueva": NEW_PASSWORD}
    )
    # Changing the password ends the older sessions, this one included: carry on with the new one
    client.headers["Authorization"] = f"Bearer {changed.json()['resultado']['token']}"
    created = client.post(
        "/api/usuarios",
        json={
            "email": "viewer@example.com",
            "nombre": "Consulta Uno",
            "rol": ROLE_VIEWER,
            "clave": USER_PASSWORD,
        },
    ).json()["resultado"]
    client.patch(f"/api/usuarios/{created['id']}", json={"clave": USER_PASSWORD + "-2"})
    person = register(NAME, PERSON_EMAIL, seeds=(1, 2))
    client.patch(f"/api/personas/{person['id']}", json={"activo": False})
    client.patch(f"/api/personas/{person['id']}", json={"activo": True})
    client.post(
        "/api/reconocimiento",
        files={"imagen": ("cara.png", make_image(1), "image/png")},
        data={"esperado": str(person["id"])},
    )
    client.get("/api/reportes/historial.csv")
    client.get("/api/reportes/analisis.csv")
    client.post("/api/modelos/entrenar")
    register("Sin Rostro", "sin.rostro@example.com")
    client.post("/api/personas/limpiar-sin-rostros")
    client.delete(f"/api/personas/{person['id']}")
    TestClient(client.app, headers=authorization(make_user(db, ROLE_VIEWER))).post(
        "/api/personas", json={"nombre": "X Y", "email": "x@y.co", "consentimiento_version": "v0"}
    )
    return token


def test_every_kind_of_action_leaves_a_row(a_busy_day, db: Session):
    written = {(r.accion, r.resultado) for r in db.scalars(select(Auditoria))}
    assert written == {
        ("login", "fallo"),
        ("login", "ok"),
        ("cambio_clave", "ok"),
        ("usuario_crear", "ok"),
        ("usuario_actualizar", "ok"),
        ("persona_crear", "ok"),
        ("rostros_registrar", "ok"),
        ("persona_desactivar", "ok"),
        ("persona_activar", "ok"),
        ("reconocimiento", "ok"),
        ("csv_historial", "ok"),
        ("csv_analisis", "ok"),
        ("entrenar", "fallo"),
        ("personas_limpiar", "ok"),
        ("persona_eliminar", "ok"),
        ("denegado", "denegado"),
    }


def test_the_rows_are_in_the_order_things_happened(a_busy_day, client: TestClient):
    order = [row["accion"] for row in reversed(listing(client, limite=200)["registros"])]
    assert order[0] == "login" and order[-1] == "denegado"
    assert (
        order.index("persona_crear")
        < order.index("rostros_registrar")
        < order.index("persona_eliminar")
    )


def test_what_the_people_did_says_who_did_it_and_on_what(
    a_busy_day, client: TestClient, db: Session
):
    rows = {r["accion"]: r for r in listing(client, limite=200)["registros"]}
    assert rows["rostros_registrar"]["detalle"] == "2 imágenes"
    assert (rows["rostros_registrar"]["recurso"], rows["persona_eliminar"]["recurso"]) == (
        "persona",
        "persona",
    )
    assert rows["personas_limpiar"]["detalle"] == "1 personas sin rostros"
    assert rows["reconocimiento"]["detalle"] == "coincide; evaluación: acierto"
    assert rows["entrenar"]["resultado"] == "fallo"
    assert rows["csv_historial"]["detalle"] == "modelo: en uso"
    assert rows["usuario_actualizar"]["detalle"] == "contraseña restablecida"
    assert rows["denegado"]["detalle"] == "POST /api/personas"
    assert rows["denegado"]["usuario_email"] == f"{ROLE_VIEWER}@example.com"


def test_no_password_token_or_name_of_a_person_is_ever_written(a_busy_day, db: Session):
    text = everything_written(db)
    for private in (
        PASSWORD,
        NEW_PASSWORD,
        USER_PASSWORD,
        "no-es-esta-clave",
        a_busy_day,  # the token of the sign-in
        "argon2",
        NAME,
        "Zulema",
        "Quispe",
        PERSON_EMAIL,
        "sin.rostro@example.com",
        "Sin Rostro",
    ):
        assert private not in text, private


def test_nothing_is_recorded_as_done_when_the_action_failed(client: TestClient, db: Session):
    client.delete("/api/personas/999")
    client.patch("/api/personas/999", json={"activo": False})
    client.patch("/api/usuarios/999", json={"nombre": "Nadie Real"})
    client.post("/api/personas", json={"nombre": "A"})
    assert db.scalars(select(Auditoria)).all() == []
