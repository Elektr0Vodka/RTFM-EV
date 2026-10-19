"""The main Basic login lets the wardrive page and API through, and nothing else."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.security import add_optional_basic_auth_middleware


def _build_app(*, wardrive: bool) -> FastAPI:
    settings = Settings(
        serial_port="",
        tcp_host="",
        ble_address="",
        basic_auth_username="owner",
        basic_auth_password="secret",
        wardrive=wardrive,
    )
    app = FastAPI()
    add_optional_basic_auth_middleware(app, settings)

    @app.get("/{path:path}")
    async def anything(path: str):
        return {"path": path}

    return app


@pytest.mark.parametrize(
    "path", ["/wardrive", "/wardrive/", "/wardrive/assets/x.js", "/api/wardrive/me"]
)
def test_exempt_paths_pass_without_auth(path):
    with TestClient(_build_app(wardrive=True)) as client:
        assert client.get(path).status_code == 200


@pytest.mark.parametrize(
    "path",
    [
        "/",
        "/api/health",
        "/api/wardrive-admin/users",
        "/wardrivex",
        "/api/wardrivex",
        "/api/wardrive",
    ],
)
def test_other_paths_need_auth(path):
    with TestClient(_build_app(wardrive=True)) as client:
        response = client.get(path)
    assert response.status_code == 401
    assert "www-authenticate" in response.headers


def test_exemption_off_when_module_inactive():
    with TestClient(_build_app(wardrive=False)) as client:
        assert client.get("/api/wardrive/me").status_code == 401
        assert client.get("/wardrive/").status_code == 401


async def _raw_status(app, path: str) -> int:
    """Drive the ASGI app with an exact scope path, as uvicorn hands it over
    (percent-decoded, dot segments not normalized). HTTP clients normalize
    ``..`` themselves, so they cannot send this."""
    sent: list[dict] = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "root_path": "",
        "query_string": b"",
        "headers": [(b"host", b"test")],
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }
    await app(scope, receive, send)
    return next(m["status"] for m in sent if m["type"] == "http.response.start")


@pytest.mark.parametrize(
    "path",
    [
        "/wardrive/../assets/index.js",
        "/wardrive/./x",
        "/api/wardrive/../health",
        "/wardrive/..",
        r"/wardrive/a\..\b",
    ],
)
async def test_dot_segments_are_not_exempt(path):
    assert await _raw_status(_build_app(wardrive=True), path) == 401
