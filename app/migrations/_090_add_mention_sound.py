import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add mention/DM notification-sound settings.

    - ``mention_sound_enabled`` (0/1, default off): master switch.
    - ``mention_sound_choice`` (default 'beep'): preset id or the literal 'custom'.
    - ``mention_sound_volume`` (0..100, default 80).
    - ``mention_sound`` table: single-row (id=1) BLOB store for a user-uploaded
      custom sound plus its metadata.

    Idempotent: guards the table and each column before adding.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    if "app_settings" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if "mention_sound_enabled" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN mention_sound_enabled INTEGER NOT NULL DEFAULT 0"
            )
        if "mention_sound_choice" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN mention_sound_choice TEXT NOT NULL DEFAULT 'beep'"
            )
        if "mention_sound_volume" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN mention_sound_volume INTEGER NOT NULL DEFAULT 80"
            )

    if "mention_sound" not in tables:
        await conn.execute(
            """
            CREATE TABLE mention_sound (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data BLOB NOT NULL,
                content_type TEXT NOT NULL,
                filename TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )

    await conn.commit()
