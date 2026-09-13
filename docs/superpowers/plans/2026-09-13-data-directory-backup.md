# Database Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app way to produce a consistent backup of the SQLite database (`meshcore.db`), delivered either as a browser download or written to an operator-configured server-side path.

**Architecture:** A `DatabaseManager.backup_to()` method runs `VACUUM INTO` on the live single connection under its lock to produce a consistent snapshot. A new `/api/backup` router exposes `GET /download` (streamed file response) and `POST /save` (write to a configured directory). Two new `app_settings` columns hold the server-path toggle and destination. The frontend adds a backup group to the existing `SettingsDatabaseSection`.

**Tech Stack:** FastAPI, `aiosqlite`, Pydantic, React + TypeScript, `i18next` (EN/NL/DE), pytest, vitest.

**Backend tests run in the container:** `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest <path> -v` (worktree bind-mounted to `/work`). Frontend tests run from `frontend/` with `npm test`.

**Re-verify before starting:** the next free migration number.
Run: `git ls-tree -r --name-only origin/main app/migrations | grep -oE '_[0-9]{3}' | sort | tail -1`
As of 2026-09-13 the latest is `_081`, so this plan uses **`_082`**. If that grep shows a higher number, use the next free one and adjust the filename in Task 1 accordingly.

---

### Task 1: Migration — add backup settings columns

**Files:**
- Create: `app/migrations/_082_add_backup_settings.py`
- Test: `tests/test_migrations/test_migration_082.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_migrations/test_migration_082.py
"""Migration 082: adds backup settings columns to app_settings."""

import aiosqlite
import pytest

from app.migrations._082_add_backup_settings import migrate


@pytest.mark.asyncio
async def test_adds_backup_columns_with_defaults():
    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await conn.execute(
        "CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1))"
    )
    await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
    await conn.commit()

    await migrate(conn)

    cur = await conn.execute("PRAGMA table_info(app_settings)")
    cols = {row[1] for row in await cur.fetchall()}
    assert "backup_to_path_enabled" in cols
    assert "backup_destination_path" in cols

    cur = await conn.execute(
        "SELECT backup_to_path_enabled, backup_destination_path FROM app_settings WHERE id = 1"
    )
    row = await cur.fetchone()
    assert row["backup_to_path_enabled"] == 0
    assert row["backup_destination_path"] == ""
    await conn.close()


@pytest.mark.asyncio
async def test_is_idempotent():
    conn = await aiosqlite.connect(":memory:")
    await conn.execute(
        "CREATE TABLE app_settings (id INTEGER PRIMARY KEY CHECK (id = 1))"
    )
    await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
    await conn.commit()

    await migrate(conn)
    await migrate(conn)  # second run must not raise

    cur = await conn.execute("PRAGMA table_info(app_settings)")
    cols = [row[1] for row in await cur.fetchall()]
    assert cols.count("backup_to_path_enabled") == 1
    await conn.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_migrations/test_migration_082.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.migrations._082_add_backup_settings'`

- [ ] **Step 3: Write the migration**

```python
# app/migrations/_082_add_backup_settings.py
import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add server-side backup settings to ``app_settings``.

    - ``backup_to_path_enabled`` (0/1, default off): allow writing backups to a
      configured server-side directory.
    - ``backup_destination_path`` (default ''): absolute directory the backup is
      written to when the toggle is on.

    Idempotent: guards the table and each column before adding.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    if "app_settings" not in {row[0] for row in await tables_cursor.fetchall()}:
        await conn.commit()
        return

    col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
    columns = {row[1] for row in await col_cursor.fetchall()}

    if "backup_to_path_enabled" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN backup_to_path_enabled INTEGER NOT NULL DEFAULT 0"
        )
    if "backup_destination_path" not in columns:
        await conn.execute(
            "ALTER TABLE app_settings ADD COLUMN backup_destination_path TEXT NOT NULL DEFAULT ''"
        )

    await conn.commit()
```

