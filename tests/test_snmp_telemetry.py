"""SNMP as a telemetry source: health rule, SNMP-to-RF field mapping, hourly
history write and the HA/fanout hand-off. Nothing here reaches RF or the LAN."""

import time
from unittest.mock import AsyncMock, patch

import pytest

from app.models import ContactSnmpConfigUpdate
from app.repository import ContactRepository
from app.repository.contact_snmp import ContactSnmpRepository
from app.repository.repeater_telemetry import RepeaterTelemetryRepository
from app.routers.snmp import put_snmp_config
from app.services.snmp_poll import poll_contact
from app.services.snmp_telemetry import (
    is_snmp_healthy,
    record_snmp_telemetry,
    snmp_to_repeater_telemetry,
)

KEY_A = "aa" * 32
KEY_B = "bb" * 32
_POLL = "app.services.snmp_poll.poll_meshcore"
_BROADCAST = "app.fanout.manager.fanout_manager.broadcast_telemetry"


def _config(**overrides):
    config = {
        "public_key": KEY_A,
        "host": "10.0.0.1",
        "port": 161,
        "community": "public",
        "poll_enabled": True,
        "poll_interval_minutes": 5,
        "use_as_telemetry": True,
        "last_ok_at": None,
        "last_error": None,
        "last_error_at": None,
    }
    config.update(overrides)
    return config


async def _insert_contact(key: str = KEY_A, contact_type: int = 2):
    await ContactRepository.upsert(
        {"public_key": key, "name": "Observer", "type": contact_type, "flags": 0}
    )


FULL_VALUES = {
    "battery_mv": 4349,
    "noise_floor": -108,
    "last_rssi": -96,
    "last_snr": 3.25,
    "packets_recv": 12819,
    "packets_sent": 1040,
    "total_air_time_secs": 10,
    "rx_air_time_secs": 20,
    "uptime_secs": 154631,
    "tx_queue_len": 0,
    "recv_errors": 4511,
    "neighbour_count": 11,
    "sent_flood": 1,
    "sent_direct": 2,
    "recv_flood": 3,
    "recv_direct": 4,
    "flood_dups": 5,
    "direct_dups": 6,
    "mcu_temp_c": 42,
    "firmware_version": "v1.18.0-dev",
}


class TestHealth:
    def test_healthy_within_three_intervals(self):
        now = 1_800_000_000
        assert is_snmp_healthy(_config(last_ok_at=now - 899), now) is True
        assert is_snmp_healthy(_config(last_ok_at=now - 901), now) is False

    def test_healthy_floor_ten_minutes(self):
        now = 1_800_000_000
        assert is_snmp_healthy(_config(poll_interval_minutes=1, last_ok_at=now - 599), now)
        assert not is_snmp_healthy(_config(poll_interval_minutes=1, last_ok_at=now - 601), now)

    def test_unhealthy_when_polling_off_or_unmarked_or_never_ok(self):
        now = 1_800_000_000
        assert not is_snmp_healthy(_config(poll_enabled=False, last_ok_at=now), now)
        assert not is_snmp_healthy(_config(use_as_telemetry=False, last_ok_at=now), now)
        assert not is_snmp_healthy(_config(last_ok_at=None), now)


class TestMapping:
    def test_mapping_full_values(self):
        data = snmp_to_repeater_telemetry(FULL_VALUES)
        assert data["battery_volts"] == pytest.approx(4.349)
        assert data["noise_floor_dbm"] == -108
        assert data["last_rssi_dbm"] == -96
        assert data["last_snr_db"] == 3.25
        assert data["packets_received"] == 12819
        assert data["packets_sent"] == 1040
        assert data["airtime_seconds"] == 10
        assert data["rx_airtime_seconds"] == 20
        assert data["uptime_seconds"] == 154631
        assert data["tx_queue_len"] == 0
        assert data["recv_errors"] == 4511
        assert data["neighbor_count"] == 11
        assert (data["sent_flood"], data["sent_direct"]) == (1, 2)
        assert (data["recv_flood"], data["recv_direct"]) == (3, 4)
        assert (data["flood_dups"], data["direct_dups"]) == (5, 6)
        assert data["source"] == "snmp"
        for absent in ("full_events", "region_count", "lpp_sensors", "firmware_version"):
            assert absent not in data

    def test_mapping_old_firmware_and_sentinels(self):
        old = {k: v for k, v in FULL_VALUES.items() if k not in ("battery_mv", "tx_queue_len")}
        data = snmp_to_repeater_telemetry(old)
        assert "battery_volts" not in data
        assert "tx_queue_len" not in data
        assert "battery_volts" not in snmp_to_repeater_telemetry({"battery_mv": 0})
        assert "noise_floor_dbm" not in snmp_to_repeater_telemetry({"noise_floor": None})


