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
        assert len(mib.ENTRIES) == 22
        assert len(mib.BY_OID) == 22
        assert mib.BY_KEY["uptime_secs"].oid == (1, 3, 6, 1, 4, 1, 99999, 1, 1, 0)
        assert mib.BY_KEY["total_air_time_secs"].oid == (1, 3, 6, 1, 4, 1, 99999, 2, 11, 0)
        assert mib.BY_KEY["wifi_rssi"].oid == (1, 3, 6, 1, 4, 1, 99999, 5, 1, 0)
        groups = {}
        for entry in mib.ENTRIES:
            groups[entry.group] = groups.get(entry.group, 0) + 1
        assert groups == {"system": 3, "radio": 11, "mqtt": 3, "memory": 4, "network": 1}
        assert [e.key for e in mib.ENTRIES if e.kind == "str"] == ["firmware_version", "node_name"]

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
    async def test_poll_meshcore_reads_the_whole_table_in_one_get(self):
        values = {
            entry.oid: SnmpValue(ber.TAG_INTEGER, 1) for entry in mib.ENTRIES if entry.kind == "int"
        }
        values[mib.BY_KEY["firmware_version"].oid] = SnmpValue(ber.TAG_OCTET_STRING, b"v1.17.1")
        values[mib.BY_KEY["node_name"].oid] = SnmpValue(ber.TAG_OCTET_STRING, b"Obs")
        transport, agent, port = await _start_agent(lambda req: [_response(req, values)])
        try:
            result = await poll_meshcore("127.0.0.1", port, "public", timeout=1)
        finally:
            transport.close()

        assert len(agent.requests) == 1
        assert [oid for oid, _ in agent.requests[0].varbinds] == [e.oid for e in mib.ENTRIES]
        assert result["firmware_version"] == "v1.17.1"
        assert result["node_name"] == "Obs"
        assert result["last_snr"] == 0.25
        assert result["packets_recv"] == 1
