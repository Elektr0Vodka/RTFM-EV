"""GET /retention/stats and POST /retention/prune."""

import time

import pytest

from app.repository import AppSettingsRepository, MessageRepository
from app.repository.noise_floor import NoiseFloorRepository
from app.routers.retention import get_retention_stats, run_retention_prune
from app.services import retention_pruner

DAY = 86400


@pytest.fixture(autouse=True)
def _reset_state():
    retention_pruner._last_run_at = None
    retention_pruner._last_result = {}
    yield
    retention_pruner._last_run_at = None
    retention_pruner._last_result = {}


@pytest.mark.asyncio
async def test_stats_lists_every_class_before_first_run(test_db):
    await NoiseFloorRepository.insert(1234, -110)

    stats = await get_retention_stats(messages_days=None)

    keys = {c.key for c in stats.classes}
    assert {"raw_packets", "messages", "advert_paths", "noise_floor"} <= keys
    noise = next(c for c in stats.classes if c.key == "noise_floor")
    assert (noise.rows, noise.oldest_ts) == (1, 1234)
    assert stats.interval_hours == 24
    assert stats.last_run_at is None
    assert stats.next_run_at is None
    assert stats.messages_would_delete is None


@pytest.mark.asyncio
async def test_stats_previews_message_deletion(test_db):
    now = int(time.time())
    await MessageRepository.create(
        msg_type="CHAN", text="old", received_at=now - 40 * DAY, conversation_key="K"
    )
    await MessageRepository.create(
        msg_type="CHAN", text="new", received_at=now - DAY, conversation_key="K"
    )

    stats = await get_retention_stats(messages_days=30)

    assert stats.messages_would_delete == 1


@pytest.mark.asyncio
async def test_prune_now_runs_and_updates_status(test_db):
    now = int(time.time())
    await NoiseFloorRepository.insert(now - 40 * DAY, -110)
    await AppSettingsRepository.update(
        noise_floor_retention_days=30, retention_prune_interval_hours=6
    )

    result = await run_retention_prune()

    assert result.deleted["noise_floor"] == 1
    assert result.ran_at > 0
    stats = await get_retention_stats(messages_days=None)
    assert stats.last_run_at == result.ran_at
    assert stats.next_run_at == result.ran_at + 6 * 3600
    assert stats.last_result["noise_floor"] == 1
