"""LAN discovery: target parsing, the companion, SNMP and web config probes, and
the scan API.

The probes run against scripted servers on loopback (a TCP companion, a UDP
SNMP agent and an HTTP server). Nothing here reaches the radio, RF or any other host.
"""

import asyncio
import json
import struct

import pytest
from fastapi import HTTPException

from app.config import settings
from app.models import LanScanRequest
from app.repository import ContactRepository
from app.repository.contact_snmp import ContactSnmpRepository
from app.routers.lan_discovery import cancel_scan, get_scan, get_suggestions, start_scan
from app.services import lan_discovery
from app.services.companion_probe import (
    CMD_APP_START,
    CMD_DEVICE_QUERY,
    RESP_CODE_DEVICE_INFO,
    RESP_CODE_SELF_INFO,
    parse_device_info,
    parse_self_info,
    probe_companion,
)
from app.services.lan_discovery import (
    SYS_DESCR,
    SYS_NAME,
    ScanTargetError,
    parse_targets,
    probe_snmp,
)
from app.services.webconfig_probe import parse_status, probe_webconfig
from app.snmp import ber, mib
from app.snmp.ber import SnmpValue
from app.snmp.message import PDU_RESPONSE, SnmpMessage, decode_message, encode_message

KEY = "ab" * 32


# --- frames -----------------------------------------------------------------


def _self_info(adv_type: int = 2, name: str = "Repeater 1", key: str = KEY) -> bytes:
    return (
        bytes([RESP_CODE_SELF_INFO, adv_type, 22, 22])
        + bytes.fromhex(key)
        + struct.pack("<ii", 52_100_000, 4_300_000)
        + bytes([0, 0, 0, 0])
        + struct.pack("<II", 869_618, 62_500)
        + bytes([8, 8])
        + name.encode()
    )


def _device_info(model: str = "Heltec V3", version: str = "v1.17.1") -> bytes:
    return (
        bytes([RESP_CODE_DEVICE_INFO, 10, 50, 8])
        + struct.pack("<I", 123456)  # BLE PIN: must never come out of the probe
        + b"16 Oct 2026".ljust(12, b"\0")
        + model.encode().ljust(40, b"\0")
        + version.encode().ljust(20, b"\0")
        + bytes([1, 0])
    )


def _out(payload: bytes) -> bytes:
    return b">" + struct.pack("<H", len(payload)) + payload


class TestFrames:
    def test_self_info(self):
        info = parse_self_info(_self_info())
        assert info.adv_type == 2
        assert info.public_key == KEY
        assert info.name == "Repeater 1"
        assert info.lat == pytest.approx(52.1)
        assert info.lon == pytest.approx(4.3)

    def test_self_info_without_position(self):
        frame = bytearray(_self_info())
        frame[36:44] = bytes(8)
        info = parse_self_info(bytes(frame))
        assert info.lat is None and info.lon is None

    def test_device_info_skips_the_pin(self):
        info = parse_device_info(_device_info())
        assert info.model == "Heltec V3"
        assert info.firmware_version == "v1.17.1"
        assert info.build_date == "16 Oct 2026"
        assert "123456" not in repr(info)

    def test_old_device_info(self):
        info = parse_device_info(bytes([RESP_CODE_DEVICE_INFO, 2]))
        assert info.protocol_version == 2
        assert info.model is None


# --- fake companion ---------------------------------------------------------


async def _start_companion(answer):
    """TCP server; ``answer(command_payload)`` returns bytes to send back."""
    received: list[bytes] = []

    async def handle(reader, writer):
        try:
            while True:
                header = await reader.readexactly(3)
                assert header[0] == ord("<")
                (length,) = struct.unpack("<H", header[1:])
                payload = await reader.readexactly(length)
                received.append(payload)
                reply = answer(payload)
                if reply:
                    writer.write(reply)
                    await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1], received