Note: migrations are auto-discovered by numeric prefix (see `app/migrations/__init__.py`); no manual registration is required. Confirm by reading `app/migrations/__init__.py` if unsure.

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_migrations/test_migration_082.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Do not commit yet** (this repo commits only on explicit instruction; the user drives commits). Move to Task 2.

---

### Task 2: `DatabaseManager.backup_to()` — consistent snapshot via VACUUM INTO

**Files:**
- Modify: `app/database.py` (add a method to `DatabaseManager`, near `tx()`/`readonly()` around line 249)
- Test: `tests/test_database_backup.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_database_backup.py
"""DatabaseManager.backup_to produces a consistent, valid snapshot."""

import sqlite3

import pytest

from app.database import Database


@pytest.mark.asyncio
async def test_backup_to_produces_valid_snapshot_with_same_rows(tmp_path):
    db = Database(":memory:")
    await db.connect()
    async with db.tx() as conn:
        await conn.execute("CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT)")
        await conn.execute("INSERT INTO widget (name) VALUES ('a'), ('b'), ('c')")

    target = tmp_path / "snapshot.db"
    await db.backup_to(str(target))
    await db.disconnect()

    assert target.exists()
    snap = sqlite3.connect(str(target))
    assert snap.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert snap.execute("SELECT COUNT(*) FROM widget").fetchone()[0] == 3
    snap.close()


@pytest.mark.asyncio
async def test_backup_to_rejects_existing_target(tmp_path):
    db = Database(":memory:")
    await db.connect()
    target = tmp_path / "exists.db"
    target.write_text("occupied")
    with pytest.raises(Exception):
        await db.backup_to(str(target))
    await db.disconnect()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_database_backup.py -v`
Expected: FAIL with `AttributeError: 'Database' object has no attribute 'backup_to'` (the class alias for `DatabaseManager`; confirm the exported name in `app/database.py`)

- [ ] **Step 3: Add the method to `DatabaseManager`**

Insert after the `readonly()` context manager (around `app/database.py:262`):

```python
    async def backup_to(self, target_path: str) -> None:
        """Write a consistent snapshot of the database to ``target_path``.

        Runs ``VACUUM INTO`` on the live connection under the lock. VACUUM reads
        a single consistent transactional view, so the snapshot is safe against
        WAL torn writes (unlike a raw file copy) and needs no second connection.

        ``target_path`` MUST NOT already exist (VACUUM INTO refuses to overwrite).
        A ``commit()`` first clears any stray implicit transaction, since VACUUM
        cannot run inside one.
        """
        async with self._lock:
            if self._connection is None:
                raise RuntimeError("Database not connected")
            await self._connection.commit()
            await self._connection.execute("VACUUM INTO ?", (target_path,))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_database_backup.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Do not commit yet.** Move to Task 3.

---

### Task 3: Settings model + repository — persist the two fields

**Files:**
- Modify: `app/models.py` (`AppSettings`, after `external_map_sync_interval_hours`, around line 1246)
- Modify: `app/repository/settings.py` (SELECT list ~line 56; `_row_to_settings`/get parsing ~line 197; `update` signature ~line 274 and body ~line 380; and the public wrapper signature ~line 424 and its call ~line 454)
- Test: `tests/test_settings_backup_fields.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_settings_backup_fields.py
"""app_settings round-trips backup settings fields."""

import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_backup_fields_default(test_db):
    s = await AppSettingsRepository.get()
    assert s.backup_to_path_enabled is False
    assert s.backup_destination_path == ""


