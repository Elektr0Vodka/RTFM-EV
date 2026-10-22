"""SF stamps through the packet pipeline, packet APIs and contact sightings."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.models import RadioStamp
from app.packet_processor import process_raw_packet
from app.repository.contact_radio_sightings import ContactRadioSightingsRepository
from app.repository.contacts import ContactRepository
from app.repository.raw_packets import RawPacketRepository
from app.services.radio_sightings import record_contact_sighting

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "websocket_events.json").read_text(encoding="utf-8")
)
ADVERT = bytes.fromhex(FIXTURES["advertisement_with_gps"]["raw_packet_hex"])
ADVERT_KEY = FIXTURES["advertisement_with_gps"]["expected_ws_event"]["data"]["public_key"]
SF8 = RadioStamp(freq=869.618, bw=62.5, sf=8, cr=8)
SF7 = RadioStamp(freq=869.618, bw=62.5, sf=7, cr=8)


class TestPipeline:
    @pytest.mark.asyncio
    async def test_advert_stamps_packet_and_records_sighting(self, test_db, captured_broadcasts):
        broadcasts, mock_broadcast = captured_broadcasts
        with (
            patch("app.radio_stamp.current_radio_stamp", return_value=SF8),
            patch("app.packet_processor.broadcast_event", mock_broadcast),
            patch("app.services.radio_sightings.broadcast_event", mock_broadcast),
        ):
            result = await process_raw_packet(ADVERT, timestamp=1700000000, snr=5.0, rssi=-90)

        async with test_db.conn.execute(
            "SELECT radio_sf FROM raw_packets WHERE id = ?", (result["packet_id"],)
        ) as cur:
            assert (await cur.fetchone())[0] == 8

        raw = [b for b in broadcasts if b["type"] == "raw_packet"]
        assert raw[-1]["data"]["radio_stamp"] == SF8.model_dump()

        sightings = await ContactRadioSightingsRepository.get_all()
        assert [s.sf for s in sightings[ADVERT_KEY]] == [8]
        events = [b for b in broadcasts if b["type"] == "contact_radio_sighting"]
        assert events and events[0]["data"]["public_key"] == ADVERT_KEY

    @pytest.mark.asyncio
    async def test_no_radio_no_stamp_no_sighting(self, test_db, captured_broadcasts):
        broadcasts, mock_broadcast = captured_broadcasts
        with (
            patch("app.radio_stamp.current_radio_stamp", return_value=None),
            patch("app.packet_processor.broadcast_event", mock_broadcast),
        ):
            await process_raw_packet(ADVERT, timestamp=1700000001)
        raw = [b for b in broadcasts if b["type"] == "raw_packet"]
        assert raw[-1]["data"]["radio_stamp"] is None
        assert await ContactRadioSightingsRepository.get_all() == {}


class TestRecordContactSighting:
    @pytest.mark.asyncio
    async def test_second_sighting_same_settings_no_broadcast(self, test_db, captured_broadcasts):
        broadcasts, mock_broadcast = captured_broadcasts
        with (
            patch("app.radio_stamp.current_radio_stamp", return_value=SF7),
            patch("app.services.radio_sightings.broadcast_event", mock_broadcast),
        ):
            await record_contact_sighting("cd" * 32, 10)
            await record_contact_sighting("cd" * 32, 11)
        assert len([b for b in broadcasts if b["type"] == "contact_radio_sighting"]) == 1

    @pytest.mark.asyncio
    async def test_never_raises(self, test_db):
        with (
            patch("app.radio_stamp.current_radio_stamp", return_value=SF7),
            patch.object(ContactRadioSightingsRepository, "record", side_effect=RuntimeError("db")),
        ):
            await record_contact_sighting("cd" * 32, 10)


class TestApis:
    @pytest.mark.asyncio
    async def test_get_contact_radio_sightings(self, test_db, client):
        await ContactRadioSightingsRepository.record("ef" * 32, SF8, 5)
        resp = await client.get("/api/contacts/radio-sightings")
        assert resp.status_code == 200
        body = resp.json()
        assert body["ef" * 32][0]["sf"] == 8

    @pytest.mark.asyncio
    async def test_contact_delete_removes_sightings(self, test_db):
        await ContactRadioSightingsRepository.record("ef" * 32, SF8, 5)
        await ContactRepository.delete("ef" * 32)
        assert await ContactRadioSightingsRepository.get_all() == {}

    @pytest.mark.asyncio
    async def test_history_and_recent_return_stamp(self, test_db, client):
        await RawPacketRepository.create(b"\x10\x00\x01", 100, radio_stamp=SF8)
        await RawPacketRepository.create(b"\x10\x00\x02", 101)
        history = (await client.get("/api/packets/history")).json()["packets"]
        stamps = {p["timestamp"]: p["radio_stamp"] for p in history}
        assert stamps[100] == SF8.model_dump()
        assert stamps[101] is None
        recent = (await client.get("/api/packets/recent")).json()
        assert {p["timestamp"]: p["radio_stamp"] for p in recent}[100]["sf"] == 8

    @pytest.mark.asyncio
    async def test_history_radio_sf_filter(self, test_db, client):
        await RawPacketRepository.create(b"\x10\x00\x03", 100, radio_stamp=SF8)
        await RawPacketRepository.create(b"\x10\x00\x04", 101, radio_stamp=SF7)
        await RawPacketRepository.create(b"\x10\x00\x05", 102)
        only8 = (await client.get("/api/packets/history?radio_sfs=8")).json()["packets"]
        assert [p["timestamp"] for p in only8] == [100]
        unknown = (await client.get("/api/packets/history?radio_sfs=Unknown")).json()["packets"]
        assert [p["timestamp"] for p in unknown] == [102]


class TestMessageSightings:
    @pytest.mark.asyncio
    async def test_incoming_dm_records_sighting(self, test_db):
        from unittest.mock import MagicMock

        from app.decoder import DecryptedDirectMessage
        from app.models import ContactUpsert
        from app.services.dm_ingest import ingest_decrypted_direct_message

        key = "aa" * 32
        await ContactRepository.upsert(ContactUpsert(public_key=key, type=1, name="Bob"))
        decrypted = DecryptedDirectMessage(
            timestamp=1_800_000_000,
            flags=0,
            message="hoi",
            dest_hash="bb",
            src_hash="aa",
            signed_sender_prefix=None,
        )
        with patch("app.radio_stamp.current_radio_stamp", return_value=SF8):
            await ingest_decrypted_direct_message(
                packet_id=None,
                decrypted=decrypted,
                their_public_key=key,
                received_at=1_800_000_000,
                broadcast_fn=MagicMock(),
            )
        assert [s.sf for s in (await ContactRadioSightingsRepository.get_all())[key]] == [8]

    @pytest.mark.asyncio
    async def test_channel_message_with_resolved_sender_records_sighting(self, test_db):
        from unittest.mock import MagicMock

        from app.models import ContactUpsert
        from app.services.messages import create_message_from_decrypted

        key = "bc" * 32
        await ContactRepository.upsert(ContactUpsert(public_key=key, type=1, name="Carol"))
        packet_id, _ = await RawPacketRepository.create(b"chan_sighting", 1_800_000_000)
        with patch("app.radio_stamp.current_radio_stamp", return_value=SF7):
            msg_id = await create_message_from_decrypted(
                packet_id=packet_id,
                channel_key="AB" * 16,
                sender="Carol",
                message_text="hello",
                timestamp=1_800_000_000,
                received_at=1_800_000_000,
                broadcast_fn=MagicMock(),
            )
        assert msg_id is not None
        assert [s.sf for s in (await ContactRadioSightingsRepository.get_all())[key]] == [7]
