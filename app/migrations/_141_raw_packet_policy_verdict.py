import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Store the OpenHop policy verdict with a raw packet.

    ``raw_packets.policy_action`` (TEXT, NULL) and ``raw_packets.policy_rule``
    (TEXT, NULL): the policy rule that decides a packet on an OpenHop node, as
    worked out at ingest by ``app/services/policy_verdict.py`` (an indication,
    not the node's own verdict). ``policy_action`` is ``allow`` / ``drop`` /
    ``log_only``; ``policy_rule`` is the rule's name, NULL for a drop by the
    default action. Both NULL means no rule decided the packet, or the radio
    was not an OpenHop node. A packet is stored once, so this is the verdict
    of its first reception.

    Existing rows keep NULL: the policy of that moment is not known, so
    nothing is backfilled.

    The partial index keeps the Packet History "only packets a rule decided"
    filter from scanning the whole table.

    Idempotent: skips an absent table and columns that already exist.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "raw_packets" in {row[0] for row in await tables_cursor.fetchall()}:
        col_cursor = await conn.execute("PRAGMA table_info(raw_packets)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        for column in ("policy_action", "policy_rule"):
            if column not in columns:
                await conn.execute(f"ALTER TABLE raw_packets ADD COLUMN {column} TEXT")
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_raw_packets_policy "
            "ON raw_packets(id) WHERE policy_action IS NOT NULL"
        )

    await conn.commit()
