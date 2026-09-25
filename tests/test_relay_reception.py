"""Tests for plan 21 S1: per-relay reception capture, aggregation and endpoint."""

from unittest.mock import AsyncMock, patch

import pytest

from app.decoder import PacketInfo, PayloadType, RouteType
from app.models import ContactUpsert
from app.path_utils import last_hop_hex
from app.repository import AppSettingsRepository, ContactRepository
from app.repository.packet_receptions import PacketReceptionRepository, PacketReceptionRow
from app.services import retention_pruner
from app.services.relay_reception import (
    aggregate_relay_receptions,
    record_packet_reception,
    resolve_relay,
)

# Header byte: bits 0-1 route type, bits 2-5 payload type. GROUP_TEXT = 5.
FLOOD_GROUP_TEXT = 0x15  # route 01 (FLOOD)
DIRECT_GROUP_TEXT = 0x16  # route 10 (DIRECT)
PAYLOAD = b"\x11" * 10


def _packet(header: int, path: bytes, payload: bytes = PAYLOAD) -> bytes:
    return bytes([header, len(path)]) + path + payload


def _row(
    payload_hash: bytes,
    observed_at: int,
    last_hop: str | None,
    snr: float | None = 5.0,
    rssi: int | None = -100,
    raw_packet_id: int | None = 1,
) -> PacketReceptionRow:
    return PacketReceptionRow(
        id=observed_at,
        raw_packet_id=raw_packet_id,
        payload_hash=payload_hash,
        observed_at=observed_at,
        snr=snr,
        rssi=rssi,
        payload_type="GROUP_TEXT",
        route_type="Flood",
        hop_count=1 if last_hop else 0,
        hash_size=1 if last_hop else 0,
        last_hop_hex=last_hop,
        path_hex=last_hop,
    )


class TestLastHopHex:
    def test_last_chunk_by_hop_count(self):
        assert last_hop_hex("aabb", 2) == "bb"
        assert last_hop_hex("aaaabbbb", 2) == "bbbb"
        assert last_hop_hex("aa", 1) == "aa"

    def test_empty_or_direct_path(self):
        assert last_hop_hex("", 0) is None
        assert last_hop_hex("aabb", 0) is None


async def _all_rows() -> list[PacketReceptionRow]:
    return await PacketReceptionRepository.window_rows(0, 2**31)


