"""Add-on mode: accept requests only from Home Assistant Ingress.

The add-on has no login of its own (Home Assistant signs users in for Ingress),
and every add-on on the hassio network can reach port 8000 directly. So in
add-on mode only the Supervisor, which proxies Ingress, and loopback get in.
The add-on option ``allow_direct_access`` (``MESHCORE_HA_ALLOW_DIRECT``) lifts
this for users who map the port on purpose.

Supervisor address: ``DOCKER_IPV4_NETWORK_MASK[2]`` of 172.30.32.0/23
(supervisor/const.py, supervisor/docker/network.py).
"""

from __future__ import annotations

import json

INGRESS_PROXY_IP = "172.30.32.2"
_ALLOWED = frozenset({INGRESS_PROXY_IP, "127.0.0.1", "::1"})
_BODY = json.dumps(
    {"detail": "Only Home Assistant Ingress may use this add-on (see allow_direct_access)"}
).encode("utf-8")


class IngressOnlyMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        if client and client[0] in _ALLOWED:
            await self.app(scope, receive, send)
            return
        prefix = "websocket.http" if scope["type"] == "websocket" else "http"
        await send(
            {
                "type": f"{prefix}.response.start",
                "status": 403,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"cache-control", b"no-store"),
                    (b"content-length", str(len(_BODY)).encode("ascii")),
                ],
            }
        )
        await send({"type": f"{prefix}.response.body", "body": _BODY})


def add_ha_addon_access_middleware(app, settings) -> None:
    """Install the guard in add-on mode unless direct access is allowed."""
    if getattr(settings, "ha_addon", False) is not True:
        return
    if getattr(settings, "ha_allow_direct", False) is True:
        return
    app.add_middleware(IngressOnlyMiddleware)
