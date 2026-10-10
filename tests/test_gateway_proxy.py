"""Tests for the gateway's HTTP and WebSocket pass-through (plan 30)."""

from __future__ import annotations

import asyncio
import json
import socket
import threading
import time

import httpx
import pytest
import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.testclient import TestClient
from gateway_fake_worker import app as fake_worker

from app.gateway.proxy import proxy_http, proxy_websocket
from app.security import WORKER_TOKEN_HEADER

TOKEN = "tok-123"


def _gateway(client: httpx.AsyncClient, *, port: int = 1) -> FastAPI:
    """Smallest app that forwards /r/k/<path> through the proxy functions."""
    gateway = FastAPI()

    @gateway.api_route("/r/k/{path:path}", methods=["GET", "POST"])
    async def http_route(path: str, request: Request):
        return await proxy_http(
            request, client=client, port=port, token=TOKEN, prefix="/r/k", path=path
        )

    @gateway.websocket("/r/k/{path:path}")
    async def ws_route(websocket: WebSocket, path: str):
        await proxy_websocket(websocket, port=port, token=TOKEN, prefix="/r/k", path=path)

    return gateway


@pytest.fixture
def worker_client(monkeypatch):
    monkeypatch.setenv("MESHCORE_WORKER_TOKEN", TOKEN)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=fake_worker))


async def _call(gateway: FastAPI, method: str, url: str, **kwargs) -> httpx.Response:
    transport = httpx.ASGITransport(app=gateway)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as client:
        return await client.request(method, url, **kwargs)


async def test_get_forwards_path_query_and_adds_gateway_headers(worker_client):
    response = await _call(_gateway(worker_client), "GET", "/r/k/api/echo?a=1&b=two")
    assert response.status_code == 200
    seen = response.json()
    assert seen["query"] == "a=1&b=two"
    assert seen["headers"][WORKER_TOKEN_HEADER] == TOKEN
    assert seen["headers"]["x-forwarded-prefix"] == "/r/k"
    assert seen["headers"]["x-forwarded-host"] == "gw.test"
    assert seen["headers"]["x-forwarded-proto"] == "http"


async def test_client_cannot_supply_the_worker_token(worker_client):
    response = await _call(
        _gateway(worker_client), "GET", "/r/k/api/echo", headers={WORKER_TOKEN_HEADER: "forged"}
    )
    assert response.status_code == 200
    assert response.json()["headers"][WORKER_TOKEN_HEADER] == TOKEN


async def test_outer_proxy_prefix_is_kept(worker_client):
    response = await _call(
        _gateway(worker_client),
        "GET",
        "/r/k/api/echo",
        headers={
            "x-forwarded-prefix": "/meshcore/",
            "x-forwarded-host": "public.example",
            "x-forwarded-proto": "https",
        },
    )
    seen = response.json()["headers"]
    assert seen["x-forwarded-prefix"] == "/meshcore/r/k"
    assert seen["x-forwarded-host"] == "public.example"
    assert seen["x-forwarded-proto"] == "https"


async def test_post_body_is_forwarded(worker_client):
    response = await _call(_gateway(worker_client), "POST", "/r/k/api/echo", content=b"hello radio")
    assert response.json()["method"] == "POST"
    assert response.json()["body"] == "hello radio"


async def test_response_headers_keep_duplicates_and_drop_server(worker_client):
    response = await _call(_gateway(worker_client), "GET", "/r/k/api/echo")
    assert response.headers.get_list("set-cookie") == ["a=1", "b=2"]
    assert "fake-worker" not in response.headers.get_list("server")


async def _raw_get(gateway: FastAPI, path: str, headers: list[tuple[bytes, bytes]] | None = None):
    """Call the ASGI app with exactly these headers (an httpx client adds its own)."""
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"gw.test"), *(headers or [])],
        "client": ("127.0.0.1", 1),
        "server": ("gw.test", 80),
    }
    messages: list[dict] = []

    request_sent = False

    async def receive():
        nonlocal request_sent
        if request_sent:
            # Stay connected: a second message would have to be http.disconnect.
            await asyncio.Event().wait()
        request_sent = True
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await gateway(scope, receive, send)
    body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    return messages[0]["status"], json.loads(body)


async def test_client_without_accept_encoding_gets_an_uncompressed_response(worker_client):
    status, seen = await _raw_get(_gateway(worker_client), "/r/k/api/echo")
    assert status == 200
    assert seen["headers"]["accept-encoding"] == "identity"


async def test_client_accept_encoding_is_passed_through(worker_client):
    _, seen = await _raw_get(
        _gateway(worker_client), "/r/k/api/echo", headers=[(b"accept-encoding", b"gzip")]
    )
    assert seen["headers"]["accept-encoding"] == "gzip"


async def test_unreachable_worker_gives_503():
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(refuse))
    response = await _call(_gateway(client), "GET", "/r/k/api/echo")
    assert response.status_code == 503
    assert response.json() == {"detail": "Radio worker is not available"}


@pytest.fixture
def live_worker(monkeypatch):
    """The fake worker on a real loopback port (WebSockets need a socket)."""
    monkeypatch.setenv("MESHCORE_WORKER_TOKEN", TOKEN)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(fake_worker, host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.05)
    assert server.started
    yield port
    server.should_exit = True
    thread.join(timeout=10)


def test_websocket_is_proxied_both_ways(live_worker):
    gateway = _gateway(httpx.AsyncClient(), port=live_worker)
    with TestClient(gateway) as client:
        with client.websocket_connect("/r/k/api/ws?events=chat") as ws:
            first = ws.receive_json()
            assert first == {"type": "health", "prefix": "/r/k", "query": "events=chat"}
            ws.send_text("ping")
            assert ws.receive_text() == "echo:ping"


def test_websocket_to_unreachable_worker_is_closed():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        dead_port = probe.getsockname()[1]
    gateway = _gateway(httpx.AsyncClient(), port=dead_port)
    with TestClient(gateway) as client:
        with pytest.raises(Exception):  # noqa: B017 - handshake is refused, type varies
            with client.websocket_connect("/r/k/api/ws"):
                pass
