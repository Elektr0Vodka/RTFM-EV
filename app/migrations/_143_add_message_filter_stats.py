import logging

import aiosqlite

logger = logging.getLogger(__name__)

_COLUMNS = (
    ("bot", "INTEGER NOT NULL DEFAULT 0"),
    ("malformed_reason", "TEXT"),
    ("spam_outcome", "TEXT"),
    ("spam_block", "TEXT"),
    ("spam_enforced", "INTEGER"),
    ("spam_label", "TEXT"),
)
_BACKFILL_COLUMNS = {"malformed", "text", "sender_name", "sender_timestamp", "received_at"}


async def migrate(conn: aiosqlite.Connection) -> None:
    """Per-message columns for the Mesh Health "Spam & bots" statistics.

    All on ``messages``, written for incoming channel messages only:

    ``bot`` (INTEGER, default 0): the sender was on an enabled bot list when
    the message arrived.

    ``malformed_reason`` (TEXT, NULL): why ``malformed`` is set: ``text``,
    ``clock`` or ``both`` (``app.malformed.malformed_reason``).

    ``spam_outcome`` (TEXT, NULL): what Spam Guard made of the message once it
    settled: ``clean``, ``stopped``, ``let_through`` or ``held``. NULL means
    not analysed (Spam Guard off, channel not protected, not settled yet, or
    older than this migration).

    ``spam_block`` (TEXT, NULL): the source of the block that caught it
    (``manual``, ``hop``, ``campaign``, ``dedupe``, ``rotation``, ``links``,
    ``lockdown``). NULL with a ``stopped`` or ``held`` outcome means the block
    had ended by the time the message settled.

    ``spam_enforced`` (INTEGER, NULL): 1 when Protect was really withholding
    forwards at that moment, 0 otherwise (Monitor, paused, backend not ready).

    ``spam_label`` (TEXT, NULL): the user's own answer on the message,
    ``spam`` or ``genuine``.

    Backfill: ``malformed_reason`` for rows already flagged, in the run that
    adds the column. A row whose flag today's tests no longer explain keeps
    NULL. Nothing else is backfilled: the lists, the blocks and the mode of
    that moment are not known.

    Idempotent: skips an absent table and columns that already exist.
    """
    from app.malformed import malformed_reason

    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "messages" in {row[0] for row in await tables_cursor.fetchall()}:
        col_cursor = await conn.execute("PRAGMA table_info(messages)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        backfill = "malformed_reason" not in columns and columns >= _BACKFILL_COLUMNS
        for name, declaration in _COLUMNS:
            if name not in columns:
                await conn.execute(f"ALTER TABLE messages ADD COLUMN {name} {declaration}")
        if backfill:
            cursor = await conn.execute(
                "SELECT id, text, sender_name, sender_timestamp, received_at "
                "FROM messages WHERE malformed = 1"
            )
            reasons: list[tuple[str, int]] = []
            for msg_id, text, sender_name, sender_timestamp, received_at in await cursor.fetchall():
                body = text or ""
                prefix = f"{sender_name}: " if sender_name else ""
                if prefix and body.startswith(prefix):
                    body = body[len(prefix) :]
                reason = malformed_reason(body, sender_timestamp, received_at)
                if reason is not None:
                    reasons.append((reason, msg_id))
            if reasons:
                await conn.executemany(
                    "UPDATE messages SET malformed_reason = ? WHERE id = ?", reasons
                )
                logger.info("Recorded the cause of %d malformed message(s)", len(reasons))

    await conn.commit()
