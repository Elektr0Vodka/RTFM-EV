"""Export the database in the format of original Remote Terminal for MeshCore.

For people moving back from RTFM-EV to the original project (jkingsman,
release 3.17.1). The export is a fresh SQLite file built from upstream's own
schema (``upstream_schema_3_17_1.sql``, generated from a database that upstream's
code created). Only upstream's tables and columns are copied; fork-only tables
and columns are left out. ``user_version`` is 63, the last migration upstream
ships, so upstream runs its future migrations normally.

Every row is kept. Fork-only flags (malformed, Spam Guard, duplicates) do not
exist upstream, so messages hidden here show as normal messages there.
"""

import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

UPSTREAM_VERSION = "3.17.1"
UPSTREAM_SCHEMA_VERSION = 63
_SCHEMA_FILE = Path(__file__).with_name("upstream_schema_3_17_1.sql")


def upstream_export_filename() -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return f"remoteterm-upstream-{UPSTREAM_VERSION}-{stamp}.db"


def _split_schema() -> tuple[str, str]:
    """Return (CREATE TABLE script, CREATE INDEX script) from the schema file."""
    # Statements are kept verbatim (inner comments included) so sqlite_master
    # stores exactly the SQL upstream stores. Only whole comment lines between
    # statements (the file header) are dropped.
    tables: list[str] = []
    indexes: list[str] = []
    buffer = ""
    for line in _SCHEMA_FILE.read_text(encoding="utf-8").splitlines(keepends=True):
        if not buffer and (not line.strip() or line.lstrip().startswith("--")):
            continue
        buffer += line
        if sqlite3.complete_statement(buffer):
            stmt = buffer.strip()
            buffer = ""
            is_index = stmt.upper().startswith(("CREATE INDEX", "CREATE UNIQUE INDEX"))
            (indexes if is_index else tables).append(stmt)
    if buffer.strip():
        raise ValueError(f"Incomplete statement in {_SCHEMA_FILE.name}")
    return "\n".join(tables), "\n".join(indexes)


def _columns(conn: sqlite3.Connection, schema: str, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f'PRAGMA {schema}.table_info("{table}")')]


def build_upstream_db(snapshot_path: str, target_path: str) -> dict[str, int]:
    """Build an upstream-format database at ``target_path`` from a snapshot.

    ``snapshot_path`` is a consistent copy of the live database (VACUUM INTO).
    ``target_path`` must not exist. Returns copied row counts per table.
    """
    if os.path.exists(target_path):
        raise FileExistsError(target_path)
    tables_sql, indexes_sql = _split_schema()
    counts: dict[str, int] = {}
    conn = sqlite3.connect(target_path, isolation_level=None)
    try:
        # Match upstream: incremental auto-vacuum must be set before the first table.
        conn.execute("PRAGMA auto_vacuum = INCREMENTAL")
        conn.execute("PRAGMA foreign_keys = OFF")
        conn.executescript(tables_sql)
        conn.execute("ATTACH DATABASE ? AS src", (snapshot_path,))
        src_tables = {
            row[0]
            for row in conn.execute("SELECT name FROM src.sqlite_master WHERE type = 'table'")
        }
        conn.execute("BEGIN")
        for (table,) in conn.execute(
            "SELECT name FROM main.sqlite_master WHERE type = 'table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY rowid"
        ).fetchall():
            if table not in src_tables:
                counts[table] = 0
                continue
            src_cols = set(_columns(conn, "src", table))
            shared = [c for c in _columns(conn, "main", table) if c in src_cols]
            col_list = ", ".join(f'"{c}"' for c in shared)
            cur = conn.execute(
                f'INSERT INTO main."{table}" ({col_list}) SELECT {col_list} FROM src."{table}"'
            )
            counts[table] = cur.rowcount
        conn.execute("COMMIT")
        conn.execute("DETACH DATABASE src")
        conn.executescript(indexes_sql)
        conn.execute(f"PRAGMA user_version = {UPSTREAM_SCHEMA_VERSION}")
        conn.execute("VACUUM")
    except BaseException:
        conn.close()
        try:
            os.remove(target_path)
        except OSError:
            pass
        raise
    conn.close()
    return counts
