import logging

import aiosqlite

logger = logging.getLogger(__name__)

# Default of the new setting; kept here so the migration does not change if the
# app default does later.
_DEFAULT_MINUTES = 60
_BACKFILL_COLUMNS = {
    "type",
    "outgoing",
    "txt_type",
    "sender_timestamp",
    "received_at",
    "malformed",
    "malformed_reason",
}


async def migrate(conn: aiosqlite.Connection) -> None:
    """Flag channel messages from a sender clock running ahead as malformed.

    ``app_settings.malformed_clock_ahead_minutes`` (INTEGER, default 60): an
    incoming channel text message stamped more than this many minutes after it
    was received is flagged ``malformed`` with reason ``clock`` (``both`` when
    the text was already flagged). 0 turns the check off. Read at ingest, and
    stored messages are checked again when it changes
    (``app.services.malformed_clock``).

    Existing incoming channel text messages are backfilled with the default.
    Idempotent: skips a column that already exists or a table that is absent,
    and only backfills in the run that adds the column.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}
    if "app_settings" not in tables:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    if "malformed_clock_ahead_minutes" in {row[1] for row in await col_cursor.fetchall()}:
        await conn.commit()
        return
    await conn.execute(
        "ALTER TABLE app_settings ADD COLUMN malformed_clock_ahead_minutes "
        f"INTEGER NOT NULL DEFAULT {_DEFAULT_MINUTES}"
    )

    if "messages" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(messages)")
        if {row[1] for row in await col_cursor.fetchall()} >= _BACKFILL_COLUMNS:
            cursor = await conn.execute(
                """
                UPDATE messages
                SET malformed = 1,
                    malformed_reason = CASE
                        WHEN malformed_reason IN ('text', 'both') THEN 'both'
                        ELSE 'clock'
                    END
                WHERE type = 'CHAN' AND outgoing = 0 AND COALESCE(txt_type, 0) = 0
                  AND sender_timestamp IS NOT NULL
                  AND sender_timestamp - received_at > ?
                """,
                (_DEFAULT_MINUTES * 60,),
            )
            if cursor.rowcount:
                logger.info(
                    "Flagged %d existing channel message(s) with a clock ahead as malformed",
                    cursor.rowcount,
                )

    await conn.commit()
