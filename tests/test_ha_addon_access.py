"""Add-on mode: only Home Assistant Ingress (the Supervisor, 172.30.32.2) and
loopback reach the app, unless the user turns on direct access. Without this,
any other add-on on the hassio network could use the unauthenticated API."""

from types import SimpleNamespace

from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient

from app.ha_addon.access import INGRESS_PROXY_IP, add_ha_addon_access_middleware
from app.ha_addon.options import addon_overrides


def _app(**settings) -> FastAPI:
    app = FastAPI()

    @app.get("/api/health")
    async def health():
        return {"ok": True}

    @app.websocket("/api/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        await websocket.send_text("hi")
        await websocket.close()

    defaults = {"ha_addon": True, "ha_allow_direct": False}
    add_ha_addon_access_middleware(app, SimpleNamespace(**(defaults | settings)))
    return app


def _client(app: FastAPI, ip: str) -> TestClient:
    return TestClient(app, client=(ip, 50000))


def test_ingress_proxy_is_allowed():
    assert INGRESS_PROXY_IP == "172.30.32.2"
    assert _client(_app(), "172.30.32.2").get("/api/health").status_code == 200


def test_loopback_is_allowed():
    assert _client(_app(), "127.0.0.1").get("/api/health").status_code == 200


def test_other_addon_is_refused():
    response = _client(_app(), "172.30.33.5").get("/api/health")
    assert response.status_code == 403
    assert "Ingress" in response.json()["detail"]


def test_lan_client_is_refused_without_direct_access():
    assert _client(_app(), "192.168.1.20").get("/api/health").status_code == 403


def test_direct_access_option_lets_everyone_in():
    assert _client(_app(ha_allow_direct=True), "192.168.1.20").get("/api/health").status_code == 200


def test_not_installed_outside_addon_mode():
    assert _client(_app(ha_addon=False), "192.168.1.20").get("/api/health").status_code == 200


def test_websocket_from_other_addon_is_refused():
    client = _client(_app(), "172.30.33.5")
    try:
        with client.websocket_connect("/api/ws") as ws:
            ws.receive_text()
        raised = False
    except Exception:
        raised = True
    assert raised


def test_websocket_from_ingress_works():
    with _client(_app(), "172.30.32.2").websocket_connect("/api/ws") as ws:
        assert ws.receive_text() == "hi"


def test_option_maps_to_setting():
    assert addon_overrides({"allow_direct_access": True}, {})["ha_allow_direct"] is True
    assert "ha_allow_direct" not in addon_overrides({"allow_direct_access": "yes"}, {})
    assert "ha_allow_direct" not in addon_overrides(
        {"allow_direct_access": True}, {"MESHCORE_HA_ALLOW_DIRECT": "false"}
    )
