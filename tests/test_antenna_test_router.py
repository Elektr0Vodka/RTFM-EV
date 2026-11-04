"""Tests for the antenna test runs router and its report."""

import pytest

from app.antenna_test_report import (
    AntennaTestAttempt,
    AntennaTestNodeResult,
    node_stats,
    run_summary,
)

KEY_A = "aa" * 32
KEY_B = "BB" * 32


def _run(**overrides) -> dict:
    body = {
        "antenna": "  5.8 dBi collinear ",
        "notes": "roof mast",
        "radio_public_key": "cc" * 32,
        "radio_name": "Base",
        "traces_per_node": 3,
        "started_at": 1_000,
        "finished_at": 1_060,
        "results": [
            {
                "public_key": KEY_A,
                "name": "Repeater A",
                "distance_km": 4.2,
                "attempts": [
                    {"replied": True, "remote_snr": 6.0, "local_snr": 4.0},
                    {"replied": True, "remote_snr": 8.0, "local_snr": 2.0},
                    {"replied": False},
                ],
            },
            {
                "public_key": KEY_B,
                "name": "Repeater B",
                "distance_km": None,
                "attempts": [{"replied": False}, {"replied": False}, {"replied": False}],
            },
        ],
    }
    body.update(overrides)
    return body


class TestReport:
    def test_node_stats_use_replied_attempts_only(self):
        stats = node_stats(
            AntennaTestNodeResult(
                public_key=KEY_A,
                attempts=[
                    AntennaTestAttempt(replied=True, remote_snr=6.0, local_snr=4.0),
                    AntennaTestAttempt(replied=True, remote_snr=8.0, local_snr=2.0),
                    AntennaTestAttempt(replied=False, remote_snr=-20.0),
                ],
            )
        )
        assert stats.attempts == 3
        assert stats.replies == 2
        assert stats.reply_rate == pytest.approx(0.6667)
        assert (stats.remote_snr.avg, stats.remote_snr.min, stats.remote_snr.max) == (7.0, 6.0, 8.0)
        assert (stats.local_snr.avg, stats.local_snr.min, stats.local_snr.max) == (3.0, 2.0, 4.0)

    def test_node_without_replies_has_no_snr(self):
        stats = node_stats(
            AntennaTestNodeResult(public_key=KEY_A, attempts=[AntennaTestAttempt(replied=False)])
        )
        assert stats.replies == 0
        assert stats.reply_rate == 0.0
        assert stats.remote_snr.avg is None
        assert stats.local_snr.avg is None

    def test_run_summary_totals(self):
        results = [AntennaTestNodeResult.model_validate(r) for r in _run()["results"]]
        summary = run_summary(results)
        assert summary.nodes == 2
        assert summary.nodes_replied == 1
        assert summary.attempts == 6
        assert summary.replies == 2
        assert summary.reply_rate == pytest.approx(0.3333)
        assert summary.remote_snr_avg == 7.0
        assert summary.local_snr_avg == 3.0


class TestRouter:
    @pytest.mark.asyncio
    async def test_save_returns_report_and_lists(self, test_db, client):
        resp = await client.post("/api/antenna-tests", json=_run())
        assert resp.status_code == 200
        saved = resp.json()
        assert saved["antenna"] == "5.8 dBi collinear"
        assert saved["summary"]["replies"] == 2
        assert [n["public_key"] for n in saved["nodes"]] == [KEY_A, KEY_B.lower()]
        assert saved["nodes"][0]["remote_snr"]["avg"] == 7.0

        listed = (await client.get("/api/antenna-tests")).json()
        assert [run["id"] for run in listed] == [saved["id"]]
        assert "nodes" not in listed[0]
        assert listed[0]["summary"]["nodes_replied"] == 1

        detail = (await client.get(f"/api/antenna-tests/{saved['id']}")).json()
        assert detail == saved

    @pytest.mark.asyncio
    async def test_list_newest_first(self, test_db, client):
        old = (await client.post("/api/antenna-tests", json=_run(antenna="old"))).json()
        new = (
            await client.post(
                "/api/antenna-tests",
                json=_run(antenna="new", started_at=2_000, finished_at=2_100),
            )
        ).json()
        listed = (await client.get("/api/antenna-tests")).json()
        assert [run["id"] for run in listed] == [new["id"], old["id"]]

    @pytest.mark.asyncio
    async def test_delete(self, test_db, client):
        saved = (await client.post("/api/antenna-tests", json=_run())).json()
        resp = await client.delete(f"/api/antenna-tests/{saved['id']}")
        assert resp.status_code == 200
        assert resp.json() == {"deleted": True}
        assert (await client.get(f"/api/antenna-tests/{saved['id']}")).status_code == 404
        assert (await client.delete(f"/api/antenna-tests/{saved['id']}")).status_code == 404

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("overrides", "status"),
        [
            ({"antenna": "   "}, 422),
            ({"results": []}, 422),
            ({"traces_per_node": 0}, 422),
            ({"traces_per_node": 11}, 422),
            ({"traces_per_node": 2}, 400),
            ({"started_at": 5_000, "finished_at": 4_000}, 400),
            ({"results": [{"public_key": "abc", "attempts": []}]}, 422),
        ],
    )
    async def test_rejects_bad_runs(self, test_db, client, overrides, status):
        resp = await client.post("/api/antenna-tests", json=_run(**overrides))
        assert resp.status_code == status
        assert (await client.get("/api/antenna-tests")).json() == []
