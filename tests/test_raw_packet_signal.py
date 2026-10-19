"""Signal persistence on raw_packets: repository create() and the packet pipeline."""

import json
import logging
from pathlib import Path
from unittest.mock import patch

import pytest

from app.decoder import PayloadType, RouteType, parse_packet
from app.packet_processor import process_raw_packet
from app.repository.contacts import ContactAdvertPathRepository, ContactRepository
from app.repository.raw_packets import RawPacketRepository
from app.services.packet_decoded_fields import decoded_stat_fields, route_label

FIXTURES_PATH = Path(__file__).parent / "fixtures" / "websocket_events.json"
with open(FIXTURES_PATH, encoding="utf-8") as f:
    FIXTURES = json.load(f)


async def _row(test_db, packet_id: int):
    async with test_db.conn.execute(
        "SELECT rssi, snr, payload_type FROM raw_packets WHERE id = ?", (packet_id,)
    ) as cur:
        return await cur.fetchone()


async def _decoded_row(test_db, packet_id: int):
    async with test_db.conn.execute(
        "SELECT route_type, hop_count, hop_byte_width, path_signature "
        "FROM raw_packets WHERE id = ?",
        (packet_id,),
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

    @pytest.mark.asyncio
    async def test_create_stores_decoded_fields(self, test_db):
        packet_id, _ = await RawPacketRepository.create(
            b"\x10\x20\x30",
            1700000002,
            route_type="Direct",
            hop_count=2,
            hop_byte_width=1,
            path_signature="abcd",
        )
        row = await _decoded_row(test_db, packet_id)
        assert row["route_type"] == "Direct"
        assert row["hop_count"] == 2
        assert row["hop_byte_width"] == 1
        assert row["path_signature"] == "abcd"


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

        # Decoded stat fields are persisted, matching the ingest-time derivation.
        expected = decoded_stat_fields(parse_packet(packet_bytes))
        decoded = await _decoded_row(test_db, packet_id)
        assert decoded["route_type"] == expected["route_type"]
        assert decoded["hop_count"] == expected["hop_count"]
        assert decoded["hop_byte_width"] == expected["hop_byte_width"]
        assert decoded["path_signature"] == expected["path_signature"]

    @pytest.mark.asyncio
    async def test_process_raw_packet_stores_request_type(self, test_db, captured_broadcasts):
        """A REQUEST packet must be stored as "REQUEST", not "Unknown".

        `PayloadType.REQUEST` is 0x00 and therefore falsy, so the old
        `payload_type.name if payload_type else "Unknown"` guard mislabelled
        every request as "Unknown" - which made the Packet History "Request"
        filter return nothing while "Unknown" surfaced them.
        """
        # header 0x01 -> route FLOOD, payload_type REQUEST(0); zero-hop path byte
        # 0x00; one payload byte. parse_packet(...) decodes this as REQUEST.
        request_packet = bytes.fromhex("0100aa")
        assert parse_packet(request_packet).payload_type is PayloadType.REQUEST
        _, mock_broadcast = captured_broadcasts

        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            result = await process_raw_packet(request_packet, timestamp=1700000000)

        row = await _row(test_db, result["packet_id"])
        assert row["payload_type"] == "REQUEST"

    @pytest.mark.asyncio
    async def test_process_raw_packet_stores_fuota_type(self, test_db, captured_broadcasts):
        """A meshcore_fuota Offer (type 0x0E, DIRECT, 0 hops) is stored as FUOTA."""
        broadcasts, mock_broadcast = captured_broadcasts

        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            result = await process_raw_packet(_FUOTA_OFFER, timestamp=1700000000)

        row = await _row(test_db, result["packet_id"])
        assert row["payload_type"] == "FUOTA"
        decoded = await _decoded_row(test_db, result["packet_id"])
        assert decoded["route_type"] == route_label(RouteType.DIRECT)
        assert decoded["hop_count"] == 0
        assert decoded["hop_byte_width"] == 0
        raw_events = [b for b in broadcasts if b["type"] == "raw_packet"]
        assert raw_events[0]["data"]["payload_type"] == "FUOTA"

    @pytest.mark.asyncio
    async def test_process_raw_packet_stores_meshcoreng_location(
        self, test_db, captured_broadcasts, caplog
    ):
        """A MeshCoreNG MCL1 report (type 0x0D, flood, 1 hop) is stored as MESHCORENG."""
        from tests.test_meshcoreng import mcl1

        packet = bytes([0x35, 0x01, 0xAA]) + mcl1(b"NG")
        broadcasts, mock_broadcast = captured_broadcasts

        with (
            caplog.at_level(logging.WARNING, logger="app.packet_processor"),
            patch("app.packet_processor.broadcast_event", mock_broadcast),
        ):
            result = await process_raw_packet(packet, timestamp=1700000000)

        row = await _row(test_db, result["packet_id"])
        assert row["payload_type"] == "MESHCORENG"
        decoded = await _decoded_row(test_db, result["packet_id"])
        assert decoded["route_type"] == route_label(RouteType.FLOOD)
        assert decoded["hop_count"] == 1
        assert decoded["path_signature"] == "aa"
        assert not [r for r in caplog.records if "Failed to parse" in r.getMessage()]
        raw_events = [b for b in broadcasts if b["type"] == "raw_packet"]
        assert raw_events[0]["data"]["payload_type"] == "MESHCORENG"

    @pytest.mark.asyncio
    async def test_fuota_packet_logs_no_parse_warning(self, test_db, captured_broadcasts, caplog):
        _, mock_broadcast = captured_broadcasts

        with (
            caplog.at_level(logging.WARNING, logger="app.packet_processor"),
            patch("app.packet_processor.broadcast_event", mock_broadcast),
        ):
            await process_raw_packet(_FUOTA_OFFER, timestamp=1700000000)

        assert not [r for r in caplog.records if "Failed to parse" in r.getMessage()]

    @pytest.mark.asyncio
    async def test_unknown_0x0e_stays_unknown(self, test_db, captured_broadcasts):
        """Type 0x0E sent as FLOOD is not FUOTA: it stays Unknown, as before."""
        _, mock_broadcast = captured_broadcasts
        flood = bytes([0x39]) + _FUOTA_OFFER[1:]

        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            result = await process_raw_packet(flood, timestamp=1700000000)

        row = await _row(test_db, result["packet_id"])
        assert row["payload_type"] == "Unknown"


# meshcore_fuota Offer: header 0x3A (version 0, type 0x0E, DIRECT), path byte 0, 30-byte payload.
_FUOTA_OFFER = bytes.fromhex("3a0001abdeadbeefc4000038000001000000050000001122334455667788047f")


def _with_version(packet: bytes, version: int) -> bytes:
    """Set the header's payload-version bits (bits 6-7) on a raw packet."""
    return bytes([(packet[0] & 0x3F) | (version << 6)]) + packet[1:]


class TestOtherVersionPackets:
    """Header version 1-3 packets are stored and shown, never processed.

    MeshCore 1.18.0 drops them in ``Dispatcher::tryParsePacket`` ("unsupported
    packet version"), but ``logRxRaw`` runs first, so the companion still pushes
    them to us. Trail Mate sends version 1 by default.
    """

    @pytest.mark.asyncio
    async def test_version_1_advert_does_not_create_contact(self, test_db, captured_broadcasts):
        fixture = FIXTURES["advertisement_chat_node"]
        packet = _with_version(bytes.fromhex(fixture["raw_packet_hex"]), 1)
        pubkey = fixture["expected_ws_event"]["data"]["public_key"]
        _, mock_broadcast = captured_broadcasts

        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            await process_raw_packet(packet, timestamp=1700000000, snr=9.0, rssi=-58)

        assert await ContactRepository.get_by_key(pubkey.lower()) is None
        assert await _path_signal(test_db, pubkey) is None

    @pytest.mark.asyncio
    async def test_version_1_advert_is_stored_and_broadcast(self, test_db, captured_broadcasts):
        fixture = FIXTURES["advertisement_chat_node"]
        original = bytes.fromhex(fixture["raw_packet_hex"])
        packet = _with_version(original, 1)
        broadcasts, mock_broadcast = captured_broadcasts

        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            result = await process_raw_packet(packet, timestamp=1700000000, snr=9.0, rssi=-58)

        assert result["payload_type"] == "OTHER_VERSION"
        row = await _row(test_db, result["packet_id"])
        assert row["payload_type"] == "OTHER_VERSION"
        assert row["rssi"] == -58
        assert row["snr"] == 9.0
        # Route and hop fields come from the header and path byte, which the
        # version bits do not change, so they match the version-0 packet.
        expected = decoded_stat_fields(parse_packet(original))
        decoded = await _decoded_row(test_db, result["packet_id"])
        assert decoded["route_type"] == expected["route_type"]
        assert decoded["hop_count"] == expected["hop_count"]

        raw_events = [b for b in broadcasts if b["type"] == "raw_packet"]
        assert len(raw_events) == 1
        assert raw_events[0]["data"]["payload_type"] == "OTHER_VERSION"
        assert raw_events[0]["data"]["data"] == packet.hex()
        assert not [b for b in broadcasts if b["type"] == "contact"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("version", [2, 3])
    async def test_versions_2_and_3_are_other_version(self, test_db, captured_broadcasts, version):
        packet = _with_version(bytes.fromhex("0100aa"), version)
        _, mock_broadcast = captured_broadcasts

        with patch("app.packet_processor.broadcast_event", mock_broadcast):
            result = await process_raw_packet(packet, timestamp=1700000000)

        row = await _row(test_db, result["packet_id"])
        assert row["payload_type"] == "OTHER_VERSION"


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
    async def test_last_primary_seen_set_on_primary_not_on_relay(self, test_db):
        """last_primary_seen tracks primary (is_new_packet) arrivals, not relay copies."""
        pubkey = "dd" * 32
        await ContactRepository.upsert({"public_key": pubkey, "name": "PrimaryNode"})

        async def _lps():
            async with test_db.conn.execute(
                "SELECT last_primary_seen FROM contact_advert_paths WHERE public_key = ?",
                (pubkey.lower(),),
            ) as cur:
                return (await cur.fetchone())["last_primary_seen"]

        # Primary (first-heard) arrival sets last_primary_seen.
        await ContactAdvertPathRepository.record_observation(
            public_key=pubkey, path_hex="", timestamp=100, is_new_packet=True
        )
        assert await _lps() == 100

        # A later relay copy of the same advert must NOT bump last_primary_seen.
        await ContactAdvertPathRepository.record_observation(
            public_key=pubkey, path_hex="", timestamp=200, is_new_packet=False
        )
        assert await _lps() == 100

        # Another primary arrival advances it.
        await ContactAdvertPathRepository.record_observation(
            public_key=pubkey, path_hex="", timestamp=300, is_new_packet=True
        )
        assert await _lps() == 300

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
