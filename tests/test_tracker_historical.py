"""Tracker traffic through historical channel decryption (review fixes)."""

from unittest.mock import patch

import pytest

from app.repository import ChannelRepository, RawPacketRepository
from app.repository.trackers import TrackerRepository
from app.services import trackers
from app.services.atak_reassembly import AtakReassembler
from app.services.messages import create_message_from_decrypted
from tests.atak_fixtures import ax25_frame, chat_value, envelopes, gps_value, tlv
from tests.test_decoder import build_group_data_packet

KEY_HEX = "A3741E6A529CCF31D04B89FE1763B82D"
KEY = bytes.fromhex(KEY_HEX)


async def _chan_rows(test_db) -> list[str]:
    async with test_db.readonly() as conn:
        async with conn.execute("SELECT text FROM messages WHERE type = 'CHAN'") as cursor:
            return [r["text"] for r in await cursor.fetchall()]


@pytest.mark.asyncio
async def test_historical_decrypt_routes_tracker_datagrams(test_db, monkeypatch):
    from app.routers.packets import _run_historical_channel_decryption

    monkeypatch.setattr(trackers, "broadcast_event", lambda *a, **k: None)
    await ChannelRepository.upsert(key=KEY_HEX, name="ATAK_DATA")
    (payload,) = envelopes(ax25_frame("OPENRL", "JSTR25", tlv(0x03, gps_value())))
    await RawPacketRepository.create(
        build_group_data_packet(KEY, 0xFF01, payload), timestamp=1_700_000_000
    )

    with (
        patch("app.routers.packets.broadcast_event"),
        patch("app.routers.packets.broadcast_success"),
    ):
        for _ in range(2):
            # A restart between runs forgets the in-memory frame cache.
            monkeypatch.setattr(trackers, "atak_reassembler", AtakReassembler())
            await _run_historical_channel_decryption(KEY, KEY_HEX, "ATAK_DATA")

    assert await _chan_rows(test_db) == []  # no [data] placeholder
    rows = await TrackerRepository.positions(None, None, False, None, 10)
    assert [(p.identity, p.received_at) for p in rows] == [("JESTER_25", 1_700_000_000)]


@pytest.mark.asyncio
async def test_same_packet_stores_one_position(test_db, monkeypatch):
    monkeypatch.setattr(trackers, "broadcast_event", lambda *a, **k: None)
    (payload,) = envelopes(ax25_frame("OPENRL", "JSTR25", tlv(0x03, gps_value())))
    datagram = trackers.DecryptedGroupData(data_type=0xFF01, data=payload, channel_hash="aa")
    ctx = trackers.DatagramContext(
        packet_id=77,
        channel_key=KEY_HEX,
        channel_name=None,
        received_at=1,
        path=None,
        path_len=None,
        rssi=None,
        snr=None,
        packet_hash=None,
        transport_code=None,
        region=None,
    )
    for _ in range(2):
        monkeypatch.setattr(trackers, "atak_reassembler", AtakReassembler())
        await trackers.handle_tracker_datagram(datagram, ctx)
    assert len(await TrackerRepository.positions(None, None, False, None, 10)) == 1


@pytest.mark.asyncio
async def test_historical_tracker_chat_is_not_realtime(test_db, monkeypatch):
    calls: list[tuple[str, bool]] = []

    def record(event_type: str, data: dict, *, realtime: bool = True) -> None:
        calls.append((event_type, realtime))

    monkeypatch.setattr(trackers, "broadcast_event", record)
    monkeypatch.setattr(trackers, "atak_reassembler", AtakReassembler())
    (payload,) = envelopes(ax25_frame("OPENRL", "JSTR25", tlv(0x02, chat_value("old line"))))
    await create_message_from_decrypted(
        packet_id=5,
        channel_key=KEY_HEX,
        sender="JSTR25",
        message_text=payload.decode(),
        timestamp=1_700_000_000,
        received_at=1_700_000_000,
        realtime=False,
        broadcast_fn=record,
    )
    assert await _chan_rows(test_db) == ["JSTR25: old line"]
    assert calls and all(realtime is False for _, realtime in calls)
