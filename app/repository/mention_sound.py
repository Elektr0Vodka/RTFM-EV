import time

from app.database import db


class MentionSoundRepository:
    """Single-row (id=1) store for the user's custom mention sound (BLOB)."""

    @staticmethod
    async def get() -> dict | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT data, content_type, filename, size_bytes, updated_at "
                "FROM mention_sound WHERE id = 1"
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "data": bytes(row["data"]),
            "content_type": row["content_type"],
            "filename": row["filename"],
            "size_bytes": row["size_bytes"],
            "updated_at": row["updated_at"],
        }

    @staticmethod
    async def set(data: bytes, content_type: str, filename: str) -> dict:
        updated_at = int(time.time())
        size_bytes = len(data)
        async with db.tx() as conn:
            await conn.execute(
                """
                INSERT INTO mention_sound (id, data, content_type, filename, size_bytes, updated_at)
                VALUES (1, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    data = excluded.data,
                    content_type = excluded.content_type,
                    filename = excluded.filename,
                    size_bytes = excluded.size_bytes,
                    updated_at = excluded.updated_at
                """,
                (data, content_type, filename, size_bytes, updated_at),
            )
        return {
            "content_type": content_type,
            "filename": filename,
            "size_bytes": size_bytes,
            "updated_at": updated_at,
        }

    @staticmethod
    async def delete() -> None:
        async with db.tx() as conn:
            await conn.execute("DELETE FROM mention_sound WHERE id = 1")
