"""Sensor telemetry push (MeshCore 1.18, ``examples/simple_sensor/SensorMesh.cpp``).

Subscribe (REQ_TYPE_SUBSCRIBE 0x08): ``push_tag(4) timeout_secs u16 reserved u8
min_deltas_len u8 min_deltas[]``. ``min_deltas`` is LPP: ``channel, type,
value`` sized and scaled with the firmware's ``LPPData::getDataSize`` and
``getMultiplier`` (``src/helpers/sensors/LPPDataHelpers.h``), big endian, which
is what ``SensorMesh::telemHasChanged`` reads them back with. Those differ
from the LPP spec for humidity: the firmware uses 2 bytes x10, not 1 byte x2.
The sensor keeps at most 14 bytes and pushes when a watched value moves more
than its minimum, but only when it has a scope region with transport keys.
Reply: ``expiry_secs u16, reserved u16, scope_name``; expiry 0 means refused.
Unsubscribe is REQ_TYPE_UNSUBSCRIBE 0x09 with no body.

A push reaches us as PUSH_CODE_BINARY_RESPONSE (0x8C): ``push_tag(4)
timestamp(4) LPP``. meshcore reports the first 4 bytes as ``tag``, so the
tag we stored is the only link back to the sensor.

meshcore's ``BinaryReqType`` stops at 0x06, so the 0x32 request frame is built
here with the same layout as ``CommandHandlerBase.send_binary_req``.
"""

import asyncio
import logging
import os
import time

from meshcore import EventType
from meshcore.lpp_json_encoder import my_lpp_types
from meshcore.parsing import lpp_parse

from app.models import LppSensor
from app.perf.recorders import loops as perf_loops
from app.repository import ContactRepository
from app.repository.sensor_push import SensorPushRepository
from app.routers.contacts import _ensure_on_radio, _record_and_forward_lpp_telemetry
from app.services.radio_runtime import radio_runtime as radio_manager

logger = logging.getLogger(__name__)

CMD_SEND_BINARY_REQ = 0x32
REQ_SUBSCRIBE = 0x08
REQ_UNSUBSCRIBE = 0x09
MAX_THRESHOLD_BYTES = 14
SUBSCRIBE_TIMEOUT_SECS = 65535
RENEW_BEFORE_SECS = 600
RETRY_AFTER_SECS = 900
LOOP_INTERVAL_SECS = 60
REPLY_TIMEOUT_SECS = 20.0

# LPPData::getDataSize / getMultiplier / isSigned (companion-v1.18.0) for the
# scalar types a threshold makes sense for. Multi-axis (accelerometer,
# gyrometer), GPS, colour, polyline and unix time are left out.
_LPP_SCALAR: dict[int, tuple[int, int, bool]] = {
    0: (1, 1, False),  # digital input
    1: (1, 1, False),  # digital output
    2: (2, 100, True),  # analog input
    3: (2, 100, True),  # analog output
    100: (4, 1, False),  # generic sensor
    101: (2, 1, False),  # luminosity
    102: (1, 1, False),  # presence
    103: (2, 10, True),  # temperature
    104: (2, 10, False),  # relative humidity (firmware: 2 bytes x10)
    115: (2, 10, False),  # barometric pressure
    116: (2, 100, False),  # voltage
    117: (2, 1000, False),  # current
    118: (4, 1, False),  # frequency
    120: (1, 1, False),  # percentage
    121: (2, 1, True),  # altitude
    125: (2, 1, False),  # concentration
    128: (2, 1, False),  # power
    130: (4, 1000, False),  # distance
    131: (4, 1000, False),  # energy
    132: (2, 1, False),  # direction
    142: (1, 1, False),  # switch
}


def _now() -> int:
    return int(time.time())


class ThresholdError(ValueError):
    """A threshold list the sensor cannot take."""


def threshold_type_codes() -> dict[str, int]:
    """Supported threshold types, meshcore type name to LPP code."""
    return {my_lpp_types[code][0]: code for code in _LPP_SCALAR if code in my_lpp_types}


def threshold_size(type_name: str) -> int:
    """Bytes one threshold of this type takes on the sensor (channel + type + value)."""
    code = threshold_type_codes().get(type_name)
    if code is None:
        raise ThresholdError(f"Unsupported sensor type for push: {type_name}")
    return 2 + _LPP_SCALAR[code][0]


