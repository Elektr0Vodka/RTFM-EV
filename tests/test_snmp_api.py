"""SNMP polling API: per-contact settings, Poll now, and the WiFi address lookup.

The poll tests patch the UDP client; the address lookup drives a MagicMock
radio (no transport). Nothing here can reach RF or the network.
"""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from meshcore import EventType
from pydantic import ValidationError

from app.models import ContactSnmpConfigUpdate
from app.radio import radio_manager
from app.repository import ContactRepository
from app.repository.contact_snmp import ContactSnmpRepository, SnmpHistoryRepository
from app.routers.snmp import (
    delete_snmp_config,
    discover_snmp_address,
    get_snmp_config,
    get_snmp_history,
    poll_snmp,
    put_snmp_config,
)
from app.services.snmp_poll import NO_MESHCORE_OIDS, is_due, run_scheduled_polls_once
from app.snmp import mib
from app.snmp.address import normalize_host, parse_wifi_status_ip
from app.snmp.client import SnmpTimeoutError

KEY_A = "aa" * 32
KEY_B = "bb" * 32
_MONOTONIC = "app.routers.server_control._monotonic"
_POLL = "app.services.snmp_poll.poll_meshcore"


async def _insert_contact(key: str = KEY_A, contact_type: int = 2):
    await ContactRepository.upsert(
        {"public_key": key, "name": "Observer", "type": contact_type, "flags": 0}
    )


def _full_values(**overrides):
    values = {entry.key: 1 for entry in mib.ENTRIES}
    values.update({"firmware_version": "v1.17.1", "node_name": "Observer"})
    values.update(overrides)
    return values


# --- pure helpers -----------------------------------------------------------


class TestNormalizeHost:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("192.168.50.95", "192.168.50.95"),
            (" 10.0.0.7 ", "10.0.0.7"),
            ("fe80::1", "fe80::1"),
            ("2001:DB8::10", "2001:db8::10"),
            ("Observer-1.lan", "observer-1.lan"),
            ("node.example.org.", "node.example.org"),
            ("heltec", "heltec"),
        ],
    )
    def test_accepts(self, raw, expected):
        assert normalize_host(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            "",
            "   ",
            "192.168.1.1:161",
            "192.168.1",
            "999.1.1.1",
            "http://node.lan",
            "node.lan/path",
            "node lan",
            "-node.lan",
            "node-.lan",
            "0.0.0.0",
            "224.0.0.1",
            "node..lan",
            "a" * 64 + ".lan",
        ],
    )
    def test_rejects(self, raw):
        with pytest.raises(ValueError):
            normalize_host(raw)


class TestParseWifiStatus:
    @pytest.mark.parametrize(
        ("reply", "expected"),
        [
            ("connected, IP: 192.168.50.95, RSSI: -22 dBm", "192.168.50.95"),
            ("connected, IP: 10.1.2.3, RSSI: -60 dBm, up 3h", "10.1.2.3"),
            ("connected, IP: 0.0.0.0, RSSI: 0 dBm", None),
            ("connected, IP: 127.0.0.1, RSSI: 0 dBm", None),
            ("disconnected", None),
            ("not_started", None),
            ("connected, IP: garbage", None),
            ("", None),
        ],
    )
    def test_parse(self, reply, expected):
        assert parse_wifi_status_ip(reply) == expected


class TestUpdateModel:
    def test_defaults(self):
        update = ContactSnmpConfigUpdate(host="192.168.1.20")
        assert (update.port, update.community, update.poll_enabled) == (161, None, False)
        assert update.poll_interval_minutes == 5

    def test_empty_community_means_keep(self):
        assert ContactSnmpConfigUpdate(host="192.168.1.20", community="").community is None

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"host": "bad host"},
            {"host": "192.168.1.20", "port": 0},
            {"host": "192.168.1.20", "port": 65536},
            {"host": "192.168.1.20", "community": "bad\ncommunity"},
            {"host": "192.168.1.20", "community": "café"},
            {"host": "192.168.1.20", "community": "x" * 65},
            {"host": "192.168.1.20", "poll_interval_minutes": 0},
            {"host": "192.168.1.20", "poll_interval_minutes": 1441},
        ],
    )
    def test_rejects_invalid(self, kwargs):
        with pytest.raises(ValidationError):
            ContactSnmpConfigUpdate(**kwargs)


