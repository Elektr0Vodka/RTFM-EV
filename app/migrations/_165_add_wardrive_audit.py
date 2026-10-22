import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Wardrive management (``MESHCORE_WARDRIVE``): the last login per user and
    an audit log of what drivers and the owner did (logins, registrations,
    radios, user and group changes, password sets, drive edits). No passwords,
    tokens or packet data go in it; the log keeps its newest 10000 rows.
    Idempotent."""
    cursor = await conn.execute("PRAGMA table_info(wardrive_users)")
    columns = {row[1] for row in await cursor.fetchall()}
    if "last_login_at" not in columns:
        await conn.execute("ALTER TABLE wardrive_users ADD COLUMN last_login_at INTEGER")
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wardrive_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            at INTEGER NOT NULL,
            actor_kind TEXT NOT NULL,
            actor_id INTEGER,
            action TEXT NOT NULL,
            target_kind TEXT,
            target_id TEXT,
            detail TEXT
        )
        """
    )
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_wardrive_audit_at ON wardrive_audit (at)")
    await conn.commit()