@pytest.mark.asyncio
async def test_backup_fields_round_trip(test_db):
    await AppSettingsRepository.update(
        backup_to_path_enabled=True,
        backup_destination_path="/mnt/backups",
    )
    s = await AppSettingsRepository.get()
    assert s.backup_to_path_enabled is True
    assert s.backup_destination_path == "/mnt/backups"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_backup_fields.py -v`
Expected: FAIL — `AttributeError` / `TypeError: update() got an unexpected keyword argument 'backup_to_path_enabled'`

- [ ] **Step 3a: Add fields to `AppSettings`** (`app/models.py`, immediately after the `external_map_sync_interval_hours` Field block):

```python
    backup_to_path_enabled: bool = Field(
        default=False,
        description="Allow writing database backups to a configured server-side directory",
    )
    backup_destination_path: str = Field(
        default="",
        description="Absolute directory backups are written to when backup_to_path_enabled is on",
    )
```

- [ ] **Step 3b: Add columns to the SELECT** in `AppSettingsRepository._get_in_conn` (`app/repository/settings.py`, extend the column list that currently ends with `external_map_sync_interval_hours`):

```python
                   external_map_enabled, external_map_sync_url,
                   external_map_sync_interval_hours,
                   backup_to_path_enabled, backup_destination_path
```

- [ ] **Step 3c: Parse the row values** (in the same method, alongside the existing `external_map_*` parsing that builds locals before the `AppSettings(...)` return):

```python
        try:
            backup_to_path_enabled = bool(row["backup_to_path_enabled"])
        except (KeyError, IndexError):
            backup_to_path_enabled = False
        try:
            backup_destination_path = row["backup_destination_path"] or ""
        except (KeyError, IndexError):
            backup_destination_path = ""
```

And pass them into the `AppSettings(...)` constructor call (next to `external_map_sync_interval_hours=...`):

```python
            backup_to_path_enabled=backup_to_path_enabled,
            backup_destination_path=backup_destination_path,
```

- [ ] **Step 3d: Extend the internal `_apply_updates` signature and body.** Add parameters (next to `external_map_sync_interval_hours: int | None = None`):

```python
        backup_to_path_enabled: bool | None = None,
        backup_destination_path: str | None = None,
```

And add the corresponding `updates.append(...)` blocks (next to the `external_map_*` ones):

```python
        if backup_to_path_enabled is not None:
            updates.append("backup_to_path_enabled = ?")
            params.append(1 if backup_to_path_enabled else 0)

        if backup_destination_path is not None:
            updates.append("backup_destination_path = ?")
            params.append(backup_destination_path)
```

- [ ] **Step 3e: Extend the public `update(...)` wrapper.** Add the same two params to its signature and forward them in the call to `_apply_updates`/`update` (mirror exactly how `external_map_enabled` is threaded through around lines 422-454):

```python
        backup_to_path_enabled: bool | None = None,
        backup_destination_path: str | None = None,
```

```python
                backup_to_path_enabled=backup_to_path_enabled,
                backup_destination_path=backup_destination_path,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_backup_fields.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Do not commit yet.** Move to Task 4.

---

### Task 4: Settings router — accept and validate the two fields

**Files:**
- Modify: `app/routers/settings.py` (`AppSettingsUpdate` model ~line 143; `update_settings` kwargs-building block ~line 362)
- Test: `tests/test_settings_router.py` (add to `TestUpdateSettings`)

- [ ] **Step 1: Write the failing test** (append to `tests/test_settings_router.py`)

```python
    @pytest.mark.asyncio
    async def test_backup_settings_round_trip(self, test_db):
        result = await update_settings(
            AppSettingsUpdate(
                backup_to_path_enabled=True,
                backup_destination_path="  /mnt/backups  ",
            )
        )
        assert result.backup_to_path_enabled is True
        # path is trimmed
        assert result.backup_destination_path == "/mnt/backups"

    @pytest.mark.asyncio
    async def test_backup_settings_default_off(self, test_db):
        result = await update_settings(AppSettingsUpdate())
        assert result.backup_to_path_enabled is False
        assert result.backup_destination_path == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_router.py::TestUpdateSettings::test_backup_settings_round_trip -v`
Expected: FAIL — `TypeError` (unexpected kwarg `backup_to_path_enabled` on `AppSettingsUpdate`)

