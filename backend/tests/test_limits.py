import pytest
from fastapi.testclient import TestClient

from app.core import rate_limit
from app.core.config import Settings, get_settings
from app.core.middleware import TOO_LARGE, TOO_MANY
from app.core.rate_limit import SlidingWindowLimiter
from app.main import create_app

ORIGIN = {"Origin": "http://localhost:5173"}
LOGIN = {"email": "x@example.com", "clave": "cualquiera"}
KEY = "x" * 40


def chunks(*sizes: int):
    """A body sent in pieces, so that the request does not say how big it is."""
    for size in sizes:
        yield b"x" * size


# --- the limiter ---------------------------------------------------------------------------


def test_it_lets_through_as_many_as_the_limit_and_then_says_how_long_to_wait():
    limiter = SlidingWindowLimiter()
    assert [limiter.allow("a", 3, now=n)[0] for n in (0, 1, 2)] == [True, True, True]
    assert limiter.allow("a", 3, now=3) == (False, 58)


def test_the_time_to_wait_is_at_least_a_second_and_at_most_the_window():
    limiter = SlidingWindowLimiter()
    limiter.allow("a", 1, now=0)
    assert limiter.allow("a", 1, now=59.5) == (False, 1)
    assert limiter.allow("a", 1, now=0.001) == (False, 60)


def test_the_window_slides_so_the_oldest_hit_frees_a_place_first():
    limiter = SlidingWindowLimiter()
    for moment in (0, 30, 40):
        assert limiter.allow("a", 3, now=moment)[0] is True
    assert limiter.allow("a", 3, now=59)[0] is False
    assert limiter.allow("a", 3, now=61)[0] is True  # the one of second 0 has left
    assert limiter.allow("a", 3, now=62)[0] is False  # 30, 40 and 61 are still inside


def test_a_hit_exactly_one_window_old_no_longer_counts():
    limiter = SlidingWindowLimiter()
    limiter.allow("a", 1, now=0)
    assert limiter.allow("a", 1, now=59.99)[0] is False
    assert limiter.allow("a", 1, now=60)[0] is True


def test_a_refused_request_does_not_extend_the_wait():
    limiter = SlidingWindowLimiter()
    limiter.allow("a", 1, now=0)
    for moment in (10, 20, 30, 40, 50):
        assert limiter.allow("a", 1, now=moment)[0] is False
    assert limiter.allow("a", 1, now=60)[0] is True


def test_every_key_is_counted_on_its_own():
    limiter = SlidingWindowLimiter()
    assert limiter.allow("a", 1, now=0)[0] is True
    assert limiter.allow("a", 1, now=1)[0] is False
    assert limiter.allow("b", 1, now=1)[0] is True


def test_a_window_of_its_own_can_be_given():
    limiter = SlidingWindowLimiter()
    limiter.allow("a", 1, window=5, now=0)
    assert limiter.allow("a", 1, window=5, now=4)[0] is False
    assert limiter.allow("a", 1, window=5, now=5)[0] is True


def test_resetting_forgets_everything():
    limiter = SlidingWindowLimiter()
    limiter.allow("a", 1, now=0)
    limiter.reset()
    assert limiter.allow("a", 1, now=1)[0] is True


def test_the_keys_that_went_quiet_are_forgotten_once_there_are_too_many(monkeypatch):
    monkeypatch.setattr(rate_limit, "PRUNE_ABOVE", 5)
    limiter = SlidingWindowLimiter()
    for number in range(5):
        limiter.allow(f"old{number}", 1, now=0)
    limiter.allow("active", 1, now=100)
    limiter.allow("newer", 1, now=100)
    assert set(limiter._hits) == {"active", "newer"}
    assert limiter.allow("active", 1, now=101)[0] is False


def test_without_a_moment_it_uses_the_clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now[0])
    limiter = SlidingWindowLimiter()
    assert limiter.allow("a", 1)[0] is True
    assert limiter.allow("a", 1)[0] is False
    now[0] += 61
    assert limiter.allow("a", 1)[0] is True


# --- too many requests ---------------------------------------------------------------------


def test_after_the_limit_a_request_is_a_429_with_when_to_try_again(
    client: TestClient, use_settings
):
    use_settings(api_rate_per_minute=3)
    assert [client.get("/api/personas").status_code for _ in range(3)] == [200, 200, 200]
    response = client.get("/api/personas")
    assert response.status_code == 429
    assert response.json() == {"success": False, "error": TOO_MANY}
    assert 1 <= int(response.headers["retry-after"]) <= 60


