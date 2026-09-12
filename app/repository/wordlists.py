import time
from pathlib import Path

from app.config import settings
from app.database import db


def wordlists_dir() -> Path:
    """Directory holding uploaded wordlist files, alongside the SQLite DB.

    Derived from ``settings.database_path`` so it follows the configured data
    dir (default ``data/``). Created on demand.
    """
    directory = Path(settings.database_path).parent / "wordlists"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


class WordlistRepository:
    """User-uploaded wordlists: metadata in ``wordlists``, words on disk."""

    @staticmethod
    async def list_all() -> list[dict]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT id, name, entry_count, size_bytes, created_at "
                "FROM wordlists ORDER BY created_at DESC, id DESC"
            ) as cursor:
                rows = await cursor.fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    async def create(name: str, words: list[str]) -> dict:
        content = ("\n".join(words) + "\n") if words else ""
        size_bytes = len(content.encode("utf-8"))
        created_at = int(time.time())
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO wordlists (name, filename, entry_count, size_bytes, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (name, "", len(words), size_bytes, created_at),
            ) as cursor:
                new_id = cursor.lastrowid
            filename = f"{new_id}.txt"
            await conn.execute("UPDATE wordlists SET filename = ? WHERE id = ?", (filename, new_id))
        # File write happens after the row commits; a missing file later reads as [].
        (wordlists_dir() / filename).write_text(content, encoding="utf-8")
        return {
            "id": new_id,
            "name": name,
            "entry_count": len(words),
            "size_bytes": size_bytes,
            "created_at": created_at,
        }

    @staticmethod
    async def get(wordlist_id: int) -> dict | None:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT id, name, filename, entry_count, size_bytes, created_at "
                "FROM wordlists WHERE id = ?",
                (wordlist_id,),
            ) as cursor:
                row = await cursor.fetchone()
        return dict(row) if row else None

    @staticmethod
    async def read_words(wordlist_id: int) -> list[str] | None:
        meta = await WordlistRepository.get(wordlist_id)
        if meta is None:
            return None
        path = wordlists_dir() / meta["filename"]
        if not path.exists():
            return []
        text = path.read_text(encoding="utf-8")
        return [line for line in text.splitlines() if line]

    @staticmethod
    async def delete(wordlist_id: int) -> bool:
        meta = await WordlistRepository.get(wordlist_id)
        if meta is None:
            return False
        async with db.tx() as conn:
            await conn.execute("DELETE FROM wordlists WHERE id = ?", (wordlist_id,))
        path = wordlists_dir() / meta["filename"]
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        return True
