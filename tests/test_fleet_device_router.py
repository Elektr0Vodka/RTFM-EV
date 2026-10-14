"""Routes for reading and applying a config over a cable (plan 32, Phase 3).

The cable is the browser's: these routes never open a port and never use the
radio. They turn device replies into a file and a stored config into commands.
"""

import nacl.pwhash
import pytest

from app.config import settings
from app.services import fleet_vault
from tests.fleet_config_samples import keypair
from tests.fleet_device_cli_samples import PRIVATE_KEY, PUBLIC_KEY, stock_replies

PASSPHRASE = "correct horse battery staple"
TOKEN = "X-Fleet-Vault-Token"


@pytest.fixture(autouse=True)
def _vault_on(monkeypatch):
    monkeypatch.setattr(settings, "fleet_vault_enabled", True)
    monkeypatch.setattr(fleet_vault, "KDF_OPSLIMIT", nacl.pwhash.argon2id.OPSLIMIT_MIN)
    monkeypatch.setattr(fleet_vault, "KDF_MEMLIMIT", nacl.pwhash.argon2id.MEMLIMIT_MIN)
    fleet_vault.sessions.close_all()
    yield
    fleet_vault.sessions.close_all()


async def _unlock(client) -> dict:
    response = await client.post("/api/fleet/vault/init", json={"passphrase": PASSPHRASE})
    assert response.status_code == 200, response.text
    return {TOKEN: response.json()["token"]}


async def _asset(client, **fields) -> dict:
    response = await client.post("/api/fleet/assets", json={"label": "Mast 7", **fields})
    assert response.status_code == 201, response.text
    return response.json()


async def _full_read(client, device: dict) -> dict:
    """Answer every round from ``device`` and return the replies."""
    replies: dict = {}
    for _round in range(10):
        response = await client.post("/api/fleet/device/read-step", json={"replies": replies})
        assert response.status_code == 200, response.text
        body = response.json()
        if body["done"]:
            return replies
        for command in body["commands"]:
            replies[command] = device.get(command, f"??: {command}")
    raise AssertionError("the read did not finish")


async def _stored_read(client, asset_id: int, replies: dict, headers=None, **body) -> dict:
    response = await client.post(
        f"/api/fleet/assets/{asset_id}/configs/read",
        json={"replies": replies, **body},
        headers=headers or {},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _plan(client, config_id: int, replies: dict, headers=None, **body):
    return await client.post(
        f"/api/fleet/configs/{config_id}/apply-plan",
        json={"replies": replies, **body},
        headers=headers or {},
    )


class TestRead:
    @pytest.mark.asyncio
    async def test_rounds_then_the_file(self, test_db, client):
        first = (await client.post("/api/fleet/device/read-step", json={"replies": {}})).json()
        assert first == {
            "done": False,
            "commands": ["ver", "board", "get role", "get public.key"],
            "read": None,
        }

        replies = await _full_read(client, stock_replies())
        body = (await client.post("/api/fleet/device/read-step", json={"replies": replies})).json()
        read = body["read"]
        assert body["done"] is True and body["commands"] == []
        assert read["identity"]["public_key"] == PUBLIC_KEY
        assert read["identity"]["firmware_version"] == "v1.14.0"
        assert read["profile"] == "stock"
        # The preview holds no secret value.
        assert read["document"]["vars"]["prv.key"] == {"$secret": None}
        assert read["document"]["vars"]["guest.password"] == {"$secret": None}
        assert read["secrets"] == 2
        assert PRIVATE_KEY not in str(body)

    @pytest.mark.asyncio
    async def test_a_silent_device_is_explained(self, test_db, client):
        replies = {"ver": None, "board": None, "get role": None, "get public.key": None}
        response = await client.post("/api/fleet/device/read-step", json={"replies": replies})
        assert response.status_code == 422
        assert "does not answer" in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_too_many_replies_are_refused(self, test_db, client):
        replies = {f"get key{index}": "> 1" for index in range(1000)}
        response = await client.post("/api/fleet/device/read-step", json={"replies": replies})
        assert response.status_code == 422


class TestStoreRead:
    @pytest.mark.asyncio
    async def test_stored_as_a_snapshot_with_secrets_in_the_vault(self, test_db, client):
        headers = await _unlock(client)
        asset = await _asset(client, public_key=PUBLIC_KEY)
        replies = await _full_read(client, stock_replies())

        result = await _stored_read(client, asset["id"], replies, headers, label="bench")

        config = result["config"]
        assert (config["kind"], config["source"], config["profile"]) == (
            "snapshot",
            "usb_browser",
            "stock",
        )
        assert config["role"] == "repeater" and config["firmware_version"] == "v1.14.0"
        assert config["label"] == "bench"
        assert (result["secrets_stored"], result["secrets_left_out"]) == (2, 0)
        assert result["public_key_set"] is False

    @pytest.mark.asyncio
    async def test_vault_locked_leaves_secrets_out(self, test_db, client):
        asset = await _asset(client, public_key=PUBLIC_KEY)
        replies = await _full_read(client, stock_replies())

        result = await _stored_read(client, asset["id"], replies)
        assert (result["secrets_stored"], result["secrets_left_out"]) == (0, 2)

    @pytest.mark.asyncio
    async def test_another_device_is_refused(self, test_db, client):
        _private, other_public = keypair()
        asset = await _asset(client, public_key=other_public)
        replies = await _full_read(client, stock_replies())

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/configs/read", json={"replies": replies}
        )
        assert response.status_code == 409
        assert PUBLIC_KEY in response.json()["detail"]

    @pytest.mark.asyncio
    async def test_an_asset_without_a_key_takes_the_device_key_only_when_asked(
        self, test_db, client
    ):
        asset = await _asset(client)
        replies = await _full_read(client, stock_replies())

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/configs/read", json={"replies": replies}
        )
        assert response.status_code == 409

        result = await _stored_read(client, asset["id"], replies, set_public_key=True)
        assert result["public_key_set"] is True
        stored = (await client.get(f"/api/fleet/assets/{asset['id']}")).json()
        assert stored["public_key"] == PUBLIC_KEY

    @pytest.mark.asyncio
    async def test_a_key_another_asset_holds_is_not_taken(self, test_db, client):
        await _asset(client, label="Other", public_key=PUBLIC_KEY)
        asset = await _asset(client)
        replies = await _full_read(client, stock_replies())

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/configs/read",
            json={"replies": replies, "set_public_key": True},
        )
        assert response.status_code == 409


