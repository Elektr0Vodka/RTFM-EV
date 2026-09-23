import time
from dataclasses import dataclass

from app.database import db


@dataclass(frozen=True)
class StoredCommunity:
    """A joined community row. ``secret`` is sensitive: never log or list it."""

    id: str
    name: str
    secret: bytes
    created_at: int

    def __repr__(self) -> str:  # keep the secret out of logs and tracebacks
        return f"StoredCommunity(id={self.id!r}, name={self.name!r}, created_at={self.created_at})"


def _row_to_community(row) -> StoredCommunity:
    return StoredCommunity(
        id=row["id"],
        name=row["name"],
        secret=bytes(row["secret"]),
        created_at=row["created_at"],
    )


class CommunityRepository:
    @staticmethod
    async def insert(community_id: str, name: str, secret: bytes) -> bool:
        """Insert a community. Returns False when the ID already exists (row unchanged)."""
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT OR IGNORE INTO communities (id, name, secret, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (community_id.lower(), name, secret, int(time.time())),
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0

    @staticmethod
    async def get(community_id: str) -> StoredCommunity | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT id, name, secret, created_at FROM communities WHERE id = ?",
                (community_id.lower(),),
            ) as cursor:
                row = await cursor.fetchone()
        return _row_to_community(row) if row else None

    @staticmethod
    async def get_all() -> list[StoredCommunity]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT id, name, secret, created_at FROM communities ORDER BY name COLLATE NOCASE"
            ) as cursor:
                rows = await cursor.fetchall()
        return [_row_to_community(row) for row in rows]

    @staticmethod
    async def delete(community_id: str) -> bool:
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM communities WHERE id = ?", (community_id.lower(),)
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0
