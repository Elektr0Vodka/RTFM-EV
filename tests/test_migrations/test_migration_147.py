"""Tests for migration 147: the filter library tables."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration147:
    @pytest.mark.asyncio
    async def test_creates_the_tables(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 146)
            await conn.commit()

            assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 146
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            await conn.execute(
                "INSERT INTO filter_profiles (kind, name, source, payload, created_at, updated_at) "
                "VALUES ('spam_guard', 'Spam wave', 'local', '{}', 1, 1)"
            )
            await conn.execute(
                "INSERT INTO filter_profile_in_use (kind, profile_id) VALUES ('spam_guard', 1)"
            )
            row = await (await conn.execute("SELECT * FROM filter_profiles")).fetchone()
            assert (row["id"], row["description"]) == (1, "")

            # One profile in use per kind.
            with pytest.raises(aiosqlite.IntegrityError):
                await conn.execute(
                    "INSERT INTO filter_profile_in_use (kind, profile_id) VALUES ('spam_guard', 2)"
                )
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._147_create_filter_profiles import migrate

        conn = await aiosqlite.connect(":memory:")
        try:
            await migrate(conn)
            await migrate(conn)
        finally:
            await conn.close()