class TestApplyPlan:
    @pytest.mark.asyncio
    async def test_plan_with_secrets_from_the_vault(self, test_db, client):
        headers = await _unlock(client)
        asset = await _asset(client, public_key=PUBLIC_KEY)
        replies = await _full_read(client, stock_replies())
        config = (await _stored_read(client, asset["id"], replies, headers))["config"]
        device = stock_replies()
        device["get tx"] = "> 10"
        device["get guest.password"] = "> other-guest"
        current = await _full_read(client, device)

        response = await _plan(client, config["id"], current, headers)

        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        plan = response.json()
        assert [step["command"] for step in plan["steps"]] == [
            "set tx 22",
            "set guest.password guest-pw-1",
        ]
        assert [step["index"] for step in plan["steps"]] == [0, 1]
        assert plan["steps"][1]["display"] == "set guest.password ********"
        assert plan["vault"] == "open" and plan["rekey"] is False and plan["reboot"] is False
        async with test_db.readonly() as conn:
            rows = await (await conn.execute("SELECT action, detail FROM fleet_audit")).fetchall()
        assert ("config_apply_planned", f"config {config['id']}: 2 secrets") in [
            (row[0], row[1]) for row in rows
        ]

    @pytest.mark.asyncio
    async def test_vault_locked_skips_the_secrets(self, test_db, client):
        headers = await _unlock(client)
        asset = await _asset(client, public_key=PUBLIC_KEY)
        replies = await _full_read(client, stock_replies())
        config = (await _stored_read(client, asset["id"], replies, headers))["config"]
        device = stock_replies()
        device["get guest.password"] = "> other-guest"
        current = await _full_read(client, device)

        plan = (await _plan(client, config["id"], current)).json()

        assert plan["steps"] == [] and plan["vault"] == "locked"
        reasons = {"/".join(map(str, row["path"])): row["reason"] for row in plan["rows"]}
        assert reasons["vars/guest.password"] == "secret_unavailable"

    @pytest.mark.asyncio
    async def test_another_device_is_refused(self, test_db, client):
        asset = await _asset(client, public_key=PUBLIC_KEY)
        replies = await _full_read(client, stock_replies())
        config = (await _stored_read(client, asset["id"], replies))["config"]
        other_private, other_public = keypair()
        current = await _full_read(
            client, stock_replies(private_key=other_private, public_key=other_public)
        )

        response = await _plan(client, config["id"], current, allow_private_key=True)
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_an_asset_without_a_key_cannot_be_applied_to(self, test_db, client):
        asset = await _asset(client)
        replies = await _full_read(client, stock_replies())
        config = (await _stored_read(client, asset["id"], replies, set_public_key=True))["config"]
        await client.patch(f"/api/fleet/assets/{asset['id']}", json={"public_key": None})

        response = await _plan(client, config["id"], replies)
        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_a_companion_file_is_refused(self, test_db, client):
        asset = await _asset(client, public_key=PUBLIC_KEY)
        companion = {"version": 1, "name": "Pocket", "radio": {"freq": 869.618}}
        imported = await client.post(
            f"/api/fleet/assets/{asset['id']}/configs/import", json={"document": companion}
        )
        assert imported.status_code == 201, imported.text
        replies = await _full_read(client, stock_replies())

        response = await _plan(client, imported.json()["config"]["id"], replies)
        assert response.status_code == 422