def encode_thresholds(thresholds: list[dict]) -> bytes:
    """Encode {channel, type_name, min_delta} entries as the sensor's min_deltas."""
    if not thresholds:
        raise ThresholdError("Pick at least one channel")
    codes = threshold_type_codes()
    out = bytearray()
    for entry in thresholds:
        code = codes.get(str(entry.get("type_name")))
        if code is None:
            raise ThresholdError(f"Unsupported sensor type for push: {entry.get('type_name')}")
        channel = int(entry.get("channel", -1))
        if not 0 <= channel <= 255:
            raise ThresholdError(f"Bad channel: {channel}")
        size, mult, signed = _LPP_SCALAR[code]
        raw = round(abs(float(entry.get("min_delta", 0))) * mult)
        if raw < 1:
            raise ThresholdError(
                f"Minimum change for channel {channel} is below the sensor's resolution (1/{mult})"
            )
        # A signed type reads the top bit as the sign (LPPData::getFloat): a
        # value past it turns negative and the sensor would push on every read.
        if raw >= 1 << (size * 8 - (1 if signed else 0)):
            raise ThresholdError(f"Minimum change for channel {channel} is too large")
        out += bytes([channel, code]) + raw.to_bytes(size, "big")
    if len(out) > MAX_THRESHOLD_BYTES:
        raise ThresholdError(
            f"Thresholds take {len(out)} bytes; the sensor keeps {MAX_THRESHOLD_BYTES}"
        )
    return bytes(out)


def build_binary_request(public_key: str, req_type: int, body: bytes) -> bytes:
    return bytes([CMD_SEND_BINARY_REQ]) + bytes.fromhex(public_key) + bytes([req_type]) + body


def build_subscribe_body(push_tag: bytes, timeout_secs: int, thresholds: bytes) -> bytes:
    return (
        push_tag
        + timeout_secs.to_bytes(2, "little")
        + b"\x00"
        + bytes([len(thresholds)])
        + thresholds
    )


def parse_subscribe_reply(data_hex: str) -> tuple[int, str]:
    """(granted expiry seconds, scope name); expiry 0 means refused."""
    data = bytes.fromhex(data_hex or "")
    if len(data) < 2:
        return 0, ""
    expiry = int.from_bytes(data[0:2], "little")
    scope = data[4:].split(b"\x00", 1)[0].decode("utf-8", "replace") if len(data) > 4 else ""
    return expiry, scope


def parse_push(data_hex: str) -> list[dict]:
    """LPP readings of a push (the first 4 bytes are the sensor's timestamp)."""
    data = bytes.fromhex(data_hex or "")
    return lpp_parse(data[4:]) if len(data) > 4 else []


async def _send_and_wait(mc, frame: bytes) -> dict | None:
    sent = await mc.commands.send(frame, [EventType.MSG_SENT, EventType.ERROR])
    if sent.type == EventType.ERROR:
        return None
    tag = sent.payload["expected_ack"].hex()
    reply = await mc.dispatcher.wait_for_event(
        EventType.BINARY_RESPONSE, attribute_filters={"tag": tag}, timeout=REPLY_TIMEOUT_SECS
    )
    return reply.payload if reply is not None else None


async def subscribe(public_key: str) -> dict:
    """(Re)subscribe to a sensor's pushes with the stored thresholds. Transmits."""
    row = await SensorPushRepository.get(public_key)
    contact = await ContactRepository.get_by_key(public_key)
    if row is None or contact is None:
        raise ThresholdError("Sensor push is not configured")
    thresholds = encode_thresholds(row["thresholds"])
    push_tag = os.urandom(4)
    while push_tag == b"\x00\x00\x00\x00":
        push_tag = os.urandom(4)
    now = _now()
    await SensorPushRepository.mark_attempt(public_key, push_tag.hex(), now)
    frame = build_binary_request(
        contact.public_key,
        REQ_SUBSCRIBE,
        build_subscribe_body(push_tag, SUBSCRIBE_TIMEOUT_SECS, thresholds),
    )
    async with radio_manager.radio_operation(
        "sensor_push_subscribe", pause_polling=True, suspend_auto_fetch=True
    ) as mc:
        await _ensure_on_radio(mc, contact)
        reply = await _send_and_wait(mc, frame)
    if reply is None:
        await SensorPushRepository.set_error(public_key, "no_reply", now)
    else:
        expiry, scope = parse_subscribe_reply(reply.get("data", ""))
        if expiry == 0:
            await SensorPushRepository.set_error(public_key, "refused", now)
            await SensorPushRepository.set_enabled(public_key, False, now)
        else:
            await SensorPushRepository.set_granted(
                public_key, push_tag.hex(), now + expiry, scope, now
            )
    return await SensorPushRepository.get(public_key) or {}


