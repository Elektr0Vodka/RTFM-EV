"""Relay reception: uncapped summary, packet paging, hourly history, per-relay detail."""

from unittest.mock import AsyncMock, patch

import pytest

from app.repository import AppSettingsRepository
from app.repository.packet_receptions import PacketReceptionRepository
from app.repository.relay_history import RelayHistoryRepository
from app.services import retention_pruner
from app.services.relay_reception import rollup_relay_history, split_window

DAY = 86400


async def _insert(
    payload_hash: bytes,
    ts: int,
    hop: str | None,
    snr: float | None = 5.0,
    rssi: int | None = -100,
    payload_type: str = "GROUP_TEXT",
) -> None:
    await PacketReceptionRepository.insert(
        raw_packet_id=None,
        payload_hash=payload_hash,
        observed_at=ts,
        snr=snr,
        rssi=rssi,
        payload_type=payload_type,
        route_type="Flood",
        hop_count=1 if hop else 0,
        hash_size=len(hop) // 2 if hop else 0,
        last_hop_hex=hop,
        path_hex=hop,
    )


class TestSplitWindow:
    def test_raw_only_when_window_inside_raw_rows(self):
        s = split_window(10_000, 20_000, raw_oldest=9_000, rolled_latest=None)
        assert (s.raw_start, s.uses_rollup) == (10_000, False)

    def test_older_part_from_hourly_history(self):
        s = split_window(3_600, 20_000, raw_oldest=10_000, rolled_latest=7_200)
        # The oldest raw hour was rolled up: raw rows from the next full hour.
        assert s.raw_start == 10_800
        assert (s.rollup_from, s.rollup_to) == (3_600, 10_800)

    def test_oldest_raw_hour_not_rolled_up_yet(self):
        s = split_window(3_600, 20_000, raw_oldest=10_000, rolled_latest=3_600)
        assert s.raw_start == 10_000
        assert (s.rollup_from, s.rollup_to) == (3_600, 10_000)

    def test_empty_history_is_not_used(self):
        s = split_window(3_600, 20_000, raw_oldest=10_000, rolled_latest=None)
        assert (s.raw_start, s.uses_rollup) == (3_600, False)
        s = split_window(7_300, 20_000, raw_oldest=10_000, rolled_latest=3_600)
        assert (s.raw_start, s.uses_rollup) == (7_300, False)

    def test_no_raw_rows_at_all(self):
        s = split_window(3_700, 20_000, raw_oldest=None, rolled_latest=7_200)
        assert s.raw_start is None
        assert (s.rollup_from, s.rollup_to) == (3_600, 20_001)


class TestUncappedSummary:
    @pytest.mark.asyncio
    async def test_summary_covers_more_than_5000_copies(self, test_db, client):
        from app.repository import packet_receptions as repo_module

        async with repo_module.db.tx() as conn:
            await conn.executemany(
                "INSERT INTO packet_receptions (raw_packet_id, payload_hash, observed_at, snr, "
                "rssi, payload_type, route_type, hop_count, hash_size, last_hop_hex, path_hex) "
                "VALUES (NULL, ?, ?, 1.0, -100, 'GROUP_TEXT', 'Flood', 1, 1, 'aa', 'aa')",
                [(i.to_bytes(32, "big"), 1_000 + i) for i in range(6_000)],
            )

        resp = await client.get("/api/packets/relay-reception?start_ts=900&end_ts=100000")

        assert resp.status_code == 200
        body = resp.json()
        assert body["receptions"] == 6_000
        assert body["total_packets"] == 6_000 and body["packet_total"] == 6_000
        assert body["relays"][0]["receptions"] == 6_000
        assert len(body["packets"]) == 50

    @pytest.mark.asyncio
    async def test_first_arrivals_unique_and_multi_relay(self, test_db, client):
        h1, h2 = b"\x01" * 32, b"\x02" * 32
        await _insert(h1, 1000, "aa", snr=3.0)  # first copy of h1
        await _insert(h1, 1001, "bb", snr=8.0)
        await _insert(h2, 1002, "aa", snr=5.0)  # h2 heard only via aa

        resp = await client.get("/api/packets/relay-reception?start_ts=900&end_ts=2000")

        body = resp.json()
        assert body["total_packets"] == 2 and body["multi_relay_packets"] == 1
        relays = {r["last_hop_hex"]: r for r in body["relays"]}
        assert relays["aa"]["first_arrivals"] == 2 and relays["aa"]["unique_packets"] == 1
        assert relays["bb"]["first_arrivals"] == 0 and relays["bb"]["unique_packets"] == 0
        assert relays["aa"]["last_snr"] == 5.0 and relays["aa"]["relay_hexes"] == ["aa"]
        assert relays["aa"]["avg_rssi"] == -100.0

    @pytest.mark.asyncio
    async def test_packet_table_pages(self, test_db, client):
        for i in range(5):
            await _insert(bytes([i + 1]) * 32, 1000 + i, "aa")

        resp = await client.get(
            "/api/packets/relay-reception?start_ts=900&end_ts=2000&limit=2&offset=2"
        )

        body = resp.json()
        assert body["packet_total"] == 5 and body["packet_offset"] == 2
        assert [p["payload_hash"][:2] for p in body["packets"]] == ["03", "02"]
        assert body["relays"][0]["receptions"] == 5  # the summary is not paged


