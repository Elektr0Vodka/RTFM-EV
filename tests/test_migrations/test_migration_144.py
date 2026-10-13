"""Tests for migrations 144-146: fleet log, health settings and the key vault tables."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _migrated_from_143() -> aiosqlite.Connection:
    from app.migrations._143_create_fleet_assets import migrate as create_assets

    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys = ON")
    await create_assets(conn)
    await set_version(conn, 143)
    assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 143
    assert await get_version(conn) == LATEST_SCHEMA_VERSION
    await conn.execute(
        "INSERT INTO fleet_assets (label, created_at, updated_at) VALUES ('Spare', 1, 1)"
    )
    return conn


class TestMigration144:
    @pytest.mark.asyncio
    async def test_log_rows_go_with_their_asset(self):
        conn = await _migrated_from_143()
        try:
            await conn.execute(
                "INSERT INTO fleet_asset_events (asset_id, kind, occurred_at, created_at) "
                "VALUES (1, 'note', 5, 5)"
            )
            row = await (await conn.execute("SELECT * FROM fleet_asset_events")).fetchone()
            assert (row["summary"], row["from_value"], row["to_value"]) == (None, None, None)

            await conn.execute("DELETE FROM fleet_assets WHERE id = 1")
            left = await (await conn.execute("SELECT COUNT(*) FROM fleet_asset_events")).fetchone()
            assert left[0] == 0
        finally:
            await conn.close()


class TestMigration145:
    @pytest.mark.asyncio
    async def test_adds_the_column_and_one_settings_row(self):
        conn = await _migrated_from_143()
        try:
            asset = await (
                await conn.execute("SELECT target_firmware FROM fleet_assets")
            ).fetchone()
            assert asset["target_firmware"] is None
            rows = await (await conn.execute("SELECT * FROM fleet_settings")).fetchall()
            assert [(r["id"], r["silent_hours"], r["low_battery_volts"]) for r in rows] == [
                (1, 48, 3.5)
            ]
            with pytest.raises(aiosqlite.IntegrityError):
                await conn.execute("INSERT INTO fleet_settings (id) VALUES (2)")
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_is_idempotent_and_keeps_saved_settings(self):
        from app.migrations._145_fleet_health_settings import migrate

        conn = await _migrated_from_143()
        try:
            await conn.execute("UPDATE fleet_settings SET silent_hours = 12")
            await migrate(conn)
            row = await (await conn.execute("SELECT silent_hours FROM fleet_settings")).fetchone()
            assert row[0] == 12
        finally:
            await conn.close()


class TestMigration146:
    @pytest.mark.asyncio
    async def test_an_asset_with_a_secret_cannot_be_deleted(self):
        conn = await _migrated_from_143()
        try:
            await conn.execute(
                "INSERT INTO fleet_secrets (asset_id, kind, nonce, ciphertext, created_at, "
                "updated_at) VALUES (1, 'other', x'00', x'00', 1, 1)"
            )
            with pytest.raises(aiosqlite.IntegrityError):
                await conn.execute("DELETE FROM fleet_assets WHERE id = 1")
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_only_one_vault_row_and_an_audit_table(self):
        conn = await _migrated_from_143()
        try:
            insert = (
                "INSERT INTO fleet_vault (id, kdf_opslimit, kdf_memlimit, salt, key_nonce, "
                "wrapped_key, created_at, updated_at) VALUES (?, 1, 1, x'00', x'00', x'00', 1, 1)"
            )
            await conn.execute(insert, (1,))
            with pytest.raises(aiosqlite.IntegrityError):
                await conn.execute(insert, (2,))
            await conn.execute("INSERT INTO fleet_audit (ts, action) VALUES (1, 'vault_created')")
        finally:
            await conn.close()
