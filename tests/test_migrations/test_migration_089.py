"""Tests for database migration 089: raw_packets decoded stat columns + backfill."""

import aiosqlite
import pytest

from app.decoder import parse_packet
from app.migrations import get_version, run_migrations, set_version
from app.services.packet_decoded_fields import decoded_stat_fields
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


def _raw_packets_ddl() -> str:
    # Mirrors the pre-089 raw_packets shape (post-065 signal columns).
    return """
        CREATE TABLE raw_packets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            data BLOB NOT NULL,
            message_id INTEGER,
            payload_hash BLOB,
            rssi INTEGER,
            snr REAL,
            payload_type TEXT
        )
    """


class TestMigration089:
    @pytest.mark.asyncio
    async def test_adds_columns_and_backfills(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 88)
            await conn.execute(_raw_packets_ddl())
            # A DIRECT (0x02) TRACE (0x09) packet with a 2-hop, 1-byte-wide path.
            packet = bytes([0x26, 0x02, 0xAA, 0xBB, 0x00])
            await conn.execute(
                "INSERT INTO raw_packets (timestamp, data) VALUES (?, ?)",
                (1700000000, packet),
            )
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 88
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(raw_packets)")
            cols = {row[1] for row in await cursor.fetchall()}
            assert {"route_type", "hop_count", "hop_byte_width", "path_signature"} <= cols

            # Backfill matches the same derivation used at ingest.
            expected = decoded_stat_fields(parse_packet(packet))
            async with conn.execute(
                "SELECT route_type, hop_count, hop_byte_width, path_signature FROM raw_packets"
            ) as cur:
                row = await cur.fetchone()
            assert row["route_type"] == expected["route_type"]
            assert row["hop_count"] == expected["hop_count"]
            assert row["hop_byte_width"] == expected["hop_byte_width"]
            assert row["path_signature"] == expected["path_signature"]
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_skips_when_raw_packets_absent(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 88)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 88
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
        finally:
            await conn.close()
