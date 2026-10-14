"""Tests for the fleet config library routes (plan 32, Phase 1).

Nothing here reaches a device: the routes only read and write stored rows.
"""

import json

import nacl.pwhash
import pytest

from app.config import settings
from app.services import fleet_vault
from tests.fleet_config_samples import (
    TOOLBOX_SECRETS,
    companion_file,
    keypair,
    secret_values,
    toolbox_file,
)

PASSPHRASE = "correct horse battery staple"
TOKEN = "X-Fleet-Vault-Token"
ALL_SECRETS = len(TOOLBOX_SECRETS) + 1  # the full sample plus its private key


@pytest.fixture(autouse=True)
def _vault_on(monkeypatch):
    """Vault switched on, cheap key derivation, no sessions left over."""
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


async def _import(client, asset_id: int, document: dict, headers=None, **body):
    return await client.post(
        f"/api/fleet/assets/{asset_id}/configs/import",
        json={"document": document, **body},
        headers=headers or {},
    )


async def _imported(client, asset_id: int, document: dict, headers=None, **body) -> dict:
    response = await _import(client, asset_id, document, headers, **body)
    assert response.status_code == 201, response.text
    return response.json()


async def _stored_text(test_db) -> str:
    """Every stored config and template document, as the database holds them."""
    async with test_db.readonly() as conn:
        rows = await (await conn.execute("SELECT document FROM fleet_configs")).fetchall()
        templates = await (
            await conn.execute("SELECT document, variables FROM fleet_config_templates")
        ).fetchall()
    return "\n".join([row[0] for row in rows] + [f"{row[0]}{row[1]}" for row in templates])


async def _secret_count(test_db) -> int:
    async with test_db.readonly() as conn:
        row = await (await conn.execute("SELECT COUNT(*) FROM fleet_secrets")).fetchone()
    return row[0]


async def _full_setup(client):
    """An asset with its key, an unlocked vault and the full sample imported."""
    private_key, public_key = keypair()
    headers = await _unlock(client)
    asset = await _asset(client, public_key=public_key)
    document = toolbox_file(private_key)
    result = await _imported(client, asset["id"], document, headers)
    return asset, headers, document, private_key, result