def _good_companion(payload: bytes) -> bytes:
    if payload[0] == CMD_APP_START:
        # A push frame first, as a busy device sends: the probe must skip it.
        return _out(bytes([0x88, 1, 2, 3])) + _out(_self_info())
    if payload[0] == CMD_DEVICE_QUERY:
        return _out(_device_info())
    return b""


class TestCompanionProbe:
    @pytest.mark.asyncio
    async def test_reads_role_name_and_model(self):
        server, port, received = await _start_companion(_good_companion)
        try:
            result = await probe_companion("127.0.0.1", port, reply_timeout=1)
        finally:
            server.close()
        assert result is not None
        assert result.self_info is not None
        assert result.self_info.adv_type == 2
        assert result.self_info.name == "Repeater 1"
        assert result.device_info is not None
        assert result.device_info.model == "Heltec V3"
        assert [p[0] for p in received] == [CMD_APP_START, CMD_DEVICE_QUERY]
        # APP_START: command, protocol version, 6 reserved bytes, app name.
        assert received[0][:8] == bytes([CMD_APP_START, 3]) + b" " * 6

    @pytest.mark.asyncio
    async def test_found_without_device_query_answer(self):
        def answer(payload):
            return _out(_self_info(adv_type=1)) if payload[0] == CMD_APP_START else b""

        server, port, _ = await _start_companion(answer)
        try:
            result = await probe_companion("127.0.0.1", port, reply_timeout=0.2)
        finally:
            server.close()
        assert result is not None and result.self_info is not None
        assert result.self_info.adv_type == 1
        assert result.device_info is None

    @pytest.mark.asyncio
    async def test_open_port_that_is_not_meshcore(self):
        server, port, _ = await _start_companion(lambda payload: b"HTTP/1.1 400 Bad\r\n" * 30)
        try:
            result = await probe_companion("127.0.0.1", port, reply_timeout=0.5)
        finally:
            server.close()
        assert result is not None
        assert result.self_info is None
        assert result.error

    @pytest.mark.asyncio
    async def test_silent_port_times_out(self):
        server, port, _ = await _start_companion(lambda payload: b"")
        try:
            result = await probe_companion("127.0.0.1", port, reply_timeout=0.1)
        finally:
            server.close()
        assert result is not None
        assert result.self_info is None

    @pytest.mark.asyncio
    async def test_closed_port_is_nothing(self):
        server, port, _ = await _start_companion(lambda payload: b"")
        server.close()
        await server.wait_closed()
        assert await probe_companion("127.0.0.1", port, connect_timeout=0.5) is None


# --- fake SNMP agent --------------------------------------------------------


class _Agent(asyncio.DatagramProtocol):
    def __init__(self, values, community=b"public"):
        self.values = values
        self.community = community
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        request = decode_message(data)
        if request.community != self.community:
            return  # agents stay silent on a wrong community
        varbinds = [
            (oid, self.values.get(oid, SnmpValue(ber.TAG_NO_SUCH_OBJECT)))
            for oid, _ in request.varbinds
        ]
        reply = SnmpMessage(
            community=request.community,
            pdu_type=PDU_RESPONSE,
            request_id=request.request_id,
            varbinds=varbinds,
        )
        self.transport.sendto(encode_message(reply), addr)


async def _start_agent(values, community=b"public"):
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(
        lambda: _Agent(values, community), local_addr=("127.0.0.1", 0)
    )
    return transport, transport.get_extra_info("sockname")[1]


MESHCORE_VALUES = {
    mib.BY_KEY["node_name"].oid: SnmpValue(ber.TAG_OCTET_STRING, b"Observer"),
    mib.BY_KEY["firmware_version"].oid: SnmpValue(ber.TAG_OCTET_STRING, b"v1.18.0-ob"),
    mib.BY_KEY["uptime_secs"].oid: SnmpValue(ber.TAG_INTEGER, 3600),
}


