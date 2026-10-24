"""Companion bridge: frames, and a real session driven by the meshcore library.

The end-to-end tests connect with ``MeshCore.create_tcp`` (the same library
RTFM-EV uses to talk to a radio) to a bridge on a free local port, so the
frames are checked by an independent parser of the companion protocol.
"""

import asyncio
import struct
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from meshcore import EventType, MeshCore

from app.companion_bridge import frames
from app.companion_bridge.server import PUBLIC_CHANNEL_KEY, CompanionBridge
from app.repository import ChannelRepository, ContactRepository

RADIO_KEY = "11" * 32
ALICE_KEY = "a1" * 32
OPS_KEY = "0F" * 16

SELF_INFO = {
    "adv_type": 1,
    "tx_power": 20,
    "max_tx_power": 22,
    "public_key": RADIO_KEY,
    "adv_lat": 52.1,
    "adv_lon": 5.2,
    "multi_acks": 0,
    "adv_loc_policy": 0,
    "telemetry_mode_env": 0,
    "telemetry_mode_loc": 0,
    "telemetry_mode_base": 0,
    "manual_add_contacts": False,
    "radio_freq": 869.618,
    "radio_bw": 62.5,
    "radio_sf": 8,
    "radio_cr": 8,
    "name": "Base Node",
}


# ── frames ──────────────────────────────────────────────────────────────────


def test_wrap_uses_the_radio_to_app_header():
    assert frames.wrap(b"\x00") == b">\x01\x00\x00"


def test_frame_reader_handles_split_and_joined_frames():
    reader = frames.FrameReader()
    data = b"<\x02\x00\x16\x03" + b"<\x01\x00\x0a"
    assert reader.feed(data[:3]) == []
    assert reader.feed(data[3:]) == [b"\x16\x03", b"\x0a"]


def test_frame_reader_skips_noise_and_empty_frames():
    reader = frames.FrameReader()
    assert reader.feed(b"xx<\x00\x00<\x01\x00\x05") == [b"\x05"]


def test_path_len_byte():
    assert frames.encode_path_len(None, None) == 0xFF
    assert frames.encode_path_len(-1, 0) == 0xFF
    assert frames.encode_path_len(3, 1) == (1 << 6) | 3


def test_text_is_cut_on_a_character_edge():
    payload = frames.channel_message(
        v3=True, snr=None, channel_index=0, path_len=0, sender_timestamp=1, text="é" * 200
    )
    assert len(payload) <= frames.MAX_FRAME_SIZE
    payload[11:].decode("utf-8")  # no broken character at the end


# ── end to end ──────────────────────────────────────────────────────────────


@pytest.fixture
async def bridge(test_db):
    await ContactRepository.upsert(
        {
            "public_key": ALICE_KEY,
            "name": "Alice",
            "type": 1,
            "flags": 0,
            "direct_path": "aabb",
            "direct_path_len": 2,
            "direct_path_hash_mode": 0,
            "last_advert": 1_700_000_000,
            "last_seen": 1_700_000_100,
            "lat": 52.0,
            "lon": 5.0,
        }
    )
    await ChannelRepository.upsert(key=PUBLIC_CHANNEL_KEY, name="Public")
    await ChannelRepository.upsert(key=OPS_KEY, name="#ops")

    radio = MagicMock()
    radio.meshcore = MagicMock()
    radio.meshcore.self_info = SELF_INFO
    radio.is_connected = True
    radio.firmware_build = "20 Oct 2026"
    radio.device_model = "Heltec V3"
    radio.firmware_version = "v1.18.0"
    radio.path_hash_mode = 0

    server = CompanionBridge()
    with patch("app.services.radio_runtime.radio_runtime", radio):
        await server.start("127.0.0.1", 0)
        try:
            yield server
        finally:
            await server.stop()


async def _client(server: CompanionBridge) -> MeshCore:
    mc = await MeshCore.create_tcp("127.0.0.1", server.port, default_timeout=5)
    assert mc is not None
    return mc


@pytest.mark.asyncio
async def test_app_start_reports_the_radio_identity(bridge):
    mc = await _client(bridge)
    try:
        assert mc.self_info["name"] == "Base Node"
        assert mc.self_info["public_key"] == RADIO_KEY
        assert mc.self_info["radio_sf"] == 8
        info = await mc.commands.send_device_query()
        assert info.type == EventType.DEVICE_INFO
        # One slot per stored channel (the test database may hold seeded ones).
        assert info.payload["max_channels"] == len(await ChannelRepository.get_all())
        assert "RTFM-EV bridge" in info.payload["model"]
        assert bridge.status()["clients"][0]["app_name"] != ""
    finally:
        await mc.disconnect()


@pytest.mark.asyncio
async def test_contacts_and_channels_come_from_the_database(bridge):
    mc = await _client(bridge)
    try:
        result = await mc.commands.get_contacts()
        assert result.type == EventType.CONTACTS
        alice = result.payload[ALICE_KEY]
        assert alice["adv_name"] == "Alice"
        assert alice["out_path"] == "aabb"
        assert alice["out_path_len"] == 2

        public = await mc.commands.get_channel(0)
        assert public.type == EventType.CHANNEL_INFO
        assert public.payload["channel_name"] == "Public"
        ops = await mc.commands.get_channel(1)
        assert ops.payload["channel_secret"].hex().upper() == OPS_KEY
        missing = await mc.commands.get_channel(5)
        assert missing.type == EventType.ERROR
    finally:
        await mc.disconnect()