class TestImport:
    @pytest.mark.asyncio
    async def test_secrets_go_to_the_vault_and_the_rest_is_stored(self, test_db, client):
        asset, headers, document, private_key, result = await _full_setup(client)

        assert (result["secrets_stored"], result["secrets_left_out"]) == (ALL_SECRETS, 0)
        config = result["config"]
        assert config["asset_id"] == asset["id"]
        assert (config["kind"], config["source"], config["profile"]) == (
            "snapshot",
            "file",
            "dmc_observer",
        )
        assert (config["secrets_stored"], config["secrets_missing"]) == (ALL_SECRETS, 0)
        assert config["document"]["vars"]["name"] == "NL-TST-RPT"
        assert config["document"]["mqtt"]["owner"] == document["mqtt"]["owner"]
        assert isinstance(config["document"]["vars"]["prv.key"]["$secret"], int)

        stored = await _stored_text(test_db)
        for value in secret_values(document, private_key):
            assert value not in stored
        assert json.dumps(config) == json.dumps(
            (await client.get(f"/api/fleet/configs/{config['id']}")).json()
        )

        secrets = (
            await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)
        ).json()
        assert len(secrets) == ALL_SECRETS
        by_label = {secret["label"]: secret["kind"] for secret in secrets}
        assert by_label["config vars/prv.key"] == "private_key"
        assert by_label["config vars/guest.password"] == "guest_password"
        assert by_label["config mqtt/wifiPassword"] == "wifi"
        assert by_label["config mqtt/slots/0/token"] == "other"

    @pytest.mark.asyncio
    async def test_vault_off_stores_placeholders_and_says_how_many(
        self, test_db, client, monkeypatch
    ):
        monkeypatch.setattr(settings, "fleet_vault_enabled", False)
        private_key, public_key = keypair()
        asset = await _asset(client, public_key=public_key)
        document = toolbox_file(private_key)

        result = await _imported(client, asset["id"], document)

        assert (result["secrets_stored"], result["secrets_left_out"]) == (0, ALL_SECRETS)
        config = result["config"]
        assert (config["secrets_stored"], config["secrets_missing"]) == (0, ALL_SECRETS)
        assert config["document"]["vars"]["prv.key"] == {"$secret": None}
        assert config["document"]["mqtt"]["slots"][0]["password"] == {"$secret": None}
        stored = await _stored_text(test_db)
        for value in secret_values(document, private_key):
            assert value not in stored
        assert await _secret_count(test_db) == 0

    @pytest.mark.asyncio
    async def test_a_locked_vault_stores_placeholders_too(self, test_db, client):
        headers = await _unlock(client)
        await client.post("/api/fleet/vault/lock", headers=headers)
        asset = await _asset(client)
        document = toolbox_file()

        result = await _imported(client, asset["id"], document, headers)

        assert (result["secrets_stored"], result["secrets_left_out"]) == (0, len(TOOLBOX_SECRETS))
        stored = await _stored_text(test_db)
        for value in secret_values(document):
            assert value not in stored
        assert await _secret_count(test_db) == 0

    @pytest.mark.asyncio
    async def test_the_same_file_twice_does_not_store_its_secrets_twice(self, test_db, client):
        asset, headers, document, _private_key, first = await _full_setup(client)

        second = await _imported(client, asset["id"], document, headers)

        assert second["secrets_stored"] == ALL_SECRETS
        assert await _secret_count(test_db) == ALL_SECRETS
        assert second["config"]["document"] == first["config"]["document"]
        assert second["config"]["id"] != first["config"]["id"]

    @pytest.mark.asyncio
    async def test_a_changed_secret_is_stored_next_to_the_old_one(self, test_db, client):
        asset, headers, document, _private_key, first = await _full_setup(client)
        document["mqtt"]["wifiPassword"] = "a-new-wifi-password"

        second = await _imported(client, asset["id"], document, headers)

        assert await _secret_count(test_db) == ALL_SECRETS + 1
        old, new = (
            result["config"]["document"]["mqtt"]["wifiPassword"]["$secret"]
            for result in (first, second)
        )
        assert old != new

    @pytest.mark.asyncio
    async def test_a_private_key_of_another_device_is_refused(self, test_db, client):
        private_key, _public = keypair()
        _other_private, other_public = keypair()
        headers = await _unlock(client)
        asset = await _asset(client, public_key=other_public)

        response = await _import(client, asset["id"], toolbox_file(private_key), headers)

        assert response.status_code == 422
        assert "private key" in response.json()["detail"]
        assert private_key not in response.text
        assert await _secret_count(test_db) == 0
        assert (await client.get(f"/api/fleet/assets/{asset['id']}/configs")).json() == []

    @pytest.mark.asyncio
    async def test_a_private_key_in_another_form_is_kept_as_an_other_secret(self, test_db, client):
        headers = await _unlock(client)
        asset = await _asset(client, public_key="a1" * 32)
        document = toolbox_file("not-a-hex-key", sections=False)

        result = await _imported(client, asset["id"], document, headers)

        assert result["secrets_stored"] == 2
        secrets = (
            await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)
        ).json()
        assert {s["label"]: s["kind"] for s in secrets}["config vars/prv.key"] == "other"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "document",
        [{}, {"vars": []}, {"hello": "world"}, {"vars": {"guest.password": {"$secret": 1}}}],
    )
    async def test_a_file_in_no_known_format_is_refused(self, test_db, client, document):
        asset = await _asset(client)

        response = await _import(client, asset["id"], document)

        assert response.status_code == 422
        assert (await client.get(f"/api/fleet/assets/{asset['id']}/configs")).json() == []

    @pytest.mark.asyncio
    async def test_unknown_asset(self, test_db, client):
        response = await _import(client, 999, toolbox_file())

        assert response.status_code == 404
        assert response.json()["detail"] == "Asset not found"

    @pytest.mark.asyncio
    async def test_the_profile_can_be_corrected_but_never_hides_fewer_secrets(
        self, test_db, client
    ):
        headers = await _unlock(client)
        asset = await _asset(client)
        document = toolbox_file()

        result = await _imported(client, asset["id"], document, headers, profile="stock")

        assert result["config"]["profile"] == "stock"
        assert result["secrets_stored"] == len(TOOLBOX_SECRETS)
        stored = await _stored_text(test_db)
        for value in secret_values(document):
            assert value not in stored

    @pytest.mark.asyncio
    async def test_a_profile_of_the_other_file_format_is_refused(self, test_db, client):
        asset = await _asset(client)

        response = await _import(client, asset["id"], toolbox_file(), profile="companion_v1")

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_what_was_stated_on_import_is_kept_beside_the_document(self, test_db, client):
        asset = await _asset(client)

        result = await _imported(
            client,
            asset["id"],
            toolbox_file(sections=False),
            kind="desired",
            role="  repeater ",
            firmware_version="v1.14.1",
            label="Before the antenna swap",
        )

        config = result["config"]
        assert (config["kind"], config["role"], config["firmware_version"], config["label"]) == (
            "desired",
            "repeater",
            "v1.14.1",
            "Before the antenna swap",
        )
        assert set(config["document"]) == {"vars"}

    @pytest.mark.asyncio
    async def test_a_companion_file(self, test_db, client):
        private_key, public_key = keypair()
        headers = await _unlock(client)
        asset = await _asset(client, public_key=public_key)
        document = companion_file(private_key)

        result = await _imported(client, asset["id"], document, headers)

        assert result["config"]["profile"] == "companion_v1"
        assert result["secrets_stored"] == 1
        assert private_key not in await _stored_text(test_db)
        exported = await client.post(
            f"/api/fleet/configs/{result['config']['id']}/export",
            json={"include_secrets": True},
            headers=headers,
        )
        assert exported.json()["document"] == document

    @pytest.mark.asyncio
    async def test_no_secret_reaches_the_audit_log(self, test_db, client):
        _asset_row, headers, document, private_key, _result = await _full_setup(client)

        audit = await client.get("/api/fleet/vault/audit", headers=headers)

        assert sum(1 for row in audit.json() if row["action"] == "secret_added") == ALL_SECRETS
        for value in secret_values(document, private_key):
            assert value not in audit.text