class TestSnmpProbe:
    @pytest.mark.asyncio
    async def test_meshcore_agent(self):
        transport, port = await _start_agent(MESHCORE_VALUES)
        try:
            result = await probe_snmp("127.0.0.1", port, "public")
        finally:
            transport.close()
        assert result is not None
        assert result["kind"] == "meshcore"
        assert result["node_name"] == "Observer"
        assert result["firmware_version"] == "v1.18.0-ob"
        assert result["uptime_secs"] == 3600

    @pytest.mark.asyncio
    async def test_other_agent(self):
        values = {
            SYS_NAME: SnmpValue(ber.TAG_OCTET_STRING, b"printer"),
            SYS_DESCR: SnmpValue(ber.TAG_OCTET_STRING, b"Laser printer"),
        }
        transport, port = await _start_agent(values)
        try:
            result = await probe_snmp("127.0.0.1", port, "public")
        finally:
            transport.close()
        assert result is not None
        assert result["kind"] == "other"
        assert result["sys_name"] == "printer"
        assert result["sys_descr"] == "Laser printer"

    @pytest.mark.asyncio
    async def test_wrong_community_is_nothing(self, monkeypatch):
        monkeypatch.setattr(lan_discovery, "SNMP_TIMEOUT_SECONDS", 0.05)
        transport, port = await _start_agent(MESHCORE_VALUES, community=b"secret")
        try:
            assert await probe_snmp("127.0.0.1", port, "public") is None
        finally:
            transport.close()


# --- fake web config ----------------------------------------------------------


OBSERVER_STATUS = {
    "mode": "lan",
    "auth": False,
    "needs_setup": False,
    "name": "Observer",
    "node_id": KEY[:16],
    "fw": "v1.18.0-dev-dutchmeshcore.nl-ob",
    "build_date": "16-Oct-2026",
    "role": "repeater",
    "board": "Heltec V4",
    "uptime_s": 7200,
    "runtime_slots": 3,
}


async def _start_http(status: int, body: bytes, content_type: str = "application/json"):
    """One-shot HTTP/1.1 responder: every request gets the same answer."""
    paths: list[str] = []

    async def handle(reader, writer):
        try:
            request_line = (await reader.readline()).decode()
            paths.append(request_line.split(" ")[1])
            while (await reader.readline()) not in (b"\r\n", b""):
                pass
            writer.write(
                f"HTTP/1.1 {status} X\r\nContent-Type: {content_type}\r\n"
                f"Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode()
                + body
            )
            await writer.drain()
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    return server, server.sockets[0].getsockname()[1], paths


class TestWebconfigStatus:
    def test_observer_status(self):
        result = parse_status(OBSERVER_STATUS)
        assert result is not None
        assert result["node_id"] == KEY[:16]
        assert result["adv_type"] == 2
        assert result["firmware_version"] == "v1.18.0-dev-dutchmeshcore.nl-ob"
        assert result["board"] == "Heltec V4"
        assert result["uptime_secs"] == 7200

    def test_room_server(self):
        result = parse_status({**OBSERVER_STATUS, "role": "room_server", "mode": "setup"})
        assert result is not None
        assert result["adv_type"] == 3
        assert result["mode"] == "setup"

    @pytest.mark.parametrize(
        "doc",
        [
            [],
            {"status": "ok"},
            {**OBSERVER_STATUS, "role": "sensor"},
            {**OBSERVER_STATUS, "mode": "off"},
            {**OBSERVER_STATUS, "node_id": "xyz"},
            {**OBSERVER_STATUS, "node_id": KEY},
            {k: v for k, v in OBSERVER_STATUS.items() if k != "fw"},
        ],
    )
    def test_not_an_observer(self, doc):
        assert parse_status(doc) is None