- [ ] **Step 3a: Add fields to `AppSettingsUpdate`** (`app/routers/settings.py`, after the `external_map_sync_interval_hours` Field):

```python
    backup_to_path_enabled: bool | None = Field(
        default=None,
        description="Allow writing database backups to a configured server-side directory",
    )
    backup_destination_path: str | None = Field(
        default=None,
        description="Absolute directory backups are written to when the toggle is on",
    )
```

- [ ] **Step 3b: Thread into `update_settings`** (in the kwargs-building block, next to the `external_map_*` handling around line 362):

```python
    if update.backup_to_path_enabled is not None:
        kwargs["backup_to_path_enabled"] = update.backup_to_path_enabled
    if update.backup_destination_path is not None:
        kwargs["backup_destination_path"] = update.backup_destination_path.strip()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_settings_router.py::TestUpdateSettings -v`
Expected: PASS (all, including the two new tests)

- [ ] **Step 5: Do not commit yet.** Move to Task 5.

---

### Task 5: Backup router — `/api/backup/download` and `/api/backup/save`

**Files:**
- Create: `app/routers/backup.py`
- Modify: `app/main.py` (import in the `from app.routers import (...)` block ~line 63; `app.include_router(...)` ~line 241)
- Test: `tests/test_backup_router.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_backup_router.py
"""Backup router: download snapshot and save-to-path behaviour."""

import sqlite3

import pytest
from fastapi import HTTPException

from app.repository import AppSettingsRepository
from app.routers.backup import download_backup, save_backup


@pytest.mark.asyncio
async def test_download_returns_valid_sqlite_file(test_db):
    async with test_db.tx() as conn:
        await conn.execute("CREATE TABLE t (id INTEGER)")
        await conn.execute("INSERT INTO t (id) VALUES (1), (2)")

    response = await download_backup()
    assert response.media_type == "application/octet-stream"
    assert "attachment" in response.headers["content-disposition"]
    assert response.filename.startswith("meshcore-backup-")
    assert response.filename.endswith(".db")

    snap = sqlite3.connect(response.path)
    assert snap.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    assert snap.execute("SELECT COUNT(*) FROM t").fetchone()[0] == 2
    snap.close()


@pytest.mark.asyncio
async def test_save_writes_to_configured_dir(test_db, tmp_path):
    async with test_db.tx() as conn:
        await conn.execute("CREATE TABLE t (id INTEGER)")
        await conn.execute("INSERT INTO t (id) VALUES (1)")
    await AppSettingsRepository.update(
        backup_to_path_enabled=True,
        backup_destination_path=str(tmp_path),
    )

    result = await save_backup()
    assert result.size_bytes > 0
    assert result.path.startswith(str(tmp_path))
    snap = sqlite3.connect(result.path)
    assert snap.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    snap.close()


@pytest.mark.asyncio
async def test_save_rejected_when_disabled(test_db, tmp_path):
    await AppSettingsRepository.update(
        backup_to_path_enabled=False,
        backup_destination_path=str(tmp_path),
    )
    with pytest.raises(HTTPException) as exc:
        await save_backup()
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_save_rejected_for_invalid_path(test_db):
    await AppSettingsRepository.update(
        backup_to_path_enabled=True,
        backup_destination_path="relative/not/absolute",
    )
    with pytest.raises(HTTPException) as exc:
        await save_backup()
    assert exc.value.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_backup_router.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.backup'`

- [ ] **Step 3a: Write the router**

