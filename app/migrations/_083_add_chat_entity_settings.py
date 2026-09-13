import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add chat entity-parsing settings to ``app_settings``.

    - chat_parse_pubkeys (default off): parse 64-hex public keys in chat.
    - chat_parse_coordinates (default off): parse GPS coordinates into cards.
    - chat_url_previews (default off): fetch OpenGraph previews for URLs.
    - chat_linkify_urls (default on): render URLs as clickable links.

    Idempotent: each column is added only if absent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in existing_tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    settings_columns = {row[1] for row in await col_cursor.fetchall()}

    additions = [
        ("chat_parse_pubkeys", "INTEGER NOT NULL DEFAULT 0"),
        ("chat_parse_coordinates", "INTEGER NOT NULL DEFAULT 0"),
        ("chat_url_previews", "INTEGER NOT NULL DEFAULT 0"),
        ("chat_linkify_urls", "INTEGER NOT NULL DEFAULT 1"),
    ]
    for name, decl in additions:
        if name not in settings_columns:
            await conn.execute(f"ALTER TABLE app_settings ADD COLUMN {name} {decl}")

    await conn.commit()
