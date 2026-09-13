# Mention & DM Notification Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a user-configurable sound when the user is @mentioned in a channel or receives a DM, with a global on/off toggle, preset sounds, a custom upload, a volume control, and per-conversation sound-muting.

**Architecture:** Backend stores three scalar settings in `app_settings` (migration `_088`) plus a single-row `mention_sound` BLOB table for the custom upload, exposed via `PATCH /api/settings` (scalars) and `POST/GET/DELETE /api/settings/mention-sound` (blob). Frontend plays via a small `HTMLAudioElement` wrapper, decides when to play in a `useMentionSound` hook wired into the existing WebSocket `onMessage` path, stores per-conversation sound-mute in `localStorage`, and adds a settings subsection.

**Tech Stack:** FastAPI + aiosqlite (backend), React + TypeScript + Vitest (frontend), pytest (backend tests).

**Reference spec:** `docs/superpowers/specs/2026-09-13-mention-notification-sound-design.md`

**Source sound files (maintainer-provided):** `C:\Users\Quicksilver.QuicksilverSSD\Downloads\New folder (4)\` containing `notification-beep.mp3`, `notification_bingbong.mp3`, `notification_bong.mp3`, `notification_tuduludu.mp3`, `notitication_uh-oh.mp3`.

**Preset ids (single source of truth used across backend + frontend):** `beep`, `bingbong`, `bong`, `tuduludu`, `uh-oh`. Default choice: `beep`.

---

## Conventions for this plan

- Run backend commands/tests inside the container per `docs/agents/ci-checks.md` (Windows host has no Python deps). The container recipe is in Task 15.
- Frontend commands run in `frontend/` after `npm ci` once.
- Commit after each task. Do NOT push (CLAUDE.md Git Rules). Do NOT add attribution/co-author lines.
- Every new user-facing string needs a `t()` key in `en.json`, `nl.json`, `de.json` (parity test enforces this).

---

## Task 1: Import and strip the preset MP3 assets

**Files:**
- Create: `frontend/public/sounds/beep.mp3`, `frontend/public/sounds/bingbong.mp3`, `frontend/public/sounds/bong.mp3`, `frontend/public/sounds/tuduludu.mp3`, `frontend/public/sounds/uh-oh.mp3`

- [ ] **Step 1: Create the target directory and run the import+strip script**

Run (Git Bash):

```bash
python3 - <<'PY'
import os
src = r"C:\Users\Quicksilver.QuicksilverSSD\Downloads\New folder (4)"
dst = "frontend/public/sounds"
os.makedirs(dst, exist_ok=True)
mapping = {
    "notification-beep.mp3": "beep.mp3",
    "notification_bingbong.mp3": "bingbong.mp3",
    "notification_bong.mp3": "bong.mp3",
    "notification_tuduludu.mp3": "tuduludu.mp3",
    "notitication_uh-oh.mp3": "uh-oh.mp3",
}
def strip_tags(b: bytes) -> bytes:
    # Strip leading ID3v2
    if b[:3] == b"ID3":
        flags = b[5]
        size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]
        total = 10 + size + (10 if flags & 0x10 else 0)
        b = b[total:]
    # Strip trailing ID3v1 (128-byte "TAG" block)
    if len(b) >= 128 and b[-128:-125] == b"TAG":
        b = b[:-128]
    return b
for srcname, dstname in mapping.items():
    raw = open(os.path.join(src, srcname), "rb").read()
    stripped = strip_tags(raw)
    open(os.path.join(dst, dstname), "wb").write(stripped)
    print(f"{srcname} -> {dstname}: {len(raw)} -> {len(stripped)} bytes")
PY
```

Expected: prints 5 lines, each `dst` file a few bytes smaller than the source (tags removed), no `ID3`/`TAG` remaining.

- [ ] **Step 2: Verify the outputs are tag-free MP3s**

Run:

```bash
python3 - <<'PY'
import glob
for f in sorted(glob.glob("frontend/public/sounds/*.mp3")):
    b = open(f, "rb").read()
    has_v2 = b[:3] == b"ID3"
    has_v1 = len(b) >= 128 and b[-128:-125] == b"TAG"
    print(f, "id3v2" if has_v2 else "clean-front", "id3v1" if has_v1 else "clean-end", len(b))
PY
```

Expected: all files `clean-front clean-end`, 5 files present.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/sounds/
git commit -m "feat(chat): add bundled notification sound presets (ID3 stripped)"
```

---

## Task 2: Backend migration `_088` (settings columns + mention_sound table)

**Files:**
- Create: `app/migrations/_088_add_mention_sound.py`
- Test: `tests/test_migrations_mention_sound.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_migrations_mention_sound.py
import aiosqlite
import pytest

from app.migrations._088_add_mention_sound import migrate


@pytest.mark.asyncio
async def test_088_adds_columns_and_table_idempotently():
    async with aiosqlite.connect(":memory:") as conn:
        conn.row_factory = aiosqlite.Row
        # Minimal app_settings table with the seed row, like earlier migrations expect.
        await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
        await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
        await conn.commit()

        # Run twice to prove idempotency.
        await migrate(conn)
        await migrate(conn)

        cols = {row[1] for row in await (await conn.execute("PRAGMA table_info(app_settings)")).fetchall()}
        assert "mention_sound_enabled" in cols
        assert "mention_sound_choice" in cols
        assert "mention_sound_volume" in cols

        tables = {row[0] for row in await (await conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )).fetchall()}
        assert "mention_sound" in tables

        # Defaults on the seed row.
        row = await (await conn.execute(
            "SELECT mention_sound_enabled, mention_sound_choice, mention_sound_volume "
            "FROM app_settings WHERE id = 1"
        )).fetchone()
        assert row["mention_sound_enabled"] == 0
        assert row["mention_sound_choice"] == "beep"
        assert row["mention_sound_volume"] == 80
```

- [ ] **Step 2: Run test to verify it fails**

Run (container recipe, Task 15): `PYTHONPATH=/work uv run pytest tests/test_migrations_mention_sound.py -q`
Expected: FAIL with `ModuleNotFoundError: app.migrations._088_add_mention_sound`.

- [ ] **Step 3: Write the migration**

```python
# app/migrations/_088_add_mention_sound.py
import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Add mention/DM notification-sound settings.

    - ``mention_sound_enabled`` (0/1, default off): master switch.
    - ``mention_sound_choice`` (default 'beep'): preset id or the literal 'custom'.
    - ``mention_sound_volume`` (0..100, default 80).
    - ``mention_sound`` table: single-row (id=1) BLOB store for a user-uploaded
      custom sound plus its metadata.

    Idempotent: guards the table and each column before adding.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    if "app_settings" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        columns = {row[1] for row in await col_cursor.fetchall()}
        if "mention_sound_enabled" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN mention_sound_enabled INTEGER NOT NULL DEFAULT 0"
            )
        if "mention_sound_choice" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN mention_sound_choice TEXT NOT NULL DEFAULT 'beep'"
            )
        if "mention_sound_volume" not in columns:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN mention_sound_volume INTEGER NOT NULL DEFAULT 80"
            )

    if "mention_sound" not in tables:
        await conn.execute(
            """
            CREATE TABLE mention_sound (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data BLOB NOT NULL,
                content_type TEXT NOT NULL,
                filename TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )

    await conn.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=/work uv run pytest tests/test_migrations_mention_sound.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/migrations/_088_add_mention_sound.py tests/test_migrations_mention_sound.py
git commit -m "feat(settings): migration _088 for mention-sound settings and blob table"
```