async def unsubscribe(public_key: str) -> dict:
    """Tell the sensor to stop pushing, then disable locally (even without a reply)."""
    now = _now()
    contact = await ContactRepository.get_by_key(public_key)
    try:
        if contact is not None and radio_manager.is_connected:
            async with radio_manager.radio_operation(
                "sensor_push_unsubscribe", pause_polling=True, suspend_auto_fetch=True
            ) as mc:
                await _ensure_on_radio(mc, contact)
                await _send_and_wait(
                    mc, build_binary_request(contact.public_key, REQ_UNSUBSCRIBE, b"")
                )
    finally:
        # Off locally even when the radio call fails, so renewals stop transmitting;
        # the sensor's own grant then simply runs out.
        await SensorPushRepository.set_enabled(public_key, False, now)
    return await SensorPushRepository.get(public_key) or {}


async def _record_telemetry(public_key: str, sensors: list[dict]) -> None:
    contact = await ContactRepository.get_by_key(public_key)
    if contact is None:
        return
    await _record_and_forward_lpp_telemetry(
        contact,
        [
            LppSensor(
                channel=s.get("channel", 0),
                type_name=str(s.get("type", "unknown")),
                value=s.get("value", 0),
            )
            for s in sensors
        ],
    )


async def handle_binary_response(event) -> None:
    """Record a telemetry push whose tag matches an enabled subscription."""
    payload = event.payload or {}
    tag = str(payload.get("tag", "")).lower()
    if not tag:
        return
    row = await SensorPushRepository.find_enabled_by_tag(tag)
    if row is None:
        return
    try:
        sensors = parse_push(payload.get("data", ""))
    except Exception:
        logger.debug("Unparseable sensor push for %s", row["public_key"][:12], exc_info=True)
        return
    if not sensors:
        return
    await _record_telemetry(row["public_key"], sensors)
    await SensorPushRepository.record_push(row["public_key"], _now())


async def renew_due(now: int) -> int:
    """Re-subscribe enabled subscriptions that expire soon; returns how many were tried."""
    if not radio_manager.is_connected:
        return 0
    tried = 0
    for row in await SensorPushRepository.list_enabled():
        granted = row.get("granted_until")
        if granted is not None and granted - now > RENEW_BEFORE_SECS:
            continue
        last_attempt = row.get("last_attempt_at")
        if (
            row.get("last_error")
            and last_attempt is not None
            and now - last_attempt < RETRY_AFTER_SECS
        ):
            continue
        tried += 1
        try:
            await subscribe(row["public_key"])
        except Exception:
            logger.warning(
                "Sensor push renewal failed for %s", row["public_key"][:12], exc_info=True
            )
    return tried


_loop_task: asyncio.Task | None = None


async def _loop() -> None:
    while True:
        try:
            with perf_loops.tick("sensor_push", LOOP_INTERVAL_SECS):
                await renew_due(_now())
        except Exception:
            logger.warning("Sensor push loop error", exc_info=True)
        await asyncio.sleep(LOOP_INTERVAL_SECS)


def start_sensor_push_loop() -> None:
    global _loop_task
    if _loop_task is None or _loop_task.done():
        _loop_task = asyncio.create_task(_loop())
        logger.info("Started sensor push renewal loop")


async def stop_sensor_push_loop() -> None:
    global _loop_task
    if _loop_task and not _loop_task.done():
        _loop_task.cancel()
        try:
            await _loop_task
        except asyncio.CancelledError:
            pass
    _loop_task = None
