"""HA import API: list RemoteTerm backups, import one, make one, restart."""

import pytest
from fastapi import HTTPException

import app.routers.backup as backup_module
import app.routers.ha_import as ha_import
from app.ha_addon.supervisor import SupervisorUnavailable
from app.routers.ha_import import (
    FromBackupRequest,
    MakeBackupRequest,
    from_backup,
    import_status,
    restart_addon,
)
from app.routers.ha_import import make_backup as make_backup_endpoint
from app.services import db_restore
from tests.ha_backup_samples import SLUG, make_backup, wal_database


class FakeSupervisor:
    def __init__(self, addons=None, fail=False):
        self.addons = addons or []
        self.fail = fail
        self.backups: list[tuple[str, str]] = []
        self.restarted = False

    async def addon_info(self, slug):
        if self.fail:
            raise SupervisorUnavailable("down")
        return next((a for a in self.addons if a["slug"] == slug), None)

    async def create_partial_backup(self, addon_slug, name):
        if self.fail:
            raise SupervisorUnavailable("down")
        self.backups.append((addon_slug, name))
        return "newslug"

    async def restart_self(self):
        if self.fail:
            raise SupervisorUnavailable("down")
        self.restarted = True


@pytest.fixture
def addon_mode(monkeypatch, tmp_path, test_db):
    monkeypatch.setattr(ha_import, "db", test_db)
    monkeypatch.setattr(ha_import.settings, "ha_addon", True)
    bdir = tmp_path / "backup"
    bdir.mkdir()
    monkeypatch.setattr(ha_import, "HA_BACKUP_DIR", str(bdir))
    (tmp_path / "data").mkdir()
    live = str(tmp_path / "data" / "meshcore.db")
    monkeypatch.setattr(backup_module, "_db_path", lambda: live)
    monkeypatch.setattr(ha_import, "_db_path", lambda: live)
    sup = FakeSupervisor(addons=[{"slug": SLUG, "name": "RemoteTerm for MeshCore"}])
    monkeypatch.setattr(ha_import, "supervisor_client", lambda: sup)
    work = tmp_path / "work"
    work.mkdir()
    return {"bdir": bdir, "live": live, "sup": sup, "work": work}


async def test_off_outside_addon_mode(monkeypatch, test_db):
    monkeypatch.setattr(ha_import.settings, "ha_addon", False)
    with pytest.raises(HTTPException) as exc:
        await import_status()
    assert exc.value.status_code == 404


async def test_status_lists_installed_and_backups(test_db, addon_mode):
    make_backup(addon_mode["bdir"] / "rt.tar", db_files=wal_database(addon_mode["work"]))
    status = await import_status()
    assert [a.slug for a in status.installed] == [SLUG]
    assert [b.addon_slug for b in status.backups] == [SLUG]
    assert status.database_empty is True


async def test_status_without_supervisor_lists_no_installed(test_db, addon_mode, monkeypatch):
    monkeypatch.setattr(ha_import, "supervisor_client", lambda: FakeSupervisor(fail=True))
    status = await import_status()
    assert status.installed == []


async def test_status_database_not_empty(test_db, addon_mode):
    async with test_db.tx() as conn:
        await conn.execute(
            "INSERT INTO contacts (public_key, name) VALUES (?, ?)", ("ab" * 32, "x")
        )
    assert (await import_status()).database_empty is False


async def test_from_backup_stages_restore(test_db, addon_mode):
    make_backup(addon_mode["bdir"] / "rt.tar", slug=SLUG, db_files=wal_database(addon_mode["work"]))
    status = await from_backup(FromBackupRequest(backup_slug="rt", addon_slug=SLUG))
    assert status.pending is not None
    assert status.pending.source == "ha-backup"
    pending = db_restore.get_pending(addon_mode["live"])
    assert pending is not None and pending["schema_version"] == 60


async def test_from_backup_encrypted_refused(test_db, addon_mode):
    make_backup(
        addon_mode["bdir"] / "enc.tar",
        db_files=wal_database(addon_mode["work"]),
        protected=True,
    )
    with pytest.raises(HTTPException) as exc:
        await from_backup(FromBackupRequest(backup_slug="enc", addon_slug=SLUG))
    assert exc.value.status_code == 400
    assert "encrypted" in exc.value.detail
    assert db_restore.get_pending(addon_mode["live"]) is None


async def test_from_backup_newer_upstream_schema_refused(test_db, addon_mode):
    make_backup(addon_mode["bdir"] / "new.tar", db_files=wal_database(addon_mode["work"], 64))
    with pytest.raises(HTTPException) as exc:
        await from_backup(FromBackupRequest(backup_slug="new", addon_slug=SLUG))
    assert exc.value.status_code == 400
    assert "newer" in exc.value.detail
    assert db_restore.get_pending(addon_mode["live"]) is None


async def test_from_backup_unknown_slug_404(test_db, addon_mode):
    with pytest.raises(HTTPException) as exc:
        await from_backup(FromBackupRequest(backup_slug="nope", addon_slug=SLUG))
    assert exc.value.status_code == 404


async def test_from_backup_leaves_no_temp_files(test_db, addon_mode):
    make_backup(addon_mode["bdir"] / "rt.tar", db_files=wal_database(addon_mode["work"]))
    await from_backup(FromBackupRequest(backup_slug="rt", addon_slug=SLUG))
    data_dir = addon_mode["work"].parent / "data"
    assert not [n for n in data_dir.iterdir() if n.name.startswith("ha-import")]


async def test_make_backup_calls_supervisor(test_db, addon_mode):
    out = await make_backup_endpoint(MakeBackupRequest(addon_slug=SLUG))
    assert out.backup_slug == "newslug"
    assert addon_mode["sup"].backups[0][0] == SLUG
    assert addon_mode["sup"].backups[0][1].startswith("RTFM-EV import ")


async def test_make_backup_refuses_other_addons(test_db, addon_mode):
    with pytest.raises(HTTPException) as exc:
        await make_backup_endpoint(MakeBackupRequest(addon_slug="core_mosquitto"))
    assert exc.value.status_code == 400
    assert addon_mode["sup"].backups == []


async def test_make_backup_supervisor_down_503(test_db, addon_mode, monkeypatch):
    monkeypatch.setattr(ha_import, "supervisor_client", lambda: FakeSupervisor(fail=True))
    with pytest.raises(HTTPException) as exc:
        await make_backup_endpoint(MakeBackupRequest(addon_slug=SLUG))
    assert exc.value.status_code == 503


async def test_restart_calls_supervisor(test_db, addon_mode):
    await restart_addon()
    assert addon_mode["sup"].restarted is True
