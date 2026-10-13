"""Storage for filter profiles and the profile in use per kind (migration _147)."""

import json
import time
from typing import Any

from app.database import db

_COLUMNS = "id, kind, name, description, source, payload, created_at, updated_at"


def _row(row: Any) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload"])
    except ValueError:
        payload = {}
    return {
        "id": int(row["id"]),
        "kind": row["kind"],
        "name": row["name"],
        "description": row["description"],
        "source": row["source"],
        # The kind validates the shape; storage only promises an object.
        "payload": payload if isinstance(payload, dict) else {},
        "created_at": int(row["created_at"]),
        "updated_at": int(row["updated_at"]),
    }


class FilterProfileRepository:
    """Saved filter profiles and which one is in use per kind."""

    @staticmethod
    async def list_kind(kind: str) -> list[dict[str, Any]]:
        """Every profile of one kind, by name."""
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM filter_profiles WHERE kind = ? "
                "ORDER BY name COLLATE NOCASE, id",
                (kind,),
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row(row) for row in rows]

    @staticmethod
    async def get(profile_id: int) -> dict[str, Any] | None:
        async with db.readonly() as conn:
            async with conn.execute(
                f"SELECT {_COLUMNS} FROM filter_profiles WHERE id = ?", (profile_id,)
            ) as cursor:
                row = await cursor.fetchone()
        return None if row is None else _row(row)

    @staticmethod
    async def count(kind: str) -> int:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT COUNT(*) AS n FROM filter_profiles WHERE kind = ?", (kind,)
            ) as cursor:
                row = await cursor.fetchone()
        return int(row["n"]) if row is not None else 0

    @staticmethod
    async def create(
        kind: str, name: str, description: str, source: str, payload: dict[str, Any]
    ) -> int:
        now = int(time.time())
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO filter_profiles "
                "(kind, name, description, source, payload, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (kind, name, description, source, json.dumps(payload, sort_keys=True), now, now),
            ) as cursor:
                new_id = cursor.lastrowid
        if new_id is None:
            raise RuntimeError("filter profile insert returned no id")
        return int(new_id)

    @staticmethod
    async def update(
        profile_id: int,
        *,
        name: str | None = None,
        description: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Set what is given; None leaves a column as it is."""
        fields: dict[str, Any] = {}
        if name is not None:
            fields["name"] = name
        if description is not None:
            fields["description"] = description
        if payload is not None:
            fields["payload"] = json.dumps(payload, sort_keys=True)
        if not fields:
            return
        fields["updated_at"] = int(time.time())
        assignments = ", ".join(f"{column} = ?" for column in fields)
        async with db.tx() as conn:
            async with conn.execute(
                f"UPDATE filter_profiles SET {assignments} WHERE id = ?",
                (*fields.values(), profile_id),
            ):
                pass

    @staticmethod
    async def delete(profile_id: int) -> None:
        """Delete a profile. If it was in use, nothing is in use afterwards."""
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM filter_profile_in_use WHERE profile_id = ?", (profile_id,)
            ):
                pass
            async with conn.execute("DELETE FROM filter_profiles WHERE id = ?", (profile_id,)):
                pass

    @staticmethod
    async def in_use(kind: str) -> int | None:
        """Id of the profile in use for this kind, if it still exists."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT u.profile_id FROM filter_profile_in_use u "
                "JOIN filter_profiles p ON p.id = u.profile_id AND p.kind = u.kind "
                "WHERE u.kind = ?",
                (kind,),
            ) as cursor:
                row = await cursor.fetchone()
        return None if row is None else int(row["profile_id"])

    @staticmethod
    async def set_in_use(kind: str, profile_id: int) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO filter_profile_in_use (kind, profile_id) VALUES (?, ?) "
                "ON CONFLICT(kind) DO UPDATE SET profile_id = excluded.profile_id",
                (kind, profile_id),
            ):
                pass