class TestHistory:
    @pytest.mark.asyncio
    async def test_newest_first_without_the_documents(self, test_db, client):
        asset = await _asset(client)
        other = await _asset(client, label="Other")
        first = await _imported(client, asset["id"], toolbox_file(sections=False), label="one")
        second = await _imported(client, asset["id"], toolbox_file(), label="two")
        await _imported(client, other["id"], toolbox_file(sections=False))

        rows = (await client.get(f"/api/fleet/assets/{asset['id']}/configs")).json()

        assert [row["id"] for row in rows] == [second["config"]["id"], first["config"]["id"]]
        assert [row["label"] for row in rows] == ["two", "one"]
        assert all("document" not in row for row in rows)
        assert rows[0]["secrets_missing"] == len(TOOLBOX_SECRETS)
        assert rows[1]["secrets_missing"] == 1

    @pytest.mark.asyncio
    async def test_unknown_asset_and_unknown_config(self, test_db, client):
        no_asset = await client.get("/api/fleet/assets/999/configs")
        no_config = await client.get("/api/fleet/configs/999")

        assert (no_asset.status_code, no_config.status_code) == (404, 404)
        assert no_asset.json()["detail"] == "Asset not found"
        assert no_config.json()["detail"] == "Config not found"

    @pytest.mark.asyncio
    async def test_the_details_beside_the_document_can_be_corrected(self, test_db, client):
        asset = await _asset(client)
        config = (await _imported(client, asset["id"], toolbox_file()))["config"]

        response = await client.patch(
            f"/api/fleet/configs/{config['id']}",
            json={"profile": "dmc_repeater", "label": " fixed ", "firmware_version": ""},
        )

        assert response.status_code == 200
        updated = response.json()
        assert (updated["profile"], updated["label"], updated["firmware_version"]) == (
            "dmc_repeater",
            "fixed",
            None,
        )
        assert updated["document"] == config["document"]
        wrong = await client.patch(
            f"/api/fleet/configs/{config['id']}", json={"profile": "companion_v1"}
        )
        assert wrong.status_code == 422

    @pytest.mark.asyncio
    async def test_deleting_a_config_keeps_its_secrets_in_the_vault(self, test_db, client):
        asset, _headers, _document, _private_key, result = await _full_setup(client)
        config_id = result["config"]["id"]

        assert (await client.delete(f"/api/fleet/configs/{config_id}")).status_code == 200

        assert (await client.get(f"/api/fleet/configs/{config_id}")).status_code == 404
        assert (await client.delete(f"/api/fleet/configs/{config_id}")).status_code == 404
        assert (await client.get(f"/api/fleet/assets/{asset['id']}/configs")).json() == []
        assert await _secret_count(test_db) == ALL_SECRETS

    @pytest.mark.asyncio
    async def test_configs_go_with_their_asset(self, test_db, client):
        asset = await _asset(client)
        config = (await _imported(client, asset["id"], toolbox_file()))["config"]

        assert (await client.delete(f"/api/fleet/assets/{asset['id']}")).status_code == 200

        assert (await client.get(f"/api/fleet/configs/{config['id']}")).status_code == 404


