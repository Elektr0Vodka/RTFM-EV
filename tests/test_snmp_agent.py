"""RTFM-EV's own SNMP agent: request handling, the host value table, lifecycle, API.

Lifecycle tests bind a real UDP socket on loopback and query it with the SNMP
client from the same package. Nothing here touches the radio.
"""

import socket
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from app.models import SnmpAgentSettings
from app.repository.snmp_agent import SnmpAgentRepository
from app.routers.snmp_agent import get_snmp_agent, put_snmp_agent
from app.services import snmp_agent as agent_service
from app.snmp import ber, mib
from app.snmp.agent import (
    ERROR_NOT_WRITABLE,
    MAX_BULK_VARBINDS,
    MAX_RESPONSE_BYTES,
    AgentCounters,
    handle_request,
)
from app.snmp.ber import SnmpValue
from app.snmp.client import SnmpError, SnmpTimeoutError, poll_meshcore
from app.snmp.message import (
    ERROR_TOO_BIG,
    PDU_GET,
    PDU_GETBULK,
    PDU_GETNEXT,
    PDU_RESPONSE,
    PDU_SET,
    SnmpMessage,
    decode_message,
    encode_message,
)

BASE = mib.ENTERPRISE_BASE
NULL = SnmpValue(ber.TAG_NULL)
END = SnmpValue(ber.TAG_END_OF_MIB_VIEW)
NO_OBJECT = SnmpValue(ber.TAG_NO_SUCH_OBJECT)

SAMPLE = {
    "uptime_secs": 3725,
    "firmware_version": "v1.17.1",
    "node_name": "Host Node",
    "packets_recv": 1204,
    "packets_sent": 311,
    "recv_errors": 7,
    "noise_floor": -96,
    "last_rssi": -25,
    "last_snr": -7.5,
    "sent_flood": 200,
    "sent_direct": 111,
    "recv_flood": 900,
    "recv_direct": 304,
    "total_air_time_secs": 412,
    "mqtt_connected_slots": 2,
    "mqtt_queue_depth": 0,
    "mqtt_skipped_publishes": 0,
    "free_heap": 199612,
    "max_alloc": 188404,
    "internal_free": 120000,
    "psram_free": 0,
    "wifi_rssi": -127,
}
TABLE = agent_service.build_table(SAMPLE)


def _request(pdu_type, oids, *, community=b"public", request_id=42, status=0, index=0):
    return encode_message(
        SnmpMessage(
            community=community,
            pdu_type=pdu_type,
            request_id=request_id,
            error_status=status,
            error_index=index,
            varbinds=[(oid, NULL) for oid in oids],
        )
    )


def _ask(pdu_type, oids, **kwargs):
    reply = handle_request(_request(pdu_type, oids, **kwargs), b"public", lambda: TABLE)
    assert reply is not None
    return decode_message(reply)


def _oid(key):
    return mib.BY_KEY[key].oid


# --- the served table -------------------------------------------------------


