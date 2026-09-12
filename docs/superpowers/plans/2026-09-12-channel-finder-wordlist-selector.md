# Channel-finder Wordlist Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a wordlist selector to the channel finder that lets users enable English and a bundled Dutch dictionary, and upload their own server-stored wordlists, all merged into the cracker.

**Architecture:** Bundled English (from `meshcore-hashtag-cracker`) and a normalized Dutch list (`frontend/public/wordlists/nl.txt`) are client-side; user uploads are normalized server-side, stored as files under the data dir with metadata in a new `wordlists` table, and fetched on demand. The selector (persisted per-browser in localStorage) chooses which bases are active; the existing synced + registry candidates are still merged on top. A single canonical normalizer conforms every entry to the MeshCore hashtag-room charset (`a-z0-9-`, no leading/trailing/double hyphens, max 30 chars).

**Tech Stack:** FastAPI + aiosqlite (backend), React + TypeScript + Vite + Vitest (frontend), pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-09-12-channel-finder-wordlist-selector-design.md`

**Repo conventions:**
- No em dashes in any output or code comments.
- Commit only when the human authorises it (repo Git Rules). Do not push/PR without instruction. No AI attribution lines.
- Backend tests run in the `rtfm-ev-local` container (worktree bind-mounted to `/work`, venv at `/app/.venv`). See the memory "Run backend tests in container".
- New user-facing strings need `t()` keys in en/nl/de (parity test enforces this).
- Run `npm --prefix frontend run format:check` and `lint` before considering frontend work done (prettier is a separate CI gate).

---

## File Structure

New backend files:
- `app/wordlist_normalize.py` - canonical normalizer (pure, no deps beyond `re`).
- `app/migrations/_080_create_wordlists.py` - creates the `wordlists` table.
- `app/repository/wordlists.py` - `WordlistRepository` + `wordlists_dir()`.
- `app/routers/wordlists.py` - upload/list/words/delete endpoints.
- `scripts/normalize_wordlist.py` - one-off tool to normalize the Dutch source into `nl.txt`.
- `tests/test_wordlist_normalize.py`, `tests/test_wordlists_router.py`.

New frontend files:
- `frontend/public/wordlists/nl.txt` - generated, normalized Dutch list.
- `frontend/src/lib/wordlistSelection.ts` - selection load/save.
- `frontend/src/test/wordlistSelection.test.ts`.

Modified:
- `app/repository/__init__.py`, `app/main.py`, `tests/conftest.py`.
- `frontend/src/api.ts`, `frontend/src/types.ts`, `frontend/src/components/CrackerPanel.tsx`.
- `frontend/src/i18n/locales/{en,nl,de}.json`.

---

## Task 1: Backend wordlist normalizer

**Files:**
- Create: `app/wordlist_normalize.py`
- Test: `tests/test_wordlist_normalize.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_wordlist_normalize.py`:

```python
"""Tests for the canonical channel-finder wordlist normalizer."""

from app.wordlist_normalize import normalize_word, normalize_wordlist_text


class TestNormalizeWord:
    def test_lowercases(self):
        assert normalize_word("Amsterdam") == "amsterdam"

    def test_strips_spaces_and_apostrophes(self):
        assert normalize_word("10 eurobiljet") == "10eurobiljet"
        assert normalize_word("auto's") == "autos"
        assert normalize_word("100+'er") == "100er"

    def test_keeps_digits_and_single_hyphens(self):
        assert normalize_word("06-dealer") == "06-dealer"
        assert normalize_word("010") == "010"

    def test_collapses_double_hyphens_and_trims_edges(self):
        assert normalize_word("-foo--bar-") == "foo-bar"

    def test_drops_empty_after_stripping(self):
        assert normalize_word("###") is None
        assert normalize_word("   ") is None

    def test_drops_over_30_chars(self):
        assert normalize_word("a" * 31) is None
        assert normalize_word("a" * 30) == "a" * 30