```python
# app/routers/backup.py
import logging
import os
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from app.database import db
from app.repository import AppSettingsRepository

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/backup", tags=["backup"])


def _timestamped_filename() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"meshcore-backup-{stamp}.db"


class BackupSaveResult(BaseModel):
    path: str
    size_bytes: int
    timestamp: str


@router.get("/download")
async def download_backup() -> FileResponse:
    """Stream a consistent snapshot of the database to the caller as a download."""
    tmp_dir = tempfile.mkdtemp(prefix="meshcore-backup-")
    filename = _timestamped_filename()
    target = os.path.join(tmp_dir, filename)
    try:
        await db.backup_to(target)
    except Exception:
        # Best-effort cleanup on failure so we don't leak temp dirs.
        import shutil

        shutil.rmtree(tmp_dir, ignore_errors=True)
        logger.exception("Backup snapshot failed")
        raise HTTPException(status_code=500, detail="Failed to create database backup")

    def _cleanup() -> None:
        import shutil

        shutil.rmtree(tmp_dir, ignore_errors=True)

    return FileResponse(
        path=target,
        media_type="application/octet-stream",
        filename=filename,
        background=BackgroundTask(_cleanup),
    )


@router.post("/save", response_model=BackupSaveResult)
async def save_backup() -> BackupSaveResult:
    """Write a consistent snapshot to the configured server-side directory."""
    settings = await AppSettingsRepository.get()
    if not settings.backup_to_path_enabled:
        raise HTTPException(status_code=409, detail="Server-side backup is disabled")

    dest = settings.backup_destination_path.strip()
    if not dest or not os.path.isabs(dest):
        raise HTTPException(
            status_code=400, detail="Backup destination must be an absolute path"
        )
    if not os.path.isdir(dest):
        raise HTTPException(
            status_code=400, detail="Backup destination is not an existing directory"
        )
    if not os.access(dest, os.W_OK):
        raise HTTPException(
            status_code=400, detail="Backup destination is not writable"
        )

    filename = _timestamped_filename()
    target = os.path.join(dest, filename)
    try:
        await db.backup_to(target)
    except Exception:
        logger.exception("Server-side backup failed")
        raise HTTPException(status_code=500, detail="Failed to write database backup")

    return BackupSaveResult(
        path=target,
        size_bytes=os.path.getsize(target),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
```

- [ ] **Step 3b: Register the router in `app/main.py`.** Add `backup` to the `from app.routers import (...)` tuple (keep alphabetical-ish grouping as the file does), and add the include line next to the others:

```python
app.include_router(backup.router, prefix="/api")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_backup_router.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the backend suites touched so far to catch regressions**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_backup_router.py /work/tests/test_database_backup.py /work/tests/test_settings_router.py /work/tests/test_settings_backup_fields.py /work/tests/test_migrations/test_migration_082.py -v`
Expected: all PASS

- [ ] **Step 6: Do not commit yet.** Move to Task 6.

---

### Task 6: Frontend API client + types

**Files:**
- Modify: `frontend/src/api.ts` (add `downloadBackup` and `saveBackup` to the `api` object; add a `BackupSaveResult` interface near the other result interfaces)
- Modify: `frontend/src/types.ts` (add the two fields to `AppSettings` and `AppSettingsUpdate`)
- Test: `frontend/src/test/apiBackup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/test/apiBackup.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from '../api';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api.saveBackup', () => {
  it('POSTs to /backup/save and returns the result', async () => {
    const payload = { path: '/mnt/x/meshcore-backup-x.db', size_bytes: 4096, timestamp: 't' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 200 })
    );
    const result = await api.saveBackup();
    expect(fetchMock).toHaveBeenCalledWith(
      './api/backup/save',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.size_bytes).toBe(4096);
  });
});

describe('api.downloadBackup', () => {
  it('returns the download URL', () => {
    expect(api.downloadBackupUrl()).toBe('./api/backup/download');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npm test -- src/test/apiBackup.test.ts`
Expected: FAIL — `api.saveBackup is not a function` / `api.downloadBackupUrl is not a function`

- [ ] **Step 3a: Add the result interface** near the other `interface ...Result` declarations in `frontend/src/api.ts`:

```ts
interface BackupSaveResult {
  path: string;
  size_bytes: number;
  timestamp: string;
}
```

- [ ] **Step 3b: Add the two methods to the `api` object** (place near `runMaintenance`):

