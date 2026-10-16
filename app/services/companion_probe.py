"""Ask a MeshCore device on the LAN what it is, over the companion protocol (TCP).

The companion protocol over TCP wraps every frame in a 3-byte header: ``<``
plus a little-endian uint16 length from app to radio, ``>`` plus the length
from radio to app (MeshCore ``src/helpers/wifi/SerialWifiInterface.cpp``).

A probe sends APP_START and reads SELF_INFO, which every MeshCore device sends
whatever firmware it runs: its advert type (companion, repeater, room server,
sensor), public key and name. Then DEVICE_QUERY for the model and firmware
version; a device that does not answer that still counts as found.

Nothing here transmits over RF: APP_START and DEVICE_QUERY are answered by the
device itself. But stock MeshCore WiFi companions serve one app at a time and
drop the connected app as soon as a new TCP connection arrives, so a probe can
disconnect someone's phone app. Callers must make that a deliberate choice.
"""

from __future__ import annotations

import asyncio
import contextlib
import struct
from dataclasses import dataclass

CMD_APP_START = 0x01
CMD_DEVICE_QUERY = 0x16
RESP_CODE_ERR = 0x01
RESP_CODE_SELF_INFO = 0x05
RESP_CODE_DEVICE_INFO = 0x0D

# APP_START: command, app protocol version, 6 reserved bytes, app name.
APP_START_FRAME = bytes([CMD_APP_START, 0x03]) + b" " * 6 + b"rtfm-ev-scan"
DEVICE_QUERY_FRAME = bytes([CMD_DEVICE_QUERY, 0x03])

FRAME_TO_RADIO = 0x3C  # '<'
FRAME_FROM_RADIO = 0x3E  # '>'
# Firmware frames are at most a few hundred bytes. Anything longer is not the
# companion protocol, so the probe gives up rather than reading it.
MAX_FRAME_BYTES = 1024
# Bytes to skip while looking for a '>' before giving up on the stream.
MAX_RESYNC_BYTES = 256

# SELF_INFO layout after the response code (MeshCore companion_radio MyMesh.cpp):
# adv_type, tx_power, max_tx_power, public key (32), lat (4), lon (4),
# multi_acks, adv_loc_policy, telemetry_mode, manual_add_contacts,
# freq (4), bw (4), sf, cr, then the name to the end of the frame.
_SELF_INFO_KEY_START = 4
_SELF_INFO_KEY_END = 36
_SELF_INFO_LAT = 36
_SELF_INFO_NAME_START = 58

# DEVICE_INFO layout after the response code, protocol version 3 and up:
# fw_ver, max_contacts / 2, max_channels, BLE PIN (4, never read here),
# build date (12), model (40), version (20).
_DEVICE_INFO_BUILD = slice(8, 20)
_DEVICE_INFO_MODEL = slice(20, 60)
_DEVICE_INFO_VERSION = slice(60, 80)

DEFAULT_CONNECT_TIMEOUT_SECONDS = 1.0
DEFAULT_REPLY_TIMEOUT_SECONDS = 2.5


class ProbeProtocolError(Exception):
    """The port answered, but not with the companion protocol."""


@dataclass(frozen=True)
class SelfInfo:
    adv_type: int
    public_key: str
    name: str
    lat: float | None
    lon: float | None


@dataclass(frozen=True)
class DeviceInfo:
    protocol_version: int
    build_date: str | None
    model: str | None
    firmware_version: str | None


@dataclass(frozen=True)
class CompanionProbeResult:
    """What one probe learned. ``self_info`` is None when the port was open
    but nothing that reads as the companion protocol came back."""

    self_info: SelfInfo | None
    device_info: DeviceInfo | None
    error: str | None = None


def encode_frame(payload: bytes) -> bytes:
    return bytes([FRAME_TO_RADIO]) + struct.pack("<H", len(payload)) + payload


def _text(raw: bytes) -> str:
    return raw.split(b"\x00", 1)[0].decode("utf-8", errors="replace").strip()


