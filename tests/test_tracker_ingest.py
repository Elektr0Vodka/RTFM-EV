"""Tracker ingest: TAK-MESHCORE datagrams / channel text and SAR fast GPS."""

import pytest

from app.decoder import DecryptedGroupData
from app.repository import ChannelRepository, ContactRepository
from app.repository.trackers import TrackerRepository
from app.services import trackers
from app.services.atak_reassembly import AtakReassembler
from app.services.messages import create_message_from_decrypted
from tests.atak_fixtures import (
    ax25_frame,
    chat_value,
    cot_gz,
    envelopes,
    gps_value,
    sar_fast_gps,
    tlv,
)

CHAN = "A3741E6A529CCF31D04B89FE1763B82D"


@pytest.fixture
def broadcasts(monkeypatch):
    seen: list[tuple[str, dict]] = []

    def fake(event_type: str, data: dict, **_kwargs) -> None:
        seen.append((event_type, data))

    monkeypatch.setattr(trackers, "broadcast_event", fake)
    import app.services.messages as messages_module

    monkeypatch.setattr(messages_module, "broadcast_event", fake, raising=False)
    monkeypatch.setattr(trackers, "atak_reassembler", AtakReassembler())
    trackers.tracker_counters.clear()
    return seen


@pytest.fixture
async def channel(test_db):
    await ChannelRepository.upsert(key=CHAN, name="ATAK_DATA")
    return CHAN


def _ctx(packet_id: int | None = 1, received_at: int = 1_700_000_000) -> trackers.DatagramContext:
    return trackers.DatagramContext(
        packet_id=packet_id,
        channel_key=CHAN,
        channel_name="ATAK_DATA",
        received_at=received_at,
        path=None,
        path_len=2,
        rssi=-90,
        snr=5.0,
        packet_hash=None,
        transport_code=None,
        region=None,
    )


def _datagram(payload: bytes, data_type: int = 0xFF01) -> DecryptedGroupData:
    return DecryptedGroupData(data_type=data_type, data=payload, channel_hash="aa")


async def _send(frame: bytes, msg_id: str = "1") -> bool:
    handled = [
        await trackers.handle_tracker_datagram(_datagram(part), _ctx())
        for part in envelopes(frame, msg_id=msg_id)
    ]
    return all(handled)


async def _count(test_db, table: str) -> int:
    async with test_db.readonly() as conn:
        async with conn.execute(f"SELECT COUNT(*) AS n FROM {table}") as cursor:
            row = await cursor.fetchone()
    return row["n"]


async def _chan_texts(test_db) -> list[str]:
    async with test_db.readonly() as conn:
        async with conn.execute("SELECT text FROM messages WHERE type = 'CHAN'") as cursor:
            rows = await cursor.fetchall()
    return [r["text"] for r in rows]


@pytest.mark.asyncio
async def test_gps_datagram_stores_position(test_db, channel, broadcasts):
    (payload,) = envelopes(ax25_frame("OPENRL", "JSTR25", tlv(0x03, gps_value())))
    assert await trackers.handle_tracker_datagram(_datagram(payload), _ctx()) is True

    rows = await TrackerRepository.positions(None, None, False, None, 10)
    assert len(rows) == 1
    assert rows[0].source == "atak"
    assert rows[0].identity == "JESTER_25"
    assert rows[0].team == "Cyan"
    assert rows[0].channel_key == CHAN
    assert rows[0].path_len == 2
    assert [t for t, _ in broadcasts] == ["tracker"]
    assert broadcasts[0][1]["kind"] == "position"
    assert await _chan_texts(test_db) == []


@pytest.mark.asyncio
async def test_chat_datagram_creates_channel_message(test_db, channel, broadcasts):
    (payload,) = envelopes(ax25_frame("OPENRL", "JSTR25", tlv(0x02, chat_value("hello"))))
    assert await trackers.handle_tracker_datagram(_datagram(payload), _ctx()) is True
    assert await _chan_texts(test_db) == ["JSTR25: hello"]


@pytest.mark.asyncio
async def test_chat_repeat_single_row(test_db, channel, broadcasts):
    (payload,) = envelopes(ax25_frame("OPENRL", "JSTR25", tlv(0x02, chat_value("hello"))))
    await trackers.handle_tracker_datagram(_datagram(payload), _ctx(received_at=100))
    await trackers.handle_tracker_datagram(_datagram(payload), _ctx(received_at=103))
    assert await _chan_texts(test_db) == ["JSTR25: hello"]


@pytest.mark.asyncio
async def test_multi_chunk_cot_marker_upserts_object(test_db, channel, broadcasts):
    frame = ax25_frame("OPENRL", "JSTR25", tlv(0x01, cot_gz(remarks="x" * 40)))
    parts = envelopes(frame, chunk=40)
    assert len(parts) >= 3
    for part in parts:
        assert await trackers.handle_tracker_datagram(_datagram(part), _ctx()) is True

    objects = await TrackerRepository.objects(None, None, True, 0)
    assert [(o.uid, o.cot_type, o.callsign, o.sender) for o in objects] == [
        ("u-1", "a-h-G", "OP-1", "JSTR25")
    ]


