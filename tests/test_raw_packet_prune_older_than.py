"""RawPacketRepository.prune_older_than deletes all rows older than a cutoff,
decrypted (message_id set) and undecrypted alike."""

import pytest

from app.repository.raw_packets import RawPacketRepository


async def _timestamps(test_db) -> list[int]:
    async with test_db.conn.execute("SELECT timestamp FROM raw_packets ORDER BY timestamp") as cur:
        return [r["timestamp"] for r in await cur.fetchall()]


@pytest.mark.asyncio
async def test_prune_older_than_deletes_all_rows_before_cutoff(test_db):
    # Two undecrypted rows (old + new).
    await RawPacketRepository.create(b"\x01old-undec", 1000)
    await RawPacketRepository.create(b"\x02new-undec", 2000)
    # An old row that is linked to a message (decrypted) must ALSO be pruned.
    # Disable FK enforcement for this synthetic link so we don't need a real message.
    await test_db.conn.execute("PRAGMA foreign_keys = OFF")
    await test_db.conn.execute(
        "UPDATE raw_packets SET message_id = 42 WHERE timestamp = 1000",
    )
    await test_db.conn.execute("PRAGMA foreign_keys = ON")
    await test_db.conn.commit()

    deleted = await RawPacketRepository.prune_older_than(1500)

    assert deleted == 1
    assert await _timestamps(test_db) == [2000]


@pytest.mark.asyncio
async def test_prune_older_than_noop_when_nothing_old(test_db):
    await RawPacketRepository.create(b"\x03recent", 5000)
    assert await RawPacketRepository.prune_older_than(1000) == 0
    assert await _timestamps(test_db) == [5000]