class TestNormalizeWordlistText:
    def test_dedupes_case_insensitively_preserving_order(self):
        assert normalize_wordlist_text("Amsterdam\nauto's\nAUTOS\namsterdam") == [
            "amsterdam",
            "autos",
        ]

    def test_drops_blank_and_invalid_lines(self):
        assert normalize_wordlist_text("ok\n\n###\nfine") == ["ok", "fine"]

    def test_handles_crlf(self):
        assert normalize_wordlist_text("a\r\nb\r\n") == ["a", "b"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_wordlist_normalize.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.wordlist_normalize'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/wordlist_normalize.py`:

```python
"""Canonical normalizer for channel-finder wordlists.

Conforms each entry to the MeshCore hashtag-room name charset: lowercase
``[a-z0-9-]``, no leading/trailing/double hyphens, max 30 characters (the
channel key is the first 16 bytes of ``SHA256("#" + name)``). Anything outside
this charset can never match a real hashtag room, so it is stripped. Used both
for user uploads (server-side) and to pre-normalize the bundled Dutch list.
"""

import re

MAX_ROOM_NAME_LEN = 30

_INVALID = re.compile(r"[^a-z0-9-]")
_MULTI_HYPHEN = re.compile(r"-{2,}")


def normalize_word(raw: str) -> str | None:
    """Normalize a single candidate. Returns None if it cannot be a valid name."""
    word = raw.strip().lower()
    word = _INVALID.sub("", word)
    word = _MULTI_HYPHEN.sub("-", word)
    word = word.strip("-")
    if not word or len(word) > MAX_ROOM_NAME_LEN:
        return None
    return word


def normalize_wordlist_text(raw: str) -> list[str]:
    """Normalize a whole file's text into a deduplicated, ordered word list."""
    out: list[str] = []
    seen: set[str] = set()
    for line in raw.splitlines():
        word = normalize_word(line)
        if word is None or word in seen:
            continue
        seen.add(word)
        out.append(word)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_wordlist_normalize.py -v`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add app/wordlist_normalize.py tests/test_wordlist_normalize.py
git commit -m "feat(cracker): add canonical wordlist normalizer"
```

---

## Task 2: `wordlists` table migration

**Files:**
- Create: `app/migrations/_080_create_wordlists.py`

- [ ] **Step 1: Write the migration**

Create `app/migrations/_080_create_wordlists.py`:

```python
import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``wordlists`` for user-uploaded channel-finder wordlists.

    Metadata only: the normalized word file lives on disk under
    ``<data_dir>/wordlists/<id>.txt``, never in the database. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS wordlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            filename TEXT NOT NULL,
            entry_count INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )
        """
    )
    await conn.commit()
```

- [ ] **Step 2: Verify the migration applies on a fresh DB**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -c "import asyncio; from app.database import Database; \
async def m():\n    db=Database(':memory:');\n    await db.connect();\n    async with db.readonly() as c:\n        cur=await c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='wordlists'\");\n        print(await cur.fetchone());\n    await db.disconnect()\nasyncio.run(m())"`

Expected: prints a row containing `wordlists` (not `None`).

If the inline heredoc is awkward in your shell, instead add a temporary test that connects a `:memory:` `Database()` and asserts the table exists, run it, then delete it. The point is to observe the table is created.

- [ ] **Step 3: Commit**

```bash
git add app/migrations/_080_create_wordlists.py
git commit -m "feat(cracker): add wordlists table migration"
```

---

## Task 3: `WordlistRepository`

**Files:**
- Create: `app/repository/wordlists.py`
- Modify: `app/repository/__init__.py`
- Modify: `tests/conftest.py`
- Test: covered by Task 4's router tests plus a direct repo test below.

- [ ] **Step 1: Write the failing test**

Create `tests/test_wordlists_repository.py`:

```python
"""Tests for WordlistRepository (DB row + on-disk file)."""

import pytest

from app.repository import WordlistRepository


@pytest.fixture
def _wordlist_dir(tmp_path, monkeypatch):
    """Point wordlist file storage at an isolated tmp dir per test."""
    from app.config import settings

    monkeypatch.setattr(settings, "database_path", str(tmp_path / "meshcore.db"))
    return tmp_path / "wordlists"


class TestWordlistRepository:
    @pytest.mark.asyncio
    async def test_create_writes_row_and_file(self, test_db, _wordlist_dir):
        meta = await WordlistRepository.create("dutch", ["amsterdam", "utrecht"])
        assert meta["name"] == "dutch"
        assert meta["entry_count"] == 2
        rows = await WordlistRepository.list_all()
        assert len(rows) == 1
        assert (_wordlist_dir / f"{meta['id']}.txt").read_text(encoding="utf-8") == (
            "amsterdam\nutrecht\n"
        )

    @pytest.mark.asyncio
    async def test_read_words_round_trips(self, test_db, _wordlist_dir):
        meta = await WordlistRepository.create("x", ["a", "b"])
        assert await WordlistRepository.read_words(meta["id"]) == ["a", "b"]

    @pytest.mark.asyncio
    async def test_read_words_missing_returns_none(self, test_db, _wordlist_dir):
        assert await WordlistRepository.read_words(999) is None

    @pytest.mark.asyncio
    async def test_delete_removes_row_and_file(self, test_db, _wordlist_dir):
        meta = await WordlistRepository.create("x", ["a"])
        path = _wordlist_dir / f"{meta['id']}.txt"
        assert path.exists()
        assert await WordlistRepository.delete(meta["id"]) is True
        assert await WordlistRepository.list_all() == []
        assert not path.exists()

    @pytest.mark.asyncio
    async def test_delete_unknown_returns_false(self, test_db, _wordlist_dir):
        assert await WordlistRepository.delete(123) is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_wordlists_repository.py -v`
Expected: FAIL with `ImportError: cannot import name 'WordlistRepository'`.

- [ ] **Step 3: Write the repository**

Create `app/repository/wordlists.py`:

```python
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
```

- [ ] **Step 4: Export the repository**

In `app/repository/__init__.py`, add the import (alphabetical, after `settings`) and the `__all__` entry:

```python
from app.repository.settings import AppSettingsRepository, StatisticsRepository
from app.repository.wordlists import WordlistRepository
```

Add `"WordlistRepository",` to the `__all__` list (keep it sorted).

- [ ] **Step 5: Wire the repo module into the test DB fixture**

In `tests/conftest.py`, the `test_db` fixture swaps `mod.db` for each repository submodule. Add the new module so repo calls hit the in-memory DB.

In the `from app.repository import (...)` block inside `test_db`, add `wordlists` to the imported names. Then add `wordlists,` to the `submodules = [...]` list.

- [ ] **Step 6: Run test to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_wordlists_repository.py -v`
Expected: PASS (all cases).

- [ ] **Step 7: Commit**

```bash
git add app/repository/wordlists.py app/repository/__init__.py tests/conftest.py tests/test_wordlists_repository.py
git commit -m "feat(cracker): add WordlistRepository with on-disk storage"
```

---

## Task 4: Wordlists router

**Files:**
- Create: `app/routers/wordlists.py`
- Modify: `app/main.py`
- Test: `tests/test_wordlists_router.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_wordlists_router.py`:

```python
"""Tests for the wordlists upload/list/words/delete router."""

import pytest


@pytest.fixture(autouse=True)
def _wordlist_dir(tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "database_path", str(tmp_path / "meshcore.db"))


class TestWordlistsRouter:
    @pytest.mark.asyncio
    async def test_upload_normalizes_and_persists(self, test_db, client):
        files = {"file": ("nl.txt", b"Amsterdam\nauto's\n###\nAMSTERDAM\n", "text/plain")}
        resp = await client.post("/api/wordlists", data={"name": "dutch"}, files=files)
        assert resp.status_code == 200
        meta = resp.json()
        assert meta["name"] == "dutch"
        assert meta["entry_count"] == 2  # amsterdam, autos (dedup + strip)

        words = (await client.get(f"/api/wordlists/{meta['id']}/words")).json()["words"]
        assert words == ["amsterdam", "autos"]

    @pytest.mark.asyncio
    async def test_upload_rejects_blank_name(self, test_db, client):
        files = {"file": ("w.txt", b"amsterdam\n", "text/plain")}
        resp = await client.post("/api/wordlists", data={"name": "  "}, files=files)
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_upload_rejects_empty_after_normalize(self, test_db, client):
        files = {"file": ("w.txt", b"###\n   \n", "text/plain")}
        resp = await client.post("/api/wordlists", data={"name": "junk"}, files=files)
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_latin1_fallback(self, test_db, client):
        # 0xe9 is 'e-acute' in latin-1 and invalid UTF-8; must not crash.
        files = {"file": ("w.txt", b"caf\xe9\n", "text/plain")}
        resp = await client.post("/api/wordlists", data={"name": "x"}, files=files)
        assert resp.status_code == 200
        assert resp.json()["entry_count"] == 1  # "caf" + stripped accent -> "caf"

    @pytest.mark.asyncio
    async def test_list_and_delete(self, test_db, client):
        files = {"file": ("w.txt", b"amsterdam\n", "text/plain")}
        meta = (await client.post("/api/wordlists", data={"name": "x"}, files=files)).json()

        listing = (await client.get("/api/wordlists")).json()["wordlists"]
        assert [w["id"] for w in listing] == [meta["id"]]

        resp = await client.delete(f"/api/wordlists/{meta['id']}")
        assert resp.status_code == 204
        assert (await client.get("/api/wordlists")).json()["wordlists"] == []

    @pytest.mark.asyncio
    async def test_words_404_for_unknown(self, test_db, client):
        assert (await client.get("/api/wordlists/999/words")).status_code == 404

    @pytest.mark.asyncio
    async def test_delete_404_for_unknown(self, test_db, client):
        assert (await client.delete("/api/wordlists/999")).status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_wordlists_router.py -v`
Expected: FAIL (404 for `/api/wordlists`, router not registered).

- [ ] **Step 3: Write the router**

Create `app/routers/wordlists.py`:

```python
import logging
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.repository import WordlistRepository
from app.wordlist_normalize import normalize_wordlist_text

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/wordlists", tags=["wordlists"])


class WordlistMeta(BaseModel):
    id: int
    name: str
    entry_count: int
    size_bytes: int
    created_at: int


class WordlistListResponse(BaseModel):
    wordlists: list[WordlistMeta]


class WordlistWordsResponse(BaseModel):
    words: list[str]


@router.get("", response_model=WordlistListResponse)
async def list_wordlists() -> WordlistListResponse:
    """List uploaded wordlist metadata (newest first)."""
    rows = await WordlistRepository.list_all()
    return WordlistListResponse(wordlists=[WordlistMeta(**row) for row in rows])


@router.post("", response_model=WordlistMeta)
async def upload_wordlist(
    name: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
) -> WordlistMeta:
    """Upload a plain-text wordlist. Server normalizes and stores it.

    Normalization conforms each line to the hashtag-room charset (see
    ``app.wordlist_normalize``). Rejects a blank name or a file that yields no
    valid entries. No entry cap is enforced.
    """
    clean_name = name.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Wordlist name is required.")

    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")

    words = normalize_wordlist_text(text)
    if not words:
        raise HTTPException(
            status_code=400,
            detail="File contained no valid hashtag-room names after normalization.",
        )

    meta = await WordlistRepository.create(clean_name, words)
    logger.info("Uploaded wordlist '%s' with %d entries", clean_name, len(words))
    return WordlistMeta(**meta)


@router.get("/{wordlist_id}/words", response_model=WordlistWordsResponse)
async def get_wordlist_words(wordlist_id: int) -> WordlistWordsResponse:
    """Return a stored wordlist's words for the browser cracker to merge."""
    words = await WordlistRepository.read_words(wordlist_id)
    if words is None:
        raise HTTPException(status_code=404, detail="Wordlist not found.")
    return WordlistWordsResponse(words=words)


