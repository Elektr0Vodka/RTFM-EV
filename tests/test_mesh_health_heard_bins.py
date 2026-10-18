"""Tests for GET /api/packets/mesh-health/heard-bins (share card 4)."""

import pytest

from app.repository.advert_events import AdvertEventRepository


async def _advert(txid: int, pubkey: str, ts: int) -> None:
    await AdvertEventRepository.record(
        transmission_id=txid, public_key=pubkey, timestamp=ts, path_len=0, path_hex=""
    )


class TestHeardBins:
    @pytest.mark.asyncio
    async def test_lists_each_contact_once_per_bin(self, test_db, client):
        start, end = 1700000000, 1700000000 + 4 * 600  # four 10-minute bins
        a, b = "aa" * 32, "bb" * 32
        await _advert(1, a, start + 10)
        await _advert(2, a, start + 20)  # same bin, same contact: listed once
        await _advert(3, b, start + 650)  # bin 1
        await _advert(4, a, start + 3 * 600 + 5)  # bin 3

        resp = await client.get(
            f"/api/packets/mesh-health/heard-bins?start_ts={start}&end_ts={end}&bin_count=4"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["bin_seconds"] == 600
        assert [b_["start_ts"] for b_ in body["bins"]] == [start + i * 600 for i in range(4)]
        assert body["bins"][0]["keys"] == [a]
        assert body["bins"][1]["keys"] == [b]
        assert body["bins"][2]["keys"] == []
        assert body["bins"][3]["keys"] == [a]

    @pytest.mark.asyncio
    async def test_ignores_adverts_outside_the_window(self, test_db, client):
        start, end = 1700000000, 1700001200
        await _advert(10, "cc" * 32, start - 1)
        await _advert(11, "dd" * 32, end)  # end is exclusive
        resp = await client.get(
            f"/api/packets/mesh-health/heard-bins?start_ts={start}&end_ts={end}&bin_count=2"
        )
        assert resp.status_code == 200
        assert all(b_["keys"] == [] for b_ in resp.json()["bins"])

    @pytest.mark.asyncio
    async def test_rejects_a_bad_window_and_bin_count(self, test_db, client):
        bad = await client.get("/api/packets/mesh-health/heard-bins?start_ts=10&end_ts=10")
        assert bad.status_code == 400
        too_many = await client.get(
            "/api/packets/mesh-health/heard-bins?start_ts=0&end_ts=100&bin_count=201"
        )
        assert too_many.status_code == 422

    @pytest.mark.asyncio
    async def test_counts_the_remainder_in_the_last_bin(self, test_db, client):
        # 1000 s over 3 bins: 333 s each; an advert at 999 s belongs to the last bin.
        start = 1700000000
        await _advert(20, "ee" * 32, start + 999)
        resp = await client.get(
            f"/api/packets/mesh-health/heard-bins?start_ts={start}&end_ts={start + 1000}&bin_count=3"
        )
        assert resp.status_code == 200
        bins = resp.json()["bins"]
        assert len(bins) == 3
        assert bins[2]["keys"] == ["ee" * 32]

    @pytest.mark.asyncio
    async def test_never_lists_more_bins_than_seconds(self, test_db, client):
        start = 1700000000
        resp = await client.get(
            f"/api/packets/mesh-health/heard-bins?start_ts={start}&end_ts={start + 5}&bin_count=40"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert all(b["start_ts"] < start + 5 for b in body["bins"])