---

## Task 3: Backend AppSettings scalar fields (model, repository, router)

**Files:**
- Modify: `app/models.py` (class `AppSettings`, ~line 1130; add fields after `show_mention_ticker` ~1216)
- Modify: `app/repository/settings.py` (SELECT ~53, parse block ~161, `AppSettings(...)` ctor ~292, `_apply_updates` signature ~334 and body ~429, `update` signature ~539 and call ~580)
- Modify: `app/routers/settings.py` (request model near `show_mention_ticker` ~144; kwargs mapping ~414)
- Test: `tests/test_settings_mention_sound_scalars.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_settings_mention_sound_scalars.py
import pytest

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_mention_sound_scalar_defaults_and_roundtrip(app_db):  # app_db: existing DB fixture
    settings = await AppSettingsRepository.get()
    assert settings.mention_sound_enabled is False
    assert settings.mention_sound_choice == "beep"
    assert settings.mention_sound_volume == 80

    await AppSettingsRepository.update(
        mention_sound_enabled=True,
        mention_sound_choice="bingbong",
        mention_sound_volume=55,
    )
    updated = await AppSettingsRepository.get()
    assert updated.mention_sound_enabled is True
    assert updated.mention_sound_choice == "bingbong"
    assert updated.mention_sound_volume == 55
```

Note: use whatever DB fixture the existing settings tests use (grep `tests/` for `AppSettingsRepository` to find the fixture name; substitute it for `app_db`).

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=/work uv run pytest tests/test_settings_mention_sound_scalars.py -q`
Expected: FAIL (`AppSettings` has no attribute `mention_sound_enabled`).

- [ ] **Step 3a: Add fields to `AppSettings` model** (`app/models.py`, immediately after the `show_mention_ticker` field block ~line 1221)

```python
    mention_sound_enabled: bool = Field(
        default=False,
        description="Play a sound when the user is @mentioned in a channel or receives a DM.",
    )
    mention_sound_choice: str = Field(
        default="beep",
        description="Selected mention-sound: a preset id or the literal 'custom'.",
    )
    mention_sound_volume: int = Field(
        default=80,
        description="Mention-sound playback volume, 0..100.",
    )
    mention_sound_custom: "MentionSoundMeta | None" = Field(
        default=None,
        description="Metadata for the uploaded custom sound, or null when none is set.",
    )
```

And add this model ABOVE `class AppSettings` (e.g. next to `AnalyzerSite`, ~line 1107):

```python
class MentionSoundMeta(BaseModel):
    filename: str
    content_type: str
    size_bytes: int
    updated_at: int
```

- [ ] **Step 3b: Repository SELECT** (`app/repository/settings.py` ~line 62) — append the three scalar columns to the SELECT list:

```python
                   openhop_api_url, openhop_api_token,
                   mention_sound_enabled, mention_sound_choice, mention_sound_volume
```

- [ ] **Step 3c: Repository parse block** (after the openhop parse block ~line 273):

```python
        # Mention/DM notification sound (migration _088 adds the columns).
        try:
            mention_sound_enabled = bool(row["mention_sound_enabled"])
        except (KeyError, TypeError):
            mention_sound_enabled = False
        try:
            mention_sound_choice = row["mention_sound_choice"] or "beep"
        except (KeyError, TypeError):
            mention_sound_choice = "beep"
        try:
            raw_vol = row["mention_sound_volume"]
            mention_sound_volume = int(raw_vol) if raw_vol is not None else 80
        except (KeyError, TypeError, ValueError):
            mention_sound_volume = 80

        # Custom-sound metadata (NOT the blob) — small, safe to include in GET.
        mention_sound_custom = None
        try:
            async with conn.execute(
                "SELECT filename, content_type, size_bytes, updated_at "
                "FROM mention_sound WHERE id = 1"
            ) as ms_cursor:
                ms_row = await ms_cursor.fetchone()
            if ms_row is not None:
                mention_sound_custom = MentionSoundMeta(
                    filename=ms_row["filename"],
                    content_type=ms_row["content_type"],
                    size_bytes=ms_row["size_bytes"],
                    updated_at=ms_row["updated_at"],
                )
        except Exception:  # table may not exist on a partial migration
            mention_sound_custom = None
```

Add `MentionSoundMeta` to the model import at the top of `settings.py` (the line importing `AnalyzerSite, AppSettings`).

- [ ] **Step 3d: Repository `AppSettings(...)` constructor** (~line 311) — add before the closing paren:

```python
            mention_sound_enabled=mention_sound_enabled,
            mention_sound_choice=mention_sound_choice,
            mention_sound_volume=mention_sound_volume,
            mention_sound_custom=mention_sound_custom,
```

- [ ] **Step 3e: `_apply_updates`** — add params to the signature (~line 353) and body (~line 505):

Signature additions:

```python
        mention_sound_enabled: bool | None = None,
        mention_sound_choice: str | None = None,
        mention_sound_volume: int | None = None,
```

Body additions (before the `if updates:` block):

```python
        if mention_sound_enabled is not None:
            updates.append("mention_sound_enabled = ?")
            params.append(1 if mention_sound_enabled else 0)

        if mention_sound_choice is not None:
            updates.append("mention_sound_choice = ?")
            params.append(mention_sound_choice)

        if mention_sound_volume is not None:
            updates.append("mention_sound_volume = ?")
            params.append(max(0, min(100, mention_sound_volume)))
```

- [ ] **Step 3f: `update`** — add the same three params to the `update(...)` signature (~line 558) and forward them in the `_apply_updates(...)` call (~line 593):

```python
                mention_sound_enabled=mention_sound_enabled,
                mention_sound_choice=mention_sound_choice,
                mention_sound_volume=mention_sound_volume,
```

- [ ] **Step 3g: Router request model** (`app/routers/settings.py`, after the `show_mention_ticker` field ~line 150):

```python
    mention_sound_enabled: bool | None = Field(
        default=None,
        description="Play a sound on @mention or DM.",
    )
    mention_sound_choice: str | None = Field(
        default=None,
        description="Mention-sound preset id or 'custom'.",
    )
    mention_sound_volume: int | None = Field(
        default=None, ge=0, le=100, description="Mention-sound volume 0..100."
    )
```

- [ ] **Step 3h: Router kwargs mapping** (after the mention-ticker mapping ~line 414):

```python
    # Mention/DM notification sound
    if update.mention_sound_enabled is not None:
        kwargs["mention_sound_enabled"] = update.mention_sound_enabled
    if update.mention_sound_choice is not None:
        kwargs["mention_sound_choice"] = update.mention_sound_choice
    if update.mention_sound_volume is not None:
        kwargs["mention_sound_volume"] = update.mention_sound_volume
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=/work uv run pytest tests/test_settings_mention_sound_scalars.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/models.py app/repository/settings.py app/routers/settings.py tests/test_settings_mention_sound_scalars.py
git commit -m "feat(settings): mention-sound scalar fields through model/repo/router"
```

---

## Task 4: Backend `MentionSoundRepository`

**Files:**
- Create: `app/repository/mention_sound.py`
- Modify: `app/repository/__init__.py` (import + `__all__`)
- Test: `tests/test_mention_sound_repository.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_mention_sound_repository.py
import pytest

