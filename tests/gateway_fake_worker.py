"""Tiny stand-in for a radio worker, used by the gateway tests (plan 30).

Checks the worker token the same way the real app does, reports a public key
from ``FAKE_PUBLIC_KEY``, and echoes requests so tests can see what arrived.
"""

from __future__ import annotations

import os

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse

TOKEN_HEADER = "x-rtfm-worker-token"

app = FastAPI()


def _token_ok(headers) -> bool:
    expected = os.environ.get("MESHCORE_WORKER_TOKEN", "")
    return not expected or headers.get(TOKEN_HEADER) == expected


@app.middleware("http")
async def require_token(request: Request, call_next):
    if not _token_ok(request.headers):
        return JSONResponse({"detail": "Forbidden"}, status_code=403)
    return await call_next(request)


@app.get("/")
async def index():
    status = int(os.environ.get("FAKE_INDEX_STATUS", "200"))
    return HTMLResponse("<h1>fake worker</h1>", status_code=status)


@app.get("/api/health")
async def health():
    key = os.environ.get("FAKE_PUBLIC_KEY") or None
    return {
        "status": "degraded",
        "radio_connected": False,
        "radio_identity": {"public_key": key, "name": "Fake"} if key else None,
    }


@app.api_route("/api/echo", methods=["GET", "POST"])
async def echo(request: Request):
    body = await request.body()
    response = JSONResponse(
        {
            "method": request.method,
            "query": request.url.query,
            "headers": dict(request.headers),
            "body": body.decode("utf-8"),
        }
    )
    response.headers["server"] = "fake-worker"
    response.raw_headers.append((b"set-cookie", b"a=1"))
    response.raw_headers.append((b"set-cookie", b"b=2"))
    return response


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    if not _token_ok(websocket.headers):
        await websocket.close(code=4403)
        return
    await websocket.accept()
    await websocket.send_json(
        {
            "type": "health",
            "prefix": websocket.headers.get("x-forwarded-prefix"),
            "query": websocket.url.query,
        }
    )
    try:
        while True:
            text = await websocket.receive_text()
            await websocket.send_text(f"echo:{text}")
    except Exception:
        return