# --- settings endpoints -----------------------------------------------------


class TestConfigEndpoints:
    @pytest.mark.asyncio
    async def test_get_returns_null_when_nothing_is_set(self, test_db):
        await _insert_contact()
        assert await get_snmp_config(KEY_A) is None

    @pytest.mark.asyncio
    async def test_unknown_contact_is_404(self, test_db):
        with pytest.raises(HTTPException) as exc:
            await get_snmp_config(KEY_A)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_put_stores_and_never_returns_the_community(self, test_db):
        await _insert_contact()
        saved = await put_snmp_config(
            KEY_A, ContactSnmpConfigUpdate(host="192.168.50.95", community="s3cret")
        )
        assert saved.host == "192.168.50.95"
        assert saved.port == 161
        assert saved.community_is_default is False
        assert saved.poll_enabled is False
        assert "s3cret" not in saved.model_dump_json()
        assert "community" not in set(saved.model_dump()) - {"community_is_default"}

        row = await ContactSnmpRepository.get(KEY_A)
        assert row["community"] == "s3cret"
        fetched = await get_snmp_config(KEY_A)
        assert fetched == saved

    @pytest.mark.asyncio
    async def test_new_config_without_community_uses_public(self, test_db):
        await _insert_contact()
        saved = await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="node.lan"))
        assert saved.community_is_default is True
        assert (await ContactSnmpRepository.get(KEY_A))["community"] == "public"

    @pytest.mark.asyncio
    async def test_null_community_keeps_the_stored_one(self, test_db):
        await _insert_contact()
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1", community="s3cret"))
        saved = await put_snmp_config(
            KEY_A,
            ContactSnmpConfigUpdate(
                host="10.0.0.2", port=1161, poll_enabled=True, poll_interval_minutes=15
            ),
        )
        assert (saved.host, saved.port, saved.poll_enabled) == ("10.0.0.2", 1161, True)
        assert saved.poll_interval_minutes == 15
        assert (await ContactSnmpRepository.get(KEY_A))["community"] == "s3cret"

    @pytest.mark.asyncio
    async def test_put_keeps_the_last_poll_outcome(self, test_db):
        await _insert_contact()
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        await ContactSnmpRepository.record_ok(KEY_A, 1700000000)
        saved = await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.2"))
        assert saved.last_ok_at == 1700000000

    @pytest.mark.asyncio
    async def test_put_is_refused_for_a_client_contact(self, test_db):
        await _insert_contact(contact_type=1)
        with pytest.raises(HTTPException) as exc:
            await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        assert exc.value.status_code == 400
        assert await ContactSnmpRepository.get(KEY_A) is None

    @pytest.mark.asyncio
    async def test_room_server_is_allowed(self, test_db):
        await _insert_contact(contact_type=3)
        saved = await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        assert saved.host == "10.0.0.1"

    @pytest.mark.asyncio
    async def test_delete_removes_the_row(self, test_db):
        await _insert_contact()
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1", community="s3cret"))
        assert await delete_snmp_config(KEY_A) == {"status": "ok", "deleted": True}
        assert await ContactSnmpRepository.get(KEY_A) is None
        assert await delete_snmp_config(KEY_A) == {"status": "ok", "deleted": False}

    @pytest.mark.asyncio
    async def test_deleting_the_contact_removes_its_snmp_row(self, test_db):
        await _insert_contact()
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        await ContactRepository.delete(KEY_A)
        assert await ContactSnmpRepository.get(KEY_A) is None

    @pytest.mark.asyncio
    async def test_list_poll_enabled(self, test_db):
        await _insert_contact(KEY_A)
        await _insert_contact(KEY_B)
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        await put_snmp_config(KEY_B, ContactSnmpConfigUpdate(host="10.0.0.2", poll_enabled=True))
        assert [row["public_key"] for row in await ContactSnmpRepository.list_poll_enabled()] == [
            KEY_B
        ]


# --- poll endpoint ----------------------------------------------------------


