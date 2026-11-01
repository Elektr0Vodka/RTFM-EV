"""Tests for migration 166: wardrive last login and audit log."""

import aiosqlite

from app.migrations import get_version, run_migrations, set_version
from app.migrations._162_create_wardrive_tables import migrate as migrate_162
from app.migrations._166_add_wardrive_audit import migrate
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


async def _columns(conn: aiosqlite.Connection, table: str) -> set[str]:
    cursor = await conn.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in await cursor.fetchall()}


async def test_adds_last_login_and_the_audit_table():
    async with aiosqlite.connect(":memory:") as conn:
        await migrate_162(conn)
        await conn.execute(
            "INSERT INTO wardrive_users (username, password_hash, created_at) VALUES ('a', 'x', 1)"
        )
        await set_version(conn, 165)
        assert await run_migrations(conn) == LATEST_SCHEMA_VERSION - 165
        assert await get_version(conn) == LATEST_SCHEMA_VERSION
        assert "last_login_at" in await _columns(conn, "wardrive_users")
        cursor = await conn.execute("SELECT last_login_at FROM wardrive_users")
        assert (await cursor.fetchone())[0] is None
        assert await _columns(conn, "wardrive_audit") == {
            "id",
            "at",
            "actor_kind",
            "actor_id",
            "action",
            "target_kind",
            "target_id",
            "detail",
        }


async def test_idempotent():
    async with aiosqlite.connect(":memory:") as conn:
        await migrate_162(conn)
        await migrate(conn)
        await migrate(conn)
        assert "last_login_at" in await _columns(conn, "wardrive_users")