def test_the_limit_counts_every_kind_of_request_and_every_route(client: TestClient, use_settings):
    use_settings(api_rate_per_minute=3)
    client.get("/api/personas")
    client.get("/api/no-existe")
    client.post("/api/personas", json={})
    assert client.get("/api/dashboard/resumen").status_code == 429


def test_the_window_slides_in_the_api_too(client: TestClient, use_settings, monkeypatch):
    use_settings(api_rate_per_minute=2)
    now = [500.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: now[0])
    client.get("/api/personas")
    client.get("/api/personas")
    assert client.get("/api/personas").status_code == 429
    now[0] += 61
    assert client.get("/api/personas").status_code == 200


def test_the_health_check_of_the_hosting_is_never_limited(client: TestClient, use_settings):
    use_settings(api_rate_per_minute=1)
    client.get("/api/personas")
    assert client.get("/api/personas").status_code == 429
    assert [client.get("/api/health").status_code for _ in range(5)] == [200] * 5


def test_the_health_check_does_not_use_up_the_limit(client: TestClient, use_settings):
    use_settings(api_rate_per_minute=1)
    for _ in range(5):
        client.get("/api/health")
    assert client.get("/api/personas").status_code == 200


def test_the_preflight_of_the_browser_is_never_limited(client: TestClient, use_settings):
    use_settings(api_rate_per_minute=1)
    client.get("/api/personas")
    assert client.get("/api/personas").status_code == 429
    for _ in range(3):
        response = client.options(
            "/api/personas", headers={**ORIGIN, "Access-Control-Request-Method": "GET"}
        )
        assert response.status_code == 200


def test_an_options_request_that_is_not_a_preflight_is_never_limited_either(
    client: TestClient, use_settings
):
    # A preflight is answered by CORS before it reaches the limit; any other OPTIONS gets here
    use_settings(api_rate_per_minute=1)
    client.get("/api/personas")
    assert client.get("/api/personas").status_code == 429
    for _ in range(3):
        assert client.options("/api/personas").status_code != 429


def test_what_is_not_the_api_is_not_limited(client: TestClient, use_settings):
    use_settings(api_rate_per_minute=1)
    client.get("/api/personas")
    assert client.get("/api/personas").status_code == 429
    assert client.get("/openapi.json").status_code == 200


def test_a_limited_answer_still_lets_the_browser_read_it(client: TestClient, use_settings):
    use_settings(api_rate_per_minute=1)
    client.get("/api/personas", headers=ORIGIN)
    response = client.get("/api/personas", headers=ORIGIN)
    assert response.status_code == 429
    assert response.headers["access-control-allow-origin"] == ORIGIN["Origin"]


def test_each_address_has_its_own_count_when_the_forwarded_one_is_trusted(
    client: TestClient, use_settings
):
    use_settings(api_rate_per_minute=1, trust_forwarded_for=True)
    first = {"X-Forwarded-For": "1.1.1.1"}
    second = {"X-Forwarded-For": "2.2.2.2"}
    assert client.get("/api/personas", headers=first).status_code == 200
    assert client.get("/api/personas", headers=first).status_code == 429
    assert client.get("/api/personas", headers=second).status_code == 200


