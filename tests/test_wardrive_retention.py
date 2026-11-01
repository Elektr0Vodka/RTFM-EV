"""Wardrive data follows its own retention setting."""

from __future__ import annotations

from app.repository import AppSettingsRepository
from app.repository.retention import RetentionRepository
from app.repository.wardrive import WardriveDataRepository, WardriveUserRepository
from app.routers.settings import AppSettingsUpdate, update_settings
from app.services import retention_pruner
from app.wardrive.models import Obs, Track
from tests.wardrive_helpers import make_radio, obs, track

DAY = 86400
NOW = 1792404000  # 2026-10-19T10:00:00Z


def _iso(ts: int) -> str:
    from datetime import UTC, datetime

    return datetime.fromtimestamp(ts, UTC).isoformat().replace("+00:00", "Z")


async def _seed() -> None:
    uid = await WardriveUserRepository.create("mike", "x", now=1)
    _, pk = make_radio()
    for ts in (NOW - 31 * DAY, NOW - DAY):
        await WardriveDataRepository.insert_obs(uid, pk, [Obs(**obs(pk, _iso(ts)))], NOW)
        await WardriveDataRepository.insert_tracks(uid, pk, [Track(**track(pk, _iso(ts)))], NOW)


async def _counts(test_db) -> tuple[int, int]:
    async with test_db.readonly() as conn:
        out = []
        for table in ("wardrive_obs", "wardrive_tracks"):
            async with conn.execute(f"SELECT COUNT(*) FROM {table}") as cur:
                out.append((await cur.fetchone())[0])
    return out[0], out[1]


async def test_setting_defaults_to_keep_forever(test_db):
    assert (await AppSettingsRepository.get()).wardrive_retention_days == 0


async def test_setting_saved_through_router(test_db):
    saved = await update_settings(AppSettingsUpdate(wardrive_retention_days=30))
    assert saved.wardrive_retention_days == 30
    assert (await AppSettingsRepository.get()).wardrive_retention_days == 30


async def test_prune_removes_old_wardrive_rows(test_db):
    await _seed()
    await AppSettingsRepository.update(wardrive_retention_days=30)
    result = await retention_pruner.prune_once(now=NOW)
    assert result["wardrive_obs"] == 1
    assert result["wardrive_tracks"] == 1
    assert await _counts(test_db) == (1, 1)


async def test_zero_keeps_everything(test_db):
    await _seed()
    await retention_pruner.prune_once(now=NOW)
    assert await _counts(test_db) == (2, 2)


async def test_stats_lists_wardrive_classes(test_db):
    await _seed()
    stats = await RetentionRepository.stats()
    assert stats["wardrive_obs"] == {"rows": 2, "oldest_ts": NOW - 31 * DAY}
    assert stats["wardrive_tracks"]["rows"] == 2
