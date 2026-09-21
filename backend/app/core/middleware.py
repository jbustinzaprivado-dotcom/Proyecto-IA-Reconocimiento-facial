"""What every request goes through before it reaches a route: the size limit, the limit of requests
and the security headers. They read their settings on every request, so a test (or a restart with
another .env) can change them."""

from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings, get_settings
from app.core.errors import RequestTooLarge, error_response
from app.core.network import client_ip

TOO_LARGE = "La solicitud es demasiado grande."
TOO_MANY = "Demasiadas solicitudes. Espera un momento y vuelve a intentarlo."

# The requests of the load balancer of the hosting must never be limited
UNLIMITED_PATHS = {"/api/health"}


def settings_of(app) -> Settings:
    """The settings in force, honoring the overrides that tests put on the app."""
    factory = getattr(app, "dependency_overrides", {}).get(get_settings, get_settings)
    return factory()


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        production = settings_of(scope["app"]).is_production

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("X-Frame-Options", "DENY")
                headers.setdefault("Referrer-Policy", "no-referrer")
                headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
                # Everything here is personal data: nothing may stay in a cache
                headers.setdefault("Cache-Control", "no-store")
                if production:
                    headers.setdefault(
                        "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
                    )
                    headers.setdefault(
                        "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
                    )
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestSizeLimitMiddleware:
    """Refuses a request that is too big, by what it says it weighs and by what it really sends."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = settings_of(scope["app"]).max_request_bytes
        declared = Headers(scope=scope).get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await error_response(413, TOO_LARGE)(scope, receive, send)
            return

        received = 0
        too_large = False
        started = False

        async def limited_receive() -> Message:
            nonlocal received, too_large
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    too_large = True
                    raise RequestTooLarge
            return message

        async def guarded_send(message: Message) -> None:
            nonlocal started
            # FastAPI turns any failure while reading the body into its own 400: that answer is
            # dropped, because the one to give is ours
            if too_large and not started:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except RequestTooLarge:
            pass
        if too_large and not started:
            await error_response(413, TOO_LARGE)(scope, receive, send)


class RateLimitMiddleware:
    """Refuses more requests per minute than the limit, counted per address."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or not path.startswith("/api")
            or path in UNLIMITED_PATHS
            or scope["method"] == "OPTIONS"
        ):
            await self.app(scope, receive, send)
            return
        app = scope["app"]
        settings = settings_of(app)
        ip = client_ip(Request(scope), settings.trust_forwarded_for) or "desconocida"
        allowed, wait = app.state.rate_limiter.allow(f"api:{ip}", settings.api_rate_per_minute)
        if not allowed:
            response = error_response(429, TOO_MANY, headers={"Retry-After": str(wait)})
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
