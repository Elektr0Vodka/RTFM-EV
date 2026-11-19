"""Export for original Remote Terminal (upstream 3.17.1 schema)."""

import sqlite3

import pytest

from app.routers.backup import download_upstream_export
from app.services.upstream_export import (
    _SCHEMA_FILE,
    UPSTREAM_SCHEMA_VERSION,
    build_upstream_db,
)


def _schema(conn: sqlite3.Connection) -> dict[tuple[str, str], str]:
    return {
        (kind, name): sql
        for kind, name, sql in conn.execute(
            "SELECT type, name, sql FROM sqlite_master "
            "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
        )
    }


def _reference_schema() -> dict[tuple[str, str], str]:
    ref = sqlite3.connect(":memory:")
    ref.executescript(_SCHEMA_FILE.read_text(encoding="utf-8"))
    schema = _schema(ref)
    ref.close()
    return schema


@pytest.mark.asyncio
async def test_fork_schema_keeps_every_upstream_column_unchanged(test_db):
    """A fork migration that changes an upstream column would break the export."""
    ref = sqlite3.connect(":memory:")
    ref.executescript(_SCHEMA_FILE.read_text(encoding="utf-8"))
    tables = [r[0] for r in ref.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    for table in tables:
        if table.startswith("sqlite_"):
            continue
        upstream_cols = {r[1]: r[2:] for r in ref.execute(f'PRAGMA table_info("{table}")')}
        cursor = await test_db.conn.execute(f'PRAGMA table_info("{table}")')
        fork_cols = {r[1]: tuple(r)[2:] for r in await cursor.fetchall()}
        for name, spec in upstream_cols.items():
            assert fork_cols.get(name) == spec, f"{table}.{name}"
    ref.close()


@pytest.mark.asyncio
async def test_download_upstream_export(test_db):
    async with test_db.tx() as conn:
        await conn.execute(
            "INSERT INTO messages (type, conversation_key, text, received_at, malformed) "
            "VALUES ('CHAN', 'abc', 'hidden here, shown upstream', 100, 1)"
        )
        await conn.execute(
            "INSERT INTO contacts (public_key, name) VALUES (?, 'Alice')", ("ab" * 32,)
        )

    response = await download_upstream_export()
    assert response.filename.startswith("remoteterm-upstream-3.17.1-")
    assert response.filename.endswith(".db")

    out = sqlite3.connect(response.path)
    try:
        assert out.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert out.execute("PRAGMA user_version").fetchone()[0] == UPSTREAM_SCHEMA_VERSION == 63
        # Exactly upstream's tables, columns and indexes: no fork-only leftovers.
        assert _schema(out) == _reference_schema()
        # Every row is kept, including ones the fork hides.
        assert out.execute("SELECT text FROM messages").fetchall() == [
            ("hidden here, shown upstream",)
        ]
        assert out.execute("SELECT name FROM contacts").fetchall() == [("Alice",)]
        assert out.execute("SELECT COUNT(*) FROM app_settings").fetchone()[0] == 1
        # AUTOINCREMENT counter follows the copied ids.
        seq = out.execute("SELECT seq FROM sqlite_sequence WHERE name='messages'").fetchone()
        max_id = out.execute("SELECT MAX(id) FROM messages").fetchone()[0]
        assert seq[0] >= max_id
    finally:
        out.close()


def test_build_refuses_existing_target(tmp_path):
    snap = tmp_path / "snap.db"
    sqlite3.connect(snap).close()
    target = tmp_path / "out.db"
    target.write_bytes(b"x")
    with pytest.raises(FileExistsError):
        build_upstream_db(str(snap), str(target))
    assert target.read_bytes() == b"x"
