"""Tests for migration 149: fleet config documents and templates."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _migrated_from_148() -> aiosqlite.Connection:
    from app.migrations._143_create_fleet_assets import migrate as create_assets

    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys = ON")
    await create_assets(conn)
    await set_version(conn, 148)
    assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 148
    assert await get_version(conn) == LATEST_SCHEMA_VERSION
    await conn.execute(
        "INSERT INTO fleet_assets (label, created_at, updated_at) VALUES ('Spare', 1, 1)"
    )
    return conn


_INSERT_CONFIG = (
    "INSERT INTO fleet_configs (asset_id, kind, source, profile, document, created_at) "
    "VALUES (?, 'snapshot', 'file', 'stock', '{\"vars\": {}}', 5)"
)


class TestMigration149:
    @pytest.mark.asyncio
    async def test_configs_go_with_their_asset(self):
        conn = await _migrated_from_148()
        try:
            await conn.execute(_INSERT_CONFIG, (1,))
            row = await (await conn.execute("SELECT * FROM fleet_configs")).fetchone()
            assert (row["role"], row["firmware_version"], row["label"]) == (None, None, None)

            await conn.execute("DELETE FROM fleet_assets WHERE id = 1")
            left = await (await conn.execute("SELECT COUNT(*) FROM fleet_configs")).fetchone()
            assert left[0] == 0
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_a_config_needs_an_existing_asset(self):
        conn = await _migrated_from_148()
        try:
            with pytest.raises(aiosqlite.IntegrityError):
                await conn.execute(_INSERT_CONFIG, (99,))
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_templates_stand_alone(self):
        conn = await _migrated_from_148()
        try:
            await conn.execute(
                "INSERT INTO fleet_config_templates (name, profile, document, created_at, "
                "updated_at) VALUES ('Base', 'stock', '{\"vars\": {}}', 1, 1)"
            )
            row = await (await conn.execute("SELECT * FROM fleet_config_templates")).fetchone()
            assert (row["description"], row["role"], row["variables"]) == (None, None, "[]")
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent(self):
        from app.migrations._149_create_fleet_configs import migrate

        conn = await _migrated_from_148()
        try:
            await conn.execute(_INSERT_CONFIG, (1,))
            await migrate(conn)
            left = await (await conn.execute("SELECT COUNT(*) FROM fleet_configs")).fetchone()
            assert left[0] == 1
        finally:
            await conn.close()
