"""RF tracked-telemetry cycle with SNMP as the primary source.

A repeater marked ``use_as_telemetry`` whose SNMP polls are healthy gets no RF
requests; RF runs again when SNMP stops answering. The radio is a stub, so
nothing here can transmit.
"""

import time
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import AppSettings
from app.repository import ContactRepository
from app.repository.contact_snmp import ContactSnmpRepository

KEY_MARKED = "aa" * 32
KEY_PLAIN = "bb" * 32


async def _insert_repeater(key: str) -> None:
    await ContactRepository.upsert({"public_key": key, "name": key[:4], "type": 2, "flags": 0})


async def _snmp(key: str, *, marked: bool = True, last_ok_age: int | None = 30) -> None:
    now = int(time.time())
    await ContactSnmpRepository.upsert(
        key,
        host="10.0.0.1",
        port=161,
        community="public",
        poll_enabled=True,
        poll_interval_minutes=1,
        now=now,
        use_as_telemetry=marked,
    )
    if last_ok_age is not None:
        await ContactSnmpRepository.record_ok(key, now - last_ok_age)


def _fake_radio():
    radio = MagicMock()
    radio.is_connected = True

    class FakeRadioOp:
        async def __aenter__(self):
            return MagicMock()

        async def __aexit__(self, *args):
            pass

    radio.radio_operation = MagicMock(side_effect=lambda *a, **k: FakeRadioOp())
    return radio


async def _run_cycle(settings: AppSettings) -> dict[str, list[str]]:
    from app.radio_sync import _run_telemetry_cycle

    called: dict[str, list[str]] = {"status": [], "neighbors": [], "clock": [], "lpp": []}

    def _recorder(name: str, result):
        async def _fake(mc, contact):
            called[name].append(contact.public_key)
            return result

        return _fake

    with (
        patch(
            "app.radio_sync.AppSettingsRepository.get",
            new_callable=AsyncMock,
            return_value=settings,
        ),
        patch("app.radio_sync.radio_manager", _fake_radio()),
        patch("app.radio_sync._collect_repeater_telemetry", new=_recorder("status", True)),
        patch("app.radio_sync._collect_repeater_neighbor_signal", new=_recorder("neighbors", True)),
        patch("app.radio_sync._maybe_sync_repeater_clock", new=_recorder("clock", "set")),
        patch("app.radio_sync._collect_contact_telemetry", new=_recorder("lpp", True)),
    ):
        await _run_telemetry_cycle()
    return called


class TestFallback:
    @pytest.mark.asyncio
    async def test_healthy_marked_repeater_skipped(self, test_db):
        await _insert_repeater(KEY_MARKED)
        await _insert_repeater(KEY_PLAIN)
        await _snmp(KEY_MARKED)
        settings = AppSettings(
            tracked_telemetry_repeaters=[KEY_MARKED, KEY_PLAIN],
            clock_sync_repeaters=[KEY_MARKED, KEY_PLAIN],
        )
        called = await _run_cycle(settings)
        for name in ("status", "neighbors", "clock"):
            assert KEY_MARKED not in called[name]
            assert KEY_PLAIN in called[name]

    @pytest.mark.asyncio
    async def test_unhealthy_marked_repeater_collected(self, test_db):
        await _insert_repeater(KEY_MARKED)
        await _snmp(KEY_MARKED, last_ok_age=7200)
        called = await _run_cycle(AppSettings(tracked_telemetry_repeaters=[KEY_MARKED]))
        assert called["status"] == [KEY_MARKED]
        assert called["neighbors"] == [KEY_MARKED]

    @pytest.mark.asyncio
    async def test_marked_node_on_lpp_list_keeps_lpp_request(self, test_db):
        await _insert_repeater(KEY_MARKED)
        await _snmp(KEY_MARKED)
        settings = AppSettings(
            tracked_telemetry_repeaters=[KEY_MARKED], tracked_telemetry_contacts=[KEY_MARKED]
        )
        called = await _run_cycle(settings)
        assert called["status"] == []
        assert called["lpp"] == [KEY_MARKED]

    @pytest.mark.asyncio
    async def test_unmarking_resumes_rf(self, test_db):
        await _insert_repeater(KEY_MARKED)
        await _snmp(KEY_MARKED)
        settings = AppSettings(tracked_telemetry_repeaters=[KEY_MARKED])
        assert (await _run_cycle(settings))["status"] == []

        await _snmp(KEY_MARKED, marked=False)
        assert (await _run_cycle(settings))["status"] == [KEY_MARKED]

    @pytest.mark.asyncio
    async def test_clamp_counts_skipped_nodes(self, test_db):
        from app.radio_sync import _maybe_run_scheduled_cycle

        await _insert_repeater(KEY_MARKED)
        await _insert_repeater(KEY_PLAIN)
        await _snmp(KEY_MARKED)
        settings = AppSettings(tracked_telemetry_repeaters=[KEY_MARKED, KEY_PLAIN])
        with (
            patch(
                "app.radio_sync.AppSettingsRepository.get",
                new_callable=AsyncMock,
                return_value=settings,
            ),
            patch("app.radio_sync.clamp_telemetry_interval", return_value=1) as clamp,
            patch("app.radio_sync._run_telemetry_cycle", new_callable=AsyncMock),
        ):
            await _maybe_run_scheduled_cycle(datetime(2026, 10, 18, 12, 0, tzinfo=UTC))
        assert clamp.call_args.args[1] == 2
