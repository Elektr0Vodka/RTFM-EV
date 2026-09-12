import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add ``openhop_api_url`` and ``openhop_api_token`` to ``app_settings``.

    These hold the OpenHop REST API base URL and API token used by the opt-in
    OpenHop management surface (Surface B). Both are nullable and default unset;
    non-OpenHop deployments never populate them. Idempotent: skips any column
    that already exists.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in existing_tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    settings_columns = {row[1] for row in await col_cursor.fetchall()}
    if "openhop_api_url" not in settings_columns:
        await conn.execute("ALTER TABLE app_settings ADD COLUMN openhop_api_url TEXT")
    if "openhop_api_token" not in settings_columns:
        await conn.execute("ALTER TABLE app_settings ADD COLUMN openhop_api_token TEXT")

    await conn.commit()
