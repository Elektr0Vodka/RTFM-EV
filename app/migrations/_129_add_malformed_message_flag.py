import logging

import aiosqlite

logger = logging.getLogger(__name__)

_BACKFILL_COLUMNS = {
    "type",
    "outgoing",
    "txt_type",
    "text",
    "sender_name",
    "sender_timestamp",
    "received_at",
}


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add the malformed-message flag and the 'Hide malformed messages' setting.

    ``messages.malformed`` (INTEGER, default 0): set at ingest for an incoming
    channel text message that ``app.malformed`` flags (gibberish mixed-script
    text, or a sender clock still at the firmware default). Existing incoming
    channel text messages are backfilled with the same rule when the column is
    added; GRP_DATA placeholder rows are left alone, as they are at ingest.

    ``app_settings.hide_malformed`` (INTEGER, default 0): when on, flagged
    messages are hidden in chat and excluded from unread counts, mentions and
    Web Push. The default (off) preserves existing behavior.

    Idempotent: skips a column that already exists or a table that is absent,
    and only backfills in the run that adds the column.
    """
    from app.malformed import is_malformed_channel_message

    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    if "messages" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(messages)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if "malformed" not in columns:
            await conn.execute(
                "ALTER TABLE messages ADD COLUMN malformed INTEGER NOT NULL DEFAULT 0"
            )
            if columns >= _BACKFILL_COLUMNS:
                cursor = await conn.execute(
                    """
                    SELECT id, text, sender_name, sender_timestamp, received_at
                    FROM messages
                    WHERE type = 'CHAN' AND outgoing = 0 AND COALESCE(txt_type, 0) = 0
                    """
                )
                flagged: list[tuple[int]] = []
                for (
                    msg_id,
                    text,
                    sender_name,
                    sender_timestamp,
                    received_at,
                ) in await cursor.fetchall():
                    body = text or ""
                    prefix = f"{sender_name}: " if sender_name else ""
                    if prefix and body.startswith(prefix):
                        body = body[len(prefix) :]
                    if is_malformed_channel_message(body, sender_timestamp, received_at):
                        flagged.append((msg_id,))
                if flagged:
                    await conn.executemany(
                        "UPDATE messages SET malformed = 1 WHERE id = ?", flagged
                    )
                    logger.info("Flagged %d existing channel message(s) as malformed", len(flagged))

    if "app_settings" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        if "hide_malformed" not in {row[1] for row in await col_cursor.fetchall()}:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN hide_malformed INTEGER NOT NULL DEFAULT 0"
            )

    await conn.commit()
