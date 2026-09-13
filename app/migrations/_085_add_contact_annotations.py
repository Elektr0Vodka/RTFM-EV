import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add user-editable annotation columns to ``contacts``.

    ``notes`` and ``owner_info`` are free text. ``owner_key`` is a 64-char hex
    pointer to another contact (the operator's companion node). ``manual_lat`` /
    ``manual_lon`` are fallback coordinates used only when the contact has no
    valid advertised location. All are user-set and must survive radio sync.
    Idempotent: skips columns that already exist.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "contacts" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(contacts)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    additions = (
        ("notes", "TEXT"),
        ("owner_info", "TEXT"),
        ("owner_key", "TEXT"),
        ("manual_lat", "REAL"),
        ("manual_lon", "REAL"),
    )
    for name, coltype in additions:
        if name not in columns:
            await conn.execute(f"ALTER TABLE contacts ADD COLUMN {name} {coltype}")

    await conn.commit()
