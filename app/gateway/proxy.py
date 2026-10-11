"""HTTP and WebSocket pass-through from the gateway to one radio worker."""

from __future__ import annotations

import asyncio
import contextlib
import logging

import httpx
import websockets
from fastapi import Request, WebSocket
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from app.security import WORKER_TOKEN_HEADER

logger = logging.getLogger(__name__)

HOP_BY_HOP = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "host",
    }
)
_FORWARDED = frozenset({"x-forwarded-prefix", "x-forwarded-host", "x-forwarded-proto"})
# The gateway's own server adds date and server again (seen doubled in the spike).
_DROPPED_RESPONSE_HEADERS = HOP_BY_HOP | {"date", "server"}
WORKER_UNAVAILABLE = {"detail": "Radio worker is not available"}


def _full_prefix(headers, prefix: str) -> str:
    """Our /r/<key> prefix behind whatever sub-path an outer proxy already added."""
    return headers.get("x-forwarded-prefix", "").rstrip("/") + prefix


async def proxy_http(
    request: Request,
    *,
    client: httpx.AsyncClient,
    port: int,
    token: str,
    prefix: str,
    path: str,
) -> Response:
    incoming = request.headers
    blocked = HOP_BY_HOP | _FORWARDED | {WORKER_TOKEN_HEADER}
    headers = [(k, v) for k, v in incoming.items() if k.lower() not in blocked]
    headers += [
        (WORKER_TOKEN_HEADER, token),
        ("x-forwarded-prefix", _full_prefix(incoming, prefix)),
        ("x-forwarded-host", incoming.get("x-forwarded-host") or incoming.get("host", "")),
        ("x-forwarded-proto", incoming.get("x-forwarded-proto") or request.url.scheme),
    ]
    if "accept-encoding" not in incoming:
        # httpx would add its own Accept-Encoding and the worker would then gzip
        # a response for a client that never asked for it.
        headers.append(("accept-encoding", "identity"))
    url = f"http://127.0.0.1:{port}/{path}"
    if request.url.query:
        url += f"?{request.url.query}"
    has_body = "content-length" in incoming or "transfer-encoding" in incoming
    try:
        upstream = await client.send(
            client.build_request(
                request.method,
                url,
                headers=headers,
                content=request.stream() if has_body else None,
            ),
            stream=True,
        )
    except httpx.TransportError:
        return JSONResponse(WORKER_UNAVAILABLE, status_code=503)

    response = StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        background=BackgroundTask(upstream.aclose),
    )
    response.raw_headers = [
        (k.encode("latin-1"), v.encode("latin-1"))
        for k, v in upstream.headers.multi_items()
        if k.lower() not in _DROPPED_RESPONSE_HEADERS
    ]
    return response


async def proxy_websocket(
    websocket: WebSocket, *, port: int, token: str, prefix: str, path: str
) -> None:
    url = f"ws://127.0.0.1:{port}/{path}"
    if websocket.url.query:
        url += f"?{websocket.url.query}"
    try:
        upstream = await websockets.connect(
            url,
            additional_headers={
                WORKER_TOKEN_HEADER: token,
                "x-forwarded-prefix": _full_prefix(websocket.headers, prefix),
            },
            max_size=None,
            open_timeout=5,
        )
    except (OSError, TimeoutError, websockets.WebSocketException):
        await websocket.close(code=1013)
        return

    await websocket.accept()

    async def client_to_upstream() -> None:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            if message.get("text") is not None:
                await upstream.send(message["text"])
            elif message.get("bytes") is not None:
                await upstream.send(message["bytes"])

    async def upstream_to_client() -> None:
        async for message in upstream:
            if isinstance(message, str):
                await websocket.send_text(message)
            else:
                await websocket.send_bytes(message)

    tasks = [asyncio.create_task(client_to_upstream()), asyncio.create_task(upstream_to_client())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks:
            task.cancel()
        try:
            # asyncio.wait, not gather: if this coroutine is cancelled right here,
            # gather re-raises a child's CancelledError and the canceller's own
            # message is lost (anyio cancel scopes then no longer recognise it).
            await asyncio.wait(tasks)
        finally:
            for task in tasks:
                if task.done() and not task.cancelled():
                    task.exception()  # a closed connection on either side is expected
            await upstream.close()
    with contextlib.suppress(Exception):
        await websocket.close()