```ts
  // Backup
  downloadBackupUrl: () => `${API_BASE}/backup/download`,
  saveBackup: () =>
    fetchJson<BackupSaveResult>('/backup/save', {
      method: 'POST',
    }),
```

- [ ] **Step 3c: Extend the TS types** in `frontend/src/types.ts`. In `AppSettings` add:

```ts
  backup_to_path_enabled: boolean;
  backup_destination_path: string;
```

In `AppSettingsUpdate` add (matching the optional-field style used there):

```ts
  backup_to_path_enabled?: boolean;
  backup_destination_path?: string;
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npm test -- src/test/apiBackup.test.ts`
Expected: PASS

- [ ] **Step 5: Do not commit yet.** Move to Task 7.

---

### Task 7: Frontend UI — backup group in `SettingsDatabaseSection` + i18n

**Files:**
- Modify: `frontend/src/components/settings/SettingsDatabaseSection.tsx`
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`
- Test: `frontend/src/test/settingsBackup.test.tsx`

- [ ] **Step 1: Add i18n keys to all three locale files.** Add these keys (English shown; provide accurate NL and DE translations — the `i18nParity.test.ts` fails if any key is missing in any locale):

`en.json`:
```json
"settings_db_backup_heading": "Backup",
"settings_db_backup_desc": "Create a consistent snapshot of the database. Download it, or save it to a server path.",
"settings_db_backup_download": "Download backup",
"settings_db_backup_server_toggle": "Also save backups to a server path",
"settings_db_backup_path_label": "Server destination directory",
"settings_db_backup_path_placeholder": "/absolute/path/to/backups",
"settings_db_backup_save_now": "Back up to server now",
"settings_db_backup_toast_saved_title": "Backup saved",
"settings_db_backup_toast_saved_desc": "Wrote {{path}} ({{size}} bytes)",
"settings_db_backup_toast_failed_title": "Backup failed"
```

`nl.json` (translations):
```json
"settings_db_backup_heading": "Back-up",
"settings_db_backup_desc": "Maak een consistente momentopname van de database. Download deze of sla deze op in een serverpad.",
"settings_db_backup_download": "Back-up downloaden",
"settings_db_backup_server_toggle": "Back-ups ook opslaan in een serverpad",
"settings_db_backup_path_label": "Bestemmingsmap op server",
"settings_db_backup_path_placeholder": "/absoluut/pad/naar/backups",
"settings_db_backup_save_now": "Nu back-up naar server maken",
"settings_db_backup_toast_saved_title": "Back-up opgeslagen",
"settings_db_backup_toast_saved_desc": "{{path}} geschreven ({{size}} bytes)",
"settings_db_backup_toast_failed_title": "Back-up mislukt"
```

`de.json` (translations):
```json
"settings_db_backup_heading": "Sicherung",
"settings_db_backup_desc": "Erstellt eine konsistente Momentaufnahme der Datenbank. Herunterladen oder in einem Serverpfad speichern.",
"settings_db_backup_download": "Sicherung herunterladen",
"settings_db_backup_server_toggle": "Sicherungen auch in einem Serverpfad speichern",
"settings_db_backup_path_label": "Zielverzeichnis auf dem Server",
"settings_db_backup_path_placeholder": "/absoluter/pfad/zu/sicherungen",
"settings_db_backup_save_now": "Jetzt auf Server sichern",
"settings_db_backup_toast_saved_title": "Sicherung gespeichert",
"settings_db_backup_toast_saved_desc": "{{path}} geschrieben ({{size}} Bytes)",
"settings_db_backup_toast_failed_title": "Sicherung fehlgeschlagen"
```

Keep each locale's JSON valid (comma placement) and insert keys next to the other `settings_db_*` keys.

- [ ] **Step 2: Write the failing component test**

```tsx
// frontend/src/test/settingsBackup.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsDatabaseSection } from '../components/settings/SettingsDatabaseSection';
import { api } from '../api';
import type { AppSettings } from '../types';

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    // Only fields this component reads need be realistic; cast for the rest.
    auto_decrypt_dm_on_advert: false,
    advert_retention_days: 30,
    registry_sync_url: '',
    wordlist_sync_url: '',
    analyzer_sites: [],
    backup_to_path_enabled: false,
    backup_destination_path: '',
    ...overrides,
  } as AppSettings;
}