from app.repository import AppSettingsRepository, MentionSoundRepository


@pytest.mark.asyncio
async def test_set_get_delete_roundtrip(app_db):
    assert await MentionSoundRepository.get() is None

    await MentionSoundRepository.set(b"\x00\x01\x02", "audio/mpeg", "chime.mp3")
    got = await MentionSoundRepository.get()
    assert got is not None
    assert got["data"] == b"\x00\x01\x02"
    assert got["content_type"] == "audio/mpeg"
    assert got["filename"] == "chime.mp3"
    assert got["size_bytes"] == 3
    assert isinstance(got["updated_at"], int)

    # set() replaces (single row).
    await MentionSoundRepository.set(b"\x09", "audio/wav", "again.wav")
    got2 = await MentionSoundRepository.get()
    assert got2["data"] == b"\x09"
    assert got2["filename"] == "again.wav"

    await MentionSoundRepository.delete()
    assert await MentionSoundRepository.get() is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=/work uv run pytest tests/test_mention_sound_repository.py -q`
Expected: FAIL (`cannot import name 'MentionSoundRepository'`).

- [ ] **Step 3: Write the repository**

```python
# app/repository/mention_sound.py
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
```

- [ ] **Step 4: Register in `app/repository/__init__.py`**

Add the import (alphabetical-ish, near `messages`):

```python
from app.repository.mention_sound import MentionSoundRepository
```

Add to `__all__`:

```python
    "MentionSoundRepository",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PYTHONPATH=/work uv run pytest tests/test_mention_sound_repository.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/repository/mention_sound.py app/repository/__init__.py tests/test_mention_sound_repository.py
git commit -m "feat(settings): MentionSoundRepository for custom-sound blob"
```

---

## Task 5: Backend upload/serve/delete endpoints

**Files:**
- Modify: `app/routers/settings.py` (add imports, constants, three routes)
- Test: `tests/test_mention_sound_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_mention_sound_endpoints.py
import pytest
from httpx import AsyncClient

from app.repository import AppSettingsRepository


@pytest.mark.asyncio
async def test_upload_get_delete_mention_sound(async_client: AsyncClient):  # use existing app client fixture
    # No sound yet -> 404.
    r = await async_client.get("/api/settings/mention-sound")
    assert r.status_code == 404

    # Upload a small valid file.
    files = {"file": ("chime.mp3", b"ID3fakebody-small", "audio/mpeg")}
    r = await async_client.post("/api/settings/mention-sound", files=files)
    assert r.status_code == 200
    body = r.json()
    assert body["filename"] == "chime.mp3"
    assert body["content_type"] == "audio/mpeg"

    # choice flips to 'custom'.
    assert (await AppSettingsRepository.get()).mention_sound_choice == "custom"

    # GET streams it back.
    r = await async_client.get("/api/settings/mention-sound")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.content == b"ID3fakebody-small"

    # Oversize rejected.
    big = {"file": ("big.mp3", b"x" * (256 * 1024 + 1), "audio/mpeg")}
    r = await async_client.post("/api/settings/mention-sound", files=big)
    assert r.status_code == 413

    # Wrong type rejected.
    bad = {"file": ("note.txt", b"hello", "text/plain")}
    r = await async_client.post("/api/settings/mention-sound", files=bad)
    assert r.status_code == 415

    # DELETE clears and resets choice to a preset.
    r = await async_client.delete("/api/settings/mention-sound")
    assert r.status_code == 204
    assert (await AppSettingsRepository.get()).mention_sound_choice == "beep"
    r = await async_client.get("/api/settings/mention-sound")
    assert r.status_code == 404
```

Note: use the existing FastAPI test client fixture (grep `tests/` for `AsyncClient` / `async_client` to find its real name and substitute it).

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=/work uv run pytest tests/test_mention_sound_endpoints.py -q`
Expected: FAIL (404 route missing -> actually 404 for GET passes but POST 404s; the assertions on POST fail).

- [ ] **Step 3: Add imports + constants** (`app/routers/settings.py`)

Update the FastAPI import line to include upload/response helpers:

```python
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
```

Add the repository import (extend the existing `from app.repository import ...` line):

```python
from app.repository import (
    AppSettingsRepository,
    ChannelRepository,
    ContactRepository,
    MentionSoundRepository,
)
```

Add constants near the other MAX_* constants (~line 27):

```python
MAX_MENTION_SOUND_BYTES = 256 * 1024  # 256 KB
ALLOWED_MENTION_SOUND_MIMES = (
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
)
ALLOWED_MENTION_SOUND_EXTS = (".mp3", ".wav", ".ogg", ".m4a", ".aac")
DEFAULT_MENTION_SOUND_PRESET = "beep"
```

- [ ] **Step 4: Add the three routes** (append to `app/routers/settings.py`)

```python
@router.post("/mention-sound")
async def upload_mention_sound(file: Annotated[UploadFile, File()]) -> dict:
    """Store a custom mention sound and switch the choice to 'custom'.

    Validates type (by MIME or extension) and enforces a 256 KB size cap.
    """
    data = await file.read()
    if len(data) > MAX_MENTION_SOUND_BYTES:
        raise HTTPException(status_code=413, detail="Sound file exceeds the 256 KB limit.")
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="Empty file.")

    filename = (file.filename or "custom").strip()
    ext_ok = filename.lower().endswith(ALLOWED_MENTION_SOUND_EXTS)
    mime = (file.content_type or "").lower()
    mime_ok = mime in ALLOWED_MENTION_SOUND_MIMES
    if not (ext_ok or mime_ok):
        raise HTTPException(
            status_code=415,
            detail="Unsupported audio type. Use mp3, wav, ogg, m4a, or aac.",
        )

    stored_mime = mime if mime_ok else "audio/mpeg"
    meta = await MentionSoundRepository.set(data, stored_mime, filename)
    await AppSettingsRepository.update(mention_sound_choice="custom")
    return meta


@router.get("/mention-sound")
async def get_mention_sound() -> Response:
    """Stream the custom mention sound, or 404 when none is set."""
    row = await MentionSoundRepository.get()
    if row is None:
        raise HTTPException(status_code=404, detail="No custom mention sound set.")
    return Response(
        content=row["data"],
        media_type=row["content_type"],
        headers={
            "Cache-Control": "private, max-age=31536000",
            "ETag": f'"{row["updated_at"]}"',
        },
    )


@router.delete("/mention-sound", status_code=204)
async def delete_mention_sound() -> Response:
    """Delete the custom sound; reset choice to the default preset if it was custom."""
    await MentionSoundRepository.delete()
    current = await AppSettingsRepository.get()
    if current.mention_sound_choice == "custom":
        await AppSettingsRepository.update(mention_sound_choice=DEFAULT_MENTION_SOUND_PRESET)
    return Response(status_code=204)
```

Add `from typing import Annotated` to the top imports if not already present (the file currently imports `from typing import Literal`; change to `from typing import Annotated, Literal`).

- [ ] **Step 5: Run test to verify it passes**

Run: `PYTHONPATH=/work uv run pytest tests/test_mention_sound_endpoints.py -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/routers/settings.py tests/test_mention_sound_endpoints.py
git commit -m "feat(settings): mention-sound upload/serve/delete endpoints"
```

