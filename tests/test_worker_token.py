"""Tests for the worker token gate used in multi-radio mode (plan 30)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketDenialResponse

from app.config import Settings
from app.security import WORKER_TOKEN_HEADER, add_optional_worker_token_middleware


def _build_app(*, token: str = "") -> FastAPI:
    settings = Settings(serial_port="", tcp_host="", ble_address="", worker_token=token)
    app = FastAPI()
    add_optional_worker_token_middleware(app, settings)

    @app.get("/protected")
    async def protected():
        return {"ok": True}

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        await websocket.send_json({"ok": True})
        await websocket.close()

    return app


def test_settings_default_to_single_radio_mode():
    settings = Settings(serial_port="", tcp_host="", ble_address="")
    assert settings.multi_radio is False
    assert settings.worker_token == ""


def test_no_token_configured_means_no_gate():
    with TestClient(_build_app()) as client:
        assert client.get("/protected").status_code == 200


def test_http_request_without_token_is_forbidden():
    with TestClient(_build_app(token="s3cret")) as client:
        response = client.get("/protected")
    assert response.status_code == 403
    assert response.json() == {"detail": "Forbidden"}


def test_http_request_with_wrong_token_is_forbidden():
    with TestClient(_build_app(token="s3cret")) as client:
        response = client.get("/protected", headers={WORKER_TOKEN_HEADER: "nope"})
    assert response.status_code == 403


def test_http_request_with_token_is_allowed():
    with TestClient(_build_app(token="s3cret")) as client:
        response = client.get("/protected", headers={WORKER_TOKEN_HEADER: "s3cret"})
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_websocket_without_token_is_denied():
    with TestClient(_build_app(token="s3cret")) as client:
        with pytest.raises(WebSocketDenialResponse) as exc_info:
            with client.websocket_connect("/ws"):
                pass
    assert exc_info.value.status_code == 403


def test_websocket_with_token_is_allowed():
    with TestClient(_build_app(token="s3cret")) as client:
        with client.websocket_connect("/ws", headers={WORKER_TOKEN_HEADER: "s3cret"}) as ws:
            assert ws.receive_json() == {"ok": True}