class TestWebconfigProbe:
    @pytest.mark.asyncio
    async def test_reads_the_status(self):
        server, port, paths = await _start_http(200, json.dumps(OBSERVER_STATUS).encode())
        try:
            result = await probe_webconfig("127.0.0.1", port)
        finally:
            server.close()
        assert paths == ["/api/status"]
        assert result is not None
        assert result["name"] == "Observer"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("status", "body", "content_type"),
        [
            (503, b"", "text/plain"),  # config page stopped
            (200, b"<html>router login</html>", "text/html"),
            (200, json.dumps({"status": "ok"}).encode(), "application/json"),
            (200, b'{"pad": "' + b"x" * 9000 + b'"}', "application/json"),
            (302, b"", "text/html"),
        ],
    )
    async def test_other_answers_are_nothing(self, status, body, content_type):
        server, port, _ = await _start_http(status, body, content_type)
        try:
            assert await probe_webconfig("127.0.0.1", port) is None
        finally:
            server.close()

    @pytest.mark.asyncio
    async def test_closed_port_is_nothing(self):
        server, port, _ = await _start_http(200, b"")
        server.close()
        await server.wait_closed()
        assert await probe_webconfig("127.0.0.1", port) is None


# --- targets ----------------------------------------------------------------


class TestParseTargets:
    def test_network_and_single_address(self):
        assert parse_targets("192.168.1.0/30, 10.0.0.5") == [
            "10.0.0.5",
            "192.168.1.1",
            "192.168.1.2",
        ]

    def test_duplicates_once(self):
        assert parse_targets("192.168.1.1 192.168.1.1;192.168.1.0/31") == [
            "192.168.1.0",
            "192.168.1.1",
        ]

    def test_full_24(self):
        assert len(parse_targets("192.168.50.0/24")) == 254

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "8.8.8.8",
            "1.1.1.0/24",
            "fe80::1",
            "node.lan",
            "192.168.1.0/16",
            "10.0.0.0/21",
            "224.0.0.1",
            "192.168.1.300",
        ],
    )
    def test_rejects(self, text):
        with pytest.raises(ScanTargetError):
            parse_targets(text)


# --- API --------------------------------------------------------------------


async def _wait_done():
    for _ in range(200):
        status = await get_scan()
        if status is not None and not status.running:
            return status
        await asyncio.sleep(0.02)
    raise AssertionError("scan did not finish")


@pytest.fixture(autouse=True)
def _reset_scan(monkeypatch):
    lan_discovery.reset_for_tests()
    monkeypatch.setattr(settings, "tcp_host", "")
    yield
    lan_discovery.reset_for_tests()


