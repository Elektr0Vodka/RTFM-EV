"""Bulk latest-telemetry repo methods and the /contacts/telemetry/latest endpoint."""

import time

import pytest

from app.repository import ContactRepository
from app.repository.contact_snmp import ContactSnmpRepository, SnmpHistoryRepository
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


async def _mark(public_key: str, *, use_as_telemetry: bool = True, poll_enabled: bool = True):
    """Give a contact SNMP settings, marked as a telemetry source by default."""
    await ContactSnmpRepository.upsert(
        public_key,
        host="10.0.0.1",
        port=161,
        community="public",
        poll_enabled=poll_enabled,
        poll_interval_minutes=1,
        now=int(time.time()),
        use_as_telemetry=use_as_telemetry,
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
            "temperature_at": now - 200,
            "mcu_temperature": None,
            "mcu_temperature_at": None,
            "source": "repeater",
        }
        assert body[KEY_B]["temperature"] == 9.0
        assert body[KEY_B]["source"] == "contact"
        assert body[KEY_B]["battery_volts"] is None

    @pytest.mark.asyncio
    async def test_contact_battery_from_lpp_voltage_sensor(self, test_db, client):
        # Contacts report battery as an LPP 'voltage' sensor, not a top-level
        # battery_volts field; the endpoint should surface it.
        await _insert_contact(KEY_A)
        now = int(time.time())
        await ContactTelemetryRepository.record(
            KEY_A,
            now - 60,
            {
                "lpp_sensors": [
                    {"channel": 1, "type_name": "temperature", "value": 18.0},
                    {"channel": 2, "type_name": "voltage", "value": 3.82},
                ]
            },
        )

        response = await client.get("/api/contacts/telemetry/latest")
        assert response.status_code == 200
        body = response.json()
        assert body[KEY_A]["battery_volts"] == 3.82
        assert body[KEY_A]["temperature"] == 18.0

    @pytest.mark.asyncio
    async def test_key_collision_merges_per_field(self, test_db, client):
        # Same key in both tables: each field comes from the newest reading that
        # has it; timestamp and source describe the battery reading.
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
        assert body[KEY_C]["battery_volts"] == 4.1
        assert body[KEY_C]["timestamp"] == now - 200
        assert body[KEY_C]["source"] == "repeater"
        assert body[KEY_C]["temperature"] == 12.0
        assert body[KEY_C]["temperature_at"] == now - 50

    @pytest.mark.asyncio
    async def test_snmp_battery_for_marked_node(self, test_db, client):
        await _insert_contact(KEY_A)
        now = int(time.time())
        await _mark(KEY_A)
        await RepeaterTelemetryRepository.record(KEY_A, now - 3000, {"battery_volts": 4.0})
        await SnmpHistoryRepository.record(KEY_A, now - 30, {"battery_mv": 4349, "mcu_temp_c": 42})

        body = (await client.get("/api/contacts/telemetry/latest")).json()
        assert body[KEY_A]["battery_volts"] == pytest.approx(4.349)
        assert body[KEY_A]["source"] == "snmp"
        assert body[KEY_A]["timestamp"] == now - 30
        assert body[KEY_A]["mcu_temperature"] == 42
        assert body[KEY_A]["mcu_temperature_at"] == now - 30

    @pytest.mark.asyncio
    async def test_unmarked_node_ignores_snmp(self, test_db, client):
        await _insert_contact(KEY_A)
        now = int(time.time())
        await _mark(KEY_A, use_as_telemetry=False)
        await RepeaterTelemetryRepository.record(KEY_A, now - 3000, {"battery_volts": 4.0})
        await SnmpHistoryRepository.record(KEY_A, now - 30, {"battery_mv": 4349, "mcu_temp_c": 42})

        body = (await client.get("/api/contacts/telemetry/latest")).json()
        assert body[KEY_A]["battery_volts"] == 4.0
        assert body[KEY_A]["source"] == "repeater"
        assert body[KEY_A]["mcu_temperature"] is None

    @pytest.mark.asyncio
    async def test_polling_off_ignores_snmp(self, test_db, client):
        await _insert_contact(KEY_A)
        now = int(time.time())
        await _mark(KEY_A, poll_enabled=False)
        await SnmpHistoryRepository.record(KEY_A, now - 30, {"battery_mv": 4349})

        body = (await client.get("/api/contacts/telemetry/latest")).json()
        assert KEY_A not in body

    @pytest.mark.asyncio
    async def test_old_firmware_keeps_rf_battery(self, test_db, client):
        await _insert_contact(KEY_A)
        now = int(time.time())
        await _mark(KEY_A)
        await RepeaterTelemetryRepository.record(KEY_A, now - 3000, {"battery_volts": 4.0})
        await SnmpHistoryRepository.record(KEY_A, now - 30, {"uptime_secs": 10, "mcu_temp_c": 40})

        body = (await client.get("/api/contacts/telemetry/latest")).json()
        assert body[KEY_A]["battery_volts"] == 4.0
        assert body[KEY_A]["source"] == "repeater"
        assert body[KEY_A]["mcu_temperature"] == 40

    @pytest.mark.asyncio
    async def test_lpp_temperature_survives_newer_row_without_lpp(self, test_db, client):
        await _insert_contact(KEY_A)
        now = int(time.time())
        await RepeaterTelemetryRepository.record(
            KEY_A,
            now - 7200,
            {
                "battery_volts": 4.0,
                "lpp_sensors": [{"channel": 1, "type_name": "temperature", "value": 12.5}],
            },
        )
        await RepeaterTelemetryRepository.record(
            KEY_A, now - 60, {"battery_volts": 4.2, "source": "snmp"}
        )

        body = (await client.get("/api/contacts/telemetry/latest")).json()
        assert body[KEY_A]["temperature"] == 12.5
        assert body[KEY_A]["temperature_at"] == now - 7200
        assert body[KEY_A]["battery_volts"] == 4.2

    @pytest.mark.asyncio
    async def test_snmp_written_history_row_reports_snmp_source(self, test_db, client):
        await _insert_contact(KEY_A)
        now = int(time.time())
        await RepeaterTelemetryRepository.record(
            KEY_A, now - 60, {"battery_volts": 4.2, "source": "snmp"}
        )

        body = (await client.get("/api/contacts/telemetry/latest")).json()
        assert body[KEY_A]["source"] == "snmp"

    @pytest.mark.asyncio
    async def test_sentinels_give_none(self, test_db, client):
        await _insert_contact(KEY_A)
        now = int(time.time())
        await _mark(KEY_A)
        await RepeaterTelemetryRepository.record(KEY_A, now - 3000, {"battery_volts": 4.0})
        await SnmpHistoryRepository.record(KEY_A, now - 30, {"battery_mv": 0, "mcu_temp_c": -127})

        body = (await client.get("/api/contacts/telemetry/latest")).json()
        assert body[KEY_A]["battery_volts"] == 4.0
        assert body[KEY_A]["mcu_temperature"] is None

    @pytest.mark.asyncio
    async def test_rf_battery_survives_newer_snmp_row_without_battery(self, test_db, client):
        # Old 22-OID firmware: the hourly SNMP row has no battery. The older RF
        # battery must still show.
        await _insert_contact(KEY_A)
        now = int(time.time())
        await RepeaterTelemetryRepository.record(KEY_A, now - 7200, {"battery_volts": 4.0})
        await RepeaterTelemetryRepository.record(
            KEY_A, now - 60, {"uptime_seconds": 100, "source": "snmp"}
        )

        body = (await client.get("/api/contacts/telemetry/latest")).json()
        assert body[KEY_A]["battery_volts"] == 4.0
        assert body[KEY_A]["source"] == "repeater"
        assert body[KEY_A]["timestamp"] == now - 7200

    @pytest.mark.asyncio
    async def test_empty_returns_empty_object(self, test_db, client):
        response = await client.get("/api/contacts/telemetry/latest")
        assert response.status_code == 200
        assert response.json() == {}
