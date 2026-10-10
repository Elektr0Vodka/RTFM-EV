"""Tests for the gateway app: radio list API and workspace routing (plan 30)."""

from __future__ import annotations

import asyncio
import base64

import httpx
import pytest
from fastapi.testclient import TestClient
from gateway_fake_worker import app as fake_worker

from app.config import Settings
from app.gateway.app import create_gateway_app
from app.gateway.registry import RadioRegistry
from app.gateway.supervisor import Worker
from app.security import WORKER_TOKEN_HEADER

TOKEN = "tok-123"
KEY_A = "0d1d00147f96" + "57ab" * 13
KEY_B = "b1b2b3b4b5b6" + "00" * 26
URL_A = "0d1d00147f96"
URL_B = "b1b2b3b4b5b6"


class StubSupervisor:
    """Records calls; every started worker is 'running' with the test token."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.workers: dict[int, Worker] = {}

    def worker(self, radio_id: int) -> Worker:
        return self.workers.setdefault(radio_id, Worker(radio_id, token=TOKEN, port=1))

    def forget(self, radio_id: int) -> None:
        self.calls.append(("forget", radio_id))
        self.workers.pop(radio_id, None)

    def view(self, radio_id: int) -> dict:
        return {
            "state": self.worker(radio_id).state,
            "restarts": 0,
            "radio_connected": None,
            "radio_name": None,
        }

    def log_lines(self, radio_id: int, limit: int = 200) -> list[str]:
        return ["line one", "line two"][-limit:]

    async def start(self, radio_id: int) -> None:
        self.calls.append(("start", radio_id))
        self.worker(radio_id).state = "running"

    async def stop(self, radio_id: int) -> None:
        self.calls.append(("stop", radio_id))
        self.worker(radio_id).state = "stopped"

    async def restart(self, radio_id: int) -> None:
        self.calls.append(("restart", radio_id))
        self.worker(radio_id).state = "running"

    async def run(self) -> None:
        await asyncio.Event().wait()

    async def shutdown(self) -> None:
        self.calls.append(("shutdown",))


@pytest.fixture
def gateway(tmp_path, monkeypatch):
    monkeypatch.setenv("MESHCORE_WORKER_TOKEN", TOKEN)
    settings = Settings(
        serial_port="",
        tcp_host="10.0.0.5",
        ble_address="",
        database_path=str(tmp_path / "meshcore.db"),
    )
    registry = RadioRegistry(tmp_path / "radios.json")
    supervisor = StubSupervisor()
    app = create_gateway_app(
        settings=settings,
        registry=registry,
        supervisor=supervisor,
        client=httpx.AsyncClient(transport=httpx.ASGITransport(app=fake_worker)),
    )
    with TestClient(app, follow_redirects=False) as client:
        yield client, registry, supervisor


def test_first_start_creates_radio_one_from_settings(gateway):
    client, registry, supervisor = gateway
    radios = client.get("/gateway/api/radios").json()
    assert len(radios) == 1
    assert radios[0]["id"] == 1
    assert radios[0]["transport"] == {"type": "tcp", "host": "10.0.0.5", "port": 5000}
    assert radios[0]["url_key"] is None
    assert radios[0]["url"] is None
    assert radios[0]["state"] == "running"
    assert ("start", 1) in supervisor.calls


def test_add_radio_starts_it_and_hides_the_ble_pin(gateway):
    client, registry, supervisor = gateway
    response = client.post(
        "/gateway/api/radios",
        json={"name": "433", "transport": {"type": "ble", "address": "AA:BB", "pin": "123456"}},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["id"] == 2
    assert body["transport"] == {"type": "ble", "address": "AA:BB"}
    assert body["database_path"].endswith("radios/2/meshcore.db")
    assert ("start", 2) in supervisor.calls
    assert registry.get(2).transport.pin == "123456"


def test_add_disabled_radio_is_not_started(gateway):
    client, _, supervisor = gateway
    client.post(
        "/gateway/api/radios",
        json={"name": "x", "enabled": False, "transport": {"type": "tcp", "host": "10.0.0.6"}},
    )
    assert ("start", 2) not in supervisor.calls


def test_invalid_change_is_refused_with_400(gateway):
    client, _, _ = gateway
    response = client.post(
        "/gateway/api/radios",
        json={"name": "dup", "transport": {"type": "tcp", "host": "10.0.0.5"}},
    )
    assert response.status_code == 400
    assert "same connection" in response.json()["detail"]


def test_patch_restarts_on_transport_change_and_stops_on_disable(gateway):
    client, registry, supervisor = gateway
    client.patch("/gateway/api/radios/1", json={"name": "868"})
    assert ("restart", 1) not in supervisor.calls
    client.patch("/gateway/api/radios/1", json={"transport": {"type": "tcp", "host": "10.0.0.9"}})
    assert ("restart", 1) in supervisor.calls
    client.patch("/gateway/api/radios/1", json={"enabled": False})
    assert supervisor.calls[-1] == ("stop", 1)
    assert registry.get(1).name == "868"
    assert client.patch("/gateway/api/radios/9", json={"name": "x"}).status_code == 404


def test_start_stop_restart_and_log_endpoints(gateway):
    client, _, supervisor = gateway
    assert client.post("/gateway/api/radios/1/stop").json()["state"] == "stopped"
    assert client.post("/gateway/api/radios/1/start").json()["state"] == "running"
    assert client.post("/gateway/api/radios/1/restart").status_code == 200
    assert supervisor.calls[-3:] == [("stop", 1), ("start", 1), ("restart", 1)]
    assert client.get("/gateway/api/radios/1/log?limit=1").json() == {"lines": ["line two"]}
    assert client.post("/gateway/api/radios/9/start").status_code == 404


def test_delete_stops_and_removes_and_only_deletes_its_own_directory(gateway, tmp_path):
    client, registry, supervisor = gateway
    client.post(
        "/gateway/api/radios",
        json={"name": "433", "transport": {"type": "tcp", "host": "10.0.0.6"}},
    )
    own_dir = tmp_path / "radios" / "2"
    own_dir.mkdir(parents=True)
    (own_dir / "meshcore.db").write_text("x")
    (tmp_path / "meshcore.db").write_text("legacy")

    assert client.delete("/gateway/api/radios/2?delete_data=true").status_code == 200
    assert not own_dir.exists()
    assert registry.get(2) is None
    assert ("stop", 2) in supervisor.calls and ("forget", 2) in supervisor.calls

    assert client.delete("/gateway/api/radios/1?delete_data=true").status_code == 200
    assert (tmp_path / "meshcore.db").read_text() == "legacy"


def test_workspace_is_proxied_under_its_key(gateway):
    client, registry, _ = gateway
    registry.set_public_key(1, KEY_A)
    radios = client.get("/gateway/api/radios").json()
    assert radios[0]["url_key"] == URL_A
    assert radios[0]["url"] == f"r/{URL_A}/"

    response = client.get(f"/r/{URL_A}/api/echo?x=1")
    assert response.status_code == 200
    seen = response.json()
    assert seen["query"] == "x=1"
    assert seen["headers"][WORKER_TOKEN_HEADER] == TOKEN
    assert seen["headers"]["x-forwarded-prefix"] == f"/r/{URL_A}"


def test_workspace_root_sets_last_radio_cookie_and_root_redirects_there(gateway):
    client, registry, _ = gateway
    registry.set_public_key(1, KEY_A)
    client.post(
        "/gateway/api/radios",
        json={"name": "433", "transport": {"type": "tcp", "host": "10.0.0.6"}},
    )
    registry.set_public_key(2, KEY_B)

    assert client.get("/").headers["location"] == f"r/{URL_A}/"
    page = client.get(f"/r/{URL_B}/")
    assert page.status_code == 200
    assert "rtfm_last_radio=2" in page.headers["set-cookie"]
    assert client.get("/").headers["location"] == f"r/{URL_B}/"


def test_failed_workspace_page_does_not_set_the_cookie(gateway, monkeypatch):
    client, registry, _ = gateway
    registry.set_public_key(1, KEY_A)
    monkeypatch.setenv("FAKE_INDEX_STATUS", "404")
    page = client.get(f"/r/{URL_A}/")
    assert page.status_code == 404
    assert "set-cookie" not in page.headers


def test_root_without_any_key_redirects_to_the_radio_list(gateway):
    client, _, _ = gateway
    response = client.get("/")
    assert response.status_code == 307
    assert response.headers["location"] == "gateway/api/radios"


def test_missing_slash_long_form_and_old_key_redirect(gateway):
    client, registry, _ = gateway
    registry.set_public_key(1, KEY_A)
    assert client.get(f"/r/{URL_A}?a=1").headers["location"] == f"{URL_A}/?a=1"
    assert client.get(f"/r/{KEY_A}/").headers["location"] == f"../{URL_A}/"
    assert (
        client.get(f"/r/{KEY_A}/api/echo?x=1").headers["location"] == f"../../{URL_A}/api/echo?x=1"
    )
    registry.set_public_key(1, KEY_B)
    assert client.get(f"/r/{URL_A}/").headers["location"] == f"../{URL_B}/"


def test_unknown_radio_is_404_and_stopped_worker_is_503(gateway):
    client, registry, supervisor = gateway
    registry.set_public_key(1, KEY_A)
    assert client.get("/r/ffffffffffff/api/echo").status_code == 404
    supervisor.worker(1).state = "starting"
    response = client.get(f"/r/{URL_A}/api/echo")
    assert response.status_code == 503
    assert response.json() == {"detail": "Radio worker is not available"}


def test_basic_auth_protects_gateway_and_workspaces(tmp_path, monkeypatch):
    monkeypatch.setenv("MESHCORE_WORKER_TOKEN", TOKEN)
    settings = Settings(
        serial_port="",
        tcp_host="10.0.0.5",
        ble_address="",
        database_path=str(tmp_path / "meshcore.db"),
        basic_auth_username="mesh",
        basic_auth_password="secret",
    )
    app = create_gateway_app(
        settings=settings,
        registry=RadioRegistry(tmp_path / "radios.json"),
        supervisor=StubSupervisor(),
        client=httpx.AsyncClient(transport=httpx.ASGITransport(app=fake_worker)),
    )
    token = base64.b64encode(b"mesh:secret").decode("ascii")
    with TestClient(app, follow_redirects=False) as client:
        assert client.get("/gateway/api/radios").status_code == 401
        assert client.get("/r/0d1d00147f96/api/echo").status_code == 401
        ok = client.get("/gateway/api/radios", headers={"Authorization": f"Basic {token}"})
        assert ok.status_code == 200