class TestHourlyHistory:
    @pytest.mark.asyncio
    async def test_rollup_then_prune_keeps_window_totals(self, test_db, client):
        now = 10 * DAY
        old = now - 5 * DAY  # older than the 2-day raw retention
        await _insert(b"\x01" * 32, old, "aa", snr=2.0)
        await _insert(b"\x01" * 32, old + 1, "bb", snr=6.0)
        await _insert(b"\x02" * 32, old + 7200, "aa", snr=4.0)
        await _insert(b"\x03" * 32, now - 3600, "aa", snr=1.0)

        result = await retention_pruner.prune_once(now)

        assert result.get("packet_receptions") == 3
        rows = await RelayHistoryRepository.relay_stats(0, now)
        by_hop = {r.relay_hex: r for r in rows}
        assert by_hop["aa"].receptions == 3 and by_hop["aa"].first_arrivals == 3
        assert by_hop["aa"].unique_packets == 2 and by_hop["bb"].receptions == 1

        resp = await client.get(
            f"/api/packets/relay-reception?start_ts={now - 7 * DAY}&end_ts={now}"
        )
        body = resp.json()
        assert body["receptions"] == 4 and body["total_packets"] == 3
        assert body["history_from"] is not None and body["raw_since"] == now - 3600
        relays = {r["last_hop_hex"]: r for r in body["relays"]}
        assert relays["aa"]["receptions"] == 3 and relays["aa"]["avg_snr"] == round(7 / 3, 1)
        assert relays["aa"]["last_snr"] == 1.0  # newest copy, from the stored rows
        assert body["packet_total"] == 1  # the per-packet table pages stored copies only

    @pytest.mark.asyncio
    async def test_rollup_is_incremental_and_idempotent(self, test_db):
        await _insert(b"\x01" * 32, 3600 * 5 + 10, "aa")
        assert await rollup_relay_history(3600 * 7) == 1
        assert await rollup_relay_history(3600 * 7) == 0  # nothing new
        await _insert(b"\x02" * 32, 3600 * 7 + 10, "aa")
        assert await rollup_relay_history(3600 * 8) == 1
        rows = await RelayHistoryRepository.relay_stats(0, 3600 * 9)
        assert rows[0].receptions == 2

    @pytest.mark.asyncio
    async def test_packet_straddling_an_hour_edge_counts_once(self, test_db):
        h = b"\x01" * 32
        await _insert(h, 3600 * 5 - 2, "aa")  # first copy, hour 4
        await _insert(h, 3600 * 5 + 2, "bb")  # second copy, hour 5
        await rollup_relay_history(3600 * 6)
        rows = await RelayHistoryRepository.relay_stats(0, 3600 * 6)
        assert sum(r.first_arrivals for r in rows) == 1
        assert sum(r.unique_packets for r in rows) == 0

    @pytest.mark.asyncio
    async def test_failed_rollup_keeps_raw_rows(self, test_db):
        await _insert(b"\x01" * 32, DAY, "aa")
        with patch.object(
            retention_pruner, "rollup_relay_history", AsyncMock(side_effect=RuntimeError("x"))
        ):
            result = await retention_pruner.prune_once(10 * DAY)
        assert "packet_receptions" not in result
        assert len(await PacketReceptionRepository.window_rows(0, 2**31)) == 1

    @pytest.mark.asyncio
    async def test_history_retention_setting(self, test_db):
        s = await AppSettingsRepository.get()
        assert s.relay_history_retention_days == 365
        await _insert(b"\x01" * 32, 3600, "aa")
        result = await retention_pruner.prune_once(400 * DAY)
        assert result.get("relay_history") == 1
        assert await RelayHistoryRepository.relay_stats(0, 400 * DAY) == []


class TestRelayDetail:
    @pytest.mark.asyncio
    async def test_detail_series_breakdowns_and_recent(self, test_db, client):
        h1, h2 = b"\x01" * 32, b"\x02" * 32
        await _insert(h1, 1000, "6942", snr=3.0)
        await _insert(h1, 1001, "bb", snr=8.0)
        await _insert(h2, 1500, "694203", snr=5.0, payload_type="ADVERT")

        resp = await client.get(
            "/api/packets/relay-reception/relay?start_ts=900&end_ts=2700&relay=6942&relay=694203"
        )

        assert resp.status_code == 200
        body = resp.json()
        totals = body["totals"]
        assert totals["receptions"] == 2 and totals["first_arrivals"] == 2
        assert totals["unique_packets"] == 1 and totals["window_packets"] == 2
        assert totals["avg_snr"] == 4.0 and totals["best_snr"] == 5.0
        assert body["bucket_seconds"] == 60 and body["series"][0]["ts"] == 900
        assert sum(p["receptions"] for p in body["series"]) == 2
        assert {c["key"]: c["count"] for c in body["payload_types"]} == {
            "GROUP_TEXT": 1,
            "ADVERT": 1,
        }
        assert [(c["key"], c["count"]) for c in body["hop_counts"]] == [("1", 2)]
        recent = body["recent"]
        assert [r["observed_at"] for r in recent] == [1500, 1000]
        assert recent[1]["first"] is True and recent[1]["relays"] == 2

    @pytest.mark.asyncio
    async def test_detail_for_heard_from_origin(self, test_db, client):
        await _insert(b"\x01" * 32, 1000, None, snr=9.0)
        resp = await client.get(
            "/api/packets/relay-reception/relay?start_ts=900&end_ts=2000&relay="
        )
        assert resp.status_code == 200
        assert resp.json()["totals"]["receptions"] == 1

    @pytest.mark.asyncio
    async def test_detail_rejects_bad_relay(self, test_db, client):
        resp = await client.get(
            "/api/packets/relay-reception/relay?start_ts=900&end_ts=2000&relay=zz"
        )
        assert resp.status_code == 400
