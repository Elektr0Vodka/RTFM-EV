"""ASGI middleware that times ``/api`` HTTP requests by route template."""

import time
from typing import Any

from app.perf.recorders import routes

_SKIP_PREFIXES = ("/api/ws",)


class PerfRouteMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        path = scope.get("path", "") if scope.get("type") == "http" else ""
        if not path.startswith("/api/") or path.startswith(_SKIP_PREFIXES):
            await self.app(scope, receive, send)
            return

        status = 500
        started = time.perf_counter()

        async def send_wrapper(message: dict) -> None:
            nonlocal status
            if message.get("type") == "http.response.start":
                status = int(message.get("status", 500))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            route = scope.get("route")
            template = getattr(route, "path", None) or "(unmatched)"
            # FastAPI leaves the include_router prefix off the matched route.
            if template.startswith("/") and not template.startswith("/api/"):
                template = "/api" + template
            routes.record(
                scope.get("method", "GET"),
                template,
                (time.perf_counter() - started) * 1000,
                status,
            )