class TestPollEndpoint:
    @pytest.mark.asyncio
    async def test_poll_without_config_is_400(self, test_db):
        await _insert_contact()
        with patch(_POLL, new_callable=AsyncMock) as poll:
            with pytest.raises(HTTPException) as exc:
                await poll_snmp(KEY_A)
        assert exc.value.status_code == 400
        poll.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_successful_poll_returns_values_and_records_it(self, test_db):
        await _insert_contact()
        await put_snmp_config(
            KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1", port=1161, community="s3cret")
        )
        await ContactSnmpRepository.record_error(KEY_A, 5, "old failure")
        values = _full_values(noise_floor=-96, last_snr=-7.5)

        with patch(_POLL, new_callable=AsyncMock, return_value=values) as poll:
            response = await poll_snmp(KEY_A)

        poll.assert_awaited_once_with("10.0.0.1", 1161, "s3cret")
        assert response.ok is True
        assert response.error is None
        assert (response.host, response.port) == ("10.0.0.1", 1161)
        assert response.values == values
        assert "s3cret" not in response.model_dump_json()
        row = await ContactSnmpRepository.get(KEY_A)
        assert row["last_ok_at"] == response.timestamp
        assert row["last_error"] is None
        assert row["last_error_at"] is None
        # A good poll is also stored for the history charts.
        history = await SnmpHistoryRepository.get_history(KEY_A, 0, max_points=100)
        assert history == [{"timestamp": response.timestamp, "values": values}]

    @pytest.mark.asyncio
    async def test_failed_poll_is_ok_false_and_recorded(self, test_db):
        await _insert_contact()
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        await ContactSnmpRepository.record_ok(KEY_A, 1700000000)

        with patch(
            _POLL,
            new_callable=AsyncMock,
            side_effect=SnmpTimeoutError("no SNMP reply from 10.0.0.1:161"),
        ):
            response = await poll_snmp(KEY_A)

        assert response.ok is False
        assert response.values is None
        assert response.error == "no SNMP reply from 10.0.0.1:161"
        row = await ContactSnmpRepository.get(KEY_A)
        assert row["last_error"] == "no SNMP reply from 10.0.0.1:161"
        assert row["last_error_at"] == response.timestamp
        # The last good poll stays visible next to the error.
        assert row["last_ok_at"] == 1700000000
        # A failed poll stores no history row.
        assert await SnmpHistoryRepository.get_history(KEY_A, 0, max_points=100) == []

    @pytest.mark.asyncio
    async def test_agent_without_meshcore_oids_is_a_failure(self, test_db):
        await _insert_contact()
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1"))
        empty = {entry.key: None for entry in mib.ENTRIES}

        with patch(_POLL, new_callable=AsyncMock, return_value=empty):
            response = await poll_snmp(KEY_A)

        assert response.ok is False
        assert response.error == NO_MESHCORE_OIDS
        assert response.values is None


# --- history ----------------------------------------------------------------


class TestHistory:
    @pytest.mark.asyncio
    async def test_history_endpoint_returns_rows_in_range_oldest_first(self, test_db):
        await _insert_contact()
        now = int(time.time())
        await SnmpHistoryRepository.record(KEY_A, now - 30 * 3600, {"free_heap": 1})
        await SnmpHistoryRepository.record(KEY_A, now - 7200, {"free_heap": 2})
        await SnmpHistoryRepository.record(KEY_A, now - 60, {"free_heap": 3, "node_name": "Obs"})

        day = await get_snmp_history(KEY_A, hours=24)
        assert [entry.values["free_heap"] for entry in day] == [2, 3]
        assert day[0].timestamp < day[1].timestamp
        assert day[1].values["node_name"] == "Obs"
        assert len(await get_snmp_history(KEY_A, hours=48)) == 3

    @pytest.mark.asyncio
    async def test_history_is_per_contact(self, test_db):
        await _insert_contact(KEY_A)
        await _insert_contact(KEY_B)
        now = int(time.time())
        await SnmpHistoryRepository.record(KEY_A, now - 10, {"free_heap": 1})
        await SnmpHistoryRepository.record(KEY_B, now - 10, {"free_heap": 2})
        assert [e.values["free_heap"] for e in await get_snmp_history(KEY_B, hours=1)] == [2]

    @pytest.mark.asyncio
    async def test_long_range_is_thinned_and_keeps_the_newest_row(self, test_db):
        await _insert_contact()
        for i in range(10):
            await SnmpHistoryRepository.record(KEY_A, 1000 + i, {"n": i})

        rows = await SnmpHistoryRepository.get_history(KEY_A, 0, max_points=4)
        assert len(rows) <= 4
        assert rows[-1]["values"]["n"] == 9
        assert [r["timestamp"] for r in rows] == sorted(r["timestamp"] for r in rows)
        # Under the cap nothing is dropped.
        assert len(await SnmpHistoryRepository.get_history(KEY_A, 0, max_points=10)) == 10

    @pytest.mark.asyncio
    async def test_history_goes_away_with_the_contact(self, test_db):
        await _insert_contact()
        await SnmpHistoryRepository.record(KEY_A, 1000, {"n": 1})
        await ContactRepository.delete(KEY_A)
        assert await SnmpHistoryRepository.get_history(KEY_A, 0, max_points=10) == []


