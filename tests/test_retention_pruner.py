"""retention_pruner applies every per-class retention setting."""

import time

import pytest

from app.models import CONTACT_TYPE_REPEATER
from app.repository import AppSettingsRepository, ContactRepository, MessageRepository
from app.repository.advert_events import AdvertEventRepository
from app.repository.airtime_history import AirtimeHistoryRepository
from app.repository.battery_history import BatteryHistoryRepository
from app.repository.contact_telemetry import ContactTelemetryRepository
from app.repository.contacts import ContactAdvertPathRepository
from app.repository.link_signal import LinkSignalRepository
from app.repository.noise_floor import NoiseFloorRepository
from app.repository.raw_packets import RawPacketRepository
from app.repository.repeater_telemetry import RepeaterTelemetryRepository
from app.repository.retention import RetentionRepository
from app.services import retention_pruner

KEY = "cc" * 32
DAY = 86400


@pytest.fixture(autouse=True)
def _reset_state():
    retention_pruner._last_run_at = None
    retention_pruner._last_result = {}
    yield
    retention_pruner._last_run_at = None
    retention_pruner._last_result = {}


async def _seed_old_and_new(now: int) -> None:
    """One 40-day-old and one 1-day-old row in every age-pruned table."""
    await ContactRepository.upsert({"public_key": KEY, "name": "R", "type": CONTACT_TYPE_REPEATER})
    old, new = now - 40 * DAY, now - DAY
    for i, ts in enumerate((old, new)):
        await RawPacketRepository.create(bytes([0x20 + i]) + b"raw", ts)
        await AdvertEventRepository.record(
            transmission_id=500 + i, public_key=KEY, timestamp=ts, path_len=0, path_hex=""
        )
        await RepeaterTelemetryRepository.record(KEY, ts, {"i": i})
        await ContactTelemetryRepository.record(KEY, ts, {"i": i})
        await LinkSignalRepository.record_traffic_sample(
            observer_pubkey="self", subject_pubkey=KEY, snr=4.0, rssi=-90, observed_at=ts
        )
        await NoiseFloorRepository.insert(ts, -110)
        await BatteryHistoryRepository.insert(ts, 4000)
        await AirtimeHistoryRepository.insert(ts, 1, 2)
        await MessageRepository.create(
            msg_type="CHAN", text=f"message {i}", received_at=ts, conversation_key="K"
        )


@pytest.mark.asyncio
async def test_defaults_reproduce_previous_caps(test_db):
    now = int(time.time())
    await _seed_old_and_new(now)

    result = await retention_pruner.prune_once(now)

    # Previously pruned at 30 days: advert events, telemetry, link signal.
    assert result["advert_events"] == 1
    assert result["repeater_telemetry"] == 1
    assert result["contact_telemetry"] == 1
    assert result["link_signal"] == 1
    # Previously never pruned (defaults 0 = keep forever).
    stats = await RetentionRepository.stats()
    for key in ("raw_packets", "noise_floor", "battery", "airtime", "messages"):
        assert key not in result, key
        assert stats[key]["rows"] == 2, key


@pytest.mark.asyncio
async def test_default_row_cap_is_1000_per_node(test_db):
    now = int(time.time())
    await ContactRepository.upsert({"public_key": KEY, "name": "R", "type": CONTACT_TYPE_REPEATER})
    for i in range(1001):
        await RepeaterTelemetryRepository.record(KEY, now - 1001 + i, {"i": i})

    # Inserts no longer prune; the service enforces the cap on its run.
    assert len(await RepeaterTelemetryRepository.get_history(KEY, 0)) == 1001
    result = await retention_pruner.prune_once(now)

    assert result["repeater_telemetry"] == 1
    history = await RepeaterTelemetryRepository.get_history(KEY, 0)
    assert len(history) == 1000
    assert history[0]["timestamp"] == now - 1000


@pytest.mark.asyncio
async def test_zero_keeps_everything(test_db):
    now = int(time.time())
    await _seed_old_and_new(now)
    await AppSettingsRepository.update(
        advert_retention_days=0,
        telemetry_retention_days=0,
        telemetry_max_rows_per_node=0,
        link_signal_retention_days=0,
    )

    result = await retention_pruner.prune_once(now)

    assert sum(result.values()) == 0
    stats = await RetentionRepository.stats()
    for key in ("advert_events", "repeater_telemetry", "contact_telemetry", "link_signal"):
        assert stats[key]["rows"] == 2, key


@pytest.mark.asyncio
async def test_configured_values_prune_every_class(test_db):
    now = int(time.time())
    await _seed_old_and_new(now)
    await AppSettingsRepository.update(
        raw_packet_retention_days=30,
        noise_floor_retention_days=30,
        battery_retention_days=30,
        airtime_retention_days=30,
        message_retention_days=30,
    )

    result = await retention_pruner.prune_once(now)

    for key in ("raw_packets", "noise_floor", "battery", "airtime", "messages"):
        assert result[key] == 1, key
    stats = await RetentionRepository.stats()
    assert stats["messages"]["rows"] == 1


@pytest.mark.asyncio
async def test_advert_paths_trimmed_to_setting(test_db):
    await ContactRepository.upsert({"public_key": KEY, "name": "R", "type": CONTACT_TYPE_REPEATER})
    for i, path in enumerate(("aa", "bb", "cc")):
        await ContactAdvertPathRepository.record_observation(KEY, path, 1000 + i)
    await AppSettingsRepository.update(advert_paths_per_contact=1)

    result = await retention_pruner.prune_once()

    assert result["advert_paths"] == 2


@pytest.mark.asyncio
async def test_one_failing_class_does_not_block_others(test_db, monkeypatch):
    now = int(time.time())
    await _seed_old_and_new(now)
    original = RetentionRepository.prune_older_than

    async def flaky(key, cutoff):
        if key == "advert_events":
            raise RuntimeError("boom")
        return await original(key, cutoff)

    monkeypatch.setattr(RetentionRepository, "prune_older_than", staticmethod(flaky))

    result = await retention_pruner.prune_once(now)

    assert "advert_events" not in result
    assert result["link_signal"] == 1


@pytest.mark.asyncio
async def test_status_and_is_due(test_db):
    assert retention_pruner.is_due(1000, 24) is True
    await retention_pruner.prune_once(now=1_000_000)

    status = retention_pruner.status()
    assert status["last_run_at"] == 1_000_000
    assert retention_pruner.is_due(1_000_000 + 23 * 3600, 24) is False
    assert retention_pruner.is_due(1_000_000 + 24 * 3600, 24) is True
    assert retention_pruner.is_due(1_000_000 + 3600, 1) is True


@pytest.mark.asyncio
async def test_prunes_old_link_edge_events(test_db):
    now = 10 * DAY
    async with test_db.tx() as conn:
        for pid, ts in ((1, now - 5 * DAY), (2, now - 1 * DAY)):
            await conn.execute(
                "INSERT INTO link_edge_events (raw_packet_id, ts, a_pubkey, b_pubkey, "
                "hop_width, confidence) VALUES (?, ?, 'a', 'b', 1, 'unique')",
                (pid, ts),
            )
    await AppSettingsRepository.update(link_edge_retention_days=2)
    result = await retention_pruner.prune_once(now)
    assert result.get("link_edges") == 1
    async with test_db.readonly() as conn:
        async with conn.execute("SELECT raw_packet_id FROM link_edge_events") as cur:
            assert [r[0] for r in await cur.fetchall()] == [2]