---

## Task 6: Frontend types + API client methods

**Files:**
- Modify: `frontend/src/types.ts` (`AppSettings` ~495, `AppSettingsUpdate` ~684, new `MentionSoundMeta`)
- Modify: `frontend/src/api.ts` (settings block ~486, new methods near `uploadWordlist` ~810)
- Create: `frontend/src/lib/mentionSoundPresets.ts`

- [ ] **Step 1: Add types** (`frontend/src/types.ts`)

Add near `AppSettings`:

```typescript
export interface MentionSoundMeta {
  filename: string;
  content_type: string;
  size_bytes: number;
  updated_at: number;
}
```

Add to `AppSettings` (after `openhop_api_token_set?`):

```typescript
  mention_sound_enabled: boolean;
  mention_sound_choice: string;
  mention_sound_volume: number;
  mention_sound_custom: MentionSoundMeta | null;
```

Add to `AppSettingsUpdate` (after `show_mention_ticker?`):

```typescript
  mention_sound_enabled?: boolean;
  mention_sound_choice?: string;
  mention_sound_volume?: number;
```

- [ ] **Step 2: Add the preset constant** (`frontend/src/lib/mentionSoundPresets.ts`)

```typescript
// Single source of truth for bundled mention-sound presets. Files live in
// frontend/public/sounds/<id>.mp3 and are referenced by relative path.
export const MENTION_SOUND_PRESET_IDS = ['beep', 'bingbong', 'bong', 'tuduludu', 'uh-oh'] as const;

export type MentionSoundPresetId = (typeof MENTION_SOUND_PRESET_IDS)[number];

export const DEFAULT_MENTION_SOUND_PRESET: MentionSoundPresetId = 'beep';

export function isMentionSoundPreset(id: string): id is MentionSoundPresetId {
  return (MENTION_SOUND_PRESET_IDS as readonly string[]).includes(id);
}

/** Resolve a settings `mention_sound_choice` to a playable URL.
 *  Presets resolve to the bundled file; 'custom' resolves to the API endpoint
 *  with a cache-busting version derived from the custom sound's updated_at. */
export function mentionSoundUrl(choice: string, customVersion?: number | null): string {
  if (choice === 'custom') {
    const v = customVersion ? `?v=${customVersion}` : '';
    return `./api/settings/mention-sound${v}`;
  }
  const id = isMentionSoundPreset(choice) ? choice : DEFAULT_MENTION_SOUND_PRESET;
  return `./sounds/${id}.mp3`;
}
```

- [ ] **Step 3: Add API methods** (`frontend/src/api.ts`, in the `api` object near `uploadWordlist`)

```typescript
  uploadMentionSound: async (file: File): Promise<MentionSoundMeta> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/settings/mention-sound`, { method: 'POST', body: form });
    if (!res.ok) {
      const text = await res.text();
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j.detail) msg = j.detail;
      } catch {
        /* raw text */
      }
      throw new Error(msg);
    }
    return res.json() as Promise<MentionSoundMeta>;
  },
  deleteMentionSound: async (): Promise<void> => {
    const res = await fetch(`${API_BASE}/settings/mention-sound`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new ApiError('Failed to delete mention sound', res.status);
    }
  },
```

Add `MentionSoundMeta` to the type import at the top of `api.ts` (the block importing `AppSettings`, `AppSettingsUpdate`, etc.).

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds (tsc + vite).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts frontend/src/lib/mentionSoundPresets.ts
git commit -m "feat(chat): mention-sound frontend types, presets, and API methods"
```

---

## Task 7: Frontend playback module

**Files:**
- Create: `frontend/src/lib/mentionSound.ts`
- Test: `frontend/src/test/mentionSound.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/test/mentionSound.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMentionSoundPlayer } from '../lib/mentionSound';

class FakeAudio {
  src = '';
  volume = 1;
  currentTime = 0;
  muted = false;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
}

describe('mentionSound player', () => {
  let fake: FakeAudio;
  let now: number;
  beforeEach(() => {
    fake = new FakeAudio();
    now = 1000;
  });

  const make = () =>
    createMentionSoundPlayer({
      makeAudio: () => fake as unknown as HTMLAudioElement,
      now: () => now,
    });

  it('sets src and clamps volume 0..1 from 0..100', () => {
    const p = make();
    p.setSource('./sounds/beep.mp3');
    p.setVolume(150);
    expect(fake.src).toBe('./sounds/beep.mp3');
    expect(fake.volume).toBe(1);
    p.setVolume(-5);
    expect(fake.volume).toBe(0);
    p.setVolume(50);
    expect(fake.volume).toBe(0.5);
  });

  it('plays by resetting currentTime and calling play()', () => {
    const p = make();
    p.setSource('./sounds/beep.mp3');
    fake.currentTime = 3;
    p.play();
    expect(fake.currentTime).toBe(0);
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated plays within the window', () => {
    const p = make();
    p.setSource('./sounds/beep.mp3');
    p.play();
    now += 100; // within 300ms window
    p.play();
    expect(fake.play).toHaveBeenCalledTimes(1);
    now += 400; // past the window
    p.play();
    expect(fake.play).toHaveBeenCalledTimes(2);
  });

  it('swallows a rejected play() promise', async () => {
    fake.play = vi.fn().mockRejectedValue(new Error('blocked'));
    const p = make();
    p.setSource('./sounds/beep.mp3');
    expect(() => p.play()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/mentionSound.test.ts`
Expected: FAIL (`createMentionSoundPlayer` not found).

- [ ] **Step 3: Write the module**

```typescript
// frontend/src/lib/mentionSound.ts
// A tiny wrapper around one reused HTMLAudioElement for the mention/DM cue.
// Volume is 0..100 (settings units), clamped to the element's 0..1 internally.
// play() is fire-and-forget: a rejected autoplay promise is swallowed so it
// never throws into the WebSocket handler. Repeat plays inside COALESCE_MS are
// ignored so a burst of mentions/DMs makes one sound, not many.

const COALESCE_MS = 300;

export interface MentionSoundPlayerDeps {
  makeAudio?: () => HTMLAudioElement;
  now?: () => number;
}

export interface MentionSoundPlayer {
  setSource(url: string): void;
  setVolume(volume0to100: number): void;
  play(): void;
  unlock(): void;
  dispose(): void;
}

export function createMentionSoundPlayer(deps: MentionSoundPlayerDeps = {}): MentionSoundPlayer {
  const now = deps.now ?? (() => Date.now());
  const audio = (deps.makeAudio ?? (() => new Audio()))();
  let lastPlay = -Infinity;
  let unlocked = false;

  return {
    setSource(url: string) {
      if (audio.src !== url) {
        audio.src = url;
      }
    },
    setVolume(v: number) {
      audio.volume = Math.max(0, Math.min(1, v / 100));
    },
    play() {
      const t = now();
      if (t - lastPlay < COALESCE_MS) return;
      lastPlay = t;
      try {
        audio.currentTime = 0;
      } catch {
        /* not always settable before metadata loads */
      }
      void Promise.resolve(audio.play()).catch(() => {
        /* autoplay blocked or no source; ignore */
      });
    },
    unlock() {
      if (unlocked) return;
      unlocked = true;
      const prevVol = audio.volume;
      audio.muted = true;
      void Promise.resolve(audio.play())
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
        })
        .catch(() => {
          /* ignore */
        })
        .finally(() => {
          audio.muted = false;
          audio.volume = prevVol;
        });
    },
    dispose() {
      audio.pause();
      audio.src = '';
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/mentionSound.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/mentionSound.ts frontend/src/test/mentionSound.test.ts
git commit -m "feat(chat): HTMLAudioElement mention-sound player with coalescing"
```

