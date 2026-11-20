"""Reading a RemoteTerm database out of a Home Assistant backup.

Fixtures follow the layout probed on a real install
(docs/plans/2026-11-19-ha-addon/ha-backup-layout.md): an outer tar with
``./backup.json`` and ``<slug>.tar.gz``; the inner gzip tar holds
``./addon.json``, ``./image.tar`` and ``data/`` with the database still in WAL.
"""

import shutil
import sqlite3
import tarfile
from pathlib import Path

import pytest

from app.ha_addon.backup_import import (
    UPSTREAM_MAX_SCHEMA,
    BackupImportError,
    check_upstream_schema,
    extract_database,
    is_remoteterm_addon,
    list_candidates,
)
from tests.ha_backup_samples import SLUG, make_backup, wal_database


@pytest.fixture
def db_files(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    return wal_database(work)


@pytest.fixture
def backups_dir(tmp_path, db_files):
    d = tmp_path / "backup"
    d.mkdir()
    make_backup(d / "rt.tar", db_files=db_files)
    make_backup(d / "older.tar", db_files=db_files, date="2026-11-01T10:00:00+00:00")
    make_backup(d / "enc.tar", db_files=db_files, protected=True, date="2026-11-10T10:00:00+00:00")
    make_backup(d / "other.tar", slug="core_mosquitto", db_files={})
    (d / "notatar.tar").write_bytes(b"junk")
    return d


def test_is_remoteterm_addon():
    assert is_remoteterm_addon(SLUG, "RemoteTerm for MeshCore")
    assert is_remoteterm_addon(
        "local_x", "x", "https://github.com/jkingsman/Remote-Terminal-for-MeshCore"
    )
    assert not is_remoteterm_addon("core_mosquitto", "Mosquitto")


def test_lists_only_remoteterm_backups_newest_first(backups_dir):
    found = list_candidates(str(backups_dir))
    assert [c.filename for c in found] == ["rt.tar", "enc.tar", "older.tar"]
    assert {c.addon_slug for c in found} == {SLUG}
    assert [c.protected for c in found] == [False, True, False]


def test_missing_backup_dir_lists_nothing(tmp_path):
    assert list_candidates(str(tmp_path / "nope")) == []


def test_extracts_db_with_wal_applied(backups_dir, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    p = extract_database(str(backups_dir / "rt.tar"), SLUG, str(out))
    conn = sqlite3.connect(p)
    assert conn.execute("pragma user_version").fetchone()[0] == 60
    assert conn.execute("select v from channels").fetchall() == [("Public",)]
    conn.close()
    assert sorted(x.name for x in out.iterdir()) == [Path(p).name]


def test_protected_backup_refused(backups_dir, tmp_path):
    with pytest.raises(BackupImportError, match="encrypted"):
        extract_database(str(backups_dir / "enc.tar"), SLUG, str(tmp_path))


def test_wrong_addon_slug_refused(backups_dir, tmp_path):
    with pytest.raises(BackupImportError, match="core_mosquitto"):
        extract_database(str(backups_dir / "rt.tar"), "core_mosquitto", str(tmp_path))


def test_missing_db_refused(tmp_path):
    make_backup(tmp_path / "empty.tar", db_files={})
    out = tmp_path / "out"
    out.mkdir()
    with pytest.raises(BackupImportError, match="meshcore.db"):
        extract_database(str(tmp_path / "empty.tar"), SLUG, str(out))


def test_not_a_tar_refused(tmp_path):
    bad = tmp_path / "bad.tar"
    bad.write_bytes(b"junk")
    with pytest.raises(BackupImportError):
        extract_database(str(bad), SLUG, str(tmp_path))


def test_path_traversal_member_ignored(tmp_path, db_files):
    make_backup(tmp_path / "evil.tar", db_files=db_files, extra_inner={"data/../../evil": b"x"})
    out = tmp_path / "out"
    out.mkdir()
    extract_database(str(tmp_path / "evil.tar"), SLUG, str(out))
    assert not (tmp_path / "evil").exists()
    assert not any(tmp_path.glob("**/evil"))


def test_db_without_wal_still_imports(tmp_path, db_files):
    work = tmp_path / "w2"
    work.mkdir()
    (work / "x.db").write_bytes(db_files["meshcore.db"])
    (work / "x.db-wal").write_bytes(db_files["meshcore.db-wal"])
    conn = sqlite3.connect(work / "x.db")
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    conn.close()
    make_backup(tmp_path / "plain.tar", db_files={"meshcore.db": (work / "x.db").read_bytes()})
    out = tmp_path / "out"
    out.mkdir()
    p = extract_database(str(tmp_path / "plain.tar"), SLUG, str(out))
    assert sqlite3.connect(p).execute("select count(*) from channels").fetchone()[0] == 1


def _plain_db(path: Path, version: int) -> None:
    conn = sqlite3.connect(path)
    conn.execute(f"PRAGMA user_version = {version}")
    conn.execute("CREATE TABLE t (x)")
    conn.commit()
    conn.close()


def test_upstream_schema_above_ceiling_refused(tmp_path):
    p = tmp_path / "x.db"
    _plain_db(p, UPSTREAM_MAX_SCHEMA + 1)
    with pytest.raises(BackupImportError, match="newer"):
        check_upstream_schema(str(p))


def test_upstream_schema_at_ceiling_ok(tmp_path):
    p = tmp_path / "x.db"
    _plain_db(p, 63)
    assert UPSTREAM_MAX_SCHEMA == 63
    assert check_upstream_schema(str(p)) == 63


def test_fixture_matches_real_layout_names(backups_dir):
    with tarfile.open(backups_dir / "rt.tar") as outer:
        assert set(outer.getnames()) == {f"{SLUG}.tar.gz", "./backup.json"}
    shutil.rmtree(backups_dir)
