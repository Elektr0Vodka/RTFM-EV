"""Routes for an observer's web config over the LAN (plan 32, Phase 4).

The observer is a fake behind httpx.MockTransport; the radio is never used
except by the start and stop routes, which are tested with the send replaced.
"""

import httpx
import nacl.pwhash
import pytest

from app.config import settings
from app.models import CommandResponse
from app.routers import fleet_webconfig as router_module
from app.services import fleet_vault
from app.services.fleet_webconfig_client import WebConfigClient
from tests.fleet_device_cli_samples import PUBLIC_KEY
from tests.fleet_webconfig_samples import FakeObserver, config

PASSPHRASE = "correct horse battery staple"
TOKEN = "X-Fleet-Vault-Token"
HOST = "192.168.1.20"


@pytest.fixture(autouse=True)
def _vault_on(monkeypatch):
    monkeypatch.setattr(settings, "fleet_vault_enabled", True)
    monkeypatch.setattr(fleet_vault, "KDF_OPSLIMIT", nacl.pwhash.argon2id.OPSLIMIT_MIN)
    monkeypatch.setattr(fleet_vault, "KDF_MEMLIMIT", nacl.pwhash.argon2id.MEMLIMIT_MIN)
    fleet_vault.sessions.close_all()
    yield
    fleet_vault.sessions.close_all()


@pytest.fixture
def fake(monkeypatch) -> FakeObserver:
    observer = FakeObserver(pending_polls=0)

    def client(address: str) -> WebConfigClient:
        assert address == HOST
        return WebConfigClient(
            address, transport=httpx.MockTransport(observer.handler), poll_delay=0
        )

    monkeypatch.setattr(router_module, "_client_factory", client)
    return observer


async def _setup(client, *, password: str | None = FakeObserver.PASSWORD) -> tuple[dict, dict]:
    response = await client.post("/api/fleet/vault/init", json={"passphrase": PASSPHRASE})
    headers = {TOKEN: response.json()["token"]}
    asset = (
        await client.post("/api/fleet/assets", json={"label": "Obs 1", "public_key": PUBLIC_KEY})
    ).json()
    if password is not None:
        stored = await client.post(
            f"/api/fleet/assets/{asset['id']}/secrets",
            json={"kind": "admin_password", "label": "web config", "value": password},
            headers=headers,
        )
        assert stored.status_code == 201, stored.text
    return asset, headers


async def _read(client, asset_id: int, headers: dict, **body):
    return await client.post(
        f"/api/fleet/assets/{asset_id}/webconfig/read",
        json={"host": HOST, **body},
        headers=headers,
    )