@router.delete("/{wordlist_id}", status_code=204)
async def delete_wordlist(wordlist_id: int) -> None:
    """Delete a wordlist row and its on-disk file."""
    deleted = await WordlistRepository.delete(wordlist_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Wordlist not found.")
```

- [ ] **Step 4: Register the router**

In `app/main.py`:

1. Add `wordlists,` to the `from app.routers import (...)` block, alphabetically between `update_status,` and `ws,`.
2. Add the include line next to the others (immediately after the `app.include_router(push.router, prefix="/api")` line is fine):

```python
app.include_router(wordlists.router, prefix="/api")
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_wordlists_router.py -v`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add app/routers/wordlists.py app/main.py tests/test_wordlists_router.py
git commit -m "feat(cracker): add wordlists upload/list/words/delete API"
```

---

## Task 5: Generate the bundled Dutch wordlist

**Files:**
- Create: `scripts/normalize_wordlist.py`
- Create (generated): `frontend/public/wordlists/nl.txt`

- [ ] **Step 1: Write the normalize script**

Create `scripts/normalize_wordlist.py`:

```python
"""One-off: normalize a plain-text wordlist into the bundled channel-finder file.

Usage:
    python scripts/normalize_wordlist.py <source.txt> <dest.txt>

Reuses the canonical server normalizer so the bundled Dutch list matches what
the upload endpoint produces.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.wordlist_normalize import normalize_wordlist_text  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python scripts/normalize_wordlist.py <source.txt> <dest.txt>")
        raise SystemExit(2)
    src, dst = sys.argv[1], sys.argv[2]
    with open(src, encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    words = normalize_wordlist_text(text)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(words) + "\n")
    print(f"Wrote {len(words)} words to {dst}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate `nl.txt` from the source file**

The Dutch source lives on the host at `C:\Users\Quicksilver.QuicksilverSSD\Downloads\wordlist.txt`.
Run from the worktree root (this uses only the stdlib `re`, so any Python 3 works):

```bash
python scripts/normalize_wordlist.py "C:/Users/Quicksilver.QuicksilverSSD/Downloads/wordlist.txt" frontend/public/wordlists/nl.txt
```

Expected: prints `Wrote <N> words to frontend/public/wordlists/nl.txt` where `<N>` is well below the 413,937 source lines (symbol-bearing and over-30-char entries are dropped/collapsed).

- [ ] **Step 3: Sanity-check the output**

Run:
```bash
head -5 frontend/public/wordlists/nl.txt
grep -cE "[^a-z0-9-]" frontend/public/wordlists/nl.txt
awk '{ if (length($0) > 30) c++ } END { print c+0 }' frontend/public/wordlists/nl.txt
```
Expected: the first command prints lowercase tokens; both counts print `0` (no invalid characters, no over-length lines).

- [ ] **Step 4: Commit**

```bash
git add scripts/normalize_wordlist.py frontend/public/wordlists/nl.txt
git commit -m "feat(cracker): add normalize script and bundled Dutch wordlist"
```

---

## Task 6: Frontend types and API client

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add the type**

In `frontend/src/types.ts`, add:

```typescript
export interface WordlistMeta {
  id: number;
  name: string;
  entry_count: number;
  size_bytes: number;
  created_at: number;
}
```

- [ ] **Step 2: Import the type in the API client**

In `frontend/src/api.ts`, add `WordlistMeta,` to the big `import type { ... } from './types';` block.

- [ ] **Step 3: Add the API methods**

In `frontend/src/api.ts`, inside the `export const api = { ... }` object (place after the channels group), add:

```typescript
  // Custom wordlists (channel finder)
  listWordlists: () => fetchJson<{ wordlists: WordlistMeta[] }>('/wordlists'),
  getWordlistWords: (id: number) => fetchJson<{ words: string[] }>(`/wordlists/${id}/words`),
  uploadWordlist: async (name: string, file: File): Promise<WordlistMeta> => {
    const form = new FormData();
    form.append('name', name);
    form.append('file', file);
    // Raw fetch so the browser sets multipart/form-data (not application/json).
    const res = await fetch(`${API_BASE}/wordlists`, { method: 'POST', body: form });
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
    return res.json() as Promise<WordlistMeta>;
  },
  deleteWordlist: async (id: number): Promise<void> => {
    // DELETE returns 204 (no body), so avoid fetchJson's res.json().
    const res = await fetch(`${API_BASE}/wordlists/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      throw new ApiError('Failed to delete wordlist', res.status);
    }
  },
```

- [ ] **Step 4: Type-check**

Run: `npm --prefix frontend run build`
Expected: build succeeds (no TS errors). If the project has a faster typecheck script, that is fine too.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(cracker): add wordlist API client methods and type"
```

---

## Task 7: Selection persistence library

**Files:**
- Create: `frontend/src/lib/wordlistSelection.ts`
- Test: `frontend/src/test/wordlistSelection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/wordlistSelection.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadSelection,
  saveSelection,
  DEFAULT_SELECTION,
} from '../lib/wordlistSelection';

const store: Record<string, string> = {};
beforeEach(() => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => store[k] ?? null);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => {
    store[k] = v;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const k of Object.keys(store)) delete store[k];
});

