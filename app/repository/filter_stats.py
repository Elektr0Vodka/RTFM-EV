"""Reads for the Mesh Health "Spam & bots" statistics (``app/services/filter_stats.py``)."""

import asyncio
from collections.abc import Iterable
from typing import Any

from app.database import db
from app.services.filter_stats import MessageRow, first_hop


def _message_rows(rows: Iterable[Any]) -> list[MessageRow]:
    return [
        MessageRow(
            id=row["id"],
            received_at=row["received_at"],
            channel=row["conversation_key"],
            sender_name=row["sender_name"],
            sender_key=row["sender_key"],
            first_hop=first_hop(row["paths"]),
            spam=bool(row["spam"]),
            malformed=bool(row["malformed"]),
            duplicate=bool(row["duplicate"]),
            bot=bool(row["bot"]),
            malformed_reason=row["malformed_reason"],
            spam_outcome=row["spam_outcome"],
            spam_block=row["spam_block"],
            spam_enforced=None if row["spam_enforced"] is None else bool(row["spam_enforced"]),
            spam_label=row["spam_label"],
        )
        for row in rows
    ]


_ROWS_SQL = """
    SELECT id, received_at, conversation_key, sender_name, sender_key, paths,
           spam, malformed, duplicate, bot, malformed_reason,
           spam_outcome, spam_block, spam_enforced, spam_label
    FROM messages
    WHERE type = 'CHAN' AND received_at >= ? AND received_at < ?
      AND outgoing = 0 AND COALESCE(txt_type, 0) = 0
"""


class FilterStatsRepository:
    @staticmethod
    async def window_rows(
        start_ts: int, end_ts: int, channel: str | None = None
    ) -> list[MessageRow]:
        """Incoming channel text messages in ``[start_ts, end_ts)``, oldest first.

        GRP_DATA placeholder rows are left out, as the malformed filter leaves
        them out. The range uses ``idx_messages_type_received_conversation``.
        """
        sql = _ROWS_SQL
        params: list[int | str] = [start_ts, end_ts]
        if channel:
            sql += " AND conversation_key = ?"
            params.append(channel)
        sql += " ORDER BY received_at, id"
        async with db.readonly() as conn:
            async with conn.execute(sql, params) as cursor:
                rows = await cursor.fetchall()
        # Measured at over a second for 100,000 rows (a JSON parse each): in a
        # thread, so the radio and the WebSocket clients are not held up.
        return await asyncio.to_thread(_message_rows, rows)

    @staticmethod
    async def bot_attribution() -> tuple[dict[str, list[str]], dict[str, list[str]]]:
        """Which enabled bot lists name a sender: by name, and by public key.

        Names on the exception list are left out, as in the effective set.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT e.name, e.public_key, l.name AS list_name "
                "FROM bot_list_entries e JOIN bot_lists l ON l.id = e.list_id "
                "WHERE l.enabled = 1 AND e.name NOT IN (SELECT name FROM bot_exceptions) "
                "ORDER BY l.name"
            ) as cursor:
                rows = await cursor.fetchall()
        names: dict[str, list[str]] = {}
        keys: dict[str, list[str]] = {}
        for row in rows:
            for table, value in ((names, row["name"]), (keys, row["public_key"])):
                if value and row["list_name"] not in table.setdefault(value, []):
                    table[value].append(row["list_name"])
        return names, keys

    @staticmethod
    async def channel_names() -> dict[str, str]:
        async with db.readonly() as conn:
            async with conn.execute("SELECT key, name FROM channels") as cursor:
                rows = await cursor.fetchall()
        return {row["key"]: row["name"] for row in rows}

    @staticmethod
    async def policy_rules(start_ts: int, end_ts: int) -> list[dict[str, Any]]:
        """Packets an OpenHop policy rule decided in the window, per action and rule.

        ``raw_packets.policy_action`` / ``policy_rule`` (migration _141): the
        verdict worked out at ingest, an indication, not the node's own.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT policy_action AS action, policy_rule AS rule, COUNT(*) AS packets "
                "FROM raw_packets "
                "WHERE policy_action IS NOT NULL AND timestamp >= ? AND timestamp < ? "
                "GROUP BY policy_action, policy_rule "
                "ORDER BY packets DESC, policy_action, policy_rule",
                (start_ts, end_ts),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {"action": row["action"], "rule": row["rule"], "packets": row["packets"]}
            for row in rows
        ]