# --- schedule ---------------------------------------------------------------


class TestSchedule:
    def test_is_due(self):
        base = {"poll_interval_minutes": 5, "last_ok_at": None, "last_error_at": None}
        assert is_due(base, 1000) is True  # never polled
        assert is_due({**base, "last_ok_at": 1000}, 1000 + 299) is False
        assert is_due({**base, "last_ok_at": 1000}, 1000 + 300) is True
        # A failed attempt also counts, so a dead node is not polled every tick.
        assert is_due({**base, "last_ok_at": 100, "last_error_at": 1000}, 1000 + 299) is False
        assert is_due({**base, "poll_interval_minutes": 1, "last_error_at": 1000}, 1060) is True

    @pytest.mark.asyncio
    async def test_polls_only_enabled_contacts_that_are_due(self, test_db):
        key_c = "cc" * 32
        for key in (KEY_A, KEY_B, key_c):
            await _insert_contact(key)
        now = int(time.time())
        # A: scheduled and never polled. B: scheduled but polled just now. C: not scheduled.
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1", poll_enabled=True))
        await put_snmp_config(KEY_B, ContactSnmpConfigUpdate(host="10.0.0.2", poll_enabled=True))
        await ContactSnmpRepository.record_ok(KEY_B, now)
        await put_snmp_config(key_c, ContactSnmpConfigUpdate(host="10.0.0.3"))

        with patch(_POLL, new_callable=AsyncMock, return_value=_full_values()) as poll:
            polled = await run_scheduled_polls_once(now)

        assert polled == 1
        poll.assert_awaited_once_with("10.0.0.1", 161, "public")
        assert len(await SnmpHistoryRepository.get_history(KEY_A, 0, max_points=10)) == 1
        assert await SnmpHistoryRepository.get_history(KEY_B, 0, max_points=10) == []

    @pytest.mark.asyncio
    async def test_one_failing_contact_does_not_stop_the_others(self, test_db):
        await _insert_contact(KEY_A)
        await _insert_contact(KEY_B)
        await put_snmp_config(KEY_A, ContactSnmpConfigUpdate(host="10.0.0.1", poll_enabled=True))
        await put_snmp_config(KEY_B, ContactSnmpConfigUpdate(host="10.0.0.2", poll_enabled=True))

        async def fake_poll(host, port, community):
            if host == "10.0.0.1":
                raise SnmpTimeoutError("no SNMP reply from 10.0.0.1:161")
            return _full_values()

        with patch(_POLL, side_effect=fake_poll):
            assert await run_scheduled_polls_once() == 2

        assert (await ContactSnmpRepository.get(KEY_A))["last_error"] is not None
        assert (await ContactSnmpRepository.get(KEY_B))["last_ok_at"] is not None

    @pytest.mark.asyncio
    async def test_nothing_due_polls_nothing(self, test_db):
        with patch(_POLL, new_callable=AsyncMock) as poll:
            assert await run_scheduled_polls_once() == 0
        poll.assert_not_awaited()


