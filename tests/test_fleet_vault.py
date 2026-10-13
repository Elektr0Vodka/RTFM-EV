"""Tests for the fleet key vault and key generation (plan 31, Phases 4 and 5)."""

import json

import nacl.pwhash
import pytest

from app.config import settings
from app.decoder import derive_public_key
from app.repository import ContactRepository
from app.services import fleet_vault

PASSPHRASE = "correct horse battery staple"
OTHER = "another long passphrase 123"
TOKEN = "X-Fleet-Vault-Token"


@pytest.fixture(autouse=True)
def _vault_on(monkeypatch):
    """Vault switched on, cheap key derivation, no sessions left over."""
    monkeypatch.setattr(settings, "fleet_vault_enabled", True)
    monkeypatch.setattr(fleet_vault, "KDF_OPSLIMIT", nacl.pwhash.argon2id.OPSLIMIT_MIN)
    monkeypatch.setattr(fleet_vault, "KDF_MEMLIMIT", nacl.pwhash.argon2id.MEMLIMIT_MIN)
    fleet_vault.sessions.close_all()
    yield
    fleet_vault.sessions.close_all()


async def _init(client, passphrase: str = PASSPHRASE) -> dict:
    response = await client.post("/api/fleet/vault/init", json={"passphrase": passphrase})
    assert response.status_code == 200, response.text
    return {TOKEN: response.json()["token"]}


async def _asset(client, **fields) -> dict:
    response = await client.post("/api/fleet/assets", json={"label": "Spare", **fields})
    assert response.status_code == 201
    return response.json()


async def _add(client, headers, asset_id: int, **body) -> dict:
    payload = {"kind": "admin_password", "label": "admin", "value": "s3cret-pass", **body}
    response = await client.post(
        f"/api/fleet/assets/{asset_id}/secrets", json=payload, headers=headers
    )
    assert response.status_code == 201, response.text
    return response.json()


def _keypair() -> tuple[str, str]:
    found = fleet_vault.generate_keypair("", set(), 1, 1000)
    assert found is not None
    private_key, public_key, _attempts = found
    return private_key.hex(), public_key.hex()


class TestSwitch:
    @pytest.mark.asyncio
    async def test_status_reports_a_disabled_vault(self, test_db, client, monkeypatch):
        monkeypatch.setattr(settings, "fleet_vault_enabled", False)

        response = await client.get("/api/fleet/vault")

        assert response.status_code == 200
        assert response.json()["enabled"] is False

    @pytest.mark.asyncio
    async def test_every_other_route_is_refused_when_disabled(self, test_db, client, monkeypatch):
        monkeypatch.setattr(settings, "fleet_vault_enabled", False)
        asset = await _asset(client)

        calls = [
            client.post("/api/fleet/vault/init", json={"passphrase": PASSPHRASE}),
            client.post("/api/fleet/vault/unlock", json={"passphrase": PASSPHRASE}),
            client.get(f"/api/fleet/assets/{asset['id']}/secrets"),
            client.post(f"/api/fleet/assets/{asset['id']}/generate-key", json={}),
            client.get("/api/fleet/vault/audit"),
        ]
        for call in calls:
            assert (await call).status_code == 403


class TestUnlock:
    @pytest.mark.asyncio
    async def test_first_use_sets_the_passphrase_and_unlocks(self, test_db, client):
        before = (await client.get("/api/fleet/vault")).json()
        headers = await _init(client)
        after = (await client.get("/api/fleet/vault", headers=headers)).json()

        assert (before["enabled"], before["initialised"], before["unlocked"]) == (
            True,
            False,
            False,
        )
        assert (after["initialised"], after["unlocked"]) == (True, True)
        assert (await client.get("/api/fleet/vault")).json()["unlocked"] is False

    @pytest.mark.asyncio
    async def test_a_second_init_is_refused(self, test_db, client):
        await _init(client)

        response = await client.post("/api/fleet/vault/init", json={"passphrase": OTHER})

        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_a_short_passphrase_is_refused(self, test_db, client):
        response = await client.post("/api/fleet/vault/init", json={"passphrase": "short"})

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_unlock_needs_the_right_passphrase(self, test_db, client):
        await _init(client)

        wrong = await client.post("/api/fleet/vault/unlock", json={"passphrase": OTHER})
        right = await client.post("/api/fleet/vault/unlock", json={"passphrase": PASSPHRASE})

        assert wrong.status_code == 401
        assert right.status_code == 200 and right.json()["token"]

    @pytest.mark.asyncio
    async def test_unlock_before_init_is_refused(self, test_db, client):
        response = await client.post("/api/fleet/vault/unlock", json={"passphrase": PASSPHRASE})

        assert response.status_code == 409

    @pytest.mark.asyncio
    async def test_lock_ends_the_session(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)

        await client.post("/api/fleet/vault/lock", headers=headers)

        response = await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_an_idle_session_expires(self, test_db, client, monkeypatch):
        headers = await _init(client)
        asset = await _asset(client)
        monkeypatch.setattr(fleet_vault, "IDLE_SECONDS", -1)

        response = await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_secret_routes_need_a_token(self, test_db, client):
        await _init(client)
        asset = await _asset(client)

        for headers in ({}, {TOKEN: "made-up"}):
            response = await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)
            assert response.status_code == 401


