"""The server side of onboarding a device (plan 32, Phase 6).

A wanted config can carry the asset's own private key from the vault, so an
apply gives a device the asset's identity. Its value never leaves the server
here: the document holds the vault id only.
"""

import nacl.pwhash
import pytest

from app.config import settings
from app.services import fleet_vault
from tests.fleet_device_cli_samples import stock_replies

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


async def _asset_with_new_key(client, headers) -> dict:
    asset = (await client.post("/api/fleet/assets", json={"label": "New mast"})).json()
    response = await client.post(
        f"/api/fleet/assets/{asset['id']}/generate-key",
        json={"prefix": "", "free_bytes": 0},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()["asset"]


async def _template(client) -> dict:
    response = await client.post(
        "/api/fleet/config-templates",
        json={
            "name": "Mast base",
            "profile": "stock",
            "role": "repeater",
            "document": {"vars": {"name": "{{asset.label}}", "tx": "{{power}}"}},
            "variables": [{"name": "power", "default": "20", "type": "number"}],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _create(client, asset_id: int, headers=None, **body):
    return await client.post(
        f"/api/fleet/assets/{asset_id}/configs/from-template",
        json={"values": {}, **body},
        headers=headers or {},
    )


@pytest.mark.asyncio
async def test_template_with_the_asset_key(test_db, client):
    headers = await _unlock(client)
    asset = await _asset_with_new_key(client, headers)
    template = await _template(client)

    response = await _create(
        client, asset["id"], headers, template_id=template["id"], include_private_key=True
    )

    assert response.status_code == 201, response.text
    config = response.json()
    assert config["kind"] == "desired" and config["source"] == "template"
    assert config["document"]["vars"]["name"] == "New mast"
    assert config["document"]["vars"]["tx"] == 20
    placeholder = config["document"]["vars"]["prv.key"]
    assert isinstance(placeholder["$secret"], int)
    assert (config["secrets_stored"], config["secrets_missing"]) == (1, 0)


@pytest.mark.asyncio
async def test_the_key_alone(test_db, client):
    headers = await _unlock(client)
    asset = await _asset_with_new_key(client, headers)

    response = await _create(client, asset["id"], headers, include_private_key=True)

    assert response.status_code == 201, response.text
    config = response.json()
    assert list(config["document"]) == ["vars"]
    assert list(config["document"]["vars"]) == ["prv.key"]
    assert config["profile"] == "stock" and config["label"] == "Asset key"


@pytest.mark.asyncio
async def test_neither_template_nor_key_is_refused(test_db, client):
    asset = (await client.post("/api/fleet/assets", json={"label": "Mast"})).json()

    response = await _create(client, asset["id"])
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_the_key_needs_the_vault(test_db, client):
    headers = await _unlock(client)
    asset = await _asset_with_new_key(client, headers)

    response = await _create(client, asset["id"], include_private_key=True)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_an_asset_without_its_key_in_the_vault_is_refused(test_db, client):
    headers = await _unlock(client)
    replies = stock_replies()
    public_key = replies["get public.key"][2:]
    asset = (
        await client.post("/api/fleet/assets", json={"label": "Mast", "public_key": public_key})
    ).json()

    response = await _create(client, asset["id"], headers, include_private_key=True)
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_a_companion_template_cannot_take_the_key(test_db, client):
    headers = await _unlock(client)
    asset = await _asset_with_new_key(client, headers)
    template = await client.post(
        "/api/fleet/config-templates",
        json={
            "name": "Pocket",
            "profile": "companion_v1",
            "document": {"version": 1, "name": "x", "radio": {}},
        },
    )
    assert template.status_code == 201, template.text

    response = await _create(
        client, asset["id"], headers, template_id=template.json()["id"], include_private_key=True
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_a_plan_with_the_asset_key_gives_the_device_its_identity(test_db, client):
    """The wanted config's key makes the apply re-key a device that is not the asset yet."""
    headers = await _unlock(client)
    asset = await _asset_with_new_key(client, headers)
    config = (await _create(client, asset["id"], headers, include_private_key=True)).json()
    replies: dict = {}
    device = stock_replies()
    for _round in range(5):
        step = (await client.post("/api/fleet/device/read-step", json={"replies": replies})).json()
        if step["done"]:
            break
        for command in step["commands"]:
            replies[command] = device.get(command, f"??: {command}")

    refused = await client.post(
        f"/api/fleet/configs/{config['id']}/apply-plan",
        json={"replies": replies},
        headers=headers,
    )
    assert refused.status_code == 409
    response = await client.post(
        f"/api/fleet/configs/{config['id']}/apply-plan",
        json={"replies": replies, "allow_private_key": True},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan["rekey"] is True
    assert [step["check"] for step in plan["steps"]] == ["public_key"]
    assert plan["steps"][0]["expect"] == asset["public_key"]
    assert plan["steps"][0]["display"] == "set prv.key ********"
