"""Tests for migration 143: the fleet asset register."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration143:
    @pytest.mark.asyncio
    async def test_creates_the_table_with_its_defaults(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 142)

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 142
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            await conn.execute(
                "INSERT INTO fleet_assets (label, created_at, updated_at) VALUES ('Spare', 1, 1)"
            )
            row = await (await conn.execute("SELECT * FROM fleet_assets")).fetchone()
            assert row["status"] == "in_stock"
            for column in (
                "public_key",
                "org_serial",
                "hw_serial",
                "model",
                "role",
                "wifi_mac",
                "ble_mac",
                "assigned_to",
                "site_name",
                "notes",
            ):
                assert row[column] is None
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_public_key_is_unique_but_may_be_absent_many_times(self):
        from app.migrations._143_create_fleet_assets import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            insert = (
                "INSERT INTO fleet_assets (public_key, created_at, updated_at) VALUES (?, 1, 1)"
            )
            await conn.execute(insert, (None,))
            await conn.execute(insert, (None,))
            await conn.execute(insert, ("ab" * 32,))
            with pytest.raises(aiosqlite.IntegrityError):
                await conn.execute(insert, ("ab" * 32,))
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._143_create_fleet_assets import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await migrate(conn)
        finally:
            await conn.close()