@pytest.mark.asyncio
async def test_cot_fragments_reassembled(test_db, channel, broadcasts):
    gz = cot_gz(uid="frag-1")
    half = len(gz) // 2
    head = (7).to_bytes(2, "big") + bytes([1, 2]) + gz[:half]
    tail = (7).to_bytes(2, "big") + bytes([2, 2]) + gz[half:]
    for i, frag in enumerate((tail, head)):
        await _send(ax25_frame("OPENRL", "JSTR25", tlv(0x06, frag)), msg_id=str(i))
    assert [o.uid for o in await TrackerRepository.objects(None, None, True, 0)] == ["frag-1"]


@pytest.mark.asyncio
async def test_cot_pli_becomes_position(test_db, channel, broadcasts):
    gz = cot_gz(uid="ANDROID-JESTER_25", cot_type="a-f-G-U-C", callsign="JESTER_25")
    assert await _send(ax25_frame("OPENRL", "JSTR25", tlv(0x01, gz)))
    rows = await TrackerRepository.positions(None, None, False, None, 10)
    assert [(p.identity, p.lat) for p in rows] == [("JESTER_25", 52.1)]
    assert await _count(test_db, "tracker_objects") == 0


@pytest.mark.asyncio
async def test_cot_geochat_becomes_message(test_db, channel, broadcasts):
    gz = cot_gz(uid="GeoChat.x", cot_type="b-t-f", callsign="JESTER_25", remarks="over")
    assert await _send(ax25_frame("OPENRL", "JSTR25", tlv(0x01, gz)))
    assert await _chan_texts(test_db) == ["JESTER_25: over"]


@pytest.mark.asyncio
async def test_non_openrl_frame_ignored(test_db, channel, broadcasts):
    (payload,) = envelopes(ax25_frame("APRS", "JSTR25", tlv(0x03, gps_value())))
    assert await trackers.handle_tracker_datagram(_datagram(payload), _ctx()) is False
    assert await _count(test_db, "tracker_positions") == 0


@pytest.mark.asyncio
async def test_encrypted_frame_counted(test_db, channel, broadcasts):
    assert await _send(ax25_frame("OPENRL", "JSTR25", b"\x03" + bytes(range(60))))
    assert trackers.tracker_counters[(CHAN, "encrypted")] == 1
    assert await _count(test_db, "tracker_positions") == 0
    assert broadcasts == []


@pytest.mark.asyncio
async def test_ping_counted(test_db, channel, broadcasts):
    (payload,) = envelopes(ax25_frame("OPENRL", "JSTR25", tlv(0x04, b"JSTR25")))
    assert await trackers.handle_tracker_datagram(_datagram(payload), _ctx()) is True
    assert trackers.tracker_counters[(CHAN, "ping")] == 1


@pytest.mark.asyncio
async def test_sar_fast_gps_resolves_contact(test_db, channel, broadcasts):
    key = "a1b2c3d4e5f6" + "00" * 26
    await ContactRepository.upsert({"public_key": key, "name": "Rescue 1", "type": 1})
    assert await trackers.handle_tracker_datagram(_datagram(sar_fast_gps(), 0xFFFF), _ctx())
    rows = await TrackerRepository.positions(None, None, False, "sar_fast_gps", 10)
    assert len(rows) == 1
    assert rows[0].identity == "a1b2c3d4e5f6"
    assert rows[0].display_name == "Rescue 1"
    assert rows[0].speed_mps == 10.0


@pytest.mark.asyncio
async def test_sar_repeat_single_row(test_db, channel, broadcasts):
    await trackers.handle_tracker_datagram(_datagram(sar_fast_gps(), 0xFFFF), _ctx())
    assert await trackers.handle_tracker_datagram(_datagram(sar_fast_gps(), 0xFFFF), _ctx())
    assert await _count(test_db, "tracker_positions") == 1


@pytest.mark.asyncio
async def test_other_data_type_falls_through(test_db, channel, broadcasts):
    assert await trackers.handle_tracker_datagram(_datagram(b"\x01\x02", 0x0100), _ctx()) is False
    assert await trackers.handle_tracker_datagram(_datagram(b"\x01\x02", 0xFFFF), _ctx()) is False


@pytest.mark.asyncio
async def test_uvax1_channel_text_suppressed(test_db, channel, broadcasts):
    (payload,) = envelopes(ax25_frame("OPENRL", "JSTR25", tlv(0x03, gps_value())))
    msg_id = await create_message_from_decrypted(
        packet_id=1,
        channel_key=CHAN,
        sender="JSTR25",
        message_text=payload.decode(),
        timestamp=1_700_000_000,
        received_at=1_700_000_000,
        broadcast_fn=lambda *a, **k: None,
    )
    assert msg_id is None
    assert await _chan_texts(test_db) == []
    assert await _count(test_db, "tracker_positions") == 1
