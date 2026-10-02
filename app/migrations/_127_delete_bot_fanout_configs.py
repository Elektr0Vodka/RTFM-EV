import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Delete bot fanout configs.

    The Python bot system (the ``bot`` fanout type) was removed from the fork,
    so ``fanout_configs`` rows with ``type = 'bot'`` can no longer run, be
    edited, or be validated. The fanout manager would only log them as an
    unknown type on every startup, so drop them. The bot code stored in those
    rows is not kept; a pre-upgrade database backup still has it.

    Idempotent: a second run deletes nothing; a missing table is a no-op.
    """
    tables_cursor = await conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='fanout_configs'"
    )
    if await tables_cursor.fetchone() is None:
        await conn.commit()
        return

    cursor = await conn.execute("DELETE FROM fanout_configs WHERE type = 'bot'")
    if cursor.rowcount:
        logger.info("Deleted %d bot fanout config(s); the bot system was removed", cursor.rowcount)

    await conn.commit()
