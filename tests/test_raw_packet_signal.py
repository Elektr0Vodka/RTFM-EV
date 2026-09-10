"""Signal persistence on raw_packets: repository create() and the packet pipeline."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.packet_processor import process_raw_packet
from app.repository.contacts import ContactAdvertPathRepository, ContactRepository
from app.repository.raw_packets import RawPacketRepository

FIXTURES_PATH = Path(__file__).parent / "fixtures" / "websocket_events.json"
with open(FIXTURES_PATH, encoding="utf-8") as f:
    FIXTURES = json.load(f)


async def _row(test_db, packet_id: int):
    async with test_db.conn.execute(
        "SELECT rssi, snr, payload_type FROM raw_packets WHERE id = ?", (packet_id,)
    ) as cur:
        return await cur.fetchone()


class TestCreatePersistsSignal:
    @pytest.mark.asyncio
    async def test_create_stores_rssi_snr_payload_type(self, test_db):
        packet_id, is_new = await RawPacketRepository.create(
            b"\x10\x20\x30", 1700000000, rssi=-92, snr=5.5, payload_type="ADVERT"
        )
        assert is_new is True

        row = await _row(test_db, packet_id)
        assert row["rssi"] == -92
        assert row["snr"] == 5.5
        assert row["payload_type"] == "ADVERT"

    @pytest.mark.asyncio
    async def test_create_defaults_signal_to_null(self, test_db):
        packet_id, _ = await RawPacketRepository.create(b"\x41\x42\x43", 1700000001)

        row = await _row(test_db, packet_id)
        assert row["rssi"] is None
        assert row["snr"] is None
        assert row["payload_type"] is None


class TestPipelinePersistsSignal:
    @pytest.mark.asyncio
    async def test_process_raw_packet_stores_signal_and_payload_type(
        self, test_db, captured_broadcasts
    ):
        """process_raw_packet must persist rssi/snr and the parsed payload type."""
        packet_bytes = bytes.fromhex(FIXTURES["channel_message"]["raw_packet_hex"])
        _, mock_broadcast = captured_broadcasts

        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            result = await process_raw_packet(
                packet_bytes, timestamp=1700000000, snr=7.25, rssi=-73
            )

        packet_id = result["packet_id"]
        row = await _row(test_db, packet_id)
        assert row["rssi"] == -73
        assert row["snr"] == 7.25
        # channel_message fixture parses as a GROUP_TEXT payload.
        assert row["payload_type"] == "GROUP_TEXT"


async def _path_signal(test_db, public_key: str):
    async with test_db.conn.execute(
        "SELECT best_rssi, best_snr FROM contact_advert_paths WHERE public_key = ?",
        (public_key.lower(),),
    ) as cur:
        return await cur.fetchone()


class TestAdvertPathSignal:
    @pytest.mark.asyncio
    async def test_advert_pipeline_records_best_signal(self, test_db, captured_broadcasts):
        """An ingested advert stores its rssi/snr onto the contact's advert path."""
        fixture = FIXTURES["advertisement_chat_node"]
        packet_bytes = bytes.fromhex(fixture["raw_packet_hex"])
        pubkey = fixture["expected_ws_event"]["data"]["public_key"]
        _, mock_broadcast = captured_broadcasts

        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            await process_raw_packet(packet_bytes, timestamp=1700000000, snr=9.0, rssi=-58)

        row = await _path_signal(test_db, pubkey)
        assert row is not None
        assert row["best_rssi"] == -58
        assert row["best_snr"] == 9.0

    @pytest.mark.asyncio
    async def test_record_observation_keeps_strongest_signal(self, test_db):
        """Repeated observations keep the strongest (max) rssi and snr independently."""
        pubkey = "aa" * 32
        await ContactRepository.upsert({"public_key": pubkey, "name": "Neighbor"})

        await ContactAdvertPathRepository.record_observation(
            public_key=pubkey, path_hex="", timestamp=1700000000, rssi=-90, snr=3.0
        )
        await ContactAdvertPathRepository.record_observation(
            public_key=pubkey, path_hex="", timestamp=1700000010, rssi=-70, snr=1.0
        )

        row = await _path_signal(test_db, pubkey)
        assert row["best_rssi"] == -70  # stronger of -90 / -70
        assert row["best_snr"] == 3.0  # stronger of 3.0 / 1.0

    @pytest.mark.asyncio
    async def test_record_observation_null_signal_preserves_existing(self, test_db):
        """A later observation without signal must not wipe the stored best."""
        pubkey = "bb" * 32
        await ContactRepository.upsert({"public_key": pubkey, "name": "Neighbor2"})

        await ContactAdvertPathRepository.record_observation(
            public_key=pubkey, path_hex="", timestamp=1700000000, rssi=-80, snr=4.0
        )
        await ContactAdvertPathRepository.record_observation(
            public_key=pubkey, path_hex="", timestamp=1700000010
        )

        row = await _path_signal(test_db, pubkey)
        assert row["best_rssi"] == -80
        assert row["best_snr"] == 4.0
