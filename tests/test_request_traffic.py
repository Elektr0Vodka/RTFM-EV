"""Tests for the request-traffic aggregation and the /request-traffic endpoint."""

import pytest

from app.decoder import PayloadType, RouteType
from app.repository.raw_packets import RawPacketRepository
from app.repository.request_traffic import (
    ParsedRequestPacket,
    aggregate_request_traffic,
    parse_request_row,
)

FLOOD = int(RouteType.FLOOD)
DIRECT = int(RouteType.DIRECT)


def _pkt(payload_type: int, route: int, dest: int, src: int, extra: bytes) -> bytes:
    """Build a raw packet: header + zero path byte (0 hops) + payload(dest, src, extra)."""
    header = (0 << 6) | (payload_type << 2) | route
    return bytes([header, 0x00, dest, src]) + extra


class TestAggregateRequestTraffic:
    def test_totals_splits_and_pair_exclusion(self):
        start, end = 1000, 2000
        packets = [
            ParsedRequestPacket(
                ts=1100, kind="request", route="flood", src_hash="aa", dest_hash="bb"
            ),
            ParsedRequestPacket(
                ts=1200, kind="request", route="flood", src_hash="aa", dest_hash="bb"
            ),
            ParsedRequestPacket(
                ts=1300, kind="request", route="direct", src_hash="cc", dest_hash="dd"
            ),
            ParsedRequestPacket(
                ts=1400, kind="anon_request", route="flood", src_hash=None, dest_hash="ee"
            ),
            ParsedRequestPacket(
                ts=1500, kind="response", route="direct", src_hash="bb", dest_hash="aa"
            ),
        ]
        agg = aggregate_request_traffic(packets, start, end, bucket_count=10, pair_limit=20)

        totals = agg["totals"]
        assert totals["requests"] == 4  # 3 REQUEST + 1 ANON_REQUEST
        assert totals["anon_requests"] == 1
        assert totals["responses"] == 1
        assert totals["flood_requests"] == 3  # 2 flood requests + 1 anon flood
        assert totals["direct_requests"] == 1

        # Pairs: standard REQUEST only; anon excluded (no stable src hash).
        pairs = {(p["src_hash"], p["dest_hash"]): p for p in agg["pairs"]}
        assert set(pairs) == {("aa", "bb"), ("cc", "dd")}
        assert pairs[("aa", "bb")]["requests"] == 2
        assert pairs[("aa", "bb")]["flood"] == 2
        assert pairs[("cc", "dd")]["direct"] == 1

    def test_series_buckets_sum_to_totals(self):
        start, end = 0, 100
        packets = [
            ParsedRequestPacket(ts=5, kind="request", route="flood", src_hash="aa", dest_hash="bb"),
            ParsedRequestPacket(
                ts=95, kind="response", route="direct", src_hash="bb", dest_hash="aa"
            ),
        ]
        agg = aggregate_request_traffic(packets, start, end, bucket_count=10, pair_limit=20)
        assert len(agg["series"]) == 10
        assert sum(b["flood"] for b in agg["series"]) == 1
        assert sum(b["responses"] for b in agg["series"]) == 1
        # ts=5 lands in the first bucket, ts=95 in the last.
        assert agg["series"][0]["flood"] == 1
        assert agg["series"][9]["responses"] == 1


class TestParseRequestRow:
    def test_parses_request_and_anon_src_rule(self):
        req = parse_request_row(500, _pkt(int(PayloadType.REQUEST), FLOOD, 0xAB, 0xCD, b"\x01\x02"))
        assert req is not None
        assert req.kind == "request"
        assert req.route == "flood"
        assert req.dest_hash == "ab"
        assert req.src_hash == "cd"

        anon = parse_request_row(
            501, _pkt(int(PayloadType.ANON_REQUEST), FLOOD, 0xAB, 0xCD, b"\x03\x04")
        )
        assert anon is not None
        assert anon.kind == "anon_request"
        assert anon.dest_hash == "ab"
        assert anon.src_hash is None  # ephemeral sender

    def test_non_request_packet_returns_none(self):
        # payload_type ADVERT(4) flood
        assert (
            parse_request_row(500, _pkt(int(PayloadType.ADVERT), FLOOD, 0x00, 0x00, b"\x01"))
            is None
        )


class TestRequestTrafficEndpoint:
    @pytest.mark.asyncio
    async def test_endpoint_aggregates_stored_packets(self, test_db, client):
        start, end = 1700000000, 1700003600
        await RawPacketRepository.create(
            _pkt(int(PayloadType.REQUEST), FLOOD, 0x11, 0x22, b"\x01\x01"),
            start + 10,
            payload_type="REQUEST",
        )
        await RawPacketRepository.create(
            _pkt(int(PayloadType.REQUEST), DIRECT, 0x11, 0x22, b"\x02\x02"),
            start + 20,
            payload_type="REQUEST",
        )
        await RawPacketRepository.create(
            _pkt(int(PayloadType.ANON_REQUEST), FLOOD, 0x33, 0x44, b"\x03\x03"),
            start + 30,
            payload_type="ANON_REQUEST",
        )
        await RawPacketRepository.create(
            _pkt(int(PayloadType.RESPONSE), DIRECT, 0x22, 0x11, b"\x04\x04"),
            start + 40,
            payload_type="RESPONSE",
        )

        resp = await client.get(f"/api/packets/request-traffic?start_ts={start}&end_ts={end}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["totals"]["requests"] == 3
        assert body["totals"]["anon_requests"] == 1
        assert body["totals"]["responses"] == 1
        assert body["totals"]["flood_requests"] == 2
        assert body["totals"]["direct_requests"] == 1

        # One standard REQUEST pair (11 -> 22) with 2 requests; anon excluded.
        assert len(body["pairs"]) == 1
        pair = body["pairs"][0]
        assert pair["src_hash"] == "22"
        assert pair["dest_hash"] == "11"
        assert pair["requests"] == 2

    @pytest.mark.asyncio
    async def test_rejects_bad_range(self, test_db, client):
        resp = await client.get("/api/packets/request-traffic?start_ts=200&end_ts=100")
        assert resp.status_code == 400
