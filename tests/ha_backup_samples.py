"""Synthetic Home Assistant backups shaped like a real one
(docs/plans/2026-11-19-ha-addon/ha-backup-layout.md)."""

import io
import json
import sqlite3
import tarfile
from pathlib import Path

SLUG = "e8c7f026_mc_remoteterm"


def wal_database(work: Path, user_version: int = 60) -> dict[str, bytes]:
    """A RemoteTerm-shaped DB whose rows live only in the WAL, as in a live backup."""
    db = work / "src.db"
    conn = sqlite3.connect(db)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA wal_autocheckpoint=0")
    for table in ("app_settings", "contacts", "channels", "messages"):
        conn.execute(f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, v TEXT)")
    conn.execute("INSERT INTO channels (v) VALUES ('Public')")
    conn.execute(f"PRAGMA user_version = {user_version}")
    conn.commit()
    files = {
        name: (work / f"src.db{suffix}").read_bytes()
        for name, suffix in (
            ("meshcore.db", ""),
            ("meshcore.db-wal", "-wal"),
            ("meshcore.db-shm", "-shm"),
        )
    }
    conn.close()
    return files


def add_member(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    tar.addfile(info, io.BytesIO(data))


def make_backup(
    path: Path,
    *,
    slug: str = SLUG,
    protected: bool = False,
    db_files: dict[str, bytes] | None = None,
    extra_inner: dict[str, bytes] | None = None,
    date: str = "2026-11-19T19:19:24+00:00",
    name: str = "TestHARTFM",
) -> None:
    inner = io.BytesIO()
    with tarfile.open(fileobj=inner, mode="w:gz") as itar:
        add_member(itar, "./addon.json", b'{"user": {"ingress_token": "secret"}}')
        add_member(itar, "./image.tar", b"\0" * 2048)
        for fname, data in (db_files or {}).items():
            add_member(itar, f"data/{fname}", data)
        for fname, data in (extra_inner or {}).items():
            add_member(itar, fname, data)
    meta = {
        "slug": path.stem,
        "name": name,
        "date": date,
        "type": "partial",
        "protected": protected,
        "addons": [{"slug": slug, "name": "RemoteTerm for MeshCore", "version": "3.12.3"}],
    }
    with tarfile.open(path, mode="w") as otar:
        add_member(otar, f"{slug}.tar.gz", inner.getvalue())
        add_member(otar, "./backup.json", json.dumps(meta).encode())