class TestCapture:
    async def _process(self, raw: bytes, ts: int, snr: float, rssi: int, captured_broadcasts):
        from app.packet_processor import process_raw_packet

        _, mock_broadcast = captured_broadcasts
        with (
            patch("app.packet_processor.broadcast_event", mock_broadcast),
            patch("app.packet_processor.record_packet_edges", AsyncMock()),
        ):
            return await process_raw_packet(raw, timestamp=ts, snr=snr, rssi=rssi)

    @pytest.mark.asyncio
    async def test_flood_copy_records_last_hop(self, test_db, captured_broadcasts):
        result = await self._process(
            _packet(FLOOD_GROUP_TEXT, bytes.fromhex("aabb")), 1000, 3.5, -90, captured_broadcasts
        )
        rows = await _all_rows()
        assert len(rows) == 1
        row = rows[0]
        assert (row.last_hop_hex, row.hop_count, row.hash_size) == ("bb", 2, 1)
        assert (row.snr, row.rssi, row.observed_at) == (3.5, -90, 1000)
        assert row.route_type == "Flood" and row.payload_type == "GROUP_TEXT"
        assert row.raw_packet_id == result["packet_id"]

    @pytest.mark.asyncio
    async def test_duplicate_payload_via_other_relay_is_a_second_row(
        self, test_db, captured_broadcasts
    ):
        await self._process(
            _packet(FLOOD_GROUP_TEXT, bytes.fromhex("aa")), 1000, 3.0, -100, captured_broadcasts
        )
        await self._process(
            _packet(FLOOD_GROUP_TEXT, bytes.fromhex("cc")), 1001, -2.0, -110, captured_broadcasts
        )
        rows = await _all_rows()
        assert [r.last_hop_hex for r in rows] == ["cc", "aa"]
        assert rows[0].payload_hash == rows[1].payload_hash
        assert rows[0].raw_packet_id == rows[1].raw_packet_id  # raw_packets deduped it

    @pytest.mark.asyncio
    async def test_zero_hop_flood_has_no_relay(self, test_db, captured_broadcasts):
        await self._process(_packet(FLOOD_GROUP_TEXT, b""), 1000, 9.0, -60, captured_broadcasts)
        rows = await _all_rows()
        assert len(rows) == 1 and rows[0].last_hop_hex is None and rows[0].hop_count == 0

    @pytest.mark.asyncio
    async def test_direct_packet_is_not_recorded(self, test_db, captured_broadcasts):
        await self._process(
            _packet(DIRECT_GROUP_TEXT, bytes.fromhex("aabb")), 1000, 3.0, -100, captured_broadcasts
        )
        assert await PacketReceptionRepository.count() == 0

    @pytest.mark.asyncio
    async def test_transport_flood_is_recorded(self, test_db):
        info = PacketInfo(
            route_type=RouteType.TRANSPORT_FLOOD,
            payload_type=PayloadType.GROUP_TEXT,
            payload_version=0,
            path_length=2,
            path=bytes.fromhex("ccdd"),
            payload=b"",
            path_hash_size=1,
            transport_codes=(1, 2),
        )
        await record_packet_reception(7, 1000, info, 1.0, -105, b"\x14\x00")
        rows = await _all_rows()
        assert len(rows) == 1 and rows[0].route_type == "TransportFlood"
        assert (rows[0].last_hop_hex, rows[0].raw_packet_id) == ("dd", 7)

    @pytest.mark.asyncio
    async def test_direct_info_is_skipped_by_the_service(self, test_db):
        info = PacketInfo(
            route_type=RouteType.TRANSPORT_DIRECT,
            payload_type=PayloadType.GROUP_TEXT,
            payload_version=0,
            path_length=1,
            path=bytes.fromhex("cc"),
            payload=b"",
            path_hash_size=1,
        )
        await record_packet_reception(7, 1000, info, 1.0, -105, b"\x17\x00")
        assert await PacketReceptionRepository.count() == 0

    @pytest.mark.asyncio
    async def test_recording_failure_is_swallowed(self, test_db, captured_broadcasts):
        with patch(
            "app.services.relay_reception.PacketReceptionRepository.insert",
            AsyncMock(side_effect=RuntimeError("disk")),
        ):
            result = await self._process(
                _packet(FLOOD_GROUP_TEXT, bytes.fromhex("aa")), 1000, 3.0, -100, captured_broadcasts
            )
        assert result["packet_id"] > 0


class TestAggregate:
    def test_groups_by_payload_and_relay(self):
        h1, h2 = b"\x01" * 32, b"\x02" * 32
        rows = [
            _row(h1, 105, "bb", snr=2.0, rssi=-95),
            _row(h2, 104, "aa", snr=7.0, rssi=-80),
            _row(h1, 103, "aa", snr=6.0, rssi=-85),
            _row(h1, 102, "bb", snr=4.0, rssi=-90),
            _row(h1, 101, None, snr=9.0, rssi=-70),
        ]
        groups, relays = aggregate_relay_receptions(rows)

        assert [g.payload_hash for g in groups] == [h1, h2]
        g1 = groups[0]
        assert (g1.copies, g1.first_seen, g1.last_seen) == (4, 101, 105)
        bb = g1.relays["bb"]
        assert (bb.count, bb.best_snr, bb.last_snr, bb.best_rssi, bb.last_seen) == (
            2,
            4.0,
            2.0,
            -90,
            105,
        )
        assert g1.relays[None].count == 1

        by_hop = {r.last_hop_hex: r for r in relays}
        assert by_hop["aa"].receptions == 2 and by_hop["aa"].packets == 2
        assert by_hop["aa"].avg_snr == 6.5 and by_hop["aa"].last_snr == 7.0
        assert by_hop["bb"].packets == 1
        assert relays[0].last_hop_hex in ("aa", "bb")

    def test_limit_applies_to_packets_only(self):
        rows = [_row(bytes([i]) * 32, 100 + i, "aa") for i in range(5)]
        groups, relays = aggregate_relay_receptions(rows, limit_packets=2)
        assert len(groups) == 2 and groups[0].last_seen == 104
        assert relays[0].receptions == 5

    def test_resolve_relay_unique_and_collision(self):
        ids = [("aa" * 32, "Alpha"), ("ab" + "00" * 31, "AlphaBee"), ("cc" * 32, None)]
        assert resolve_relay("aa", ids) == ("aa" * 32, "Alpha", 1)
        assert resolve_relay("cc", ids) == ("cc" * 32, None, 1)
        assert resolve_relay("a", ids) == (None, None, 2)
        assert resolve_relay("ff", ids) == (None, None, 0)
        assert resolve_relay(None, ids) == (None, None, 0)