class TestCheck:
    @pytest.mark.asyncio
    async def test_ok_and_not_ok(self, test_db, client):
        step = {
            "section": "vars",
            "path": ["vars", "tx"],
            "command": "set tx 20",
            "display": "set tx 20",
            "readback": ["get tx"],
            "expect": 20,
        }
        good = await client.post(
            "/api/fleet/device/check",
            json={"step": step, "reply": "OK", "readback": {"get tx": "> 20"}},
        )
        assert good.json() == {"ok": True, "reason": None, "reply": "OK"}
        bad = await client.post(
            "/api/fleet/device/check",
            json={"step": step, "reply": "OK", "readback": {"get tx": "> 22"}},
        )
        assert bad.json()["ok"] is False and bad.json()["reason"] == "readback_differs"

    @pytest.mark.asyncio
    async def test_a_secret_reply_is_not_echoed(self, test_db, client):
        step = {
            "section": "vars",
            "path": ["vars", "guest.password"],
            "command": "set guest.password hunter2",
            "display": "set guest.password ********",
            "secret": True,
            "readback": ["get guest.password"],
            "expect": "hunter2",
        }
        response = await client.post(
            "/api/fleet/device/check",
            json={"step": step, "reply": "unknown config: guest.password hunter2", "readback": {}},
        )
        assert response.json() == {"ok": False, "reason": "unexpected_reply", "reply": ""}

    @pytest.mark.asyncio
    async def test_a_command_that_may_not_be_sent_is_refused(self, test_db, client):
        step = {"section": "vars", "path": ["vars", "x"], "command": "erase", "display": "erase"}
        response = await client.post(
            "/api/fleet/device/check", json={"step": step, "reply": "OK", "readback": {}}
        )
        assert response.status_code == 422


class TestApplyLog:
    @pytest.mark.asyncio
    async def test_the_log_entry_is_on_the_asset(self, test_db, client):
        asset = await _asset(client, public_key=PUBLIC_KEY)
        replies = await _full_read(client, stock_replies())
        config = (await _stored_read(client, asset["id"], replies))["config"]

        response = await client.post(
            f"/api/fleet/configs/{config['id']}/apply-log",
            json={
                "transport": "usb_browser",
                "total": 3,
                "results": [
                    {"display": "set tx 20", "ok": True, "reply": "OK"},
                    {"display": "set radio 869,250,11,5", "ok": False, "reply": "Error"},
                ],
                "stopped_reason": "unexpected_reply",
                "reboot_needed": False,
            },
        )

        assert response.status_code == 201, response.text
        events = (await client.get(f"/api/fleet/assets/{asset['id']}/events")).json()
        entry = next(event for event in events if event["kind"] == "config_applied")
        assert "stopped at command 2 of 3" in entry["summary"]
        assert "set tx 20" in entry["detail"] and "unexpected_reply" in entry["detail"]


@pytest.mark.asyncio
async def test_nothing_here_touches_the_radio(test_db, client, monkeypatch):
    from app.services import radio_runtime

    class _NoRadio:
        def __getattr__(self, name):
            raise AssertionError(f"a cable route touched the radio: {name}")

    # Creating the asset reads what the radio reports; everything after must not.
    asset = await _asset(client, public_key=PUBLIC_KEY)
    monkeypatch.setattr(radio_runtime, "radio_runtime", _NoRadio())
    replies = await _full_read(client, stock_replies())
    config = (await _stored_read(client, asset["id"], replies))["config"]
    response = await _plan(client, config["id"], replies)
    assert response.status_code == 200