class TestExport:
    @pytest.mark.asyncio
    async def test_with_secrets_gives_back_the_imported_file(self, test_db, client):
        asset, headers, document, _private_key, result = await _full_setup(client)
        config_id = result["config"]["id"]

        response = await client.post(
            f"/api/fleet/configs/{config_id}/export",
            json={"include_secrets": True},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        body = response.json()
        assert body["document"] == document
        assert json.dumps(body["document"]) == json.dumps(document)
        assert (body["secrets_included"], body["secrets_left_out"]) == (ALL_SECRETS, 0)

        audit = (await client.get("/api/fleet/vault/audit", headers=headers)).json()
        exported = [row for row in audit if row["action"] == "config_exported"]
        assert len(exported) == 1
        assert exported[0]["asset_id"] == asset["id"]
        assert exported[0]["detail"] == f"config {config_id}: {ALL_SECRETS} secrets"

    @pytest.mark.asyncio
    async def test_without_secrets_needs_no_vault_and_leaves_the_keys_out(
        self, test_db, client, monkeypatch
    ):
        _asset_row, _headers, document, private_key, result = await _full_setup(client)
        monkeypatch.setattr(settings, "fleet_vault_enabled", False)

        response = await client.post(
            f"/api/fleet/configs/{result['config']['id']}/export", json={"include_secrets": False}
        )

        assert response.status_code == 200
        body = response.json()
        assert (body["secrets_included"], body["secrets_left_out"]) == (0, ALL_SECRETS)
        assert "$secret" not in response.text
        for value in secret_values(document, private_key):
            assert value not in response.text
        # Still a file the toolbox reads: the sections and nothing new at the top.
        assert list(body["document"]) == ["vars", "filter", "region", "hardware", "mqtt"]
        assert "guest.password" not in body["document"]["vars"]
        assert body["document"]["vars"]["radio"] == document["vars"]["radio"]

    @pytest.mark.asyncio
    async def test_with_secrets_is_refused_while_locked_or_switched_off(
        self, test_db, client, monkeypatch
    ):
        _asset_row, headers, _document, _private_key, result = await _full_setup(client)
        url = f"/api/fleet/configs/{result['config']['id']}/export"
        await client.post("/api/fleet/vault/lock", headers=headers)

        locked = await client.post(url, json={"include_secrets": True}, headers=headers)
        monkeypatch.setattr(settings, "fleet_vault_enabled", False)
        off = await client.post(url, json={"include_secrets": True}, headers=headers)

        assert (locked.status_code, off.status_code) == (401, 403)

    @pytest.mark.asyncio
    async def test_a_deleted_secret_is_left_out_and_counted(self, test_db, client):
        _asset_row, headers, _document, _private_key, result = await _full_setup(client)
        config = result["config"]
        gone = config["document"]["mqtt"]["wifiPassword"]["$secret"]
        await client.delete(f"/api/fleet/secrets/{gone}", headers=headers)

        response = await client.post(
            f"/api/fleet/configs/{config['id']}/export",
            json={"include_secrets": True},
            headers=headers,
        )

        body = response.json()
        assert (body["secrets_included"], body["secrets_left_out"]) == (ALL_SECRETS - 1, 1)
        assert "wifiPassword" not in body["document"]["mqtt"]

    @pytest.mark.asyncio
    async def test_a_secret_of_another_asset_is_never_put_in(self, test_db, client):
        headers = await _unlock(client)
        mine = await _asset(client)
        theirs = await _asset(client, label="Theirs")
        secret = await client.post(
            f"/api/fleet/assets/{theirs['id']}/secrets",
            json={"kind": "other", "label": "theirs", "value": "not-yours"},
            headers=headers,
        )
        config = (await _imported(client, mine["id"], toolbox_file(sections=False)))["config"]
        forged = dict(config["document"])
        forged["vars"] = {**forged["vars"], "guest.password": {"$secret": secret.json()["id"]}}
        async with test_db.tx() as conn:
            await conn.execute(
                "UPDATE fleet_configs SET document = ? WHERE id = ?",
                (json.dumps(forged), config["id"]),
            )

        response = await client.post(
            f"/api/fleet/configs/{config['id']}/export",
            json={"include_secrets": True},
            headers=headers,
        )

        assert response.status_code == 200
        assert "not-yours" not in response.text
        assert response.json()["secrets_left_out"] == 1


def _template_body(**over) -> dict:
    return {
        "name": "Repeater base",
        "description": "Default settings for a new repeater",
        "profile": "stock",
        "role": "repeater",
        "document": {
            "vars": {
                "name": "{{asset.label}}",
                "tx": "{{power}}",
                "owner.info": "Site {{site}}",
                "repeat": True,
                "guest.password": {"$secret": None},
            }
        },
        "variables": [
            {"name": "power", "description": "TX power", "default": "20", "type": "number"},
            {"name": "site", "description": "", "default": "", "type": "text"},
        ],
        **over,
    }


class TestTemplates:
    @pytest.mark.asyncio
    async def test_save_a_config_as_a_template(self, test_db, client):
        asset, _headers, document, private_key, result = await _full_setup(client)

        response = await client.post(
            f"/api/fleet/configs/{result['config']['id']}/template",
            json={"name": "Observer base", "description": "From mast 7"},
        )

        assert response.status_code == 201, response.text
        template = response.json()
        assert (template["name"], template["profile"], template["variables"]) == (
            "Observer base",
            "dmc_observer",
            [],
        )
        assert "name" not in template["document"]["vars"]
        assert "lat" not in template["document"]["vars"]
        assert template["document"]["vars"]["prv.key"] == {"$secret": None}
        assert template["document"]["mqtt"]["wifiSsid"] == "mesh-lab"
        assert '"$secret": null' in await _stored_text(test_db)
        for value in secret_values(document, private_key):
            assert value not in await _stored_text(test_db)
        listed = (await client.get("/api/fleet/config-templates")).json()
        assert [row["id"] for row in listed] == [template["id"]]
        assert asset["id"] > 0

    @pytest.mark.asyncio
    async def test_create_edit_and_delete_a_template(self, test_db, client):
        created = await client.post("/api/fleet/config-templates", json=_template_body())
        assert created.status_code == 201, created.text
        template = created.json()
        assert template["variables"][0] == {
            "name": "power",
            "description": "TX power",
            "default": "20",
            "type": "number",
        }

        changed = await client.patch(
            f"/api/fleet/config-templates/{template['id']}",
            json={
                "name": "Repeater base v2",
                "variables": [*template["variables"], {"name": "extra", "type": "boolean"}],
            },
        )
        assert changed.status_code == 200, changed.text
        assert changed.json()["name"] == "Repeater base v2"
        assert changed.json()["document"] == template["document"]
        assert changed.json()["variables"][2] == {
            "name": "extra",
            "description": "",
            "default": "",
            "type": "boolean",
        }
        assert changed.json()["updated_at"] >= template["updated_at"]

        fetched = await client.get(f"/api/fleet/config-templates/{template['id']}")
        assert fetched.json() == changed.json()

        deleted = await client.delete(f"/api/fleet/config-templates/{template['id']}")
        assert deleted.status_code == 200
        assert (
            await client.get(f"/api/fleet/config-templates/{template['id']}")
        ).status_code == 404
        assert (
            await client.delete(f"/api/fleet/config-templates/{template['id']}")
        ).status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "over",
        [
            {"document": {"vars": {"guest.password": "hunter2"}}},
            {"document": {"vars": {"name": "{{undeclared}}"}}},
            {"document": {"version": 1, "radio": {}}},
            {"variables": [{"name": "power", "type": "number", "default": "lots"}]},
            {"name": "   "},
        ],
    )
    async def test_a_template_that_breaks_a_rule_is_refused(self, test_db, client, over):
        response = await client.post("/api/fleet/config-templates", json=_template_body(**over))

        assert response.status_code == 422
        assert "hunter2" not in await _stored_text(test_db)

    @pytest.mark.asyncio
    async def test_an_edit_is_checked_against_what_stays(self, test_db, client):
        template = (await client.post("/api/fleet/config-templates", json=_template_body())).json()
        url = f"/api/fleet/config-templates/{template['id']}"

        # Dropping a variable the document still uses.
        dropped = await client.patch(url, json={"variables": []})
        secret = await client.patch(url, json={"document": {"vars": {"guest.password": "hunter2"}}})

        assert (dropped.status_code, secret.status_code) == (422, 422)
        assert (await client.get(url)).json() == template

    @pytest.mark.asyncio
    async def test_create_a_config_for_an_asset(self, test_db, client):
        asset = await _asset(client, org_serial="DTIS-0042")
        template = (await client.post("/api/fleet/config-templates", json=_template_body())).json()

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/configs/from-template",
            json={"template_id": template["id"], "values": {"site": "North"}, "label": "Plan"},
        )

        assert response.status_code == 201, response.text
        config = response.json()
        assert (config["kind"], config["source"], config["profile"], config["role"]) == (
            "desired",
            "template",
            "stock",
            "repeater",
        )
        assert config["label"] == "Plan"
        assert config["document"] == {
            "vars": {
                "name": "Mast 7",
                "tx": 20,
                "owner.info": "Site North",
                "repeat": True,
                "guest.password": {"$secret": None},
            }
        }
        assert (config["secrets_stored"], config["secrets_missing"]) == (0, 1)
        rows = (await client.get(f"/api/fleet/assets/{asset['id']}/configs")).json()
        assert [row["id"] for row in rows] == [config["id"]]

    @pytest.mark.asyncio
    async def test_a_missing_value_or_template_is_refused(self, test_db, client):
        asset = await _asset(client)
        body = _template_body(
            variables=[
                {"name": "power", "description": "", "default": "", "type": "number"},
                {"name": "site", "description": "", "default": "", "type": "text"},
            ]
        )
        template = (await client.post("/api/fleet/config-templates", json=body)).json()
        url = f"/api/fleet/assets/{asset['id']}/configs/from-template"

        missing = await client.post(url, json={"template_id": template["id"], "values": {}})
        unknown = await client.post(url, json={"template_id": 999, "values": {}})
        no_asset = await client.post(
            "/api/fleet/assets/999/configs/from-template",
            json={"template_id": template["id"], "values": {"power": 20}},
        )

        assert missing.status_code == 422
        assert "power" in missing.json()["detail"]
        assert (unknown.status_code, no_asset.status_code) == (404, 404)
        assert (await client.get(f"/api/fleet/assets/{asset['id']}/configs")).json() == []