class TestSecrets:
    @pytest.mark.asyncio
    async def test_a_secret_is_listed_without_its_value(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)

        created = await _add(client, headers, asset["id"])
        listed = (
            await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)
        ).json()

        assert listed == [created]
        assert set(created) == {"id", "asset_id", "kind", "label", "created_at", "updated_at"}
        assert "s3cret-pass" not in json.dumps(listed)

    @pytest.mark.asyncio
    async def test_reveal_returns_the_value(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)
        secret = await _add(client, headers, asset["id"])

        response = await client.post(f"/api/fleet/secrets/{secret['id']}/reveal", headers=headers)

        assert response.status_code == 200
        assert response.json() == {"value": "s3cret-pass"}

    @pytest.mark.asyncio
    async def test_the_database_holds_no_plaintext(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)
        await _add(client, headers, asset["id"])

        async with test_db.readonly() as conn:
            async with conn.execute("SELECT nonce, ciphertext FROM fleet_secrets") as cursor:
                row = await cursor.fetchone()
            async with conn.execute("SELECT * FROM fleet_vault") as cursor:
                vault = await cursor.fetchone()
        assert b"s3cret-pass" not in bytes(row["ciphertext"])
        assert PASSPHRASE.encode() not in b"".join(
            bytes(value) for value in tuple(vault) if isinstance(value, (bytes, memoryview))
        )

    @pytest.mark.asyncio
    async def test_a_ciphertext_moved_to_another_asset_does_not_open(self, test_db, client):
        headers = await _init(client)
        first = await _asset(client)
        second = await _asset(client, label="Other")
        secret = await _add(client, headers, first["id"])
        async with test_db.tx() as conn:
            await conn.execute(
                "UPDATE fleet_secrets SET asset_id = ? WHERE id = ?", (second["id"], secret["id"])
            )

        response = await client.post(f"/api/fleet/secrets/{secret['id']}/reveal", headers=headers)

        assert response.status_code == 409
        assert "s3cret-pass" not in response.text

    @pytest.mark.asyncio
    async def test_delete_a_secret(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)
        secret = await _add(client, headers, asset["id"])

        response = await client.delete(f"/api/fleet/secrets/{secret['id']}", headers=headers)

        assert response.status_code == 200
        listed = await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)
        assert listed.json() == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "body",
        [
            {"kind": "admin_password", "value": ""},
            {"kind": "admin_password", "value": "   "},
            {"kind": "nonsense", "value": "x"},
            {"kind": "other", "value": "x" * 4097},
            {"kind": "private_key", "value": "abcd"},
        ],
    )
    async def test_invalid_secrets_are_rejected(self, test_db, client, body):
        headers = await _init(client)
        asset = await _asset(client)

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/secrets", json=body, headers=headers
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_a_private_key_must_belong_to_the_asset(self, test_db, client):
        headers = await _init(client)
        private_key, public_key = _keypair()
        other_private, _other_public = _keypair()
        asset = await _asset(client, public_key=public_key)
        url = f"/api/fleet/assets/{asset['id']}/secrets"

        wrong = await client.post(
            url, json={"kind": "private_key", "value": other_private}, headers=headers
        )
        right = await client.post(
            url, json={"kind": "private_key", "value": private_key.upper()}, headers=headers
        )

        assert wrong.status_code == 422
        assert right.status_code == 201
        revealed = await client.post(
            f"/api/fleet/secrets/{right.json()['id']}/reveal", headers=headers
        )
        assert revealed.json()["value"] == private_key

    @pytest.mark.asyncio
    async def test_an_asset_with_secrets_cannot_be_deleted(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)
        secret = await _add(client, headers, asset["id"])

        refused = await client.delete(f"/api/fleet/assets/{asset['id']}")
        await client.delete(f"/api/fleet/secrets/{secret['id']}", headers=headers)
        allowed = await client.delete(f"/api/fleet/assets/{asset['id']}")

        assert refused.status_code == 409
        assert allowed.status_code == 200

    @pytest.mark.asyncio
    async def test_asset_responses_never_carry_secret_material(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)
        await _add(client, headers, asset["id"])

        text = (await client.get("/api/fleet/assets")).text
        text += (await client.get(f"/api/fleet/assets/{asset['id']}")).text

        assert "s3cret-pass" not in text
        assert "ciphertext" not in text and "nonce" not in text


