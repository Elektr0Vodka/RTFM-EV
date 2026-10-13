"""Tests for the fleet health data and attention settings (plan 31, Phase 3a)."""

import json

import pytest

from app.repository import ContactRepository
from app.repository.device_config_history import DeviceConfigHistoryRepository

KEY_A = "a1" * 32
KEY_B = "b2" * 32

EMPTY_HEALTH = {
    "battery_volts": None,
    "temperature": None,
    "telemetry_at": None,
    "firmware_version": None,
    "firmware_at": None,
    "firmware_source": None,
}


async def _linked_asset(client, key: str = KEY_A, **fields) -> dict:
    await ContactRepository.upsert({"public_key": key, "name": "Tower", "type": 2})
    response = await client.post("/api/fleet/assets", json={"public_key": key, **fields})
    assert response.status_code == 201
    return response.json()


async def _snmp_poll(test_db, key: str, timestamp: int, values: dict) -> None:
    async with test_db.tx() as conn:
        await conn.execute(
            "INSERT INTO snmp_history (public_key, timestamp, data) VALUES (?, ?, ?)",
            (key, timestamp, json.dumps(values)),
        )


async def _telemetry(test_db, key: str, timestamp: int, data: dict) -> None:
    async with test_db.tx() as conn:
        await conn.execute(
            "INSERT INTO repeater_telemetry_history (public_key, timestamp, data) VALUES (?, ?, ?)",
            (key, timestamp, json.dumps(data)),
        )


class TestHealth:
    @pytest.mark.asyncio
    async def test_an_asset_without_a_key_has_no_health(self, test_db, client):
        asset = (await client.post("/api/fleet/assets", json={"label": "Spare"})).json()

        assert asset["health"] is None

    @pytest.mark.asyncio
    async def test_a_node_with_nothing_stored_has_empty_health(self, test_db, client):
        asset = await _linked_asset(client)

        assert asset["health"] == EMPTY_HEALTH

    @pytest.mark.asyncio
    async def test_battery_comes_from_the_newest_stored_telemetry(self, test_db, client):
        asset = await _linked_asset(client)
        await _telemetry(test_db, KEY_A, 1700000000, {"battery_volts": 3.9})
        await _telemetry(test_db, KEY_A, 1700000600, {"battery_volts": 3.71})

        health = (await client.get(f"/api/fleet/assets/{asset['id']}")).json()["health"]

        assert health["battery_volts"] == 3.71
        assert health["telemetry_at"] == 1700000600

    @pytest.mark.asyncio
    async def test_firmware_comes_from_the_owner_info_snapshot(self, test_db, client):
        asset = await _linked_asset(client)
        await DeviceConfigHistoryRepository.record(
            KEY_A, "owner_info", 1700000000, {"firmware_version": "v1.9.0", "name": "Tower"}
        )

        health = (await client.get(f"/api/fleet/assets/{asset['id']}")).json()["health"]

        assert (health["firmware_version"], health["firmware_at"], health["firmware_source"]) == (
            "v1.9.0",
            1700000000,
            "owner_info",
        )

    @pytest.mark.asyncio
    async def test_the_newer_of_snapshot_and_snmp_poll_wins(self, test_db, client):
        asset = await _linked_asset(client)
        await DeviceConfigHistoryRepository.record(
            KEY_A, "owner_info", 1700000000, {"firmware_version": "v1.9.0"}
        )
        await _snmp_poll(test_db, KEY_A, 1700000500, {"firmware_version": "v1.10.0"})
        await _snmp_poll(test_db, KEY_A, 1700000100, {"firmware_version": "v1.9.5"})

        health = (await client.get(f"/api/fleet/assets/{asset['id']}")).json()["health"]

        assert (health["firmware_version"], health["firmware_source"]) == ("v1.10.0", "snmp")

    @pytest.mark.asyncio
    async def test_the_list_carries_health_per_asset(self, test_db, client):
        await _linked_asset(client, KEY_A)
        await _linked_asset(client, KEY_B)
        await _snmp_poll(test_db, KEY_B, 1700000500, {"firmware_version": "v1.10.0"})
        await client.post("/api/fleet/assets", json={"label": "Spare"})

        by_key = {a["public_key"]: a for a in (await client.get("/api/fleet/assets")).json()}

        assert by_key[KEY_A]["health"] == EMPTY_HEALTH
        assert by_key[KEY_B]["health"]["firmware_version"] == "v1.10.0"
        assert by_key[None]["health"] is None

    @pytest.mark.asyncio
    async def test_a_broken_stored_row_is_skipped(self, test_db, client):
        asset = await _linked_asset(client)
        async with test_db.tx() as conn:
            await conn.execute(
                "INSERT INTO snmp_history (public_key, timestamp, data) VALUES (?, 5, 'not json')",
                (KEY_A,),
            )

        response = await client.get(f"/api/fleet/assets/{asset['id']}")

        assert response.status_code == 200
        assert response.json()["health"] == EMPTY_HEALTH


class TestTargetFirmware:
    @pytest.mark.asyncio
    async def test_target_firmware_is_stored_and_cleared(self, test_db, client):
        asset = (
            await client.post(
                "/api/fleet/assets", json={"label": "Spare", "target_firmware": " v1.10.0 "}
            )
        ).json()
        assert asset["target_firmware"] == "v1.10.0"

        cleared = (
            await client.patch(f"/api/fleet/assets/{asset['id']}", json={"target_firmware": None})
        ).json()
        assert cleared["target_firmware"] is None


class TestSettings:
    @pytest.mark.asyncio
    async def test_defaults(self, test_db, client):
        response = await client.get("/api/fleet/settings")

        assert response.status_code == 200
        assert response.json() == {"silent_hours": 48, "low_battery_volts": 3.5}

    @pytest.mark.asyncio
    async def test_save(self, test_db, client):
        response = await client.put(
            "/api/fleet/settings", json={"silent_hours": 12, "low_battery_volts": 3.3}
        )

        assert response.status_code == 200
        assert (await client.get("/api/fleet/settings")).json() == {
            "silent_hours": 12,
            "low_battery_volts": 3.3,
        }

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "body",
        [
            {"silent_hours": 0, "low_battery_volts": 3.5},
            {"silent_hours": 9000, "low_battery_volts": 3.5},
            {"silent_hours": 48, "low_battery_volts": -1},
            {"silent_hours": 48},
        ],
    )
    async def test_invalid_settings_are_rejected(self, test_db, client, body):
        assert (await client.put("/api/fleet/settings", json=body)).status_code == 422