afterEach(() => vi.restoreAllMocks());

describe('SettingsDatabaseSection backup', () => {
  it('renders a download link pointing at the backup endpoint', () => {
    render(
      <SettingsDatabaseSection
        appSettings={baseSettings()}
        health={null}
        onSaveAppSettings={vi.fn().mockResolvedValue(undefined)}
        onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const link = screen.getByRole('link', { name: /download backup/i });
    expect(link.getAttribute('href')).toBe(api.downloadBackupUrl());
  });

  it('calls saveBackup when the server button is clicked (toggle on + path set)', async () => {
    const saveSpy = vi.spyOn(api, 'saveBackup').mockResolvedValue({
      path: '/mnt/b/x.db',
      size_bytes: 10,
      timestamp: 't',
    });
    render(
      <SettingsDatabaseSection
        appSettings={baseSettings({
          backup_to_path_enabled: true,
          backup_destination_path: '/mnt/b',
        })}
        health={null}
        onSaveAppSettings={vi.fn().mockResolvedValue(undefined)}
        onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /back up to server now/i }));
    expect(saveSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `frontend/`): `npm test -- src/test/settingsBackup.test.tsx`
Expected: FAIL — no download link / button found (UI not added yet)

- [ ] **Step 4: Add the UI to `SettingsDatabaseSection.tsx`**

4a. Add local state near the other `useState` hooks:

```tsx
  const [backupToPath, setBackupToPath] = useState(false);
  const [backupPath, setBackupPath] = useState('');
  const [savingBackup, setSavingBackup] = useState(false);
```

4b. Hydrate from props in the existing `useEffect([appSettings])`:

```tsx
    setBackupToPath(appSettings.backup_to_path_enabled ?? false);
    setBackupPath(appSettings.backup_destination_path ?? '');
```

4c. Add a save handler (near the other handlers):

```tsx
  const handleSaveBackupToServer = async () => {
    setSavingBackup(true);
    try {
      const result = await api.saveBackup();
      toast.success(t('settings_db_backup_toast_saved_title'), {
        description: t('settings_db_backup_toast_saved_desc', {
          path: result.path,
          size: result.size_bytes,
        }),
      });
    } catch (err) {
      console.error('Failed to save backup to server:', err);
      toast.error(t('settings_db_backup_toast_failed_title'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    } finally {
      setSavingBackup(false);
    }
  };
```

4d. Render the backup group in the returned JSX (insert a `<Separator />` then this block; follow the existing markup/classes used by neighbouring groups in the file):

```tsx
      <Separator />
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">{t('settings_db_backup_heading')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings_db_backup_desc')}</p>
        </div>

        <a href={api.downloadBackupUrl()} download>
          <Button type="button" variant="secondary">
            {t('settings_db_backup_download')}
          </Button>
        </a>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={backupToPath}
            onChange={(e) => {
              const next = e.target.checked;
              const prev = backupToPath;
              setBackupToPath(next);
              void persistAppSettings({ backup_to_path_enabled: next }, () =>
                setBackupToPath(prev)
              );
            }}
          />
          {t('settings_db_backup_server_toggle')}
        </label>

        {backupToPath && (
          <div className="space-y-2">
            <Label htmlFor="backup-path">{t('settings_db_backup_path_label')}</Label>
            <Input
              id="backup-path"
              value={backupPath}
              placeholder={t('settings_db_backup_path_placeholder')}
              onChange={(e) => setBackupPath(e.target.value)}
              onBlur={() => {
                const prev = appSettings.backup_destination_path ?? '';
                if (backupPath !== prev) {
                  void persistAppSettings({ backup_destination_path: backupPath }, () =>
                    setBackupPath(prev)
                  );
                }
              }}
            />
            <Button
              type="button"
              disabled={savingBackup || !backupPath.trim()}
              onClick={handleSaveBackupToServer}
            >
              {t('settings_db_backup_save_now')}
            </Button>
          </div>
        )}
      </div>
```

If `Button` inside an `<a download>` misbehaves in tests (nested interactive roles), instead render the download as a styled `<a>` with the button classes used elsewhere in this file; keep the accessible name "Download backup" so the test's `getByRole('link', { name: /download backup/i })` still matches.

- [ ] **Step 5: Run tests to verify they pass**

Run (from `frontend/`): `npm test -- src/test/settingsBackup.test.tsx src/test/i18nParity.test.ts src/test/apiBackup.test.ts`
Expected: PASS (all)

- [ ] **Step 6: Run lint + format gates** (this repo's CI runs prettier `format:check` separately from lint):

Run (from `frontend/`): `npm run lint && npm run format:check`
Expected: no errors. If `format:check` fails, run `npm run format` and re-check.

- [ ] **Step 7: Do not commit yet.** Move to Task 8.

---

### Task 8: Documentation

**Files:**
- Modify: `CHANGELOG-DMC-EV.md`
- Modify: `README.md` and/or `README_ADVANCED.md`
- Modify: `docs/plans/22-data-directory-backup.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Add a `CHANGELOG-DMC-EV.md` entry** following the existing grouped format, referencing issue #85. Example wording:

```
- Backup: in-app database backup. Download a consistent SQLite snapshot
  (VACUUM INTO) from Settings, or save it to a configured server path
  behind a toggle. Backup-only; manual restore documented. (#85)
```

- [ ] **Step 2: Document the feature and manual restore** in `README.md` (feature list) and `README_ADVANCED.md` (usage + restore). Restore procedure text:

```
Restore (manual): stop the server, replace data/meshcore.db with the backup
file, delete data/meshcore.db-wal and data/meshcore.db-shm if present, then
start the server again.
```

- [ ] **Step 3: Update `docs/plans/22-data-directory-backup.md`** status from "PLANNING (stub)" to reflect the delivered first slice (download + server-path save, VACUUM INTO, backup-only) and list the deferred follow-ups (restore, scheduled backups, network-protocol clients).

- [ ] **Step 4: Update the delivery table row for [22]** in `docs/plans/README.md`.

- [ ] **Step 5: Do not commit yet.** Report completion and hand back to the user for verification + commit (see Final Verification).

---

### Final Verification (before claiming done)

Per repo rule "Never claim it works without proof", run and capture output for at least these independent checks:

- [ ] **Full backend suite** (or at minimum every file this plan touched):

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_backup_router.py /work/tests/test_database_backup.py /work/tests/test_settings_router.py /work/tests/test_settings_backup_fields.py /work/tests/test_migrations/test_migration_082.py -v`

- [ ] **Frontend suite + gates:**

Run (from `frontend/`): `npm test -- src/test/apiBackup.test.ts src/test/settingsBackup.test.tsx src/test/i18nParity.test.ts && npm run lint && npm run format:check`

- [ ] **Runtime observation** (this is required — compiling is not proof a page renders): rebuild/restart the `rtfm-ev-local` container on this branch, open Settings → the database/data-management section, and confirm: (a) "Download backup" downloads a `.db` that opens in `sqlite3` and passes `PRAGMA integrity_check`; (b) with the toggle on and a valid absolute path set, "Back up to server now" writes a timestamped `.db` to that directory and the toast shows the path/size; (c) with the toggle off, the server button is hidden/disabled. Record the observed results, or mark anything not observed as **NOT VERIFIED**.

- [ ] Windows note: ~14 pre-existing backend failures and charmap collection errors are known env issues, not regressions — do not attribute them to this change.