def parse_self_info(frame: bytes) -> SelfInfo:
    """Parse a SELF_INFO frame (response code included)."""
    if len(frame) < _SELF_INFO_KEY_END or frame[0] != RESP_CODE_SELF_INFO:
        raise ProbeProtocolError("SELF_INFO frame too short")
    lat = lon = None
    if len(frame) >= _SELF_INFO_LAT + 8:
        lat_raw, lon_raw = struct.unpack_from("<ii", frame, _SELF_INFO_LAT)
        if lat_raw or lon_raw:
            lat, lon = lat_raw / 1e6, lon_raw / 1e6
    name = _text(frame[_SELF_INFO_NAME_START:]) if len(frame) > _SELF_INFO_NAME_START else ""
    return SelfInfo(
        adv_type=frame[1],
        public_key=frame[_SELF_INFO_KEY_START:_SELF_INFO_KEY_END].hex(),
        name=name,
        lat=lat,
        lon=lon,
    )


def parse_device_info(frame: bytes) -> DeviceInfo:
    """Parse a DEVICE_INFO frame (response code included). The BLE PIN in it
    is skipped on purpose."""
    if len(frame) < 2 or frame[0] != RESP_CODE_DEVICE_INFO:
        raise ProbeProtocolError("DEVICE_INFO frame too short")
    protocol_version = frame[1]
    if protocol_version < 3 or len(frame) < _DEVICE_INFO_VERSION.stop:
        return DeviceInfo(protocol_version, None, None, None)
    return DeviceInfo(
        protocol_version=protocol_version,
        build_date=_text(frame[_DEVICE_INFO_BUILD]) or None,
        model=_text(frame[_DEVICE_INFO_MODEL]) or None,
        firmware_version=_text(frame[_DEVICE_INFO_VERSION]) or None,
    )


async def _read_frame(reader: asyncio.StreamReader) -> bytes:
    """Read the next radio-to-app frame, skipping stray bytes before it."""
    skipped = 0
    while True:
        marker = await reader.readexactly(1)
        if marker[0] == FRAME_FROM_RADIO:
            break
        skipped += 1
        if skipped > MAX_RESYNC_BYTES:
            raise ProbeProtocolError("no companion frame header")
    (length,) = struct.unpack("<H", await reader.readexactly(2))
    if length == 0 or length > MAX_FRAME_BYTES:
        raise ProbeProtocolError(f"frame length {length} out of range")
    return await reader.readexactly(length)


async def _await_reply(reader: asyncio.StreamReader, wanted: int) -> bytes:
    """Read frames until one with response code ``wanted`` (or ERR) arrives.
    Push frames the device sends on its own (adverts, log data) are skipped."""
    while True:
        frame = await _read_frame(reader)
        if frame[0] in (wanted, RESP_CODE_ERR):
            return frame


async def probe_companion(
    host: str,
    port: int,
    *,
    connect_timeout: float = DEFAULT_CONNECT_TIMEOUT_SECONDS,
    reply_timeout: float = DEFAULT_REPLY_TIMEOUT_SECONDS,
) -> CompanionProbeResult | None:
    """Probe one address. None when nothing accepts a TCP connection there."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), connect_timeout
        )
    except (TimeoutError, OSError):
        return None

    try:
        writer.write(encode_frame(APP_START_FRAME))
        await writer.drain()
        try:
            frame = await asyncio.wait_for(_await_reply(reader, RESP_CODE_SELF_INFO), reply_timeout)
            if frame[0] == RESP_CODE_ERR:
                return CompanionProbeResult(None, None, "the device refused APP_START")
            self_info = parse_self_info(frame)
        except TimeoutError:
            return CompanionProbeResult(None, None, "port open, no companion protocol reply")
        except (ProbeProtocolError, asyncio.IncompleteReadError):
            return CompanionProbeResult(None, None, "port open, not the companion protocol")

        device_info: DeviceInfo | None = None
        try:
            writer.write(encode_frame(DEVICE_QUERY_FRAME))
            await writer.drain()
            frame = await asyncio.wait_for(
                _await_reply(reader, RESP_CODE_DEVICE_INFO), reply_timeout
            )
            if frame[0] == RESP_CODE_DEVICE_INFO:
                device_info = parse_device_info(frame)
        except (TimeoutError, ProbeProtocolError, asyncio.IncompleteReadError, OSError):
            device_info = None
        return CompanionProbeResult(self_info, device_info)
    except OSError as exc:
        return CompanionProbeResult(None, None, f"connection error: {exc}")
    finally:
        writer.close()
        with contextlib.suppress(OSError, TimeoutError):
            await asyncio.wait_for(writer.wait_closed(), 1.0)