class TestBuildTable:
    def test_one_row_per_entry_sorted_by_oid(self):
        assert len(TABLE) == 22
        oids = [oid for oid, _ in TABLE]
        assert oids == sorted(oids)
        # .2.9 sorts before .2.10 and .2.11 (numeric, not text, order).
        radio = [oid[-2] for oid in oids if oid[-3] == 2]
        assert radio == list(range(1, 12))

    def test_types_and_values_match_the_firmware(self):
        by = dict(TABLE)
        assert by[_oid("uptime_secs")] == SnmpValue(ber.TAG_INTEGER, 3725)
        assert by[_oid("node_name")] == SnmpValue(ber.TAG_OCTET_STRING, b"Host Node")
        assert by[_oid("noise_floor")] == SnmpValue(ber.TAG_INTEGER, -96)
        # The firmware serves SNR as dB x 4.
        assert by[_oid("last_snr")] == SnmpValue(ber.TAG_INTEGER, -30)
        assert by[_oid("wifi_rssi")] == SnmpValue(ber.TAG_INTEGER, -127)

    def test_unknown_values_are_zero_or_empty_and_big_values_are_capped(self):
        by = dict(agent_service.build_table({"free_heap": 8 * 1024**3, "last_snr": None}))
        assert by[_oid("free_heap")] == SnmpValue(ber.TAG_INTEGER, 2**31 - 1)
        assert by[_oid("last_snr")] == SnmpValue(ber.TAG_INTEGER, 0)
        assert by[_oid("packets_recv")] == SnmpValue(ber.TAG_INTEGER, 0)
        assert by[_oid("node_name")] == SnmpValue(ber.TAG_OCTET_STRING, b"")

    def test_host_values_come_from_the_radio_stats_sample(self):
        stats = {
            "uptime_secs": 100,
            "noise_floor": -110,
            "last_rssi": -80,
            "last_snr": 6.25,
            "tx_air_secs": 55,
            "packets": {
                "recv": 10,
                "sent": 4,
                "flood_tx": 3,
                "direct_tx": 1,
                "flood_rx": 8,
                "direct_rx": 2,
                "recv_errors": 5,
            },
        }
        radio = MagicMock()
        radio.meshcore.self_info = {"name": "My Radio"}
        radio.firmware_version = "v1.15.0"
        with (
            patch("app.services.radio_stats.get_latest_radio_stats", return_value=stats),
            patch("app.services.radio_runtime.radio_runtime", radio),
            patch.object(agent_service, "_connected_mqtt_integrations", return_value=2),
            patch.object(
                agent_service, "_read_meminfo", return_value={"MemAvailable": 5000, "MemFree": 3000}
            ),
        ):
            values = agent_service.host_values()

        assert values["uptime_secs"] == 100
        assert values["node_name"] == "My Radio"
        assert values["firmware_version"] == "v1.15.0"
        assert (values["packets_recv"], values["packets_sent"], values["recv_errors"]) == (10, 4, 5)
        assert (values["sent_flood"], values["sent_direct"]) == (3, 1)
        assert (values["recv_flood"], values["recv_direct"]) == (8, 2)
        assert values["total_air_time_secs"] == 55
        assert values["last_snr"] == 6.25
        assert values["mqtt_connected_slots"] == 2
        assert (values["free_heap"], values["internal_free"], values["psram_free"]) == (
            5000,
            3000,
            0,
        )
        assert values["wifi_rssi"] == -127
        assert set(values) == {entry.key for entry in mib.ENTRIES}


# --- request handling (pure) ------------------------------------------------


class TestGet:
    def test_known_and_unknown_oids(self):
        unknown = (*BASE, 9, 9, 0)
        reply = _ask(PDU_GET, [_oid("noise_floor"), unknown])
        assert reply.pdu_type == PDU_RESPONSE
        assert reply.request_id == 42
        assert reply.community == b"public"
        assert (reply.error_status, reply.error_index) == (0, 0)
        assert reply.varbinds == [
            (_oid("noise_floor"), SnmpValue(ber.TAG_INTEGER, -96)),
            (unknown, NO_OBJECT),
        ]

    def test_scalar_without_instance_suffix_is_not_served(self):
        # .2.4 names the object; only .2.4.0 is an instance.
        reply = _ask(PDU_GET, [(*BASE, 2, 4)])
        assert reply.varbinds == [((*BASE, 2, 4), NO_OBJECT)]


class TestGetNext:
    def test_walk_from_the_base_visits_every_oid_in_order_then_ends(self):
        seen = []
        current = BASE
        for _ in range(40):
            reply = _ask(PDU_GETNEXT, [current])
            oid, value = reply.varbinds[0]
            if value == END:
                break
            seen.append(oid)
            current = oid
        assert seen == [oid for oid, _ in TABLE]

    def test_past_the_last_oid_is_end_of_mib_view(self):
        last = TABLE[-1][0]
        assert _ask(PDU_GETNEXT, [last]).varbinds == [(last, END)]
        beyond = (1, 3, 6, 1, 4, 1, 99999, 99)
        assert _ask(PDU_GETNEXT, [beyond]).varbinds == [(beyond, END)]

    def test_oid_before_the_tree_returns_the_first_entry(self):
        assert _ask(PDU_GETNEXT, [(1, 3)]).varbinds == [TABLE[0]]