class TestPassphraseChange:
    @pytest.mark.asyncio
    async def test_change_keeps_the_secrets_and_ends_old_sessions(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)
        secret = await _add(client, headers, asset["id"])

        response = await client.post(
            "/api/fleet/vault/passphrase",
            json={"current": PASSPHRASE, "new": OTHER},
            headers=headers,
        )
        new_headers = {TOKEN: response.json()["token"]}

        assert response.status_code == 200
        old = await client.post(f"/api/fleet/secrets/{secret['id']}/reveal", headers=headers)
        new = await client.post(f"/api/fleet/secrets/{secret['id']}/reveal", headers=new_headers)
        assert old.status_code == 401
        assert new.json() == {"value": "s3cret-pass"}
        assert (
            await client.post("/api/fleet/vault/unlock", json={"passphrase": PASSPHRASE})
        ).status_code == 401
        assert (
            await client.post("/api/fleet/vault/unlock", json={"passphrase": OTHER})
        ).status_code == 200

    @pytest.mark.asyncio
    async def test_change_needs_the_current_passphrase(self, test_db, client):
        headers = await _init(client)

        response = await client.post(
            "/api/fleet/vault/passphrase",
            json={"current": OTHER, "new": "yet another long one"},
            headers=headers,
        )

        assert response.status_code == 401


class TestAudit:
    @pytest.mark.asyncio
    async def test_actions_are_logged_without_any_secret(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)
        secret = await _add(client, headers, asset["id"])
        await client.post(f"/api/fleet/secrets/{secret['id']}/reveal", headers=headers)
        await client.post("/api/fleet/vault/unlock", json={"passphrase": OTHER})
        await client.delete(f"/api/fleet/secrets/{secret['id']}", headers=headers)

        response = await client.get("/api/fleet/vault/audit", headers=headers)

        assert response.status_code == 200
        rows = response.json()
        assert [row["action"] for row in reversed(rows)] == [
            "vault_created",
            "secret_added",
            "secret_revealed",
            "unlock_failed",
            "secret_deleted",
        ]
        revealed = next(row for row in rows if row["action"] == "secret_revealed")
        assert (revealed["asset_id"], revealed["secret_id"]) == (asset["id"], secret["id"])
        assert "s3cret-pass" not in response.text
        assert PASSPHRASE not in response.text and OTHER not in response.text


