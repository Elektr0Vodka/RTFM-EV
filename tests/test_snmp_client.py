"""SNMP client and MeshCore OID table, against a scripted UDP agent on loopback."""

import asyncio

import pytest

from app.snmp import ber, mib
from app.snmp.ber import SnmpValue
from app.snmp.client import (
    SnmpError,
    SnmpResponseError,
    SnmpTimeoutError,
    poll_meshcore,
    snmp_get,
    snmp_get_all,
)
from app.snmp.message import (
    ERROR_TOO_BIG,
    PDU_GET,
    PDU_RESPONSE,
    SnmpMessage,
    decode_message,
    encode_message,
)

UPTIME = mib.BY_KEY["uptime_secs"].oid
NAME = mib.BY_KEY["node_name"].oid


class _ScriptedAgent(asyncio.DatagramProtocol):
    """Answers each request with whatever ``handler(request)`` returns.

    The handler returns a list of datagrams (possibly empty) to send back.
    """

    def __init__(self, handler):
        self.handler = handler
        self.requests: list[SnmpMessage] = []
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        request = decode_message(data)
        self.requests.append(request)
        for reply in self.handler(request):
            self.transport.sendto(reply, addr)


async def _start_agent(handler):
    loop = asyncio.get_running_loop()
    transport, agent = await loop.create_datagram_endpoint(
        lambda: _ScriptedAgent(handler), local_addr=("127.0.0.1", 0)
    )
    return transport, agent, transport.get_extra_info("sockname")[1]


def _response(request: SnmpMessage, values: dict, **overrides) -> bytes:
    varbinds = [
        (oid, values.get(oid, SnmpValue(ber.TAG_NO_SUCH_OBJECT))) for oid, _ in request.varbinds
    ]
    fields = {
        "community": request.community,
        "pdu_type": PDU_RESPONSE,
        "request_id": request.request_id,
        "varbinds": varbinds,
    }
    fields.update(overrides)
    return encode_message(SnmpMessage(**fields))


class TestSnmpGet:
    @pytest.mark.asyncio
    async def test_sends_one_get_and_returns_the_varbinds(self):
        values = {UPTIME: SnmpValue(ber.TAG_INTEGER, 18)}
        transport, agent, port = await _start_agent(lambda req: [_response(req, values)])
        try:
            result = await snmp_get("127.0.0.1", port, "public", [UPTIME, NAME], timeout=1)
        finally:
            transport.close()

        assert result == [
            (UPTIME, SnmpValue(ber.TAG_INTEGER, 18)),
            (NAME, SnmpValue(ber.TAG_NO_SUCH_OBJECT)),
        ]
        assert len(agent.requests) == 1
        request = agent.requests[0]
        assert request.pdu_type == PDU_GET
        assert request.community == b"public"
        assert request.varbinds == [
            (UPTIME, SnmpValue(ber.TAG_NULL)),
            (NAME, SnmpValue(ber.TAG_NULL)),
        ]

    @pytest.mark.asyncio
    async def test_retries_once_then_times_out(self):
        transport, agent, port = await _start_agent(lambda req: [])
        try:
            with pytest.raises(SnmpTimeoutError):
                await snmp_get("127.0.0.1", port, "public", [UPTIME], timeout=0.05, retries=1)
        finally:
            transport.close()
        assert len(agent.requests) == 2
        assert agent.requests[0].request_id == agent.requests[1].request_id

    @pytest.mark.asyncio
    async def test_answer_to_the_retry_is_accepted(self):
        values = {UPTIME: SnmpValue(ber.TAG_INTEGER, 5)}
        seen = []

        def handler(req):
            seen.append(req)
            return [] if len(seen) == 1 else [_response(req, values)]

        transport, _agent, port = await _start_agent(handler)
        try:
            result = await snmp_get("127.0.0.1", port, "public", [UPTIME], timeout=0.05, retries=1)
        finally:
            transport.close()
        assert result == [(UPTIME, SnmpValue(ber.TAG_INTEGER, 5))]

    @pytest.mark.asyncio
    async def test_ignores_garbage_wrong_request_id_and_non_response_pdus(self):
        values = {UPTIME: SnmpValue(ber.TAG_INTEGER, 7)}

        def handler(req):
            return [
                b"not snmp at all",
                _response(
                    req, {UPTIME: SnmpValue(ber.TAG_INTEGER, 999)}, request_id=req.request_id + 1
                ),
                _response(req, {UPTIME: SnmpValue(ber.TAG_INTEGER, 998)}, pdu_type=PDU_GET),
                _response(req, values),
            ]

        transport, _agent, port = await _start_agent(handler)
        try:
            result = await snmp_get("127.0.0.1", port, "public", [UPTIME], timeout=1)
        finally:
            transport.close()
        assert result == [(UPTIME, SnmpValue(ber.TAG_INTEGER, 7))]

    @pytest.mark.asyncio
    async def test_agent_error_status_is_raised(self):
        transport, _agent, port = await _start_agent(
            lambda req: [_response(req, {}, error_status=5, error_index=1)]
        )
        try:
            with pytest.raises(SnmpResponseError) as exc:
                await snmp_get("127.0.0.1", port, "public", [UPTIME], timeout=1)
        finally:
            transport.close()
        assert (exc.value.status, exc.value.index) == (5, 1)
        assert "genErr" in str(exc.value)

    @pytest.mark.asyncio
    async def test_unresolvable_host_is_an_snmp_error(self):
        with pytest.raises(SnmpError):
            await snmp_get("no-such-host.invalid", 161, "public", [UPTIME], timeout=0.05, retries=0)