describe('wordlistSelection', () => {
  it('returns the default when nothing is stored', () => {
    expect(loadSelection()).toEqual(DEFAULT_SELECTION);
  });

  it('round-trips a saved selection', () => {
    saveSelection({ english: false, dutch: true, customIds: [1, 2] });
    expect(loadSelection()).toEqual({ english: false, dutch: true, customIds: [1, 2] });
  });

  it('falls back to default on malformed JSON', () => {
    store['meshcore-wordlist-selection'] = '{not json';
    expect(loadSelection()).toEqual(DEFAULT_SELECTION);
  });

  it('filters non-number custom ids', () => {
    store['meshcore-wordlist-selection'] = JSON.stringify({
      english: true,
      dutch: false,
      customIds: [1, 'x', null, 3],
    });
    expect(loadSelection().customIds).toEqual([1, 3]);
  });

  it('fills missing fields from the default', () => {
    store['meshcore-wordlist-selection'] = JSON.stringify({ dutch: true });
    expect(loadSelection()).toEqual({ english: true, dutch: true, customIds: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test -- --run wordlistSelection`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/wordlistSelection.ts`:

```typescript
// Per-browser persistence of which channel-finder wordlist bases are enabled.
// Cracking runs client-side and English/Dutch are client resources, so the
// SELECTION is a browser preference; custom-list CONTENTS live on the server
// and are referenced here only by id.

export interface WordlistSelection {
  english: boolean;
  dutch: boolean;
  customIds: number[];
}

const STORAGE_KEY = 'meshcore-wordlist-selection';

export const DEFAULT_SELECTION: WordlistSelection = {
  english: true,
  dutch: false,
  customIds: [],
};

/** Load the saved selection, falling back to the default on any error. */
export function loadSelection(): WordlistSelection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SELECTION };
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_SELECTION };
    return {
      english: typeof parsed.english === 'boolean' ? parsed.english : DEFAULT_SELECTION.english,
      dutch: typeof parsed.dutch === 'boolean' ? parsed.dutch : DEFAULT_SELECTION.dutch,
      customIds: Array.isArray(parsed.customIds)
        ? parsed.customIds.filter((n: unknown): n is number => typeof n === 'number')
        : [],
    };
  } catch {
    return { ...DEFAULT_SELECTION };
  }
}

/** Persist the selection. Silently no-ops if storage is unavailable. */
export function saveSelection(selection: WordlistSelection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Quota exceeded or storage unavailable: selection just will not persist.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test -- --run wordlistSelection`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/wordlistSelection.ts frontend/src/test/wordlistSelection.test.ts
git commit -m "feat(cracker): add wordlist selection persistence"
```

---

## Task 8: CrackerPanel base loaders and rebuild flow

**Files:**
- Modify: `frontend/src/components/CrackerPanel.tsx`

This task rewrites how the wordlist is assembled: instead of a one-time load of English + synced + registry when the panel becomes visible, it builds the merged list from the current selection and rebuilds when the selection or the custom lists change (while idle).

- [ ] **Step 1: Add imports and base loaders**

At the top of `frontend/src/components/CrackerPanel.tsx`, add to the existing imports:

```typescript
import type { RawPacket, Channel, WordlistMeta } from '../types';
import {
  loadSelection,
  saveSelection,
  type WordlistSelection,
} from '../lib/wordlistSelection';
```

(Merge the `WordlistMeta` into the existing `../types` import line; add the selection import as a new line.)

Above the `CrackerPanel` component function, add two module-level loaders:

```typescript
async function loadEnglishWordlist(): Promise<string[]> {
  const mod = await import('meshcore-hashtag-cracker/wordlist');
  return mod.ENGLISH_WORDLIST;
}

async function loadDutchWordlist(): Promise<string[]> {
  // Bundled static asset (frontend/public/wordlists/nl.txt), fetched on demand.
  const res = await fetch('wordlists/nl.txt');
  if (!res.ok) throw new Error(`nl.txt HTTP ${res.status}`);
  const text = await res.text();
  return text.split(/\r?\n/).filter((line) => line.length > 0);
}
```

- [ ] **Step 2: Add selection and custom-list state**

Inside the component, next to the other `useState` calls, add:

```typescript
  const [selection, setSelection] = useState<WordlistSelection>(() => loadSelection());
  const [customLists, setCustomLists] = useState<WordlistMeta[]>([]);
  const [showWordlists, setShowWordlists] = useState(false);
  const selectionRef = useRef<WordlistSelection>(selection);
```

Keep the ref in sync (add near the other ref-sync effects):

```typescript
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
```

- [ ] **Step 3: Replace the load-wordlist effect with a rebuild callback**

Replace the existing effect that starts with `// Load wordlist dynamically when panel becomes visible for the first time` (the `useEffect` importing `meshcore-hashtag-cracker/wordlist`) with a rebuild function plus an effect that runs it.

Add this `useCallback` (near `processNext`):

```typescript
  const rebuildWordlist = useCallback(async () => {
    if (!crackerRef.current) return;
    const sel = selectionRef.current;
    const bases: string[][] = [];
    try {
      if (sel.english) bases.push(await loadEnglishWordlist());
      if (sel.dutch) bases.push(await loadDutchWordlist());
      for (const id of sel.customIds) {
        try {
          const { words } = await api.getWordlistWords(id);
          bases.push(words);
        } catch (err) {
          console.error('Failed to load custom wordlist', id, err);
          toast.error(t('cracker_wordlist_custom_load_failed'));
        }
      }
      const merged = mergeWordlists(
        ...bases,
        loadSyncedWordlist(),
        loadRegistryWordlist()
      );
      crackerRef.current.setWordlist(merged);
      setWordlistLoaded(true);
    } catch (err) {
      console.error('Failed to build wordlist:', err);
      toast.error(t('toast_failed_load_wordlist'), {
        description: t('cracker_channel_finder_unavailable_desc'),
      });
    }
  }, [t]);
```

Add the driving effect (rebuild when visible or selection changes, but never mid-crack):

```typescript
  useEffect(() => {
    if (!visible || isRunning) return;
    void rebuildWordlist();
  }, [visible, isRunning, selection, rebuildWordlist]);
```

- [ ] **Step 4: Fetch custom lists when the panel is visible**

Add an effect that loads the custom-list metadata (and prunes selected ids that no longer exist):

```typescript
  useEffect(() => {
    if (!visible) return;
    api
      .listWordlists()
      .then(({ wordlists }) => {
        setCustomLists(wordlists);
        const ids = new Set(wordlists.map((w) => w.id));
        setSelection((prev) => {
          const kept = prev.customIds.filter((id) => ids.has(id));
          if (kept.length === prev.customIds.length) return prev;
          const next = { ...prev, customIds: kept };
          saveSelection(next);
          return next;
        });
      })
      .catch((err) => console.error('Failed to list wordlists:', err));
  }, [visible]);
```

- [ ] **Step 5: Persist selection whenever it changes**

Add:

```typescript
  useEffect(() => {
    saveSelection(selection);
  }, [selection]);
```

- [ ] **Step 6: Type-check**

Run: `npm --prefix frontend run build`
Expected: build succeeds. (UI wiring for toggles/upload/delete comes in Task 9; unused-var warnings for `setSelection`/`customLists`/`showWordlists`/`setShowWordlists` are expected until then. If the build fails on unused vars, proceed straight to Task 9 and type-check at its end instead.)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/CrackerPanel.tsx
git commit -m "feat(cracker): build wordlist from selection with rebuild flow"
```

---

## Task 9: CrackerPanel wordlist selector UI

**Files:**
- Modify: `frontend/src/components/CrackerPanel.tsx`

- [ ] **Step 1: Add upload/delete/toggle handlers**

Inside the component, add:

```typescript
  const refreshCustomLists = useCallback(async () => {
    const { wordlists } = await api.listWordlists();
    setCustomLists(wordlists);
    return wordlists;
  }, []);

  const handleUploadWordlist = useCallback(
    async (name: string, file: File) => {
      try {
        const meta = await api.uploadWordlist(name, file);
        await refreshCustomLists();
        setSelection((prev) => ({ ...prev, customIds: [...prev.customIds, meta.id] }));
        toast.success(t('toast_wordlist_uploaded', { name: meta.name }));
      } catch (err) {
        toast.error(t('toast_wordlist_upload_failed'), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [refreshCustomLists, t]
  );

  const handleDeleteWordlist = useCallback(
    async (id: number) => {
      try {
        await api.deleteWordlist(id);
        await refreshCustomLists();
        setSelection((prev) => ({
          ...prev,
          customIds: prev.customIds.filter((x) => x !== id),
        }));
        toast.success(t('toast_wordlist_deleted'));
      } catch (err) {
        toast.error(t('toast_wordlist_upload_failed'), {
          description: err instanceof Error ? err.message : undefined,
        });
      }
    },
    [refreshCustomLists, t]
  );
```

- [ ] **Step 2: Add the Wordlists button and panel to the toolbar**

In the toolbar `div` (the `flex items-center gap-3 flex-wrap` block), next to the existing "Sync from channels" button, add a Wordlists toggle button:

```tsx
        <button
          type="button"
          onClick={() => setShowWordlists((v) => !v)}
          disabled={isRunning}
          className="px-3 py-1 text-sm rounded border border-border bg-muted hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('cracker_wordlists_button')}
        </button>
```

Immediately after the toolbar `div` (before the Start/Stop button), add the panel:

```tsx
      {showWordlists && (
        <div className="rounded border border-border bg-muted/40 p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={selection.english}
              onChange={(e) => setSelection((prev) => ({ ...prev, english: e.target.checked }))}
              className="rounded"
            />
            {t('cracker_wordlist_english')}
          </label>

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={selection.dutch}
              onChange={(e) => setSelection((prev) => ({ ...prev, dutch: e.target.checked }))}
              className="rounded"
            />
            {t('cracker_wordlist_dutch')}
            {selection.dutch && (
              <span className="text-xs text-muted-foreground">
                ({t('cracker_wordlist_dutch_note')})
              </span>
            )}
          </label>

          {customLists.map((wl) => (
            <div key={wl.id} className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={selection.customIds.includes(wl.id)}
                  onChange={(e) =>
                    setSelection((prev) => ({
                      ...prev,
                      customIds: e.target.checked
                        ? [...prev.customIds, wl.id]
                        : prev.customIds.filter((x) => x !== wl.id),
                    }))
                  }
                  className="rounded"
                />
                {wl.name}
                <span className="text-xs text-muted-foreground">
                  {t('cracker_wordlist_entries', { count: wl.entry_count })}
                </span>
              </label>
              <button
                type="button"
                onClick={() => handleDeleteWordlist(wl.id)}
                className="text-xs text-destructive hover:underline"
              >
                {t('cracker_wordlist_delete')}
              </button>
            </div>
          ))}

          <form
            className="flex items-center gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const nameInput = form.elements.namedItem('wl-name') as HTMLInputElement;
              const fileInput = form.elements.namedItem('wl-file') as HTMLInputElement;
              const file = fileInput.files?.[0];
              if (!nameInput.value.trim() || !file) return;
              void handleUploadWordlist(nameInput.value.trim(), file);
              form.reset();
            }}
          >
            <input
              name="wl-name"
              type="text"
              placeholder={t('cracker_wordlist_upload_name_placeholder')}
              className="w-32 px-2 py-1 text-sm bg-muted border border-border rounded"
            />
            <input
              name="wl-file"
              type="file"
              accept=".txt,text/plain"
              className="text-xs text-muted-foreground"
            />
            <button
              type="submit"
              className="px-2 py-1 text-sm rounded border border-border bg-muted hover:bg-accent"
            >
              {t('cracker_wordlist_upload_label')}
            </button>
          </form>
        </div>
      )}
```

- [ ] **Step 3: Type-check and lint**

Run: `npm --prefix frontend run build`
Expected: build succeeds with no TS errors and no unused-var errors.

Run: `npm --prefix frontend run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CrackerPanel.tsx
git commit -m "feat(cracker): add wordlist selector UI (toggle, upload, delete)"
```

---

## Task 10: i18n strings

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/nl.json`
- Modify: `frontend/src/i18n/locales/de.json`

- [ ] **Step 1: Add the keys**

Add these keys near the other `cracker_*` / `toast_*` keys in each file. Keep JSON valid (watch trailing commas). The keys must be identical across all three files (a parity test enforces this).

`en.json`:

```json
  "cracker_wordlists_button": "Wordlists",
  "cracker_wordlist_english": "English",
  "cracker_wordlist_dutch": "Dutch (NL)",
  "cracker_wordlist_dutch_note": "large list, slower",
  "cracker_wordlist_entries": "{count} entries",
  "cracker_wordlist_delete": "Delete",
  "cracker_wordlist_upload_label": "Upload",
  "cracker_wordlist_upload_name_placeholder": "Name",
  "cracker_wordlist_custom_load_failed": "Could not load a selected wordlist",
  "toast_wordlist_uploaded": "Uploaded wordlist {name}",
  "toast_wordlist_upload_failed": "Failed to upload wordlist",
  "toast_wordlist_deleted": "Wordlist deleted",
```

`nl.json`:

```json
  "cracker_wordlists_button": "Woordenlijsten",
  "cracker_wordlist_english": "Engels",
  "cracker_wordlist_dutch": "Nederlands (NL)",
  "cracker_wordlist_dutch_note": "grote lijst, langzamer",
  "cracker_wordlist_entries": "{count} woorden",
  "cracker_wordlist_delete": "Verwijderen",
  "cracker_wordlist_upload_label": "Uploaden",
  "cracker_wordlist_upload_name_placeholder": "Naam",
  "cracker_wordlist_custom_load_failed": "Kon een geselecteerde woordenlijst niet laden",
  "toast_wordlist_uploaded": "Woordenlijst {name} geupload",
  "toast_wordlist_upload_failed": "Uploaden van woordenlijst mislukt",
  "toast_wordlist_deleted": "Woordenlijst verwijderd",
```

`de.json`:

```json
  "cracker_wordlists_button": "Wortlisten",
  "cracker_wordlist_english": "Englisch",
  "cracker_wordlist_dutch": "Niederlaendisch (NL)",
  "cracker_wordlist_dutch_note": "grosse Liste, langsamer",
  "cracker_wordlist_entries": "{count} Woerter",
  "cracker_wordlist_delete": "Loeschen",
  "cracker_wordlist_upload_label": "Hochladen",
  "cracker_wordlist_upload_name_placeholder": "Name",
  "cracker_wordlist_custom_load_failed": "Eine ausgewaehlte Wortliste konnte nicht geladen werden",
  "toast_wordlist_uploaded": "Wortliste {name} hochgeladen",
  "toast_wordlist_upload_failed": "Hochladen der Wortliste fehlgeschlagen",
  "toast_wordlist_deleted": "Wortliste geloescht",
```

Note: the German strings above avoid umlauts to keep this plan ASCII-safe. When editing, use the correct German characters (Woerter -> Wörter, Loeschen -> Löschen, grosse -> große, Niederlaendisch -> Niederländisch, ausgewaehlte -> ausgewählte) to match the rest of `de.json`.

- [ ] **Step 2: Verify i18n parity and lint**

Run: `npm --prefix frontend run test -- --run i18n`
Expected: the locale parity test passes (all keys present in en/nl/de).

Run: `npm --prefix frontend run lint`
Expected: no `i18n`/no-hardcoded-string errors from CrackerPanel.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(cracker): add wordlist selector i18n strings"
```

---

## Task 11: Full verification (tests, format, runtime)

**Files:** none (verification only).

- [ ] **Step 1: Backend test suite**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_wordlist_normalize.py /work/tests/test_wordlists_repository.py /work/tests/test_wordlists_router.py -v`
Expected: all PASS.

- [ ] **Step 2: Full backend suite (regression check)**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests -q`
Expected: no NEW failures versus baseline. Pre-existing Windows/env failures noted in the memory "Windows-only test failures" do not count; run in the container to avoid them.

- [ ] **Step 3: Frontend unit tests + format + lint**

Run:
```bash
npm --prefix frontend run test -- --run
npm --prefix frontend run lint
npm --prefix frontend run format:check
```
Expected: all pass. If `format:check` reports files, run `npx --prefix frontend prettier --write src/` (or the repo's format script), then re-commit.

- [ ] **Step 4: Runtime observation (required, per repo rules)**

Runtime behavior must be observed, not assumed. Rebuild/refresh the `rtfm-ev-local` container against this branch (see the memory "Local Docker instance" for the rebuild/verify procedure), open the app, and open the channel finder panel. Confirm, and capture evidence (screenshot or noted observation) for each:

1. The "Wordlists" button appears; opening it shows English (checked) and Dutch (NL) (unchecked).
2. Enabling Dutch causes the finder to become ready again (wordlist reloads); the "large list, slower" note shows. Verify `wordlists/nl.txt` is actually served (network 200), not 404.
3. Uploading a small `.txt` with a name adds it to the list with an entry count, and it becomes selected.
4. Deleting a custom list removes it from the panel.
5. With a real undecrypted GROUP_TEXT packet present, starting the finder still runs (no regression to existing cracking).

Record which checks passed. If a check cannot be run (e.g. no live radio for step 5), mark it "NOT VERIFIED" explicitly rather than claiming success.

- [ ] **Step 5: Update docs/changelog if the repo expects it**

Check `CHANGELOG.md` / `changelog-DMC-EV.md` conventions and add an entry describing the wordlist selector, bundled Dutch list, and custom uploads. Commit:

```bash
git add CHANGELOG.md changelog-DMC-EV.md
git commit -m "docs(cracker): note wordlist selector in changelog"
```

---

## Notes and deferred items

- **Word-pair separator (deferred):** `meshcore-hashtag-cracker@1.11.0` `CrackOptions` has no separator field; pairs concatenate directly on the GPU. Adding a `-` (or other) separator needs a new release of that package, then a dependency bump and a small UI addition. Not in this plan.
- **No upload cap:** by decision, uploads are not size-capped. A very large upload is read into memory server-side on upload and returned in full when its words endpoint is hit. Acceptable for a single-instance local app.
- **Charset source of truth:** lowercase `a-z0-9-`, no leading/trailing/double hyphens, max 30 chars (verified from `meshcore-packet-knife` README and Jack Kingsman's MeshCore cryptography writeup). Any change to this rule must update `app/wordlist_normalize.py` and regenerate `nl.txt`.