---

## Task 8: Frontend per-conversation sound-mute helpers

**Files:**
- Create: `frontend/src/lib/mentionSoundMute.ts`
- Test: `frontend/src/test/mentionSoundMute.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/test/mentionSoundMute.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isConversationSoundMuted,
  toggleConversationSoundMuted,
} from '../lib/mentionSoundMute';

describe('mentionSoundMute', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to not muted', () => {
    expect(isConversationSoundMuted('channel', 'abc')).toBe(false);
  });

  it('toggles on and off and persists', () => {
    expect(toggleConversationSoundMuted('contact', 'k1')).toBe(true);
    expect(isConversationSoundMuted('contact', 'k1')).toBe(true);
    expect(toggleConversationSoundMuted('contact', 'k1')).toBe(false);
    expect(isConversationSoundMuted('contact', 'k1')).toBe(false);
  });

  it('keys channels and contacts separately', () => {
    toggleConversationSoundMuted('channel', 'x');
    expect(isConversationSoundMuted('channel', 'x')).toBe(true);
    expect(isConversationSoundMuted('contact', 'x')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/mentionSoundMute.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module** (mirrors the map pattern in `useBrowserNotifications.ts`)

```typescript
// frontend/src/lib/mentionSoundMute.ts
// Per-conversation "mute the mention sound" flags, kept per-device in
// localStorage — the override half of the global mention-sound setting.
import { getStateKey } from '../utils/conversationState';

const STORAGE_KEY = 'meshcore_mention_sound_muted_by_conversation';

type MutedMap = Record<string, true>;

function read(): MutedMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([k, v]) => typeof k === 'string' && v === true)
    ) as MutedMap;
  } catch {
    return {};
  }
}

function write(map: MutedMap): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
}

export function isConversationSoundMuted(type: 'channel' | 'contact', id: string): boolean {
  return read()[getStateKey(type, id)] === true;
}

