"""Storage for bot lists, their entries and the exceptions (migration _142)."""

import time
from typing import Any

from app.database import db

_UPDATABLE = frozenset(
    {"name", "description", "enabled", "block_forward", "file_updated", "fetched_at", "last_error"}
)
_SELECT_LISTS = """
    SELECT id, name, description, source, url, enabled, block_forward,
           file_updated, fetched_at, last_error, created_at,
           (SELECT COUNT(*) FROM bot_list_entries e WHERE e.list_id = bot_lists.id)
               AS entry_count,
           (SELECT COUNT(*) FROM bot_list_entries e
             WHERE e.list_id = bot_lists.id AND e.forward_reviewed = 0
               AND e.name NOT IN (SELECT name FROM bot_exceptions))
               AS review_count
    FROM bot_lists
"""


def _list_row(row: Any) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "description": row["description"],
        "source": row["source"],
        "url": row["url"],
        "enabled": bool(row["enabled"]),
        "block_forward": bool(row["block_forward"]),
        "file_updated": row["file_updated"],
        "fetched_at": row["fetched_at"],
        "last_error": row["last_error"],
        "created_at": int(row["created_at"]),
        "entry_count": int(row["entry_count"]),
        # Names a refresh added that the user has not confirmed yet.
        "review_count": int(row["review_count"]),
    }


