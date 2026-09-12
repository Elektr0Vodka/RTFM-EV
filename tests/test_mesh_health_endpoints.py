"""Tests for the mesh-health analytics endpoints."""

import pytest

from app.repository import (
    ChannelRepository,  # noqa: F401  (ensures repo package import side effects)
)
from app.repository.contacts import ContactAdvertPathRepository, ContactRepository
from app.repository.raw_packets import RawPacketRepository


async def _contact(pubkey: str, last_seen: int, lat=None, lon=None):
    await ContactRepository.upsert(
        {"public_key": pubkey, "name": pubkey[:6], "lat": lat, "lon": lon, "last_seen": last_seen}
    )


class TestMeshHealth:
    @pytest.mark.asyncio
    async def test_direct_flood_split_and_alert(self, test_db, client):
        from app.repository.advert_events import AdvertEventRepository

        start, end = 1700000000, 1700003600  # 1h window
        pubkey = "aa" * 32
        await _contact(pubkey, start + 10)
        # 3 direct transmissions + 1 flood-only -> direct 3, flood 1, total 4 -> MEDIUM (>2).
        for i, txid in enumerate((1, 2, 3)):
            await AdvertEventRepository.record(
                transmission_id=txid,
                public_key=pubkey,
                timestamp=start + 10 + i,
                path_len=0,
                path_hex="",
            )
        await AdvertEventRepository.record(
            transmission_id=4,
            public_key=pubkey,
            timestamp=start + 20,
            path_len=2,
            path_hex="bbbbcccc",
        )

        resp = await client.get(f"/api/packets/mesh-health?start_ts={start}&end_ts={end}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total_contacts"] == 1
        c = next(x for x in body["contacts"] if x["public_key"] == pubkey)
        assert c["direct_count"] == 3
        assert c["flood_count"] == 1
        assert c["advert_count"] == 4
        assert c["min_path_len"] == 0
        assert body["medium_alert_count"] == 1
        assert body["high_alert_count"] == 0
        assert body["alerts"][0]["level"] == "MEDIUM"

    @pytest.mark.asyncio
    async def test_rejects_bad_range(self, test_db, client):
        resp = await client.get("/api/packets/mesh-health?start_ts=200&end_ts=100")
        assert resp.status_code == 400


class TestSnrRssiScatter:
    @pytest.mark.asyncio
    async def test_returns_points_with_both_signals(self, test_db, client):
        await RawPacketRepository.create(b"\x01", 1700000000, rssi=-80, snr=5.0)
        await RawPacketRepository.create(b"\x02", 1700000001, rssi=-70, snr=7.0)
        await RawPacketRepository.create(b"\x03", 1700000002)  # no signal -> excluded

        resp = await client.get(
            "/api/packets/snr-rssi-scatter?start_ts=1700000000&end_ts=1700000100"
        )
        assert resp.status_code == 200
        pts = resp.json()
        assert len(pts) == 2
        assert {p["rssi"] for p in pts} == {-80, -70}


class TestReachabilityRings:
    @pytest.mark.asyncio
    async def test_buckets_by_min_hop(self, test_db, client):
        now_start, now_end = 1700000000, 1700003600
        direct = "aa" * 32
        relayed = "bb" * 32
        await _contact(direct, now_start + 5)
        await _contact(relayed, now_start + 5)
        await ContactAdvertPathRepository.record_observation(
            public_key=direct, path_hex="", timestamp=now_start + 5
        )
        await ContactAdvertPathRepository.record_observation(
            public_key=relayed, path_hex=" aabb".strip(), timestamp=now_start + 5, hop_count=1
        )

        resp = await client.get(
            f"/api/packets/reachability-rings?start_ts={now_start}&end_ts={now_end}"
        )
        assert resp.status_code == 200
        rings = {r["hops"]: r["count"] for r in resp.json()}
        assert rings.get(0) == 1  # direct
        assert rings.get(1) == 1  # 1 hop


class TestHourlyHeatmapAndRelayPairs:
    @pytest.mark.asyncio
    async def test_hourly_heatmap_shape(self, test_db, client):
        await RawPacketRepository.create(b"\x01", 1700000000)
        resp = await client.get("/api/packets/hourly-heatmap?start_ts=1699999000&end_ts=1700001000")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body) >= {"cells", "max_count", "total"}
        assert body["total"] >= 1

    @pytest.mark.asyncio
    async def test_relay_pairs_extracts_consecutive_hops(self, test_db, client):
        pubkey = "cc" * 32
        await _contact(pubkey, 1700000000)
        # path_hex "aabbcc" with path_len 3 -> hops aa,bb,cc -> pairs (aa,bb),(bb,cc)
        await ContactAdvertPathRepository.record_observation(
            public_key=pubkey, path_hex="aabbcc", timestamp=1700000000, hop_count=3
        )
        resp = await client.get("/api/packets/relay-pairs")
        assert resp.status_code == 200
        pairs = {(p["hop_a"], p["hop_b"]) for p in resp.json()}
        assert ("aa", "bb") in pairs
        assert ("bb", "cc") in pairs