/** Toggle and persist. Returns the new muted state. */
export function toggleConversationSoundMuted(type: 'channel' | 'contact', id: string): boolean {
  const key = getStateKey(type, id);
  const map = read();
  let nowMuted: boolean;
  if (map[key]) {
    delete map[key];
    nowMuted = false;
  } else {
    map[key] = true;
    nowMuted = true;
  }
  write(map);
  return nowMuted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/mentionSoundMute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/mentionSoundMute.ts frontend/src/test/mentionSoundMute.test.ts
git commit -m "feat(chat): per-conversation mention-sound mute helpers"
```

---

## Task 9: Frontend `useMentionSound` hook (trigger logic)

**Files:**
- Create: `frontend/src/hooks/useMentionSound.ts`
- Test: `frontend/src/test/useMentionSound.test.ts`

The hook owns a player instance, keeps source/volume synced to settings, and exposes `notifyMentionSound(msg, ctx)` applying all trigger rules. It takes an injectable player + focus function for testing.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/test/useMentionSound.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMentionSound } from '../hooks/useMentionSound';
import type { Message } from '../types';

const chan = (over: Partial<Message> = {}): Message =>
  ({
    id: 1,
    type: 'CHAN',
    text: 'hi @[Me]',
    outgoing: false,
    conversation_key: 'chan1',
    sender_name: 'Bob',
    sender_key: 'bob',
  }) as Message;

const dm = (over: Partial<Message> = {}): Message =>
  ({
    id: 2,
    type: 'PRIV',
    text: 'yo',
    outgoing: false,
    conversation_key: 'k1',
    sender_name: 'Bob',
    ...over,
  }) as Message;

function setup(enabled: boolean, extra?: { focused?: boolean }) {
  const play = vi.fn();
  const player = {
    setSource: vi.fn(),
    setVolume: vi.fn(),
    play,
    unlock: vi.fn(),
    dispose: vi.fn(),
  };
  const { result } = renderHook(() =>
    useMentionSound({
      enabled,
      choice: 'beep',
      volume: 80,
      customVersion: null,
      makePlayer: () => player,
      isDocumentFocused: () => extra?.focused ?? false,
    })
  );
  return { result, play };
}

describe('useMentionSound', () => {
  beforeEach(() => localStorage.clear());

  it('plays for a CHAN mention when not viewing it', () => {
    const { result, play } = setup(true);
    result.current.notifyMentionSound(chan(), { isForActiveConversation: false, hasMention: true });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not play for CHAN without a mention', () => {
    const { result, play } = setup(true);
    result.current.notifyMentionSound(chan({ text: 'no ping' }), {
      isForActiveConversation: false,
      hasMention: false,
    });
    expect(play).not.toHaveBeenCalled();
  });

  it('plays for any incoming DM', () => {
    const { result, play } = setup(true);
    result.current.notifyMentionSound(dm(), { isForActiveConversation: false, hasMention: false });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('is silent when globally disabled', () => {
    const { result, play } = setup(false);
    result.current.notifyMentionSound(dm(), { isForActiveConversation: false, hasMention: false });
    expect(play).not.toHaveBeenCalled();
  });

  it('suppresses when focused AND viewing that conversation', () => {
    const { result, play } = setup(true, { focused: true });
    result.current.notifyMentionSound(dm(), { isForActiveConversation: true, hasMention: false });
    expect(play).not.toHaveBeenCalled();
  });

  it('still plays when viewing it but tab NOT focused', () => {
    const { result, play } = setup(true, { focused: false });
    result.current.notifyMentionSound(dm(), { isForActiveConversation: true, hasMention: false });
    expect(play).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/useMentionSound.test.ts`
Expected: FAIL (hook not found).

- [ ] **Step 3: Write the hook**

```typescript
// frontend/src/hooks/useMentionSound.ts
import { useCallback, useEffect, useMemo } from 'react';
import type { Message } from '../types';
import { createMentionSoundPlayer, type MentionSoundPlayer } from '../lib/mentionSound';
import { mentionSoundUrl } from '../lib/mentionSoundPresets';
import { isConversationSoundMuted } from '../lib/mentionSoundMute';

interface UseMentionSoundArgs {
  enabled: boolean;
  choice: string;
  volume: number;
  customVersion: number | null;
  /** Test seams. */
  makePlayer?: () => MentionSoundPlayer;
  isDocumentFocused?: () => boolean;
}

interface MentionSoundContext {
  isForActiveConversation: boolean;
  hasMention: boolean;
}

function defaultFocused(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function useMentionSound({
  enabled,
  choice,
  volume,
  customVersion,
  makePlayer,
  isDocumentFocused = defaultFocused,
}: UseMentionSoundArgs) {
  const player = useMemo(
    () => (makePlayer ? makePlayer() : createMentionSoundPlayer()),
    [makePlayer]
  );

  useEffect(() => {
    player.setSource(mentionSoundUrl(choice, customVersion));
  }, [player, choice, customVersion]);

  useEffect(() => {
    player.setVolume(volume);
  }, [player, volume]);

  // Unlock on the first user gesture so later programmatic plays are allowed.
  useEffect(() => {
    const unlock = () => player.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [player]);

  useEffect(() => () => player.dispose(), [player]);

  const notifyMentionSound = useCallback(
    (msg: Message, ctx: MentionSoundContext) => {
      if (!enabled) return;
      if (msg.outgoing) return;

      const qualifies = msg.type === 'PRIV' || (msg.type === 'CHAN' && ctx.hasMention);
      if (!qualifies) return;

      // Focus rule: suppress only when both focused AND already viewing it.
      if (ctx.isForActiveConversation && isDocumentFocused()) return;

      // Per-conversation sound mute.
      const convType = msg.type === 'PRIV' ? 'contact' : 'channel';
      if (isConversationSoundMuted(convType, msg.conversation_key)) return;

      player.play();
    },
    [enabled, player, isDocumentFocused]
  );

  return { notifyMentionSound };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/useMentionSound.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useMentionSound.ts frontend/src/test/useMentionSound.test.ts
git commit -m "feat(chat): useMentionSound hook with trigger rules"
```

---

## Task 10: Wire the sound callback into the WebSocket path and App

**Files:**
- Modify: `frontend/src/hooks/useRealtimeAppState.ts` (args interface ~64, destructure ~117, `onMessage` ~224, `useMemo` deps ~327)
- Modify: `frontend/src/App.tsx` (call `useMentionSound` ~103; pass callback into `useRealtimeAppState` ~478)
- Test: extend `frontend/src/test/useRealtimeAppState.test.ts`

- [ ] **Step 1: Write the failing test** (append to `frontend/src/test/useRealtimeAppState.test.ts`, mirroring the existing `onChannelMention` tests)

```typescript
  it('fires notifyMentionSound for a new incoming DM with active/mention context', () => {
    const notifyMentionSound = vi.fn();
    const handlers = renderRealtime({
      ...baseArgs,
      notifyMentionSound,
    });
    handlers.onMessage!(incomingDm); // reuse the existing incomingDm fixture
    expect(notifyMentionSound).toHaveBeenCalledWith(
      incomingDm,
      expect.objectContaining({ isForActiveConversation: expect.any(Boolean), hasMention: expect.any(Boolean) })
    );
  });

  it('does not fire notifyMentionSound for a muted channel', () => {
    const notifyMentionSound = vi.fn();
    const handlers = renderRealtime({
      ...baseArgs,
      channelsRef: { current: [{ key: incomingChan.conversation_key, muted: true }] } as never,
      notifyMentionSound,
    });
    handlers.onMessage!(incomingChan);
    expect(notifyMentionSound).not.toHaveBeenCalled();
  });
```

Note: match the existing test file's helper names (`renderRealtime`/`baseArgs`/`incomingDm`/`incomingChan`). Grep the file first and adapt.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/useRealtimeAppState.test.ts`
Expected: FAIL (`notifyMentionSound` never called).

- [ ] **Step 3: Add the callback to the args interface** (`useRealtimeAppState.ts`, after `onChannelMention?` ~line 67)

```typescript
  /** Fired for every new, incoming, non-muted message so the caller can decide
   *  whether to play the mention/DM sound. ctx carries the active-conversation
   *  and mention flags computed here. */
  notifyMentionSound?: (
    msg: Message,
    ctx: { isForActiveConversation: boolean; hasMention: boolean }
  ) => void;
```

- [ ] **Step 4: Destructure it** (in the `useRealtimeAppState({ ... })` param list, after `onChannelMention,` ~line 117)

```typescript
  notifyMentionSound,
```

- [ ] **Step 5: Call it in `onMessage`** (after the `notifyIncomingMessage?.(msg);` block ~line 226)

```typescript
        if (!msg.outgoing && isNewMessage && !isMutedChannel) {
          notifyMentionSound?.(msg, {
            isForActiveConversation: isForActiveConversation,
            hasMention: msg.type === 'CHAN' ? checkMention(msg.text) : false,
          });
        }
```

- [ ] **Step 6: Add to the `useMemo` dependency array** (~line 328, next to `onChannelMention,`)

```typescript
      notifyMentionSound,
```

- [ ] **Step 7: Wire in `App.tsx`**

After the `useBrowserNotifications()` block (~line 102), and once `appSettings` is available (it is destructured later; place this call after `appSettings` exists — near where `handleChannelMention` is defined, ~line 273, AFTER appSettings is in scope). Add:

```typescript
  const { notifyMentionSound } = useMentionSound({
    enabled: appSettings?.mention_sound_enabled ?? false,
    choice: appSettings?.mention_sound_choice ?? 'beep',
    volume: appSettings?.mention_sound_volume ?? 80,
    customVersion: appSettings?.mention_sound_custom?.updated_at ?? null,
  });
```

Add the import at the top of `App.tsx`:

```typescript
import { useMentionSound } from './hooks/useMentionSound';
```

Pass it into the `useRealtimeAppState({ ... })` call (after `onChannelMention: handleChannelMention,` ~line 479):

```typescript
    notifyMentionSound,
```

Note on ordering: `useMentionSound` must be called before `useRealtimeAppState` and after `appSettings` is destructured. If `appSettings` is destructured below line 455, move the `useMentionSound` call to just before the `useRealtimeAppState` call. Verify by reading the surrounding lines; React hooks must run unconditionally in a stable order.

- [ ] **Step 8: Run tests + build**

Run:
```bash
cd frontend && npx vitest run src/test/useRealtimeAppState.test.ts && npm run build
```
Expected: tests PASS, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/useRealtimeAppState.ts frontend/src/App.tsx frontend/src/test/useRealtimeAppState.test.ts
git commit -m "feat(chat): play mention/DM sound from the websocket message path"
```

---

## Task 11: Settings UI subsection + i18n

**Files:**
- Modify: `frontend/src/components/settings/SettingsLocalSection.tsx` (new subsection near the chat group ~554)
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`
- Test: `frontend/src/test/settingsMentionSound.test.tsx`

- [ ] **Step 1: Add i18n keys** to all three locale files (translate the values for nl/de; keep keys identical). Keys:

```
settings_mention_sound_group_title
settings_mention_sound_enable_label
settings_mention_sound_enable_desc
settings_mention_sound_preset_label
settings_mention_sound_volume_label
settings_mention_sound_test
settings_mention_sound_custom_label
settings_mention_sound_custom_upload
settings_mention_sound_custom_replace
settings_mention_sound_custom_remove
settings_mention_sound_custom_none
settings_mention_sound_upload_error
settings_mention_sound_too_large
```

English values (add matching nl/de translations):

```json
  "settings_mention_sound_group_title": "MENTION & DM SOUND",
  "settings_mention_sound_enable_label": "Play a sound on mentions and DMs",
  "settings_mention_sound_enable_desc": "Plays when you are @mentioned in a channel or receive a direct message, unless you are already viewing that conversation.",
  "settings_mention_sound_preset_label": "Sound",
  "settings_mention_sound_volume_label": "Volume",
  "settings_mention_sound_test": "Test",
  "settings_mention_sound_custom_label": "Custom sound",
  "settings_mention_sound_custom_upload": "Upload sound",
  "settings_mention_sound_custom_replace": "Replace",
  "settings_mention_sound_custom_remove": "Remove",
  "settings_mention_sound_custom_none": "No custom sound uploaded",
  "settings_mention_sound_upload_error": "Failed to upload sound",
  "settings_mention_sound_too_large": "Sound file must be 256 KB or smaller"
```

- [ ] **Step 2: Write the failing test**

```typescript
// frontend/src/test/settingsMentionSound.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsLocalSection } from '../components/settings/SettingsLocalSection';
import type { AppSettings } from '../types';

// Reuse whatever minimal AppSettings factory other SettingsLocalSection tests use.
function makeSettings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    // ... spread a base object; grep settingsModal.test.tsx for an existing factory
    mention_sound_enabled: false,
    mention_sound_choice: 'beep',
    mention_sound_volume: 80,
    mention_sound_custom: null,
    ...over,
  } as AppSettings;
}

describe('SettingsLocalSection mention sound', () => {
  it('toggles the enable checkbox via onSaveAppSettings', () => {
    const onSave = vi.fn();
    render(
      <SettingsLocalSection
        appSettings={makeSettings()}
        onSaveAppSettings={onSave}
        /* provide the other required props as the existing tests do */
      />
    );
    const cb = screen.getByLabelText(/Play a sound on mentions and DMs/i);
    fireEvent.click(cb);
    expect(onSave).toHaveBeenCalledWith({ mention_sound_enabled: true });
  });
});
```

Note: read `frontend/src/test/settingsModal.test.tsx` / `settingsHandyInfoSection.test.tsx` for the exact required prop set + any test providers/i18n wrapper, and mirror them.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/test/settingsMentionSound.test.tsx`
Expected: FAIL (control not rendered).

- [ ] **Step 4: Add the subsection** to `SettingsLocalSection.tsx`, after the chat group block (~line 573 area). Add imports at the top of the file:

```typescript
import { useRef, useState } from 'react';
import { api } from '../../api';
import { toast } from '../ui/sonner';
import { createMentionSoundPlayer } from '../../lib/mentionSound';
import { MENTION_SOUND_PRESET_IDS, mentionSoundUrl } from '../../lib/mentionSoundPresets';
```

(If some of these are already imported, merge rather than duplicate.)

Inside the component body (near the other local hooks), add a stable player ref for the Test button:

```typescript
  const testPlayerRef = useRef(createMentionSoundPlayer());
  const soundFileRef = useRef<HTMLInputElement>(null);
  const [soundUploadBusy, setSoundUploadBusy] = useState(false);
```

JSX (place after the chat group's last checkbox, before the closing of that group container):

```tsx
          <div className="pt-1 text-[0.6875rem] font-medium uppercase tracking-wider text-muted-foreground">
            {t('settings_mention_sound_group_title')}
          </div>

          <div className="flex items-start gap-3 rounded-md border border-border/60 p-3">
            <Checkbox
              id="mention-sound-enabled"
              checked={appSettings?.mention_sound_enabled ?? false}
              onCheckedChange={(checked) =>
                onSaveAppSettings?.({ mention_sound_enabled: checked === true })
              }
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="mention-sound-enabled">
                {t('settings_mention_sound_enable_label')}
              </Label>
              <p className="text-[0.8125rem] text-muted-foreground">
                {t('settings_mention_sound_enable_desc')}
              </p>
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border/60 p-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="mention-sound-preset" className="w-20 shrink-0">
                {t('settings_mention_sound_preset_label')}
              </Label>
              <select
                id="mention-sound-preset"
                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                value={appSettings?.mention_sound_choice ?? 'beep'}
                onChange={(e) => onSaveAppSettings?.({ mention_sound_choice: e.target.value })}
              >
                {MENTION_SOUND_PRESET_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
                {appSettings?.mention_sound_custom ? (
                  <option value="custom">custom</option>
                ) : null}
              </select>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent"
                onClick={() => {
                  const p = testPlayerRef.current;
                  p.setVolume(appSettings?.mention_sound_volume ?? 80);
                  p.setSource(
                    mentionSoundUrl(
                      appSettings?.mention_sound_choice ?? 'beep',
                      appSettings?.mention_sound_custom?.updated_at ?? null
                    )
                  );
                  p.unlock();
                  p.play();
                }}
              >
                {t('settings_mention_sound_test')}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="mention-sound-volume" className="w-20 shrink-0">
                {t('settings_mention_sound_volume_label')}
              </Label>
              <input
                id="mention-sound-volume"
                type="range"
                min={0}
                max={100}
                value={appSettings?.mention_sound_volume ?? 80}
                onChange={(e) =>
                  onSaveAppSettings?.({ mention_sound_volume: Number(e.target.value) })
                }
                className="flex-1"
              />
              <span className="w-8 text-right text-sm text-muted-foreground">
                {appSettings?.mention_sound_volume ?? 80}
              </span>
            </div>

            <div className="space-y-1">
              <Label>{t('settings_mention_sound_custom_label')}</Label>
              <p className="text-[0.8125rem] text-muted-foreground">
                {appSettings?.mention_sound_custom
                  ? appSettings.mention_sound_custom.filename
                  : t('settings_mention_sound_custom_none')}
              </p>
              <div className="flex gap-2 pt-1">
                <input
                  ref={soundFileRef}
                  type="file"
                  accept=".mp3,.wav,.ogg,.m4a,.aac,audio/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (file.size > 256 * 1024) {
                      toast.error(t('settings_mention_sound_too_large'));
                      return;
                    }
                    setSoundUploadBusy(true);
                    try {
                      await api.uploadMentionSound(file);
                      onSaveAppSettings?.({ mention_sound_choice: 'custom' });
                    } catch (err) {
                      toast.error(
                        err instanceof Error ? err.message : t('settings_mention_sound_upload_error')
                      );
                    } finally {
                      setSoundUploadBusy(false);
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={soundUploadBusy}
                  className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent disabled:opacity-50"
                  onClick={() => soundFileRef.current?.click()}
                >
                  {appSettings?.mention_sound_custom
                    ? t('settings_mention_sound_custom_replace')
                    : t('settings_mention_sound_custom_upload')}
                </button>
                {appSettings?.mention_sound_custom ? (
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-sm hover:bg-accent"
                    onClick={async () => {
                      try {
                        await api.deleteMentionSound();
                        onSaveAppSettings?.({ mention_sound_choice: 'beep' });
                      } catch {
                        toast.error(t('settings_mention_sound_upload_error'));
                      }
                    }}
                  >
                    {t('settings_mention_sound_custom_remove')}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
```

Note: after `onSaveAppSettings` following an upload/delete, the parent refetches settings (`handleSaveAppSettings` calls `fetchAppSettings`), so `mention_sound_custom` metadata refreshes and the `updated_at` cache-buster updates.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/test/settingsMentionSound.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify i18n parity + lint/format**

Run:
```bash
cd frontend && npm run test:run -- src/test/i18n && npm run lint && npm run format:check
```
Expected: parity test PASS; lint/format clean (run `npx prettier --write` on changed files if format:check flags them).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/settings/SettingsLocalSection.tsx frontend/src/i18n/locales/*.json frontend/src/test/settingsMentionSound.test.tsx
git commit -m "feat(settings): mention-sound settings UI (enable, preset, volume, test, upload)"
```

---

## Task 12: Per-conversation "mute sound" toggle in the conversation header

**Files:**
- Modify: `frontend/src/App.tsx` (add `soundMuted` / `onToggleSoundMute` to the `ConversationPane` props block ~716-730)
- Modify: `frontend/src/components/ConversationPane.tsx` (accept the two props; render a small mute-sound button next to the existing notifications button)
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`
- Test: reuse existing ConversationPane/App tests; add a focused unit test only if a header test already exists.

First read the existing notifications button in `ConversationPane.tsx` (grep `onToggleNotifications` / `notificationsEnabled`) and mirror it exactly for the sound-mute control.

- [ ] **Step 1: Add i18n keys** (all three locales):

```json
  "conversation_sound_mute": "Mute mention sound for this conversation",
  "conversation_sound_unmute": "Unmute mention sound for this conversation"
```

- [ ] **Step 2: App.tsx — provide state + handler.** Add a state version counter so toggling re-renders:

Near the other conversation-scoped state (~line 88):

```typescript
  const [soundMuteVersion, setSoundMuteVersion] = useState(0);
```

Add imports:

```typescript
import { isConversationSoundMuted, toggleConversationSoundMuted } from './lib/mentionSoundMute';
```

In the `ConversationPane` props block (~after `onToggleNotifications` ~line 730), add:

```typescript
    soundMuted:
      activeConversation?.type === 'contact' || activeConversation?.type === 'channel'
        ? (soundMuteVersion, isConversationSoundMuted(activeConversation.type, activeConversation.id))
        : false,
    onToggleSoundMute: () => {
      if (activeConversation?.type === 'contact' || activeConversation?.type === 'channel') {
        toggleConversationSoundMuted(activeConversation.type, activeConversation.id);
        setSoundMuteVersion((v) => v + 1);
      }
    },
```

(The `(soundMuteVersion, ...)` comma expression forces the value to recompute when the version changes; equivalently, reference `soundMuteVersion` on the line above.)

- [ ] **Step 3: ConversationPane.tsx — accept and render.** Add the two props to its Props interface:

```typescript
  soundMuted?: boolean;
  onToggleSoundMute?: () => void;
```

Render a button next to the notifications button, mirroring its markup (use a `lucide-react` icon such as `Volume2` / `VolumeX`):

```tsx
{onToggleSoundMute ? (
  <button
    type="button"
    onClick={onToggleSoundMute}
    title={soundMuted ? t('conversation_sound_unmute') : t('conversation_sound_mute')}
    className="/* copy the className from the adjacent notifications button */"
  >
    {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
  </button>
) : null}
```

Add the icon import: `import { Volume2, VolumeX } from 'lucide-react';` (merge into the existing lucide import).

- [ ] **Step 4: Run frontend tests + build**

Run:
```bash
cd frontend && npm run test:run && npm run build
```
Expected: all tests PASS (including i18n parity), build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/ConversationPane.tsx frontend/src/i18n/locales/*.json
git commit -m "feat(chat): per-conversation mention-sound mute toggle in the header"
```

---

## Task 13: Documentation

**Files:**
- Modify: `CHANGELOG-DMC-EV.md`
- Modify: `README.md` (feature list / settings docs; also `README_ADVANCED.md` if it enumerates chat/notification features)

- [ ] **Step 1: Add a `CHANGELOG-DMC-EV.md` entry** following the existing grouped format (under a chat/frontend area). Include: mention & DM notification sound (global toggle, 5 presets + custom upload up to 256 KB, volume, Test, per-conversation mute), migration `_088`, and the autoplay caveat (a tab that never received a user gesture may block the first play).

- [ ] **Step 2: Update `README.md`** feature list + settings section to mention the new sound option. Grep for where `show_mention_ticker` / notifications are documented and add alongside.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG-DMC-EV.md README.md README_ADVANCED.md
git commit -m "docs: document mention/DM notification sound feature"
```

---

## Task 14: Manual runtime verification

CLAUDE.md requires observed runtime behaviour, not just green tests. Rebuild the local Docker instance on this branch (see the "Local Docker instance" memory) and verify in a real browser.

- [ ] **Step 1:** Rebuild/redeploy `rtfm-ev-local` on this branch and open it.
- [ ] **Step 2:** In Settings → Local, enable the sound, pick a preset, set volume, click Test — confirm audio plays.
- [ ] **Step 3:** Upload a custom MP3 (< 256 KB); confirm the dropdown shows "custom", Test plays it, and reload persists it.
- [ ] **Step 4:** With the app open on a DIFFERENT conversation (or tab unfocused), have a DM and a channel `@[you]` arrive; confirm the sound plays. With the exact conversation focused, confirm it does NOT.
- [ ] **Step 5:** Toggle per-conversation mute; confirm the sound is suppressed for that conversation only.
- [ ] **Step 6:** Try oversize (>256 KB) and a non-audio file; confirm the UI shows the error and the server rejects (413/415).
- [ ] **Step 7:** Record what was observed (pass/fail per step) in the PR description / session notes. Mark anything not verified as NOT VERIFIED.

---

## Task 15: Full CI-equivalent gate (before any push)

Per `docs/agents/ci-checks.md`. Backend runs in the container (Windows host lacks Python deps).

- [ ] **Step 1: Backend gate (container)**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "/$(pwd)://work" -w "//work" \
  -e UV_PROJECT_ENVIRONMENT=/app/.venv rtfm-ev-local:latest bash -lc "\
  apt-get update -qq && apt-get install -y -qq libatomic1 >/dev/null 2>&1; \
  uv sync --dev && \
  uv run ruff check app/ tests/ && \
  uv run ruff format --check app/ tests/ && \
  uv run pyright app/ && \
  PYTHONPATH=/work uv run pytest tests/ -q"
```

Expected: all four steps green. Fix import order with `uv run ruff check --fix app/ tests/`, formatting with `uv run ruff format app/ tests/`. (Pre-existing Windows-only failures noted in memory are not from this change; verify any failure is unrelated before dismissing it.)

- [ ] **Step 2: Frontend gate**

```bash
cd frontend
npm run lint
npm run format:check
npm run test:run
npm run build
```

Expected: all green. Fix prettier with `npx prettier --write` on changed files only.

- [ ] **Step 3:** Do not push or open a PR unless explicitly instructed (CLAUDE.md Git Rules). If instructed, target the fork `origin` (Elektr0Vodka/RTFM-EV).

---

## Self-review notes (author)

- Spec coverage: trigger rules (Task 9/10), global settings (Task 2/3), presets (Task 1/6), custom upload table+endpoints (Task 2/4/5), playback module (Task 7), per-conversation mute (Task 8/12), settings UI (Task 11), i18n (Task 11/12), docs (Task 13), runtime verify (Task 14), CI gate (Task 15).
- Type consistency: `notifyMentionSound(msg, { isForActiveConversation, hasMention })` identical in the hook (Task 9), the WS interface (Task 10), and the call site (Task 10). `mention_sound_choice`/`mention_sound_enabled`/`mention_sound_volume`/`mention_sound_custom` identical across backend model, TS types, and UI. Preset ids identical (`mentionSoundPresets.ts` is the single source; backend `DEFAULT_MENTION_SOUND_PRESET='beep'` matches).
- Known follow-up flagged in spec (out of scope): distinct sounds for mention vs DM, DND schedule, service-worker background playback.
