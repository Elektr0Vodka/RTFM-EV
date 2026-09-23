"""RetentionRepository: age prune, per-node caps, advert-path trim, message prune, stats."""

import time

import pytest

from app.models import CONTACT_TYPE_REPEATER
from app.repository import ContactRepository, MessageRepository
from app.repository.advert_events import AdvertEventRepository
from app.repository.airtime_history import AirtimeHistoryRepository
from app.repository.battery_history import BatteryHistoryRepository
from app.repository.contact_telemetry import ContactTelemetryRepository
from app.repository.contacts import ContactAdvertPathRepository
from app.repository.link_signal import LinkSignalRepository
from app.repository.noise_floor import NoiseFloorRepository
from app.repository.raw_packets import RawPacketRepository
from app.repository.repeater_telemetry import RepeaterTelemetryRepository
from app.repository.retention import AGE_TABLES, RetentionRepository

KEY_A = "aa" * 32
KEY_B = "bb" * 32
DAY = 86400


async def _contact(key: str) -> None:
    await ContactRepository.upsert(
        {"public_key": key, "name": key[:4], "type": CONTACT_TYPE_REPEATER}
    )


async def _count(conn_db, table: str) -> int:
    async with conn_db.readonly() as conn:
        async with conn.execute(f"SELECT COUNT(*) AS n FROM {table}") as cursor:
            row = await cursor.fetchone()
    return row["n"]


@pytest.mark.asyncio
async def test_prune_older_than_each_age_table(test_db):
    now = int(time.time())
    old, new = now - 40 * DAY, now - DAY
    await _contact(KEY_A)

    await RawPacketRepository.create(b"\x01old", old)
    await RawPacketRepository.create(b"\x02new", new)
    await AdvertEventRepository.record(
        transmission_id=1, public_key=KEY_A, timestamp=old, path_len=0, path_hex=""
    )
    await AdvertEventRepository.record(
        transmission_id=2, public_key=KEY_A, timestamp=new, path_len=0, path_hex=""
    )
    for ts in (old, new):
        await RepeaterTelemetryRepository.record(KEY_A, ts, {"v": ts})
        await ContactTelemetryRepository.record(KEY_A, ts, {"v": ts})
        await LinkSignalRepository.record_traffic_sample(
            observer_pubkey="self", subject_pubkey=KEY_A, snr=5.0, rssi=-80, observed_at=ts
        )
        await NoiseFloorRepository.insert(ts, -110)
        await BatteryHistoryRepository.insert(ts, 4100)
        await AirtimeHistoryRepository.insert(ts, 10, 20)

    cutoff = now - 30 * DAY
    for key in AGE_TABLES:
        if key == "messages":
            continue
        assert await RetentionRepository.prune_older_than(key, cutoff) == 1, key
        table = AGE_TABLES[key][0]
        assert await _count(test_db, table) == 1, key


@pytest.mark.asyncio
async def test_prune_older_than_rejects_unknown_and_messages(test_db):
    with pytest.raises(ValueError):
        await RetentionRepository.prune_older_than("contacts; DROP TABLE x", 0)
    with pytest.raises(ValueError):
        await RetentionRepository.prune_older_than("messages", 0)


@pytest.mark.asyncio
async def test_cap_rows_per_node_keeps_newest_per_node(test_db):
    await _contact(KEY_A)
    await _contact(KEY_B)
    for i in range(5):
        await RepeaterTelemetryRepository.record(KEY_A, 1000 + i, {"i": i})
    for i in range(2):
        await RepeaterTelemetryRepository.record(KEY_B, 1000 + i, {"i": i})

    deleted = await RetentionRepository.cap_rows_per_node("repeater_telemetry_history", 3)

    assert deleted == 2
    history_a = await RepeaterTelemetryRepository.get_history(KEY_A, 0)
    assert [row["timestamp"] for row in history_a] == [1002, 1003, 1004]
    assert len(await RepeaterTelemetryRepository.get_history(KEY_B, 0)) == 2


@pytest.mark.asyncio
async def test_cap_rows_per_node_rejects_other_tables(test_db):
    with pytest.raises(ValueError):
        await RetentionRepository.cap_rows_per_node("messages", 1)


@pytest.mark.asyncio
async def test_trim_advert_paths_keeps_most_recent_per_contact(test_db):
    await _contact(KEY_A)
    await _contact(KEY_B)
    for i, path in enumerate(("aa", "bb", "cc", "dd")):
        await ContactAdvertPathRepository.record_observation(KEY_A, path, 1000 + i)
    await ContactAdvertPathRepository.record_observation(KEY_B, "ee", 1000)

    deleted = await RetentionRepository.trim_advert_paths(2)

    assert deleted == 2
    paths_a = await ContactAdvertPathRepository.get_recent_for_contact(KEY_A, limit=10)
    assert sorted(p.path for p in paths_a) == ["cc", "dd"]
    assert len(await ContactAdvertPathRepository.get_recent_for_contact(KEY_B, limit=10)) == 1


@pytest.mark.asyncio
async def test_prune_messages_removes_linked_raw_packets_only(test_db):
    now = int(time.time())
    old, new = now - 40 * DAY, now - DAY
    old_msg = await MessageRepository.create(
        msg_type="CHAN", text="old message", received_at=old, conversation_key="K1"
    )
    new_msg = await MessageRepository.create(
        msg_type="CHAN", text="new message", received_at=new, conversation_key="K1"
    )
    linked_old, _ = await RawPacketRepository.create(b"\x10linked-old", old)
    linked_new, _ = await RawPacketRepository.create(b"\x11linked-new", new)
    unlinked_old, _ = await RawPacketRepository.create(b"\x12unlinked-old", old)
    await RawPacketRepository.mark_decrypted(linked_old, old_msg)
    await RawPacketRepository.mark_decrypted(linked_new, new_msg)

    assert await RetentionRepository.count_messages_older_than(now - 30 * DAY) == 1
    messages_deleted, raw_deleted = await RetentionRepository.prune_messages_older_than(
        now - 30 * DAY
    )

    assert (messages_deleted, raw_deleted) == (1, 1)
    assert await RawPacketRepository.get_by_id(linked_old) is None
    assert await RawPacketRepository.get_by_id(linked_new) is not None
    assert await RawPacketRepository.get_by_id(unlinked_old) is not None
    assert await _count(test_db, "messages") == 1


@pytest.mark.asyncio
async def test_stats_covers_every_class(test_db):
    await NoiseFloorRepository.insert(1234, -110)
    await NoiseFloorRepository.insert(2345, -111)

    stats = await RetentionRepository.stats()

    assert set(stats) == set(AGE_TABLES) | {"advert_paths"}
    assert stats["noise_floor"] == {"rows": 2, "oldest_ts": 1234}
    assert stats["messages"] == {"rows": 0, "oldest_ts": None}


@pytest.mark.asyncio
async def test_incremental_vacuum_runs(test_db):
    await RetentionRepository.incremental_vacuum()
