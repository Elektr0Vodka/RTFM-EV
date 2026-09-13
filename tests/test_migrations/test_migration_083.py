"""Tests for database migration 083."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration083:
    """Test migration 083: add chat entity-parsing settings to app_settings."""

    @pytest.mark.asyncio
    async def test_adds_chat_entity_columns_with_defaults(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 82)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 82
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute(
                """
                SELECT chat_parse_pubkeys, chat_parse_coordinates,
                       chat_url_previews, chat_linkify_urls
                FROM app_settings WHERE id = 1
                """
            )
            row = await cursor.fetchone()
            # Parsing/previews default off; clickable links default on.
            assert row["chat_parse_pubkeys"] == 0
            assert row["chat_parse_coordinates"] == 0
            assert row["chat_url_previews"] == 0
            assert row["chat_linkify_urls"] == 1
        finally:
            await conn.close()