class TestExportImport:
    @pytest.mark.asyncio
    async def test_round_trip_restores_a_deleted_secret(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client, org_serial="S-1")
        secret = await _add(client, headers, asset["id"])

        exported = await client.post(
            "/api/fleet/vault/export", json={"passphrase": OTHER}, headers=headers
        )
        document = exported.json()
        await client.delete(f"/api/fleet/secrets/{secret['id']}", headers=headers)
        imported = await client.post(
            "/api/fleet/vault/import",
            json={"passphrase": OTHER, "document": document},
            headers=headers,
        )

        assert exported.status_code == 200
        assert "s3cret-pass" not in exported.text
        assert imported.json() == {"imported": 1, "skipped": 0}
        listed = (
            await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)
        ).json()
        revealed = await client.post(
            f"/api/fleet/secrets/{listed[0]['id']}/reveal", headers=headers
        )
        assert revealed.json() == {"value": "s3cret-pass"}

    @pytest.mark.asyncio
    async def test_import_skips_what_is_already_there_and_what_has_no_asset(self, test_db, client):
        headers = await _init(client)
        kept = await _asset(client, org_serial="S-1")
        gone = await _asset(client, label="Gone", org_serial="S-2")
        await _add(client, headers, kept["id"])
        gone_secret = await _add(client, headers, gone["id"], value="other-value")
        document = (
            await client.post(
                "/api/fleet/vault/export", json={"passphrase": OTHER}, headers=headers
            )
        ).json()
        await client.delete(f"/api/fleet/secrets/{gone_secret['id']}", headers=headers)
        await client.delete(f"/api/fleet/assets/{gone['id']}")

        imported = await client.post(
            "/api/fleet/vault/import",
            json={"passphrase": OTHER, "document": document},
            headers=headers,
        )

        assert imported.json() == {"imported": 0, "skipped": 2}

    @pytest.mark.asyncio
    async def test_import_with_the_wrong_passphrase_stores_nothing(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client, org_serial="S-1")
        secret = await _add(client, headers, asset["id"])
        document = (
            await client.post(
                "/api/fleet/vault/export", json={"passphrase": OTHER}, headers=headers
            )
        ).json()
        await client.delete(f"/api/fleet/secrets/{secret['id']}", headers=headers)

        response = await client.post(
            "/api/fleet/vault/import",
            json={"passphrase": "not the export one", "document": document},
            headers=headers,
        )

        assert response.status_code == 422
        listed = await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)
        assert listed.json() == []


class TestGenerateKey:
    def test_generated_private_key_derives_to_its_public_key(self):
        found = fleet_vault.generate_keypair("", set(), 1, 1000)

        assert found is not None
        private_key, public_key, attempts = found
        assert len(private_key) == 64 and len(public_key) == 32
        assert derive_public_key(private_key) == public_key
        assert public_key[0] not in (0x00, 0xFF)
        assert attempts >= 1

    def test_prefix_and_taken_prefixes_are_honoured(self):
        taken = {f"a{digit:x}" for digit in range(15)}  # a0..ae taken, only af is free

        found = fleet_vault.generate_keypair("a", taken, 1, 200000)

        assert found is not None
        assert found[1].hex().startswith("af")

    def test_gives_up_after_the_attempt_limit(self):
        assert fleet_vault.generate_keypair("abcd", set(), 1, 3) is None

    @pytest.mark.asyncio
    async def test_generate_stores_the_key_and_links_the_asset(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client)

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/generate-key", json={"prefix": "b"}, headers=headers
        )

        assert response.status_code == 200, response.text
        data = response.json()
        public_key = data["asset"]["public_key"]
        assert public_key.startswith("b") and len(public_key) == 64
        assert "private" not in json.dumps(data)
        secrets = (
            await client.get(f"/api/fleet/assets/{asset['id']}/secrets", headers=headers)
        ).json()
        assert [s["kind"] for s in secrets] == ["private_key"]
        revealed = await client.post(
            f"/api/fleet/secrets/{secrets[0]['id']}/reveal", headers=headers
        )
        assert derive_public_key(bytes.fromhex(revealed.json()["value"])).hex() == public_key

    @pytest.mark.asyncio
    async def test_generate_avoids_the_prefix_of_a_known_node(self, test_db, client):
        headers = await _init(client)
        for digit in range(15):
            key = f"c{digit:x}" + "00" * 31
            await ContactRepository.upsert({"public_key": key, "name": "n", "type": 2})
        asset = await _asset(client)

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/generate-key",
            json={"prefix": "c", "free_bytes": 1},
            headers=headers,
        )

        assert response.json()["asset"]["public_key"].startswith("cf")

    @pytest.mark.asyncio
    async def test_generate_is_refused_for_an_asset_that_has_a_key(self, test_db, client):
        headers = await _init(client)
        asset = await _asset(client, public_key="a1" * 32)

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/generate-key", json={}, headers=headers
        )

        assert response.status_code == 409

    @pytest.mark.asyncio
    @pytest.mark.parametrize("body", [{"prefix": "xyz"}, {"prefix": "abcde"}, {"free_bytes": 3}])
    async def test_invalid_requests_are_rejected(self, test_db, client, body):
        headers = await _init(client)
        asset = await _asset(client)

        response = await client.post(
            f"/api/fleet/assets/{asset['id']}/generate-key", json=body, headers=headers
        )

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_generate_needs_an_unlocked_vault(self, test_db, client):
        await _init(client)
        asset = await _asset(client)

        response = await client.post(f"/api/fleet/assets/{asset['id']}/generate-key", json={})

        assert response.status_code == 401