def test_the_forwarded_address_cannot_be_used_to_escape_the_limit_unless_it_is_trusted(
    client: TestClient, use_settings
):
    use_settings(api_rate_per_minute=1)
    assert client.get("/api/personas", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    assert client.get("/api/personas", headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 429


def test_faking_an_earlier_forwarded_address_does_not_help_either(client: TestClient, use_settings):
    # Only the last entry is ours (the proxy added it): what the caller wrote before it is ignored
    use_settings(api_rate_per_minute=1, trust_forwarded_for=True)
    assert (
        client.get("/api/personas", headers={"X-Forwarded-For": "9.9.9.1, 7.7.7.7"}).status_code
        == 200
    )
    assert (
        client.get("/api/personas", headers={"X-Forwarded-For": "9.9.9.2, 7.7.7.7"}).status_code
        == 429
    )


def test_the_limit_comes_before_the_sign_in_so_an_attacker_is_stopped_early(
    anonymous: TestClient, use_settings
):
    use_settings(api_rate_per_minute=2, login_rate_per_minute=100)
    for _ in range(2):
        assert anonymous.post("/api/auth/login", json=LOGIN).status_code == 401
    response = anonymous.post("/api/auth/login", json=LOGIN)
    assert (response.status_code, response.json()["error"]) == (429, TOO_MANY)


def test_the_default_limits_leave_room_for_normal_use():
    settings = Settings(_env_file=None)
    assert settings.api_rate_per_minute == 120
    assert settings.login_rate_per_minute == 10


# --- requests that are too big -------------------------------------------------------------


def test_a_request_that_says_it_is_too_big_is_refused_before_it_is_read(
    client: TestClient, use_settings
):
    use_settings(max_request_bytes=2048)
    response = client.post(
        "/api/personas", content=b"x" * 3000, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert response.json() == {"success": False, "error": TOO_LARGE}


def test_a_request_that_does_not_say_how_big_it_is_is_stopped_while_it_is_read(
    client: TestClient, use_settings
):
    use_settings(max_request_bytes=2048)
    response = client.post(
        "/api/personas",
        content=chunks(1000, 1000, 1000),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json() == {"success": False, "error": TOO_LARGE}


def test_a_request_that_lies_about_its_size_is_stopped_all_the_same(
    client: TestClient, use_settings
):
    use_settings(max_request_bytes=2048)
    response = client.post(
        "/api/personas",
        content=chunks(1500, 1500),
        headers={"Content-Type": "application/json", "Content-Length": "100"},
    )
    # What the server can honestly say is either the size or that the body does not match
    assert response.status_code in (400, 413)


def test_a_request_of_exactly_the_limit_goes_through(client: TestClient, use_settings):
    use_settings(max_request_bytes=2048)
    response = client.post(
        "/api/personas", content=b" " * 2048, headers={"Content-Type": "application/json"}
    )
    assert response.status_code != 413


def test_one_byte_over_the_limit_is_refused(client: TestClient, use_settings):
    use_settings(max_request_bytes=2048)
    response = client.post(
        "/api/personas", content=b" " * 2049, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413


def test_a_request_within_the_limit_is_still_handled_normally(client: TestClient, use_settings):
    use_settings(max_request_bytes=2048)
    response = client.post(
        "/api/personas",
        json={
            "nombre": "Ana Torres",
            "email": "ana@example.com",
            "consentimiento_version": "v0-provisional",
        },
    )
    assert response.status_code == 201


def test_a_too_big_answer_still_lets_the_browser_read_it(client: TestClient, use_settings):
    use_settings(max_request_bytes=2048)
    for content in (b"x" * 3000, chunks(1500, 1500)):
        response = client.post(
            "/api/personas",
            content=content,
            headers={**ORIGIN, "Content-Type": "application/json"},
        )
        assert response.status_code == 413
        assert response.headers["access-control-allow-origin"] == ORIGIN["Origin"]


def test_a_too_big_upload_of_pictures_is_refused_whoever_sends_it(
    client: TestClient, use_settings, make_image
):
    use_settings(max_request_bytes=2048)
    response = client.post(
        "/api/reconocimiento", files={"imagen": ("cara.png", make_image(1), "image/png")}
    )
    assert response.status_code == 413


def test_a_too_big_request_from_someone_not_signed_in_is_refused_too(
    anonymous: TestClient, use_settings
):
    use_settings(max_request_bytes=2048)
    response = anonymous.post("/api/auth/login", content=b"x" * 3000)
    assert response.status_code == 413


def test_the_default_limit_fits_the_most_pictures_a_person_may_have_plus_the_form():
    settings = Settings(_env_file=None)
    pictures = settings.max_images_per_person * settings.max_image_bytes
    assert pictures < settings.max_request_bytes <= pictures + 2 * 1024 * 1024


def test_a_limit_that_would_refuse_every_normal_request_is_not_accepted():
    with pytest.raises(ValueError):
        Settings(_env_file=None, max_request_bytes=10)


# --- headers -------------------------------------------------------------------------------

DEVELOPMENT_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "cache-control": "no-store",
}
PRODUCTION_ONLY = ("strict-transport-security", "content-security-policy")


def check_headers(response, production: bool = False):
    for name, value in DEVELOPMENT_HEADERS.items():
        assert response.headers.get(name) == value, name
    for name in PRODUCTION_ONLY:
        assert (name in response.headers) is production, name


@pytest.mark.parametrize(
    ("method", "path", "status"),
    [
        ("GET", "/api/health", 200),
        ("GET", "/api/personas", 200),
        ("GET", "/api/no-existe", 404),
        ("DELETE", "/api/health", 405),
        ("POST", "/api/personas", 422),
        ("GET", "/api/reportes/historial.csv", 200),
    ],
)
def test_every_answer_carries_the_security_headers(
    client: TestClient, method: str, path: str, status: int
):
    response = client.request(method, path)
    assert response.status_code == status
    check_headers(response)


def test_the_answers_to_someone_not_signed_in_carry_them_too(anonymous: TestClient):
    response = anonymous.get("/api/personas")
    assert response.status_code == 401
    check_headers(response)


def test_the_answers_that_are_refused_by_the_limits_carry_them_too(
    client: TestClient, use_settings
):
    use_settings(api_rate_per_minute=1, max_request_bytes=2048)
    client.get("/api/personas")
    limited = client.get("/api/personas")
    assert limited.status_code == 429
    check_headers(limited)
    use_settings(api_rate_per_minute=100, max_request_bytes=2048)
    big = client.post("/api/personas", content=b"x" * 3000)
    assert big.status_code == 413
    check_headers(big)


def test_the_answer_to_a_crash_carries_them_too(client: TestClient, monkeypatch):
    from app.services import persona_service

    def explode(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(persona_service, "list_personas", explode)
    response = client.get("/api/personas")
    assert response.status_code == 500
    check_headers(response)


def test_in_development_there_is_no_hsts_and_no_csp(client: TestClient):
    response = client.get("/api/health")
    assert "strict-transport-security" not in response.headers
    assert "content-security-policy" not in response.headers


def test_in_production_the_browser_is_also_told_to_use_https_and_load_nothing(
    client: TestClient, use_settings
):
    use_settings(environment="production", jwt_secret=KEY)
    for path in ("/api/health", "/api/personas", "/api/no-existe"):
        response = client.get(path)
        check_headers(response, production=True)
        assert response.headers["strict-transport-security"] == (
            "max-age=31536000; includeSubDomains"
        )
        assert response.headers["content-security-policy"] == (
            "default-src 'none'; frame-ancestors 'none'"
        )


def test_the_headers_are_not_set_twice(client: TestClient):
    response = client.get("/api/health")
    for name in DEVELOPMENT_HEADERS:
        assert len(response.headers.get_list(name)) == 1


def test_a_header_a_route_chose_is_respected(client: TestClient):
    from app.main import app

    @app.get("/api/_prueba_cabeceras")
    def route():
        from fastapi.responses import JSONResponse

        return JSONResponse({}, headers={"Cache-Control": "max-age=5"})

    try:
        response = client.get("/api/_prueba_cabeceras")
        assert response.headers["cache-control"] == "max-age=5"
    finally:
        app.router.routes.pop()


# --- documentation and production ----------------------------------------------------------


@pytest.fixture
def built_app(monkeypatch):
    """A new app built as the server would build it with these variables in its environment."""

    def build(**environment: str) -> TestClient:
        for name, value in environment.items():
            monkeypatch.setenv(name, value)
        get_settings.cache_clear()
        return TestClient(create_app())

    yield build
    get_settings.cache_clear()


DOCS = ("/docs", "/redoc", "/openapi.json")


def test_in_development_the_documentation_is_there(built_app):
    client = built_app(ENVIRONMENT="development")
    assert [client.get(path).status_code for path in DOCS] == [200, 200, 200]


def test_in_production_the_documentation_and_the_map_of_the_api_are_gone(built_app):
    client = built_app(ENVIRONMENT="production", JWT_SECRET=KEY)
    assert [client.get(path).status_code for path in DOCS] == [404, 404, 404]
    # There is no engine here (the start-up did not run), so the health check says so: 503, not 404
    assert client.get("/api/health").status_code == 503


def test_in_production_the_api_still_asks_for_a_session(built_app):
    client = built_app(ENVIRONMENT="production", JWT_SECRET=KEY)
    assert client.get("/api/personas").status_code == 401


def test_in_production_the_headers_come_from_the_app_as_it_is_built(built_app):
    client = built_app(ENVIRONMENT="production", JWT_SECRET=KEY)
    check_headers(client.get("/api/health"), production=True)


def test_production_does_not_start_without_a_secret_of_its_own(built_app):
    with pytest.raises(ValueError, match="JWT_SECRET"):
        built_app(ENVIRONMENT="production", JWT_SECRET="corta")


def test_every_app_has_a_limiter_of_its_own(built_app):
    first, second = built_app(), built_app()
    assert first.app.state.rate_limiter is not second.app.state.rate_limiter


def test_a_request_that_says_it_is_too_big_never_reaches_the_app_nor_has_its_body_read():
    import asyncio

    from app.core.config import get_settings
    from app.core.middleware import RequestSizeLimitMiddleware

    class FakeApp:
        dependency_overrides = {
            get_settings: lambda: Settings(_env_file=None, max_request_bytes=2048)
        }

    reached, reads, sent = [], [], []

    async def inner(scope, receive, send):
        reached.append(True)

    async def receive():
        reads.append(True)
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/personas",
        "headers": [(b"content-length", b"999999")],
        "app": FakeApp(),
    }
    asyncio.run(RequestSizeLimitMiddleware(inner)(scope, receive, send))
    assert (reached, reads) == ([], [])
    assert sent[0]["status"] == 413
