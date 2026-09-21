"""Tests for database migration 101: relabel REQUEST packets stored as Unknown."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


def _raw_packets_ddl() -> str:
    return """
        CREATE TABLE raw_packets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            data BLOB NOT NULL,
            payload_type TEXT
        )
    """


# header 0x01 -> route FLOOD, payload_type REQUEST(0); zero-hop path byte; one
# payload byte. Decodes to REQUEST - the type the ingest bug mislabelled.
_REQUEST_PACKET = bytes.fromhex("0100aa")
# header 0x11 -> payload_type ADVERT(4); same framing. Decodes to ADVERT.
_ADVERT_PACKET = bytes.fromhex("1100aa")
# Too short to parse (len < 2): stays genuinely Unknown.
_MALFORMED = b"\xff"


class TestMigration101:
    @pytest.mark.asyncio
    async def test_relabels_only_mislabelled_requests(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 100)
            await conn.execute(_raw_packets_ddl())
            await conn.executemany(
                "INSERT INTO raw_packets (id, timestamp, data, payload_type) VALUES (?, ?, ?, ?)",
                [
                    (1, 100, _REQUEST_PACKET, "Unknown"),  # mislabelled -> REQUEST
                    (2, 101, _MALFORMED, "Unknown"),  # unparseable -> stays Unknown
                    (3, 102, _ADVERT_PACKET, "ADVERT"),  # correctly labelled -> untouched
                ],
            )
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 100
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            async with conn.execute("SELECT id, payload_type FROM raw_packets ORDER BY id") as cur:
                rows = {row["id"]: row["payload_type"] for row in await cur.fetchall()}
            assert rows == {1: "REQUEST", 2: "Unknown", 3: "ADVERT"}
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 100)
            await conn.execute(_raw_packets_ddl())
            await conn.execute(
                "INSERT INTO raw_packets (id, timestamp, data, payload_type) VALUES (?, ?, ?, ?)",
                (1, 100, _REQUEST_PACKET, "Unknown"),
            )
            await conn.commit()

            await run_migrations(conn)
            # Re-running the migration body must not touch the already-fixed row.
            from app.migrations import _101_backfill_request_payload_type as mig

            await mig.migrate(conn)

            async with conn.execute("SELECT payload_type FROM raw_packets WHERE id = 1") as cur:
                row = await cur.fetchone()
            assert row["payload_type"] == "REQUEST"
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_raw_packets_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 100)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 100
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