# --- address lookup over RF (stubbed radio) ---------------------------------


@pytest.fixture
def _stub_radio():
    prev, prev_lock = radio_manager._meshcore, radio_manager._operation_lock
    with (
        patch("app.routers.server_control._flush_pending_messages", new_callable=AsyncMock),
        patch("app.routers.server_control.asyncio.sleep", new_callable=AsyncMock),
    ):
        yield
    radio_manager._meshcore, radio_manager._operation_lock = prev, prev_lock


def _radio_result(event_type=EventType.OK, payload=None):
    result = MagicMock()
    result.type = event_type
    result.payload = payload or {}
    return result


def _mock_mc(replies):
    mc = MagicMock()
    mc.commands = MagicMock()
    mc.commands.send_cmd = AsyncMock(return_value=_radio_result(EventType.OK))
    mc.commands.get_msg = AsyncMock(side_effect=replies)
    mc.commands.add_contact = AsyncMock(return_value=_radio_result(EventType.OK))
    mc.subscribe = MagicMock(return_value=MagicMock(unsubscribe=MagicMock()))
    mc.stop_auto_message_fetching = AsyncMock()
    mc.start_auto_message_fetching = AsyncMock()
    return mc


def _cli_reply(text: str):
    return _radio_result(
        EventType.CONTACT_MSG_RECV, {"pubkey_prefix": KEY_A[:12], "text": text, "txt_type": 1}
    )


def _sent(mc) -> list[str]:
    out = []
    for call in mc.commands.send_cmd.await_args_list:
        text = call.args[1]
        out.append(text[3:] if len(text) > 3 and text[2] == "|" else text)
    return out


async def _discover(mc, monotonic=lambda: 0.0):
    with (
        patch("app.routers.snmp.radio_manager.require_connected", return_value=mc),
        patch.object(radio_manager, "_meshcore", mc),
        patch(_MONOTONIC, side_effect=monotonic),
    ):
        return await discover_snmp_address(KEY_A)


@pytest.mark.usefixtures("_stub_radio")
class TestDiscoverAddress:
    @pytest.mark.asyncio
    async def test_sends_one_get_and_returns_the_ip(self, test_db):
        await _insert_contact()
        mc = _mock_mc([_cli_reply("> connected, IP: 192.168.50.95, RSSI: -22 dBm")])

        response = await _discover(mc)

        assert _sent(mc) == ["get wifi.status"]
        assert response.status == "ok"
        assert response.ip == "192.168.50.95"
        assert response.reply == "connected, IP: 192.168.50.95, RSSI: -22 dBm"
        # Nothing is saved by the lookup.
        assert await ContactSnmpRepository.get(KEY_A) is None

    @pytest.mark.asyncio
    async def test_wifi_down_has_no_address(self, test_db):
        await _insert_contact()
        response = await _discover(_mock_mc([_cli_reply("> disconnected")]))
        assert (response.status, response.ip, response.reply) == (
            "no_address",
            None,
            "disconnected",
        )

    @pytest.mark.asyncio
    async def test_stock_firmware_is_unsupported(self, test_db):
        await _insert_contact()
        response = await _discover(_mock_mc([_cli_reply("??: wifi.status")]))
        assert (response.status, response.ip) == ("unsupported", None)

    @pytest.mark.asyncio
    async def test_no_reply(self, test_db):
        await _insert_contact()
        mc = _mock_mc(None)
        mc.commands.get_msg = AsyncMock(return_value=_radio_result(EventType.NO_MORE_MSGS))
        clock = {"t": 0.0}

        def tick():
            clock["t"] += 6.0
            return clock["t"]

        response = await _discover(mc, monotonic=tick)
        assert _sent(mc) == ["get wifi.status"]
        assert (response.status, response.ip, response.reply) == ("no_reply", None, None)

    @pytest.mark.asyncio
    async def test_client_contact_is_refused_before_any_send(self, test_db):
        await _insert_contact(contact_type=1)
        mc = _mock_mc([])
        with pytest.raises(HTTPException) as exc:
            await _discover(mc)
        assert exc.value.status_code == 400
        mc.commands.send_cmd.assert_not_awaited()