class TestGetBulk:
    def test_repeats_up_to_max_repetitions(self):
        reply = _ask(PDU_GETBULK, [BASE], status=0, index=5)
        assert reply.varbinds == TABLE[:5]
        assert (reply.error_status, reply.error_index) == (0, 0)

    def test_stops_at_the_end_of_the_tree(self):
        reply = _ask(PDU_GETBULK, [BASE], status=0, index=50)
        assert reply.varbinds[:22] == TABLE
        assert reply.varbinds[22] == (TABLE[-1][0], END)
        assert len(reply.varbinds) == 23

    def test_non_repeaters_are_answered_once(self):
        reply = _ask(PDU_GETBULK, [BASE, _oid("free_heap")], status=1, index=2)
        assert reply.varbinds[0] == TABLE[0]
        assert [oid for oid, _ in reply.varbinds[1:]] == [_oid("max_alloc"), _oid("internal_free")]

    def test_zero_repetitions_and_huge_requests_are_bounded(self):
        assert _ask(PDU_GETBULK, [BASE], status=0, index=0).varbinds == []
        many = [(*BASE, 1, 1, 0)] * 60
        data = handle_request(_request(PDU_GETBULK, many, index=50), b"public", lambda: TABLE)
        assert len(data) <= MAX_RESPONSE_BYTES
        assert len(decode_message(data).varbinds) <= MAX_BULK_VARBINDS


class TestRefusals:
    def test_wrong_community_gets_no_reply(self):
        counters = AgentCounters()
        reply = handle_request(
            _request(PDU_GET, [_oid("uptime_secs")], community=b"private"),
            b"public",
            lambda: TABLE,
            counters,
        )
        assert reply is None
        assert (counters.bad_community, counters.requests) == (1, 0)

    @pytest.mark.parametrize("data", [b"", b"garbage", b"\x30\x03\x02\x01\x00"])
    def test_malformed_or_non_v2c_gets_no_reply(self, data):
        counters = AgentCounters()
        assert handle_request(data, b"public", lambda: TABLE, counters) is None
        assert counters.malformed == 1

    def test_set_is_refused_and_nothing_is_read(self):
        provider = MagicMock(return_value=TABLE)
        reply = decode_message(
            handle_request(_request(PDU_SET, [_oid("node_name")]), b"public", provider)
        )
        assert (reply.error_status, reply.error_index) == (ERROR_NOT_WRITABLE, 1)
        assert reply.varbinds == [(_oid("node_name"), NULL)]
        provider.assert_not_called()

    def test_a_response_pdu_is_ignored(self):
        assert (
            handle_request(_request(PDU_RESPONSE, [_oid("uptime_secs")]), b"public", lambda: TABLE)
            is None
        )

    def test_get_that_cannot_fit_is_too_big(self):
        big = [
            ((*BASE, 7, i, 0), SnmpValue(ber.TAG_OCTET_STRING, b"x" * 200)) for i in range(1, 20)
        ]
        data = handle_request(_request(PDU_GET, [oid for oid, _ in big]), b"public", lambda: big)
        reply = decode_message(data)
        assert reply.error_status == ERROR_TOO_BIG
        assert reply.varbinds == []

    def test_requests_are_counted(self):
        counters = AgentCounters()
        for _ in range(3):
            handle_request(
                _request(PDU_GET, [_oid("uptime_secs")]), b"public", lambda: TABLE, counters
            )
        assert counters.requests == 3


# --- settings model ---------------------------------------------------------


class TestSettingsModel:
    def test_defaults_are_off_public_161(self):
        settings = SnmpAgentSettings()
        assert (settings.enabled, settings.port, settings.community) == (False, 161, "public")

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"port": 0},
            {"port": 65536},
            {"community": ""},
            {"community": "a\nb"},
            {"community": "x" * 65},
        ],
    )
    def test_rejects_invalid(self, kwargs):
        with pytest.raises(ValidationError):
            SnmpAgentSettings(**kwargs)


# --- lifecycle over real UDP on loopback ------------------------------------


def _free_udp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
async def _agent_cleanup():
    yield
    await agent_service.stop_snmp_agent()