class TestRecord:
    @pytest.mark.asyncio
    async def test_record_writes_hourly_for_repeater(self, test_db):
        await _insert_contact()
        t0 = int(time.time())
        with patch(_BROADCAST, new_callable=AsyncMock):
            assert await record_snmp_telemetry(_config(), 2, t0, FULL_VALUES) is True
            assert await record_snmp_telemetry(_config(), 2, t0 + 600, FULL_VALUES) is False
            assert await record_snmp_telemetry(_config(), 2, t0 + 3601, FULL_VALUES) is True
        rows = await RepeaterTelemetryRepository.get_history(KEY_A, 0)
        assert [row["timestamp"] for row in rows] == [t0, t0 + 3601]
        assert all(row["data"]["source"] == "snmp" for row in rows)

    @pytest.mark.asyncio
    async def test_record_respects_rf_row(self, test_db):
        await _insert_contact()
        now = int(time.time())
        await RepeaterTelemetryRepository.record(KEY_A, now - 1800, {"battery_volts": 4.0})
        with patch(_BROADCAST, new_callable=AsyncMock):
            assert await record_snmp_telemetry(_config(), 2, now, FULL_VALUES) is False

    @pytest.mark.asyncio
    async def test_record_skips_companion_and_unmarked(self, test_db):
        await _insert_contact(KEY_A, contact_type=1)
        await _insert_contact(KEY_B, contact_type=2)
        now = int(time.time())
        with patch(_BROADCAST, new_callable=AsyncMock):
            assert await record_snmp_telemetry(_config(), 1, now, FULL_VALUES) is False
            unmarked = _config(public_key=KEY_B, use_as_telemetry=False)
            assert await record_snmp_telemetry(unmarked, 2, now, FULL_VALUES) is False
        assert await RepeaterTelemetryRepository.get_history(KEY_A, 0) == []
        assert await RepeaterTelemetryRepository.get_history(KEY_B, 0) == []

    @pytest.mark.asyncio
    async def test_record_skips_marked_node_with_polling_off(self, test_db):
        # "Poll now" on a marked node without scheduled polling: the mark has no effect.
        await _insert_contact()
        now = int(time.time())
        with patch(_BROADCAST, new_callable=AsyncMock) as broadcast:
            assert (
                await record_snmp_telemetry(_config(poll_enabled=False), 2, now, FULL_VALUES)
                is False
            )
        broadcast.assert_not_awaited()
        assert await RepeaterTelemetryRepository.get_history(KEY_A, 0) == []

    @pytest.mark.asyncio
    async def test_record_broadcasts_telemetry(self, test_db):
        await _insert_contact()
        now = int(time.time())
        with patch(_BROADCAST, new_callable=AsyncMock) as broadcast:
            assert await record_snmp_telemetry(_config(), 2, now, FULL_VALUES) is True
            # The broadcast runs as a task; let it start.
            import asyncio

            await asyncio.sleep(0)
        broadcast.assert_awaited_once()
        sent = broadcast.await_args.args[0]
        assert sent["public_key"] == KEY_A
        assert sent["name"] == "Observer"
        assert sent["timestamp"] == now
        assert sent["battery_volts"] == pytest.approx(4.349)
        assert sent["source"] == "snmp"
        assert "community" not in sent and "host" not in sent


class TestPollHook:
    @pytest.mark.asyncio
    async def test_poll_contact_triggers_record(self, test_db):
        await _insert_contact()
        await put_snmp_config(
            KEY_A,
            ContactSnmpConfigUpdate(host="10.0.0.1", poll_enabled=True, use_as_telemetry=True),
        )
        row = await ContactSnmpRepository.get(KEY_A)
        with (
            patch(_POLL, new_callable=AsyncMock, return_value=dict(FULL_VALUES)),
            patch(_BROADCAST, new_callable=AsyncMock),
        ):
            result = await poll_contact(row)
        assert result.ok is True
        rows = await RepeaterTelemetryRepository.get_history(KEY_A, 0)
        assert len(rows) == 1
        assert rows[0]["data"]["source"] == "snmp"

    @pytest.mark.asyncio
    async def test_poll_contact_unmarked_writes_nothing(self, test_db):
        await _insert_contact()
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1", poll_enabled=True))
        row = await ContactSnmpRepository.get(KEY_A)
        with patch(_POLL, new_callable=AsyncMock, return_value=dict(FULL_VALUES)):
            await poll_contact(row)
        assert await RepeaterTelemetryRepository.get_history(KEY_A, 0) == []