class TestEndpoint:
    @pytest.mark.asyncio
    async def test_relay_reception_window(self, test_db, client):
        await ContactRepository.upsert(
            ContactUpsert(public_key="bb" + "11" * 31, name="Relay Bee", type=2)
        )
        h = b"\x09" * 32
        for ts, hop, snr in ((1000, "aa", 1.0), (1001, "bb", 5.5), (1002, "bb", 6.5)):
            await PacketReceptionRepository.insert(
                raw_packet_id=None,
                payload_hash=h,
                observed_at=ts,
                snr=snr,
                rssi=-100,
                payload_type="GROUP_TEXT",
                route_type="Flood",
                hop_count=1,
                hash_size=1,
                last_hop_hex=hop,
                path_hex=hop,
            )
        await PacketReceptionRepository.insert(
            raw_packet_id=None,
            payload_hash=b"\x08" * 32,
            observed_at=5,  # outside the window
            snr=0.0,
            rssi=-120,
            payload_type="ADVERT",
            route_type="Flood",
            hop_count=1,
            hash_size=1,
            last_hop_hex="aa",
            path_hex="aa",
        )

        resp = await client.get("/api/packets/relay-reception?start_ts=900&end_ts=2000")

        assert resp.status_code == 200
        body = resp.json()
        assert body["receptions"] == 3
        assert len(body["packets"]) == 1
        packet = body["packets"][0]
        assert packet["copies"] == 3 and packet["payload_type"] == "GROUP_TEXT"
        cells = {c["last_hop_hex"]: c for c in packet["relays"]}
        assert cells["bb"]["count"] == 2 and cells["bb"]["best_snr"] == 6.5
        assert cells["bb"]["resolved_name"] == "Relay Bee"
        assert cells["aa"]["resolved_name"] is None and cells["aa"]["candidates"] == 0
        relays = {r["last_hop_hex"]: r for r in body["relays"]}
        assert relays["bb"]["receptions"] == 2 and relays["bb"]["avg_snr"] == 6.0

    @pytest.mark.asyncio
    async def test_rejects_bad_window(self, test_db, client):
        resp = await client.get("/api/packets/relay-reception?start_ts=10&end_ts=5")
        assert resp.status_code == 400


@pytest.mark.asyncio
async def test_retention_prunes_old_receptions(test_db):
    s = await AppSettingsRepository.get()
    assert s.packet_reception_retention_days == 2
    day = 86400
    now = 10 * day
    for ts in (now - 5 * day, now - 1 * day):
        await PacketReceptionRepository.insert(
            raw_packet_id=None,
            payload_hash=b"\x01" * 32,
            observed_at=ts,
            snr=None,
            rssi=None,
            payload_type="GROUP_TEXT",
            route_type="Flood",
            hop_count=0,
            hash_size=0,
            last_hop_hex=None,
            path_hex=None,
        )
    result = await retention_pruner.prune_once(now)
    assert result.get("packet_receptions") == 1
    rows = await _all_rows()
    assert [r.observed_at for r in rows] == [now - 1 * day]

    await AppSettingsRepository.update(packet_reception_retention_days=0)
    result = await retention_pruner.prune_once(now)
    assert "packet_receptions" not in result