@pytest.mark.usefixtures("test_db")
class TestScanApi:
    @pytest.mark.asyncio
    async def test_idle_before_the_first_scan(self):
        assert await get_scan() is None

    @pytest.mark.asyncio
    async def test_finds_a_companion_and_matches_its_contact(self):
        await ContactRepository.upsert(
            {"public_key": KEY, "name": "Repeater 1", "type": 2, "flags": 0}
        )
        server, port, _ = await _start_companion(_good_companion)
        try:
            await start_scan(
                LanScanRequest(targets="127.0.0.1", snmp=False, companion=True, companion_port=port)
            )
            status = await _wait_done()
        finally:
            server.close()
        assert status.done == status.total == 1
        assert [h.ip for h in status.hosts] == ["127.0.0.1"]
        host = status.hosts[0]
        assert host.companion is not None and host.companion.found
        assert host.companion.model == "Heltec V3"
        assert host.contact is not None
        assert host.contact.public_key == KEY
        assert host.contact.matched_by == "public_key"
        assert "123456" not in status.model_dump_json()

    @pytest.mark.asyncio
    async def test_snmp_match_by_unique_name_with_existing_setup(self):
        await ContactRepository.upsert(
            {"public_key": KEY, "name": "Observer", "type": 2, "flags": 0}
        )
        await ContactSnmpRepository.upsert(
            KEY,
            host="127.0.0.1",
            port=161,
            community="public",
            poll_enabled=False,
            poll_interval_minutes=5,
            now=1,
        )
        transport, port = await _start_agent(MESHCORE_VALUES, community=b"mesh")
        try:
            await start_scan(LanScanRequest(targets="127.0.0.1", snmp_port=port, community="mesh"))
            status = await _wait_done()
        finally:
            transport.close()
        host = status.hosts[0]
        assert host.snmp is not None and host.snmp.kind == "meshcore"
        assert host.contact is not None
        assert host.contact.matched_by == "name"
        assert host.contact.snmp_host == "127.0.0.1"
        assert "mesh" not in status.model_dump_json().replace("meshcore", "")

    @pytest.mark.asyncio
    async def test_web_config_matched_by_node_id(self):
        await ContactRepository.upsert(
            {"public_key": KEY, "name": "Renamed since", "type": 2, "flags": 0}
        )
        server, port, _ = await _start_http(200, json.dumps(OBSERVER_STATUS).encode())
        try:
            await start_scan(
                LanScanRequest(targets="127.0.0.1", snmp=False, webconfig=True, webconfig_port=port)
            )
            status = await _wait_done()
        finally:
            server.close()
        assert status.webconfig is True
        host = status.hosts[0]
        assert host.webconfig is not None
        assert host.webconfig.board == "Heltec V4"
        assert host.contact is not None
        assert host.contact.public_key == KEY
        assert host.contact.matched_by == "node_id"

    @pytest.mark.asyncio
    async def test_web_config_alone_is_a_check(self):
        status = await start_scan(
            LanScanRequest(targets="10.0.0.1", snmp=False, companion=False, webconfig=True)
        )
        assert status.webconfig is True
        await cancel_scan()

    @pytest.mark.asyncio
    async def test_own_radio_skipped_by_the_companion_check(self, monkeypatch):
        monkeypatch.setattr(settings, "tcp_host", "127.0.0.1")
        server, port, received = await _start_companion(_good_companion)
        try:
            await start_scan(
                LanScanRequest(targets="127.0.0.1", snmp=False, companion=True, companion_port=port)
            )
            status = await _wait_done()
        finally:
            server.close()
        assert status.skipped == ["127.0.0.1"]
        assert status.hosts == []
        assert received == []

    @pytest.mark.asyncio
    async def test_bad_targets_and_no_checks(self):
        with pytest.raises(HTTPException) as exc:
            await start_scan(LanScanRequest(targets="8.8.8.8"))
        assert exc.value.status_code == 400
        with pytest.raises(HTTPException) as exc:
            await start_scan(LanScanRequest(targets="10.0.0.1", snmp=False, companion=False))
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_second_scan_while_running_and_cancel(self, monkeypatch):
        async def slow_snmp(*args, **kwargs):
            await asyncio.sleep(10)

        monkeypatch.setattr(lan_discovery, "probe_snmp", slow_snmp)
        await start_scan(LanScanRequest(targets="10.0.0.0/30"))
        with pytest.raises(HTTPException) as exc:
            await start_scan(LanScanRequest(targets="10.0.0.1"))
        assert exc.value.status_code == 409
        status = await cancel_scan()
        assert status is not None
        assert status.cancelled and not status.running

    @pytest.mark.asyncio
    async def test_suggestions(self, monkeypatch):
        monkeypatch.setattr(settings, "tcp_host", "192.168.1.60")
        await ContactRepository.upsert(
            {"public_key": KEY, "name": "Observer", "type": 2, "flags": 0}
        )
        await ContactSnmpRepository.upsert(
            KEY,
            host="10.1.2.3",
            port=161,
            community="public",
            poll_enabled=False,
            poll_interval_minutes=5,
            now=1,
        )
        result = await get_suggestions()
        assert result.networks == ["192.168.1.0/24", "10.1.2.0/24"]
        assert result.own_radio == ["192.168.1.60"]