@pytest.mark.asyncio
async def test_received_messages_are_queued_for_the_app(bridge):
    mc = await _client(bridge)
    try:
        await mc.commands.send_device_query()
        empty = await mc.commands.get_msg()
        assert empty.type == EventType.NO_MORE_MSGS

        bridge.on_event(
            "message",
            {
                "type": "CHAN",
                "conversation_key": OPS_KEY,
                "text": "Bob: hello ops",
                "sender_timestamp": 1_700_000_500,
                "outgoing": False,
                "paths": [{"path": "aabb", "path_len": 2, "snr": 6.5}],
            },
        )
        bridge.on_event(
            "message",
            {
                "type": "PRIV",
                "conversation_key": ALICE_KEY,
                "text": "hi there",
                "sender_timestamp": 1_700_000_600,
                "outgoing": False,
                "txt_type": 0,
                "paths": [],
            },
        )
        # Our own messages are not echoed back to the app.
        bridge.on_event("message", {"type": "CHAN", "conversation_key": OPS_KEY, "outgoing": True})

        chan = await mc.commands.get_msg()
        assert chan.type == EventType.CHANNEL_MSG_RECV
        assert chan.payload["channel_idx"] == 1
        assert chan.payload["text"] == "Bob: hello ops"
        assert chan.payload["SNR"] == 6.5
        dm = await mc.commands.get_msg()
        assert dm.type == EventType.CONTACT_MSG_RECV
        assert dm.payload["pubkey_prefix"] == ALICE_KEY[:12]
        assert dm.payload["text"] == "hi there"
        assert (await mc.commands.get_msg()).type == EventType.NO_MORE_MSGS
    finally:
        await mc.disconnect()


@pytest.mark.asyncio
async def test_sending_goes_through_rtfm_ev_and_the_ack_is_passed_on(bridge):
    mc = await _client(bridge)
    sent_message = MagicMock(id=42, acked=0)
    send_dm = AsyncMock(return_value=sent_message)
    send_chan = AsyncMock()
    try:
        await mc.commands.send_device_query()
        with (
            patch("app.services.message_send.send_direct_message_to_contact", send_dm),
            patch("app.services.message_send.send_channel_message_to_channel", send_chan),
        ):
            confirmed = asyncio.get_running_loop().create_future()
            mc.subscribe(EventType.ACK, lambda e: confirmed.set_result(e))

            result = await mc.commands.send_msg(ALICE_KEY, "from the app")
            assert result.type == EventType.MSG_SENT
            assert send_dm.await_args.kwargs["text"] == "from the app"
            assert send_dm.await_args.kwargs["contact"].public_key == ALICE_KEY

            bridge.on_event("message_acked", {"message_id": 42, "ack_count": 1})
            ack = await asyncio.wait_for(confirmed, 5)
            assert ack.payload["code"] == result.payload["expected_ack"].hex()

            chan = await mc.commands.send_chan_msg(1, "to ops")
            assert chan.type == EventType.OK
            assert send_chan.await_args.kwargs["text"] == "to ops"
            assert send_chan.await_args.kwargs["channel_key_upper"] == OPS_KEY
    finally:
        await mc.disconnect()


@pytest.mark.asyncio
async def test_everything_else_is_refused(bridge):
    mc = await _client(bridge)
    try:
        reboot = await mc.commands.send(b"\x13reboot", [EventType.OK, EventType.ERROR])
        assert reboot.type == EventType.ERROR
        export_key = await mc.commands.send(b"\x17", [EventType.PRIVATE_KEY, EventType.ERROR])
        assert export_key.type == EventType.ERROR
        set_channel = await mc.commands.send(
            b"\x20\x00" + b"x" * 32 + b"\x00" * 16, [EventType.OK, EventType.ERROR]
        )
        assert set_channel.type == EventType.ERROR
    finally:
        await mc.disconnect()


@pytest.mark.asyncio
async def test_sending_can_be_switched_off(test_db):
    server = CompanionBridge()
    radio = MagicMock()
    radio.meshcore = MagicMock()
    radio.meshcore.self_info = SELF_INFO
    with patch("app.services.radio_runtime.radio_runtime", radio):
        await server.start("127.0.0.1", 0, allow_send=False)
        try:
            reader, writer = await asyncio.open_connection("127.0.0.1", server.port)
            body = b"\x03\x00\x00" + struct.pack("<I", 1) + b"hi"
            writer.write(b"<" + struct.pack("<H", len(body)) + body)
            await writer.drain()
            reply = await asyncio.wait_for(reader.readexactly(5), 5)
            assert reply == b">\x02\x00\x01\x01"  # ERR, unsupported
            writer.close()
        finally:
            await server.stop()


@pytest.mark.asyncio
async def test_realtime_broadcasts_reach_the_bridge():
    from app import websocket

    with patch("app.companion_bridge.server.companion_bridge.on_event") as on_event:
        websocket.broadcast_event("message", {"id": 1})
        websocket.broadcast_event("message_acked", {"message_id": 1})
        websocket.broadcast_event("message", {"id": 2}, realtime=False)
        await asyncio.sleep(0)
    assert [c.args[0] for c in on_event.call_args_list] == ["message", "message_acked"]