async def _desired(client, asset_id: int, headers: dict, **changes) -> dict:
    """A wanted config: what the device has, with ``changes`` to its vars."""
    from app.services.fleet_webconfig import document_from_config

    document = document_from_config(config())
    document["vars"].update(changes)
    response = await client.post(
        f"/api/fleet/assets/{asset_id}/configs/import",
        json={"document": document, "kind": "desired"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["config"]


class TestRead:
    @pytest.mark.asyncio
    async def test_read_and_store(self, test_db, client, fake):
        asset, headers = await _setup(client)

        response = await _read(client, asset["id"], headers)
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"]["node_id"] == PUBLIC_KEY[:16]
        assert body["document"]["vars"]["tx"] == 22
        assert body["document"]["mqtt"]["snmpCommunity"] == {"$secret": None}
        assert body["stored"] is None

        stored = (await _read(client, asset["id"], headers, store=True, label="lan")).json()
        config_row = stored["stored"]["config"]
        assert (config_row["source"], config_row["kind"], config_row["profile"]) == (
            "webconfig",
            "snapshot",
            "dmc_observer",
        )
        assert config_row["firmware_version"] == "v1.14.1-dmc-observer"
        assert stored["stored"]["secrets_stored"] == 1
        # One login and one logout per read; never a save.
        assert fake.saved == []
        paths = [request.url.path for request in fake.requests]
        assert paths.count("/api/login") == 2 and paths.count("/api/logout") == 2

    @pytest.mark.asyncio
    async def test_another_node_is_refused(self, test_db, client, fake):
        asset, headers = await _setup(client)
        fake.public_key = "cd" * 32

        response = await _read(client, asset["id"], headers)
        assert response.status_code == 409
        assert not any(request.url.path == "/api/login" for request in fake.requests)

    @pytest.mark.asyncio
    async def test_setup_mode_is_refused(self, test_db, client, fake):
        asset, headers = await _setup(client)
        fake.mode = "setup"

        response = await _read(client, asset["id"], headers)
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_needs_the_vault_and_the_admin_password(self, test_db, client, fake):
        asset, headers = await _setup(client, password=None)

        assert (await _read(client, asset["id"], {})).status_code == 401
        response = await _read(client, asset["id"], headers)
        assert response.status_code == 409
        assert "admin password" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_a_wrong_password_is_reported(self, test_db, client, fake):
        asset, headers = await _setup(client, password="not-it")

        response = await _read(client, asset["id"], headers)
        assert response.status_code == 502
        assert response.json()["detail"]["code"] == "wrong_password"

    @pytest.mark.parametrize("host", ["8.8.8.8", "127.0.0.1", "http://192.168.1.20"])
    @pytest.mark.asyncio
    async def test_hosts_outside_the_lan_are_refused(self, test_db, client, fake, host):
        asset, headers = await _setup(client)

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/webconfig/read", json={"host": host}, headers=headers
        )
        assert response.status_code == 422
        assert fake.requests == []


class TestApply:
    @pytest.mark.asyncio
    async def test_plan_then_one_step(self, test_db, client, fake):
        asset, headers = await _setup(client)
        desired = await _desired(client, asset["id"], headers, tx=20)

        plan_response = await client.post(
            f"/api/fleet/configs/{desired['id']}/webconfig/plan",
            json={"host": HOST},
            headers=headers,
        )
        assert plan_response.status_code == 200, plan_response.text
        assert plan_response.headers["cache-control"] == "no-store"
        plan = plan_response.json()
        assert [step["command"] for step in plan["steps"]] == ["set tx 20"]
        assert plan["rekey"] is False and plan["identity"]["public_key"] == PUBLIC_KEY

        step = plan["steps"][0]
        response = await client.post(
            f"/api/fleet/configs/{desired['id']}/webconfig/step",
            json={"host": HOST, "step": step},
            headers=headers,
        )
        assert response.json() == {"ok": True, "reason": None, "reply": "OK"}
        assert fake.saved[-1]["set"] == {"tx": "20"} and fake.saved[-1]["reboot"] is False

    @pytest.mark.asyncio
    async def test_a_read_back_that_differs_stops(self, test_db, client, fake):
        asset, headers = await _setup(client)
        desired = await _desired(client, asset["id"], headers, tx=20)
        plan = (
            await client.post(
                f"/api/fleet/configs/{desired['id']}/webconfig/plan",
                json={"host": HOST},
                headers=headers,
            )
        ).json()
        fake.apply_saves = False

        response = await client.post(
            f"/api/fleet/configs/{desired['id']}/webconfig/step",
            json={"host": HOST, "step": plan["steps"][0]},
            headers=headers,
        )
        assert response.json()["ok"] is False
        assert response.json()["reason"] == "readback_differs"

    @pytest.mark.asyncio
    async def test_an_unreachable_node_stops_the_apply(self, test_db, client, fake):
        asset, headers = await _setup(client)
        desired = await _desired(client, asset["id"], headers, tx=20)
        plan = (
            await client.post(
                f"/api/fleet/configs/{desired['id']}/webconfig/plan",
                json={"host": HOST},
                headers=headers,
            )
        ).json()
        fake.running = False

        response = await client.post(
            f"/api/fleet/configs/{desired['id']}/webconfig/step",
            json={"host": HOST, "step": plan["steps"][0]},
            headers=headers,
        )
        assert response.json() == {"ok": False, "reason": "not_running", "reply": ""}

    @pytest.mark.parametrize(
        "command", ["erase", "set password new-admin", "set guest.password x", "region save"]
    )
    @pytest.mark.asyncio
    async def test_commands_outside_the_web_config_are_refused(
        self, test_db, client, fake, command
    ):
        asset, headers = await _setup(client)
        desired = await _desired(client, asset["id"], headers)
        step = {"section": "vars", "path": ["vars", "x"], "command": command, "display": command}

        response = await client.post(
            f"/api/fleet/configs/{desired['id']}/webconfig/step",
            json={"host": HOST, "step": step},
            headers=headers,
        )
        assert response.status_code == 422
        assert fake.saved == []

    @pytest.mark.asyncio
    async def test_the_log_takes_the_lan(self, test_db, client, fake):
        asset, headers = await _setup(client)
        desired = await _desired(client, asset["id"], headers)
        response = await client.post(
            f"/api/fleet/configs/{desired['id']}/apply-log",
            json={
                "transport": "webconfig",
                "total": 1,
                "results": [{"display": "set tx 20", "ok": True, "reply": "OK"}],
            },
        )
        assert response.status_code == 201
        assert "web config (LAN)" in response.json()["summary"]


class TestStartStop:
    @pytest.mark.asyncio
    async def test_start_and_stop_send_one_command_each(self, test_db, client, monkeypatch):
        asset, _headers = await _setup(client, password=None)
        sent: list[str] = []

        async def contact(_asset):
            return object()

        async def send(_contact, command, *, operation_name):
            sent.append(command)
            reply = (
                "WebConfig started: http://192.168.1.20/ (admin password login)"
                if command == "start webconfig"
                else "WebConfig stopped"
            )
            return CommandResponse(command=command, response=reply)

        monkeypatch.setattr(router_module, "_node_contact", contact)
        monkeypatch.setattr(router_module, "send_contact_cli_command", send)
        monkeypatch.setattr(router_module, "_require_radio", lambda: None)

        start = await client.post(
            f"/api/fleet/assets/{asset['id']}/webconfig/start", json={"confirm": True}
        )
        assert start.json() == {
            "reply": "WebConfig started: http://192.168.1.20/ (admin password login)",
            "host": "192.168.1.20",
        }
        stop = await client.post(
            f"/api/fleet/assets/{asset['id']}/webconfig/stop", json={"confirm": True}
        )
        assert stop.json()["host"] is None
        assert sent == ["start webconfig", "stop webconfig"]

    @pytest.mark.asyncio
    async def test_start_needs_the_confirm(self, test_db, client, monkeypatch):
        asset, _headers = await _setup(client, password=None)
        sent: list[str] = []

        async def send(_contact, command, *, operation_name):
            sent.append(command)

        monkeypatch.setattr(router_module, "send_contact_cli_command", send)
        response = await client.post(f"/api/fleet/assets/{asset['id']}/webconfig/start", json={})
        assert response.status_code == 422
        assert sent == []
