"""link_signal persistence: migration, repository, capture sites, endpoint."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import Contact
from app.repository.link_signal import LinkSignalRepository

LSR = LinkSignalRepository

REP = "aa" * 32
SELF = "bb" * 32


def _repeater_contact(pubkey: str) -> Contact:
    return Contact(public_key=pubkey, name="Rep", type=2)


class TestLinkSignalTable:
    @pytest.mark.asyncio
    async def test_table_exists_after_migrations(self, test_db):
        async with test_db.readonly() as conn:
            async with conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='link_signal'"
            ) as cur:
                row = await cur.fetchone()
        assert row is not None


class TestLinkSignalRepository:
    @pytest.mark.asyncio
    async def test_record_repeater_samples_row_per_neighbor(self, test_db):
        await LinkSignalRepository.record_repeater_samples(
            REP,
            [
                {"pubkey": "11223344", "snr": 7.25, "secs_ago": 30},
                {"pubkey": "55667788", "snr": -3.0, "secs_ago": 90},
            ],
            observed_at=1700000000,
        )
        rows = await LinkSignalRepository.get_repeater_history(REP, since=0)
        assert len(rows) == 2
        by_subject = {r["subject_pubkey"]: r for r in rows}
        assert by_subject["11223344"]["snr"] == 7.25
        assert by_subject["11223344"]["secs_ago"] == 30

    @pytest.mark.asyncio
    async def test_record_repeater_samples_empty_noop(self, test_db):
        await LinkSignalRepository.record_repeater_samples(REP, [], observed_at=1700000000)
        assert await LinkSignalRepository.get_repeater_history(REP, since=0) == []

    @pytest.mark.asyncio
    async def test_get_repeater_history_window(self, test_db):
        await LinkSignalRepository.record_repeater_samples(
            REP, [{"pubkey": "11223344", "snr": 1.0, "secs_ago": 1}], observed_at=1000
        )
        await LinkSignalRepository.record_repeater_samples(
            REP, [{"pubkey": "11223344", "snr": 2.0, "secs_ago": 1}], observed_at=5000
        )
        rows = await LinkSignalRepository.get_repeater_history(REP, since=2000)
        assert [r["snr"] for r in rows] == [2.0]

    @pytest.mark.asyncio
    async def test_record_and_match_traffic_sample(self, test_db):
        # subject full key starts with the repeater neighbour prefix "11223344"
        full = "11223344" + "cc" * 28
        await LinkSignalRepository.record_traffic_sample(
            SELF, full, snr=4.5, rssi=-80, observed_at=1700000000
        )
        rows = await LinkSignalRepository.get_traffic_history_for_subjects(
            ["11223344"], since=0
        )
        assert len(rows) == 1
        assert rows[0]["snr"] == 4.5
        assert rows[0]["rssi"] == -80
        # unrelated prefix returns nothing
        assert await LinkSignalRepository.get_traffic_history_for_subjects(["99999999"], 0) == []

    @pytest.mark.asyncio
    async def test_traffic_sample_requires_snr(self, test_db):
        await LinkSignalRepository.record_traffic_sample(
            SELF, "11223344" + "cc" * 28, snr=None, rssi=-80, observed_at=1700000000
        )
        assert await LinkSignalRepository.get_traffic_history_for_subjects(["11223344"], 0) == []

    @pytest.mark.asyncio
    async def test_prune_deletes_only_old(self, test_db):
        now = int(time.time())
        await LinkSignalRepository.record_repeater_samples(
            REP, [{"pubkey": "11223344", "snr": 1.0, "secs_ago": 1}], observed_at=now
        )
        await LinkSignalRepository.record_repeater_samples(
            REP, [{"pubkey": "55667788", "snr": 1.0, "secs_ago": 1}],
            observed_at=now - 40 * 86400,
        )
        deleted = await LinkSignalRepository.prune(older_than_days=30)
        assert deleted == 1
        rows = await LinkSignalRepository.get_repeater_history(REP, since=0)
        assert [r["subject_pubkey"] for r in rows] == ["11223344"]


class TestCaptureSiteEndpoint:
    @pytest.mark.asyncio
    async def test_neighbors_endpoint_persists_snapshot(self, test_db):
        from app.routers import repeaters

        rep_key = "cc" * 32
        neighbours = {
            "neighbours_count": 1,
            "neighbours": [{"pubkey": "11223344", "snr": 6.5, "secs_ago": 12}],
        }

        mc = MagicMock()
        mc.commands.fetch_all_neighbours = AsyncMock(return_value=neighbours)

        class _Op:
            async def __aenter__(self):
                return mc

            async def __aexit__(self, *a):
                return False

        with (
            patch.object(repeaters.radio_manager, "require_connected", MagicMock()),
            patch.object(
                repeaters.radio_manager, "radio_operation", MagicMock(return_value=_Op())
            ),
            patch.object(
                repeaters,
                "_resolve_contact_or_404",
                AsyncMock(return_value=_repeater_contact(rep_key)),
            ),
            patch.object(repeaters, "_ensure_on_radio", AsyncMock()),
            patch.object(
                repeaters.ContactRepository, "get_by_key_prefix", AsyncMock(return_value=None)
            ),
        ):
            await repeaters.repeater_neighbors(rep_key)

        rows = await LSR.get_repeater_history(rep_key, since=0)
        assert len(rows) == 1
        assert rows[0]["subject_pubkey"] == "11223344"
        assert rows[0]["snr"] == 6.5


class TestHistoryEndpoint:
    @pytest.mark.asyncio
    async def test_history_joins_both_perspectives(self, test_db):
        from app.routers import repeaters

        rep_key = "dd" * 32
        self_key = "ee" * 32
        full_neighbor = "11223344" + "ff" * 28
        now = int(time.time())

        await LSR.record_repeater_samples(
            rep_key, [{"pubkey": "11223344", "snr": 5.0, "secs_ago": 10}],
            observed_at=now - 120,
        )
        await LSR.record_traffic_sample(
            self_key, full_neighbor, snr=-2.0, rssi=-95, observed_at=now - 60
        )

        with patch.object(
            repeaters,
            "_resolve_contact_or_404",
            AsyncMock(return_value=_repeater_contact(rep_key)),
        ):
            resp = await repeaters.repeater_neighbor_history(rep_key, since_hours=720)

        assert len(resp.neighbors) == 1
        entry = resp.neighbors[0]
        assert entry.neighbor_pubkey == "11223344"
        assert [s.snr for s in entry.repeater_samples] == [5.0]
        assert [s.snr for s in entry.self_samples] == [-2.0]
        assert entry.self_samples[0].rssi == -95

    @pytest.mark.asyncio
    async def test_history_empty(self, test_db):
        from app.routers import repeaters

        rep_key = "ab" * 32
        with patch.object(
            repeaters,
            "_resolve_contact_or_404",
            AsyncMock(return_value=_repeater_contact(rep_key)),
        ):
            resp = await repeaters.repeater_neighbor_history(rep_key, since_hours=720)
        assert resp.neighbors == []


class TestCaptureSiteCycle:
    @pytest.mark.asyncio
    async def test_collect_persists_neighbor_samples(self, test_db):
        import app.radio_sync as rs

        rep_key = "ba" * 32
        contact = _repeater_contact(rep_key)

        mc = MagicMock()
        mc.commands.fetch_all_neighbours = AsyncMock(
            return_value={
                "neighbours_count": 1,
                "neighbours": [{"pubkey": "aabbccdd", "snr": 3.0, "secs_ago": 5}],
            }
        )

        await rs._collect_repeater_neighbor_signal(mc, contact)

        rows = await LSR.get_repeater_history(rep_key, since=0)
        assert [r["subject_pubkey"] for r in rows] == ["aabbccdd"]


class TestCaptureSiteTraffic:
    @pytest.mark.asyncio
    async def test_zero_hop_advert_persists_traffic_sample(self, test_db):
        import app.packet_processor as pp

        subject = "12" * 32
        await pp._maybe_record_traffic_signal(
            subject_pubkey=subject, path_length=0, rssi=-70, snr=8.0,
            timestamp=int(time.time()),
        )
        rows = await LSR.get_traffic_history_for_subjects([subject[:8]], since=0)
        assert len(rows) == 1
        assert rows[0]["snr"] == 8.0
        assert rows[0]["rssi"] == -70

    @pytest.mark.asyncio
    async def test_multi_hop_advert_not_persisted(self, test_db):
        import app.packet_processor as pp

        subject = "34" * 32
        await pp._maybe_record_traffic_signal(
            subject_pubkey=subject, path_length=2, rssi=-70, snr=8.0, timestamp=1700000000
        )
        assert await LSR.get_traffic_history_for_subjects([subject[:8]], since=0) == []
