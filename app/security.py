"""ASGI middleware for optional app-wide HTTP Basic authentication."""

from __future__ import annotations

import base64
import binascii
import json
import logging
import secrets
from typing import Any

from starlette.datastructures import Headers

logger = logging.getLogger(__name__)

_AUTH_REALM = "RemoteTerm"
_UNAUTHORIZED_BODY = json.dumps({"detail": "Unauthorized"}).encode("utf-8")


class BasicAuthMiddleware:
    """Protect all HTTP and WebSocket entrypoints with HTTP Basic auth."""

    def __init__(self, app, *, username: str, password: str, realm: str = _AUTH_REALM) -> None:
        self.app = app
        self.username = username
        self.password = password
        self.realm = realm
        self._challenge_value = f'Basic realm="{realm}", charset="UTF-8"'.encode("latin-1")

    def _is_authorized(self, scope: dict[str, Any]) -> bool:
        headers = Headers(scope=scope)
        authorization = headers.get("authorization")
        if not authorization:
            return False

        scheme, _, token = authorization.partition(" ")
        if not token or scheme.lower() != "basic":
            return False

        token = token.strip()
        try:
            decoded = base64.b64decode(token, validate=True).decode("utf-8")
        except (binascii.Error, UnicodeDecodeError):
            logger.debug("Rejecting malformed basic auth header")
            return False

        username, sep, password = decoded.partition(":")
        if not sep:
            return False

        return secrets.compare_digest(username, self.username) and secrets.compare_digest(
            password, self.password
        )

    async def _send_http_unauthorized(self, send) -> None:
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"cache-control", b"no-store"),
                    (b"content-length", str(len(_UNAUTHORIZED_BODY)).encode("ascii")),
                    (b"www-authenticate", self._challenge_value),
                ],
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": _UNAUTHORIZED_BODY,
            }
        )

    async def _send_websocket_unauthorized(self, send) -> None:
        await send(
            {
                "type": "websocket.http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"cache-control", b"no-store"),
                    (b"content-length", str(len(_UNAUTHORIZED_BODY)).encode("ascii")),
                    (b"www-authenticate", self._challenge_value),
                ],
            }
        )
        await send(
            {
                "type": "websocket.http.response.body",
                "body": _UNAUTHORIZED_BODY,
            }
        )

    async def __call__(self, scope, receive, send) -> None:
        scope_type = scope["type"]
        if scope_type not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return

        if self._is_authorized(scope):
            await self.app(scope, receive, send)
            return

        if scope_type == "http":
            await self._send_http_unauthorized(send)
            return

        await self._send_websocket_unauthorized(send)


def add_optional_basic_auth_middleware(app, settings) -> None:
    """Enable app-wide basic auth when configured via environment variables."""
    if not settings.basic_auth_enabled:
        return

    app.add_middleware(
        BasicAuthMiddleware,
        username=settings.basic_auth_username,
        password=settings.basic_auth_password,
    )


WORKER_TOKEN_HEADER = "x-rtfm-worker-token"
_FORBIDDEN_BODY = json.dumps({"detail": "Forbidden"}).encode("utf-8")


class WorkerTokenMiddleware:
    """Multi-radio mode: only serve requests that came through the gateway.

    The gateway starts each worker with a random token and adds it to every
    request it forwards. Without this, any local process could reach a worker
    on its loopback port and skip the gateway's Basic auth.
    """

    def __init__(self, app, *, token: str) -> None:
        self.app = app
        self._token = token.encode("utf-8")

    async def __call__(self, scope, receive, send) -> None:
        scope_type = scope["type"]
        if scope_type not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return

        supplied = Headers(scope=scope).get(WORKER_TOKEN_HEADER, "")
        if secrets.compare_digest(supplied.encode("utf-8"), self._token):
            await self.app(scope, receive, send)
            return

        prefix = "websocket.http.response" if scope_type == "websocket" else "http.response"
        await send(
            {
                "type": f"{prefix}.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"cache-control", b"no-store"),
                    (b"content-length", str(len(_FORBIDDEN_BODY)).encode("ascii")),
                ],
            }
        )
        await send({"type": f"{prefix}.body", "body": _FORBIDDEN_BODY})


def add_optional_worker_token_middleware(app, settings) -> None:
    """Gate the app behind the gateway's token when one is configured."""
    if not settings.worker_token:
        return

    app.add_middleware(WorkerTokenMiddleware, token=settings.worker_token)