@pytest.mark.usefixtures("_agent_cleanup")
class TestLifecycle:
    @pytest.mark.asyncio
    async def test_enabled_agent_answers_the_snmp_client(self):
        port = _free_udp_port()
        settings = SnmpAgentSettings(enabled=True, port=port, community="s3cret")
        with patch.object(agent_service, "host_values", return_value=SAMPLE):
            await agent_service.apply_snmp_agent_settings(settings)
            state = agent_service.get_snmp_agent_state(settings)
            assert (state.running, state.error) == (True, None)

            values = await poll_meshcore("127.0.0.1", port, "s3cret", timeout=2)

        assert values == SAMPLE
        assert agent_service.get_snmp_agent_state(settings).requests == 1

    @pytest.mark.asyncio
    async def test_wrong_community_times_out_and_is_counted(self):
        port = _free_udp_port()
        settings = SnmpAgentSettings(enabled=True, port=port, community="s3cret")
        await agent_service.apply_snmp_agent_settings(settings)
        with pytest.raises(SnmpTimeoutError):
            await poll_meshcore("127.0.0.1", port, "public", timeout=0.2, retries=0)
        state = agent_service.get_snmp_agent_state(settings)
        assert (state.requests, state.bad_community) == (0, 1)

    @pytest.mark.asyncio
    async def test_disabling_stops_the_listener(self):
        port = _free_udp_port()
        on = SnmpAgentSettings(enabled=True, port=port)
        await agent_service.apply_snmp_agent_settings(on)
        off = SnmpAgentSettings(enabled=False, port=port)
        await agent_service.apply_snmp_agent_settings(off)

        assert agent_service.get_snmp_agent_state(off).running is False
        # Nothing listens any more: a timeout, or "connection refused" where
        # the OS reports the closed port.
        with pytest.raises(SnmpError):
            await poll_meshcore("127.0.0.1", port, "public", timeout=0.2, retries=0)

    @pytest.mark.asyncio
    async def test_changing_the_community_takes_effect(self):
        port = _free_udp_port()
        await agent_service.apply_snmp_agent_settings(
            SnmpAgentSettings(enabled=True, port=port, community="one")
        )
        await agent_service.apply_snmp_agent_settings(
            SnmpAgentSettings(enabled=True, port=port, community="two")
        )
        with patch.object(agent_service, "host_values", return_value=SAMPLE):
            assert (await poll_meshcore("127.0.0.1", port, "two", timeout=2))["uptime_secs"] == 3725
        with pytest.raises(SnmpTimeoutError):
            await poll_meshcore("127.0.0.1", port, "one", timeout=0.2, retries=0)

    @pytest.mark.asyncio
    async def test_port_in_use_is_reported_not_raised(self):
        # Loopback is enough to occupy the port: the agent's own wildcard bind
        # on the same port then fails.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as busy:
            busy.bind(("127.0.0.1", 0))
            port = busy.getsockname()[1]
            settings = SnmpAgentSettings(enabled=True, port=port)
            await agent_service.apply_snmp_agent_settings(settings)
            state = agent_service.get_snmp_agent_state(settings)
        assert state.running is False
        assert f"cannot listen on UDP port {port}" in state.error

    @pytest.mark.asyncio
    async def test_a_failing_value_source_still_gets_an_answer(self):
        port = _free_udp_port()
        await agent_service.apply_snmp_agent_settings(SnmpAgentSettings(enabled=True, port=port))
        with patch.object(agent_service, "host_values", side_effect=RuntimeError("boom")):
            values = await poll_meshcore("127.0.0.1", port, "public", timeout=2)
        assert values["uptime_secs"] == 0
        assert values["node_name"] == ""


# --- API --------------------------------------------------------------------


@pytest.mark.usefixtures("_agent_cleanup")
class TestApi:
    @pytest.mark.asyncio
    async def test_default_state_is_off(self, test_db):
        state = await get_snmp_agent()
        assert state.settings == SnmpAgentSettings()
        assert (state.running, state.error, state.requests) == (False, None, 0)

    @pytest.mark.asyncio
    async def test_put_saves_and_starts_then_stops(self, test_db):
        port = _free_udp_port()
        state = await put_snmp_agent(SnmpAgentSettings(enabled=True, port=port, community="mon"))
        assert state.running is True
        assert await SnmpAgentRepository.get() == SnmpAgentSettings(
            enabled=True, port=port, community="mon"
        )
        assert (await get_snmp_agent()).running is True

        state = await put_snmp_agent(SnmpAgentSettings(enabled=False, port=port, community="mon"))
        assert state.running is False
        assert (await SnmpAgentRepository.get()).enabled is False

    @pytest.mark.asyncio
    async def test_start_hook_follows_the_stored_settings(self, test_db):
        await agent_service.start_snmp_agent()
        assert agent_service.get_snmp_agent_state(SnmpAgentSettings()).running is False

        port = _free_udp_port()
        await SnmpAgentRepository.save(SnmpAgentSettings(enabled=True, port=port))
        await agent_service.start_snmp_agent()
        assert agent_service.get_snmp_agent_state(await SnmpAgentRepository.get()).running is True