class BotListRepository:
    """Bot lists, their entries and the names that are never a bot."""

    @staticmethod
    async def list_all() -> list[dict[str, Any]]:
        """Every list with its entry count; the shipped list first, then by name."""
        async with db.readonly() as conn:
            async with conn.execute(
                _SELECT_LISTS + " ORDER BY CASE source WHEN 'shipped' THEN 0 ELSE 1 END,"
                " name COLLATE NOCASE, id"
            ) as cursor:
                rows = await cursor.fetchall()
        return [_list_row(row) for row in rows]

    @staticmethod
    async def get(list_id: int) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(_SELECT_LISTS + " WHERE id = ?", (list_id,)) as cursor:
                row = await cursor.fetchone()
        return None if row is None else _list_row(row)

    @staticmethod
    async def get_shipped() -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                _SELECT_LISTS + " WHERE source = 'shipped' ORDER BY id LIMIT 1"
            ) as cursor:
                row = await cursor.fetchone()
        return None if row is None else _list_row(row)

    @staticmethod
    async def find_by_url(url: str) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                _SELECT_LISTS + " WHERE source = 'url' AND url = ? ORDER BY id LIMIT 1", (url,)
            ) as cursor:
                row = await cursor.fetchone()
        return None if row is None else _list_row(row)

    @staticmethod
    async def count_by_source(source: str) -> int:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT COUNT(*) AS n FROM bot_lists WHERE source = ?", (source,)
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["n"]) if row is not None else 0

    @staticmethod
    async def due_url_lists(fetched_before: int) -> list[dict[str, Any]]:
        """Subscriptions never fetched, or last fetched at or before ``fetched_before``."""
        async with db.readonly() as conn:
            async with conn.execute(
                _SELECT_LISTS + " WHERE source = 'url' AND (fetched_at IS NULL OR fetched_at <= ?)"
                " ORDER BY fetched_at IS NOT NULL, fetched_at, id",
                (fetched_before,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [_list_row(row) for row in rows]

    @staticmethod
    async def create(name: str, description: str, source: str, url: str | None = None) -> int:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO bot_lists (name, description, source, url, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (name, description, source, url, int(time.time())),
            ) as cursor:
                new_id = cursor.lastrowid
        if new_id is None:
            raise RuntimeError("bot list insert returned no id")
        return int(new_id)

    @staticmethod
    async def update(list_id: int, fields: dict[str, Any]) -> None:
        """Set the given columns. A value of None clears the column."""
        unknown = set(fields) - _UPDATABLE
        if unknown:
            raise ValueError(f"not an updatable bot list field: {sorted(unknown)}")
        if not fields:
            return
        assignments = ", ".join(f"{column} = ?" for column in fields)
        async with db.tx() as conn:
            async with conn.execute(
                f"UPDATE bot_lists SET {assignments} WHERE id = ?",
                (*fields.values(), list_id),
            ):
                pass

    @staticmethod
    async def delete(list_id: int) -> None:
        async with db.tx() as conn:
            async with conn.execute("DELETE FROM bot_list_entries WHERE list_id = ?", (list_id,)):
                pass
            async with conn.execute("DELETE FROM bot_lists WHERE id = ?", (list_id,)):
                pass

    @staticmethod
    async def entries(list_id: int) -> list[dict[str, Any]]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT name, public_key, note, forward_reviewed FROM bot_list_entries "
                "WHERE list_id = ? ORDER BY name COLLATE NOCASE, name",
                (list_id,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {
                "name": row["name"],
                "public_key": row["public_key"],
                "note": row["note"],
                "forward_reviewed": bool(row["forward_reviewed"]),
            }
            for row in rows
        ]

    @staticmethod
    async def replace_entries(list_id: int, entries: list[dict[str, Any]]) -> None:
        async with db.tx() as conn:
            async with conn.execute("DELETE FROM bot_list_entries WHERE list_id = ?", (list_id,)):
                pass
            await conn.executemany(
                "INSERT INTO bot_list_entries (list_id, name, public_key, note) "
                "VALUES (?, ?, ?, ?)",
                [(list_id, e["name"], e.get("public_key"), e.get("note")) for e in entries],
            )

    @staticmethod
    async def apply_refresh(list_id: int, entries: list[dict[str, Any]]) -> tuple[int, int]:
        """Make the stored entries those of a fetched file, by name.

        A name already stored keeps its ``forward_reviewed`` and takes key and
        note from the file. A name that is new gets ``forward_reviewed = 0``. A
        name no longer in the file is removed. Returns ``(added, removed)``.

        A list that was deleted while its file was being fetched gets nothing:
        its rows would belong to no list.
        """
        async with db.tx() as conn:
            async with conn.execute("SELECT 1 FROM bot_lists WHERE id = ?", (list_id,)) as cursor:
                if await cursor.fetchone() is None:
                    return 0, 0
            async with conn.execute(
                "SELECT name FROM bot_list_entries WHERE list_id = ?", (list_id,)
            ) as cursor:
                stored = {row["name"] for row in await cursor.fetchall()}
            wanted = {entry["name"] for entry in entries}
            gone = stored - wanted
            await conn.executemany(
                "DELETE FROM bot_list_entries WHERE list_id = ? AND name = ?",
                [(list_id, name) for name in gone],
            )
            await conn.executemany(
                "UPDATE bot_list_entries SET public_key = ?, note = ? "
                "WHERE list_id = ? AND name = ?",
                [
                    (e.get("public_key"), e.get("note"), list_id, e["name"])
                    for e in entries
                    if e["name"] in stored
                ],
            )
            await conn.executemany(
                "INSERT INTO bot_list_entries (list_id, name, public_key, note, forward_reviewed) "
                "VALUES (?, ?, ?, ?, 0)",
                [
                    (list_id, e["name"], e.get("public_key"), e.get("note"))
                    for e in entries
                    if e["name"] not in stored
                ],
            )
        return len(wanted - stored), len(gone)

    @staticmethod
    async def add_entry(list_id: int, name: str, public_key: str | None, note: str | None) -> None:
        """Add one entry. For a name already there, only missing details are filled in."""
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO bot_list_entries (list_id, name, public_key, note) "
                "VALUES (?, ?, ?, ?) "
                "ON CONFLICT(list_id, name) DO UPDATE SET "
                "public_key = COALESCE(bot_list_entries.public_key, excluded.public_key), "
                "note = COALESCE(bot_list_entries.note, excluded.note)",
                (list_id, name, public_key, note),
            ):
                pass

    @staticmethod
    async def enabled_entries(*, without: int | None = None) -> list[tuple[str, str | None]]:
        """(name, public key) of every entry in an enabled list.

        ``without`` leaves one list out: what the others hold, for judging a
        change that replaces that list's names.
        """
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT e.name, e.public_key FROM bot_list_entries e "
                "JOIN bot_lists l ON l.id = e.list_id WHERE l.enabled = 1 "
                "AND (? IS NULL OR l.id != ?) ORDER BY e.name, l.id",
                (without, without),
            ) as cursor:
                rows = await cursor.fetchall()
        return [(row["name"], row["public_key"]) for row in rows]

    @staticmethod
    async def forward_names() -> list[str]:
        """Reviewed names of every list that is enabled and blocks forwards."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT DISTINCT e.name FROM bot_list_entries e "
                "JOIN bot_lists l ON l.id = e.list_id "
                "WHERE l.enabled = 1 AND l.block_forward = 1 AND e.forward_reviewed = 1 "
                "ORDER BY e.name"
            ) as cursor:
                rows = await cursor.fetchall()
        return [row["name"] for row in rows]

    @staticmethod
    async def set_reviewed(list_id: int, names: list[str]) -> int:
        """Mark these names of one list as reviewed. Returns how many changed."""
        changed = 0
        async with db.tx() as conn:
            for name in names:
                async with conn.execute(
                    "UPDATE bot_list_entries SET forward_reviewed = 1 "
                    "WHERE list_id = ? AND name = ? AND forward_reviewed = 0",
                    (list_id, name),
                ) as cursor:
                    changed += cursor.rowcount
        return changed

    @staticmethod
    async def exceptions() -> list[str]:
        async with db.readonly() as conn:
            async with conn.execute("SELECT name FROM bot_exceptions ORDER BY name") as cursor:
                rows = await cursor.fetchall()
        return [row["name"] for row in rows]

    @staticmethod
    async def set_exceptions(names: list[str]) -> None:
        async with db.tx() as conn:
            async with conn.execute("DELETE FROM bot_exceptions"):
                pass
            await conn.executemany(
                "INSERT OR IGNORE INTO bot_exceptions (name) VALUES (?)",
                [(name,) for name in names],
            )
