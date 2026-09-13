"""Bulk latest-telemetry repo methods and the /contacts/telemetry/latest endpoint."""

import time

import pytest

from app.repository import ContactRepository
from app.repository.contact_telemetry import ContactTelemetryRepository
from app.repository.repeater_telemetry import RepeaterTelemetryRepository

KEY_A = "aa" * 32
KEY_B = "bb" * 32
KEY_C = "cc" * 32


async def _insert_contact(public_key: str) -> None:
    """Insert a minimal contact so telemetry FK constraints are satisfied."""
    await ContactRepository.upsert(
        {
            "public_key": public_key,
            "name": "Node",
            "type": 1,  # client
            "flags": 0,
            "direct_path": None,
            "direct_path_len": -1,
            "direct_path_hash_mode": -1,
            "last_advert": None,
            "lat": None,
            "lon": None,
            "last_seen": None,
            "on_radio": False,
            "last_contacted": None,
            "first_seen": None,
        }
    )


class TestGetLatestAll:
    @pytest.mark.asyncio
    async def test_returns_newest_row_per_key(self, test_db):
        await _insert_contact(KEY_A)
        await _insert_contact(KEY_B)
        now = int(time.time())
        await RepeaterTelemetryRepository.record(KEY_A, now - 200, {"battery_volts": 3.9})
        await RepeaterTelemetryRepository.record(KEY_A, now - 100, {"battery_volts": 4.0})
        await RepeaterTelemetryRepository.record(KEY_B, now - 150, {"battery_volts": 3.5})

        latest = await RepeaterTelemetryRepository.get_latest_all()
        assert set(latest) == {KEY_A, KEY_B}
        assert latest[KEY_A]["timestamp"] == now - 100
        assert latest[KEY_A]["data"]["battery_volts"] == 4.0
        assert latest[KEY_B]["timestamp"] == now - 150

    @pytest.mark.asyncio
    async def test_empty_returns_empty_dict(self, test_db):
        assert await RepeaterTelemetryRepository.get_latest_all() == {}
        assert await ContactTelemetryRepository.get_latest_all() == {}


class TestLatestTelemetryEndpoint:
    @pytest.mark.asyncio
    async def test_merges_sources_and_extracts_temperature(self, test_db, client):
        await _insert_contact(KEY_A)
        await _insert_contact(KEY_B)
        now = int(time.time())
        await RepeaterTelemetryRepository.record(
            KEY_A,
            now - 200,
            {
                "battery_volts": 4.0,
                "lpp_sensors": [{"channel": 1, "type_name": "temperature", "value": 21.5}],
            },
        )
        await ContactTelemetryRepository.record(
            KEY_B,
            now - 190,
            {"lpp_sensors": [{"channel": 1, "type_name": "temperature", "value": 9.0}]},
        )

        response = await client.get("/api/contacts/telemetry/latest")
        assert response.status_code == 200
        body = response.json()

        assert body[KEY_A] == {
            "timestamp": now - 200,
            "battery_volts": 4.0,
            "temperature": 21.5,
            "source": "repeater",
        }
        assert body[KEY_B]["temperature"] == 9.0
        assert body[KEY_B]["source"] == "contact"
        assert body[KEY_B]["battery_volts"] is None

    @pytest.mark.asyncio
    async def test_key_collision_prefers_newer_reading(self, test_db, client):
        # Same key in both tables: contact reading is newer, so it wins.
        await _insert_contact(KEY_C)
        now = int(time.time())
        await RepeaterTelemetryRepository.record(KEY_C, now - 200, {"battery_volts": 4.1})
        await ContactTelemetryRepository.record(
            KEY_C,
            now - 50,
            {"lpp_sensors": [{"channel": 1, "type_name": "temperature", "value": 12.0}]},
        )

        response = await client.get("/api/contacts/telemetry/latest")
        assert response.status_code == 200
        body = response.json()
        assert body[KEY_C]["timestamp"] == now - 50
        assert body[KEY_C]["source"] == "contact"
        assert body[KEY_C]["temperature"] == 12.0

    @pytest.mark.asyncio
    async def test_empty_returns_empty_object(self, test_db, client):
        response = await client.get("/api/contacts/telemetry/latest")
        assert response.status_code == 200
        assert response.json() == {}
