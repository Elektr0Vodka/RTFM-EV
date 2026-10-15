"""Sensor telemetry push (MeshCore 1.18 SensorMesh REQ_TYPE_SUBSCRIBE / UNSUBSCRIBE)."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from meshcore import EventType

from app.models import CONTACT_TYPE_SENSOR, ContactUpsert
from app.repository import ContactRepository
from app.repository.sensor_push import SensorPushRepository
from app.services import sensor_push as sp

KEY = "a1" * 32
TEMP_THRESHOLD = [{"channel": 1, "type_name": "temperature", "min_delta": 0.5}]


def test_encode_thresholds_matches_firmware_layout():
    # Firmware LPPData::getDataSize/getMultiplier (not the LPP spec): temperature
    # 2 bytes x10, humidity 2 bytes x10, big endian. 0.5 -> 5, 2.0 -> 20.
    data = sp.encode_thresholds(
        [
            {"channel": 1, "type_name": "temperature", "min_delta": 0.5},
            {"channel": 2, "type_name": "humidity", "min_delta": 2.0},
        ]
    )
    assert data == bytes([1, 103, 0x00, 0x05, 2, 104, 0x00, 20])


def test_encode_rounds_instead_of_truncating():
    # 0.29 * 100 = 28.999... must encode as 29 (voltage, x100, 2 bytes)
    data = sp.encode_thresholds([{"channel": 1, "type_name": "voltage", "min_delta": 0.29}])
    assert data == bytes([1, 116, 0, 29])


def test_threshold_over_14_bytes_rejected():
    four = [{"channel": i, "type_name": "voltage", "min_delta": 0.1} for i in range(1, 5)]
    with pytest.raises(sp.ThresholdError):
        sp.encode_thresholds(four)  # 4 x 4 bytes = 16


def test_empty_thresholds_rejected():
    with pytest.raises(sp.ThresholdError):
        sp.encode_thresholds([])


def test_threshold_below_resolution_rejected():
    with pytest.raises(sp.ThresholdError):
        sp.encode_thresholds([{"channel": 1, "type_name": "temperature", "min_delta": 0.01}])


def test_unsupported_type_rejected():
    with pytest.raises(sp.ThresholdError):
        sp.encode_thresholds([{"channel": 1, "type_name": "gps", "min_delta": 1}])


def test_subscribe_body_and_frame():
    body = sp.build_subscribe_body(b"\x01\x02\x03\x04", 65535, bytes([1, 103, 0, 5]))
    assert body == b"\x01\x02\x03\x04" + b"\xff\xff" + b"\x00" + b"\x04" + bytes([1, 103, 0, 5])
    frame = sp.build_binary_request(KEY, sp.REQ_SUBSCRIBE, body)
    assert frame[0] == 0x32
    assert frame[1:33] == bytes.fromhex(KEY)
    assert frame[33] == 0x08
    assert frame[34:] == body


def test_parse_subscribe_reply():
    granted = (3600).to_bytes(2, "little").hex() + "0000" + b"nl\x00".hex()
    assert sp.parse_subscribe_reply(granted) == (3600, "nl")
    assert sp.parse_subscribe_reply("00000000") == (0, "")


def test_parse_push_skips_timestamp_and_reads_lpp():
    lpp = bytes([1, 103, 0x00, 0xD2])  # channel 1 temperature 21.0
    sensors = sp.parse_push((1_800_000_000).to_bytes(4, "little").hex() + lpp.hex())
    assert len(sensors) == 1
    assert sensors[0]["channel"] == 1
    assert sensors[0]["type"] == "temperature"
    assert sensors[0]["value"] == pytest.approx(21.0)


def _event(event_type, payload):
    ev = MagicMock()
    ev.type = event_type
    ev.payload = payload
    return ev


def _mc_for_subscribe(reply_data_hex: str | None):
    mc = MagicMock()
    mc.commands.send = AsyncMock(
        return_value=_event(
            EventType.MSG_SENT,
            {"expected_ack": b"\xaa\xbb\xcc\xdd", "suggested_timeout": 8000},
        )
    )
    mc.dispatcher.wait_for_event = AsyncMock(
        return_value=None
        if reply_data_hex is None
        else _event(EventType.BINARY_RESPONSE, {"tag": "aabbccdd", "data": reply_data_hex})
    )
    return mc


def _op(mc):
    @asynccontextmanager
    async def _ctx(*_a, **_k):
        yield mc

    return _ctx


async def _sensor_with_config():
    await ContactRepository.upsert(
        ContactUpsert(public_key=KEY, type=CONTACT_TYPE_SENSOR, name="S")
    )
    await SensorPushRepository.save_config(KEY, TEMP_THRESHOLD, now=1)
    await SensorPushRepository.set_enabled(KEY, True, now=1)


@pytest.mark.asyncio
async def test_subscribe_stores_granted_expiry(test_db):
    await _sensor_with_config()
    mc = _mc_for_subscribe((3600).to_bytes(2, "little").hex() + "0000" + b"nl\x00".hex())
    with (
        patch("app.services.sensor_push.radio_manager") as rm,
        patch("app.services.sensor_push._ensure_on_radio", AsyncMock()),
        patch("app.services.sensor_push._now", return_value=1000),
    ):
        rm.is_connected = True
        rm.radio_operation = _op(mc)
        row = await sp.subscribe(KEY)

    assert row["granted_until"] == 1000 + 3600
    assert row["scope_name"] == "nl"
    assert len(row["push_tag"]) == 8
    sent_frame = mc.commands.send.await_args.args[0]
    assert sent_frame[33] == sp.REQ_SUBSCRIBE
    assert sent_frame[34:38].hex() == row["push_tag"]


@pytest.mark.asyncio
async def test_subscribe_refused_disables(test_db):
    await _sensor_with_config()
    mc = _mc_for_subscribe("00000000")
    with (
        patch("app.services.sensor_push.radio_manager") as rm,
        patch("app.services.sensor_push._ensure_on_radio", AsyncMock()),
        patch("app.services.sensor_push._now", return_value=1000),
    ):
        rm.is_connected = True
        rm.radio_operation = _op(mc)
        row = await sp.subscribe(KEY)

    assert row["enabled"] is False
    assert row["last_error"] == "refused"


@pytest.mark.asyncio
async def test_subscribe_timeout_sets_error_keeps_enabled(test_db):
    await _sensor_with_config()
    mc = _mc_for_subscribe(None)
    with (
        patch("app.services.sensor_push.radio_manager") as rm,
        patch("app.services.sensor_push._ensure_on_radio", AsyncMock()),
        patch("app.services.sensor_push._now", return_value=1000),
    ):
        rm.is_connected = True
        rm.radio_operation = _op(mc)
        row = await sp.subscribe(KEY)

    assert row["enabled"] is True
    assert row["last_error"] == "no_reply"


@pytest.mark.asyncio
async def test_unsubscribe_sends_and_disables(test_db):
    await _sensor_with_config()
    mc = _mc_for_subscribe("0000000000000000")
    with (
        patch("app.services.sensor_push.radio_manager") as rm,
        patch("app.services.sensor_push._ensure_on_radio", AsyncMock()),
    ):
        rm.is_connected = True
        rm.radio_operation = _op(mc)
        row = await sp.unsubscribe(KEY)

    assert mc.commands.send.await_args.args[0][33] == sp.REQ_UNSUBSCRIBE
    assert row["enabled"] is False


@pytest.mark.asyncio
async def test_push_records_telemetry(test_db):
    await ContactRepository.upsert(
        ContactUpsert(public_key=KEY, type=CONTACT_TYPE_SENSOR, name="S")
    )
    await SensorPushRepository.set_enabled(KEY, True, now=1)
    await SensorPushRepository.mark_attempt(KEY, "01020304", now=1)
    recorder = AsyncMock()
    lpp = bytes([1, 103, 0x00, 0xD2])
    event = _event(
        EventType.BINARY_RESPONSE,
        {"tag": "01020304", "data": (5).to_bytes(4, "little").hex() + lpp.hex()},
    )
    with (
        patch("app.services.sensor_push._record_telemetry", recorder),
        patch("app.services.sensor_push._now", return_value=2000),
    ):
        await sp.handle_binary_response(event)

    recorder.assert_awaited_once()
    public_key, sensors = recorder.await_args.args
    assert public_key == KEY
    assert sensors[0]["type"] == "temperature"
    row = await SensorPushRepository.get(KEY)
    assert row is not None
    assert row["last_push_at"] == 2000


@pytest.mark.asyncio
async def test_unknown_or_disabled_tag_ignored(test_db):
    await SensorPushRepository.set_enabled(KEY, False, now=1)
    await SensorPushRepository.mark_attempt(KEY, "01020304", now=1)
    recorder = AsyncMock()
    # Real timestamp + LPP payload, so only the tag/enabled check can stop it.
    data = (5).to_bytes(4, "little").hex() + bytes([1, 103, 0x00, 0xD2]).hex()
    with patch("app.services.sensor_push._record_telemetry", recorder):
        await sp.handle_binary_response(
            _event(EventType.BINARY_RESPONSE, {"tag": "01020304", "data": data})
        )
        await sp.handle_binary_response(
            _event(EventType.BINARY_RESPONSE, {"tag": "ffffffff", "data": data})
        )

    recorder.assert_not_awaited()
    row = await SensorPushRepository.get(KEY)
    assert row is not None
    assert row["last_push_at"] is None


@pytest.mark.asyncio
async def test_renew_due_picks_expiring_and_respects_retry(test_db):
    await SensorPushRepository.set_enabled(KEY, True, now=1)
    await SensorPushRepository.set_granted(
        KEY, "01020304", granted_until=10_000, scope_name="nl", now=1
    )
    calls = AsyncMock(return_value={})
    with (
        patch("app.services.sensor_push.subscribe", calls),
        patch("app.services.sensor_push.radio_manager") as rm,
    ):
        rm.is_connected = True
        assert await sp.renew_due(now=9_000) == 0  # 1000 s left, more than RENEW_BEFORE_SECS
        assert await sp.renew_due(now=9_500) == 1  # 500 s left
        await SensorPushRepository.set_error(KEY, "no_reply", now=9_500)
        # Due again, but the failed attempt was only 100 s ago (< RETRY_AFTER_SECS).
        assert await sp.renew_due(now=9_600) == 0
    assert calls.await_count == 1


@pytest.mark.asyncio
async def test_renew_due_skips_when_radio_offline(test_db):
    await SensorPushRepository.set_enabled(KEY, True, now=1)
    calls = AsyncMock(return_value={})
    with (
        patch("app.services.sensor_push.subscribe", calls),
        patch("app.services.sensor_push.radio_manager") as rm,
    ):
        rm.is_connected = False
        assert await sp.renew_due(now=100) == 0
    calls.assert_not_awaited()


def test_event_handlers_subscribe_to_binary_responses():
    from app.event_handlers import register_event_handlers

    meshcore = MagicMock()
    register_event_handlers(meshcore)

    subscribed = [c.args[0] for c in meshcore.subscribe.call_args_list]
    assert EventType.BINARY_RESPONSE in subscribed


@pytest.mark.asyncio
async def test_on_binary_response_delegates_to_sensor_push():
    from app.event_handlers import on_binary_response

    handler = AsyncMock()
    event = _event(EventType.BINARY_RESPONSE, {"tag": "01020304", "data": ""})
    with patch("app.services.sensor_push.handle_binary_response", handler):
        await on_binary_response(event)
    handler.assert_awaited_once_with(event)


def test_signed_threshold_that_would_wrap_negative_is_rejected():
    # analog input is signed, 2 bytes x100: 400 -> 40000 >= 0x8000 decodes negative
    # in LPPData::getFloat, which would make the sensor push on every read.
    with pytest.raises(sp.ThresholdError):
        sp.encode_thresholds([{"channel": 1, "type_name": "analog input", "min_delta": 400}])


def test_unsigned_threshold_can_use_the_full_range():
    # voltage is unsigned, 2 bytes x100: 400 -> 40000 fits in 16 bits
    assert sp.encode_thresholds(
        [{"channel": 1, "type_name": "voltage", "min_delta": 400}]
    ) == bytes([1, 116, 0x9C, 0x40])


@pytest.mark.asyncio
async def test_unsubscribe_disables_even_when_the_radio_call_fails(test_db):
    from fastapi import HTTPException

    await _sensor_with_config()

    @asynccontextmanager
    async def _busy(*_a, **_k):
        raise HTTPException(status_code=423, detail="Radio busy")
        yield  # pragma: no cover

    with patch("app.services.sensor_push.radio_manager") as rm:
        rm.is_connected = True
        rm.radio_operation = _busy
        with pytest.raises(HTTPException):
            await sp.unsubscribe(KEY)

    row = await SensorPushRepository.get(KEY)
    assert row is not None
    assert row["enabled"] is False