class TestSnmpGetAll:
    @pytest.mark.asyncio
    async def test_halves_the_request_while_the_agent_says_too_big(self):
        oids = [entry.oid for entry in mib.ENTRIES[:4]]
        values = {oid: SnmpValue(ber.TAG_INTEGER, i) for i, oid in enumerate(oids)}

        def handler(req):
            if len(req.varbinds) > 2:
                return [_response(req, {}, error_status=ERROR_TOO_BIG)]
            return [_response(req, values)]

        transport, agent, port = await _start_agent(handler)
        try:
            result = await snmp_get_all("127.0.0.1", port, "public", oids, timeout=1)
        finally:
            transport.close()

        assert result == [(oid, values[oid]) for oid in oids]
        assert [len(req.varbinds) for req in agent.requests] == [4, 2, 2]

    @pytest.mark.asyncio
    async def test_too_big_for_a_single_oid_is_raised(self):
        transport, _agent, port = await _start_agent(
            lambda req: [_response(req, {}, error_status=ERROR_TOO_BIG)]
        )
        try:
            with pytest.raises(SnmpResponseError):
                await snmp_get_all("127.0.0.1", port, "public", [UPTIME], timeout=1)
        finally:
            transport.close()


class TestMeshcoreTable:
    def test_table_matches_the_firmware_layout(self):
        assert len(mib.FIRST_RELEASE_ENTRIES) == 22
        assert mib.ENTRIES[:22] == mib.FIRST_RELEASE_ENTRIES
        assert mib.BY_KEY["uptime_secs"].oid == (1, 3, 6, 1, 4, 1, 99999, 1, 1, 0)
        assert mib.BY_KEY["total_air_time_secs"].oid == (1, 3, 6, 1, 4, 1, 99999, 2, 11, 0)
        assert mib.BY_KEY["wifi_rssi"].oid == (1, 3, 6, 1, 4, 1, 99999, 5, 1, 0)
        groups = {}
        for entry in mib.FIRST_RELEASE_ENTRIES:
            groups[entry.group] = groups.get(entry.group, 0) + 1
        assert groups == {"system": 3, "radio": 11, "mqtt": 3, "memory": 4, "network": 1}
        # The first release is all INTEGER and two strings, no Counter32, no sentinels.
        assert {e.kind for e in mib.FIRST_RELEASE_ENTRIES} == {"int", "str"}
        assert all(e.sentinel is None for e in mib.FIRST_RELEASE_ENTRIES)

    def test_added_oids_match_the_firmware_pr(self):
        # Dutch-MeshCore/MeshCore PR #16, MQTT_SNMP.md.
        assert len(mib.ENTRIES) == 53
        assert len(mib.BY_OID) == 53
        sub_ids = {e.key: e.sub_id for e in mib.ADDED_ENTRIES}
        assert sub_ids["battery_mv"] == (1, 4)
        assert sub_ids["reset_reason"] == (1, 7)
        assert sub_ids["error_flags"] == (2, 17)
        assert sub_ids["ntp_synced"] == (3, 4)
        assert sub_ids["min_free_heap"] == (4, 5)
        assert sub_ids["dc_gate_hysteresis"] == (6, 5)
        assert sub_ids["filter_air_saved_ms"] == (7, 13)
        assert sub_ids["neighbour_count"] == (8, 1)
        groups = {}
        for entry in mib.ADDED_ENTRIES:
            groups[entry.group] = groups.get(entry.group, 0) + 1
        assert groups == {
            "system": 4,
            "radio": 6,
            "mqtt": 1,
            "memory": 1,
            "duty_gate": 5,
            "filter": 13,
            "neighbours": 1,
        }
        assert [e.key for e in mib.ADDED_ENTRIES if e.kind == "str"] == ["reset_reason"]
        counters = {e.sub_id for e in mib.ADDED_ENTRIES if e.kind == "counter"}
        assert counters == {(2, 13), (2, 14), (2, 15), *((7, n) for n in range(3, 14))}
        assert mib.BY_KEY["battery_mv"].sentinel == 0
        assert mib.BY_KEY["mcu_temp_c"].sentinel == -127

    def test_decode_added_values(self):
        result = mib.decode_varbinds(
            [
                (mib.BY_KEY["flood_dups"].oid, SnmpValue(ber.TAG_COUNTER32, 2**32 - 1)),
                (mib.BY_KEY["filter_rate_limit_drops"].oid, SnmpValue(ber.TAG_COUNTER32, 12)),
                (
                    mib.BY_KEY["reset_reason"].oid,
                    SnmpValue(ber.TAG_OCTET_STRING, b"Brownout (low voltage)"),
                ),
                (mib.BY_KEY["reset_reason_code"].oid, SnmpValue(ber.TAG_INTEGER, 9)),
                # Sentinels are stored as sent; the UI shows them as n/a.
                (mib.BY_KEY["battery_mv"].oid, SnmpValue(ber.TAG_INTEGER, 0)),
                (mib.BY_KEY["mcu_temp_c"].oid, SnmpValue(ber.TAG_INTEGER, -127)),
                # A room server has no duty gate or filter groups.
                (mib.BY_KEY["dc_gate_enabled"].oid, SnmpValue(ber.TAG_NO_SUCH_OBJECT)),
                (mib.BY_KEY["filter_enabled"].oid, SnmpValue(ber.TAG_NO_SUCH_OBJECT)),
            ]
        )
        # Counter32 is unsigned: the top of the range stays positive.
        assert result["flood_dups"] == 2**32 - 1
        assert result["filter_rate_limit_drops"] == 12
        assert result["reset_reason"] == "Brownout (low voltage)"
        assert result["reset_reason_code"] == 9
        assert result["battery_mv"] == 0
        assert result["mcu_temp_c"] == -127
        assert result["dc_gate_enabled"] is None
        assert result["filter_enabled"] is None
        assert result["neighbour_count"] is None  # not in the response

    def test_decode_varbinds(self):
        result = mib.decode_varbinds(
            [
                (mib.BY_KEY["uptime_secs"].oid, SnmpValue(ber.TAG_INTEGER, 18)),
                (
                    mib.BY_KEY["node_name"].oid,
                    SnmpValue(ber.TAG_OCTET_STRING, b"Heltec Repeater\x00junk"),
                ),
                (mib.BY_KEY["noise_floor"].oid, SnmpValue(ber.TAG_INTEGER, -96)),
                (mib.BY_KEY["last_snr"].oid, SnmpValue(ber.TAG_INTEGER, -30)),
                (mib.BY_KEY["free_heap"].oid, SnmpValue(ber.TAG_GAUGE32, 199612)),
                (mib.BY_KEY["psram_free"].oid, SnmpValue(ber.TAG_NO_SUCH_INSTANCE)),
                (mib.BY_KEY["wifi_rssi"].oid, SnmpValue(ber.TAG_OCTET_STRING, b"-22")),
                ((1, 3, 6, 1, 2, 1, 1, 1, 0), SnmpValue(ber.TAG_OCTET_STRING, b"other")),
            ]
        )
        assert set(result) == {entry.key for entry in mib.ENTRIES}
        assert result["uptime_secs"] == 18
        assert result["node_name"] == "Heltec Repeater"
        assert result["noise_floor"] == -96
        assert result["last_snr"] == -7.5
        assert result["free_heap"] == 199612
        assert result["psram_free"] is None
        assert result["wifi_rssi"] is None  # wrong type for a numeric entry
        assert result["packets_recv"] is None  # not in the response

    @pytest.mark.asyncio
    async def test_poll_meshcore_reads_the_table_in_batches_first_release_first(self):
        values = {
            entry.oid: SnmpValue(ber.TAG_INTEGER, 1) for entry in mib.ENTRIES if entry.kind == "int"
        }
        values.update(
            {
                entry.oid: SnmpValue(ber.TAG_COUNTER32, 7)
                for entry in mib.ENTRIES
                if entry.kind == "counter"
            }
        )
        values[mib.BY_KEY["firmware_version"].oid] = SnmpValue(ber.TAG_OCTET_STRING, b"v1.17.1")
        values[mib.BY_KEY["node_name"].oid] = SnmpValue(ber.TAG_OCTET_STRING, b"Obs")
        values[mib.BY_KEY["reset_reason"].oid] = SnmpValue(ber.TAG_OCTET_STRING, b"Power-on")
        transport, agent, port = await _start_agent(lambda req: [_response(req, values)])
        try:
            result = await poll_meshcore("127.0.0.1", port, "public", timeout=1)
        finally:
            transport.close()

        # The first GET is exactly the first-release table, as before.
        assert [len(req.varbinds) for req in agent.requests] == [22, 22, 9]
        assert [oid for oid, _ in agent.requests[0].varbinds] == [
            e.oid for e in mib.FIRST_RELEASE_ENTRIES
        ]
        sent = [oid for req in agent.requests for oid, _ in req.varbinds]
        assert sent == [e.oid for e in mib.ENTRIES]
        assert result["firmware_version"] == "v1.17.1"
        assert result["node_name"] == "Obs"
        assert result["last_snr"] == 0.25
        assert result["packets_recv"] == 1
        assert result["reset_reason"] == "Power-on"
        assert result["filter_air_saved_ms"] == 7
        assert all(value is not None for value in result.values())

    @pytest.mark.asyncio
    async def test_old_firmware_without_the_added_oids_still_polls(self):
        # Older firmware answers noSuchObject for every OID it does not have.
        values = {
            entry.oid: SnmpValue(ber.TAG_INTEGER, 5)
            for entry in mib.FIRST_RELEASE_ENTRIES
            if entry.kind == "int"
        }
        transport, agent, port = await _start_agent(lambda req: [_response(req, values)])
        try:
            result = await poll_meshcore("127.0.0.1", port, "public", timeout=1)
        finally:
            transport.close()

        assert len(agent.requests) == 3
        assert result["packets_recv"] == 5
        assert all(result[entry.key] is None for entry in mib.ADDED_ENTRIES)

    @pytest.mark.asyncio
    async def test_room_server_without_duty_gate_and_filter(self):
        values = {
            entry.oid: SnmpValue(
                ber.TAG_COUNTER32 if entry.kind == "counter" else ber.TAG_INTEGER, 3
            )
            for entry in mib.ENTRIES
            if entry.kind != "str" and entry.group not in ("duty_gate", "filter")
        }
        transport, _agent, port = await _start_agent(lambda req: [_response(req, values)])
        try:
            result = await poll_meshcore("127.0.0.1", port, "public", timeout=1)
        finally:
            transport.close()

        assert result["neighbour_count"] == 3
        assert result["battery_mv"] == 3
        assert all(result[e.key] is None for e in mib.ENTRIES if e.group in ("duty_gate", "filter"))
