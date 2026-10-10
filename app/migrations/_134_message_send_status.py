import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Persist the outcome of outgoing radio send commands.

    ``messages.send_status`` (TEXT, default ``'confirmed'``):

    - ``pending``: stored before the radio answered the send command.
    - ``confirmed``: the radio accepted the command (also every existing row
      and every incoming message).
    - ``unknown``: the radio never answered, so the message may or may not be
      on air. The row is kept instead of deleted; hearing the message echoed
      back (or an ACK) flips it to ``confirmed``.

    Idempotent: skips an absent table or a column that already exists.
    """
    table_cursor = await conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages'"
    )
    if await table_cursor.fetchone() is None:
        await conn.commit()
        return

    cursor = await conn.execute("PRAGMA table_info(messages)")
    columns = {row[1] for row in await cursor.fetchall()}
    if "send_status" not in columns:
        await conn.execute(
            "ALTER TABLE messages ADD COLUMN send_status TEXT NOT NULL DEFAULT 'confirmed'"
        )
    await conn.commit()
