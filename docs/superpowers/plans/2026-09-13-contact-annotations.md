# Contact Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add DB-stored, user-editable contact annotations — free-text notes, free-text owner info (auto-filled from the CLI owner-info request), an owner pubkey pointer to another contact (with click-to-DM and a reverse "Owned nodes" list), and manual fallback GPS — surfaced in the contact info pane and on the map.

**Architecture:** Five nullable columns are added to the `contacts` table (migration `_085`). A single write endpoint `POST /contacts/{public_key}/annotations` persists any subset and broadcasts a `contact` WS event. The existing `POST /contacts/{public_key}/repeater/owner-info` auto-fills `owner_info` server-side only when empty. Effective location (advertised-wins, manual-fallback) is computed on the frontend and consumed by the map and the contact pane. All new user annotations are preserved through radio-sync upserts via `COALESCE`.

**Tech Stack:** FastAPI + aiosqlite + Pydantic (backend), React + TypeScript + MapLibre (frontend), pytest (backend tests), vitest (frontend tests).

---

## Project conventions (read before starting)

- **Commits are gated.** This repo's `CLAUDE.md` says: never commit unless explicitly instructed. Each task ends with a **"Stage"** step (`git add`). Do **not** run `git commit` until the user explicitly authorizes it. When authorized, use a conventional-commit message and add **no** AI attribution/co-author lines (a `PreToolUse` hook rejects them).
- **No em dashes** in any user-facing string or code comment.
- **i18n is enforced.** Every new user-facing string needs a `t()` key present in `en.json`, `nl.json`, and `de.json`. eslint (`i18next/no-literal-string`) and a parity test fail otherwise.
- **Backend tests run in the container** per project setup: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/ -v` (the worktree is bind-mounted to `/work`). Locally, `PYTHONPATH=. uv run pytest tests/ -v` also works. On Windows, ~14 pre-existing failures and charmap collection errors are known env issues, not regressions — judge new tests by their own pass/fail.
- **Frontend checks before considering a task done:** `npm run test` (vitest), `npm run lint` (eslint), and `npm run format:check` (prettier) from `frontend/`. CI runs prettier `format:check` separately from lint.
- **Migration number:** `_085` is the next free number on this branch (off `main`, latest `_074`). If other branches (`_078/_080/_082` in the operator's notes) merge first, re-check the next free number before finalizing.

---

## File Structure

**Backend — create:**
- `app/migrations/_085_add_contact_annotations.py` — adds five columns to `contacts`.

**Backend — modify:**
- `app/database.py` — add the five columns to the `contacts` CREATE TABLE (fresh-DB parity).
- `app/models.py` — add fields to `Contact` and `ContactUpsert`; add `ContactAnnotationsUpdate`; add two fields to `RepeaterOwnerInfoResponse`.
- `app/repository/contacts.py` — carry columns through `upsert` INSERT/UPDATE (COALESCE) and `_row_to_contact`; add `set_annotations` and `set_owner_info_if_empty`.
- `app/routers/contacts.py` — add `POST /{public_key}/annotations`.
- `app/routers/repeaters.py` — auto-fill `owner_info` in the owner-info endpoint and return the new response fields.

**Backend — test:**
- `tests/test_repository.py` — column round-trip + advert-no-clobber + `set_annotations`/`set_owner_info_if_empty`.
- `tests/test_contacts_router.py` — annotations endpoint validation/clearing/broadcast.
- `tests/test_repeater_routes.py` — owner-info auto-fill vs. no-overwrite.

**Frontend — create:**
- (helper added inside existing `frontend/src/utils/pathUtils.ts`)
- `frontend/src/test/effectiveLocation.test.ts`

**Frontend — modify:**
- `frontend/src/types.ts` — `Contact` fields, `RepeaterOwnerInfoResponse` fields, `ContactAnnotationsUpdate`.
- `frontend/src/api.ts` — `updateContactAnnotations`.
- `frontend/src/utils/pathUtils.ts` — `getEffectiveLocation`.
- `frontend/src/components/ContactInfoPane.tsx` — editable sections + owned-nodes list; effective location.
- `frontend/src/components/MapView.tsx` — effective location, popup enrich, Details button.
- `frontend/src/components/ConversationPane.tsx` — thread the open-info callback to `MapView`.
- `frontend/src/App.tsx` — expose an open-info handler to `ConversationPane`.
- `frontend/src/components/repeater/RepeaterOwnerInfoPane.tsx` + `frontend/src/components/RepeaterDashboard.tsx` — auto-fill toast + override prompt.
- `frontend/src/i18n/locales/{en,nl,de}.json` — new keys.

**Docs — modify:**
- `app/AGENTS.md`, `frontend/AGENTS.md`, `CHANGELOG-DMC-EV.md`.

---

## Task 1: Migration + base schema columns

**Files:**
- Create: `app/migrations/_085_add_contact_annotations.py`
- Modify: `app/database.py:14-36` (contacts CREATE TABLE)
- Test: `tests/test_repository.py`

- [ ] **Step 1: Write the migration**

Create `app/migrations/_085_add_contact_annotations.py`:

```python
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
```

- [ ] **Step 2: Add the columns to the fresh-DB schema**

In `app/database.py`, the `contacts` CREATE TABLE ends at `radio_policy TEXT NOT NULL DEFAULT 'auto'` (line ~35). Add the five columns before the closing `);`:

```sql
    radio_policy TEXT NOT NULL DEFAULT 'auto',
    notes TEXT,
    owner_info TEXT,
    owner_key TEXT,
    manual_lat REAL,
    manual_lon REAL
);
```

(Change the previous line to end with a comma.)

- [ ] **Step 3: Verify the migration runner discovers `_085`**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -c "import app.migrations; print('ok')"`
Expected: `ok` (no import error; the per-version module loads).

- [ ] **Step 4: Stage**

```bash
git add app/migrations/_085_add_contact_annotations.py app/database.py
```

---

## Task 2: Models

**Files:**
- Modify: `app/models.py` (`Contact`, `ContactUpsert`, `RepeaterOwnerInfoResponse`; add `ContactAnnotationsUpdate`)
- Test: `tests/test_repository.py` (indirectly, next task)

- [ ] **Step 1: Add annotation fields to `ContactUpsert`**

In `app/models.py`, `class ContactUpsert` (starts line ~24), add after `first_seen: int | None = None`:

```python
    notes: str | None = None
    owner_info: str | None = None
    owner_key: str | None = None
    manual_lat: float | None = None
    manual_lon: float | None = None
```

- [ ] **Step 2: Add the same fields to `Contact`**

In `class Contact` (starts line ~97), add after `first_seen: int | None = None`:

```python
    notes: str | None = None
    owner_info: str | None = None
    owner_key: str | None = None
    manual_lat: float | None = None
    manual_lon: float | None = None
```

`ContactUpsert.from_contact` uses `contact.model_dump(...)`, so these carry through automatically.

- [ ] **Step 3: Add the `ContactAnnotationsUpdate` request model**

Add near `ContactRoutingOverrideRequest` (line ~236):

```python
class ContactAnnotationsUpdate(BaseModel):
    """Partial update of user-editable contact annotations.

    Every field is optional. A field left unset is unchanged; a field explicitly
    set to ``null`` clears it. Use ``model_fields_set`` to tell the two apart.
    """

    notes: str | None = Field(default=None, max_length=2000)
    owner_info: str | None = Field(default=None, max_length=2000)
    owner_key: str | None = Field(default=None, description="64-char hex of an existing contact")
    manual_lat: float | None = Field(default=None, ge=-90, le=90)
    manual_lon: float | None = Field(default=None, ge=-180, le=180)
```

- [ ] **Step 4: Add fields to `RepeaterOwnerInfoResponse`**

In `class RepeaterOwnerInfoResponse` (line ~666), add after `guest_password`:

```python
    stored_owner_info: str | None = Field(
        default=None, description="Contact's persisted owner_info after this call"
    )
    owner_info_updated: bool = Field(
        default=False, description="True iff this call auto-filled an empty stored owner_info"
    )
```

- [ ] **Step 5: Verify models import**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -c "from app.models import Contact, ContactUpsert, ContactAnnotationsUpdate, RepeaterOwnerInfoResponse; print(ContactAnnotationsUpdate.model_fields.keys())"`
Expected: prints the five field names.

- [ ] **Step 6: Stage**

```bash
git add app/models.py
```

---

## Task 3: Repository — persist and read annotations

**Files:**
- Modify: `app/repository/contacts.py` (`upsert`, `_row_to_contact`, add `set_annotations`, `set_owner_info_if_empty`)
- Test: `tests/test_repository.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_repository.py` (match the existing async test style / fixtures used elsewhere in that file):

```python
import pytest

from app.models import ContactUpsert
from app.repository import ContactRepository


@pytest.mark.asyncio
async def test_annotations_roundtrip(db):
    key = "a" * 64
    await ContactRepository.upsert(ContactUpsert(public_key=key, name="Node"))
    await ContactRepository.set_annotations(
        key,
        {"notes": "my note", "owner_info": "PA0XYZ", "owner_key": "b" * 64,
         "manual_lat": 52.1, "manual_lon": 5.2},
    )
    c = await ContactRepository.get_by_key(key)
    assert c.notes == "my note"
    assert c.owner_info == "PA0XYZ"
    assert c.owner_key == "b" * 64
    assert c.manual_lat == 52.1
    assert c.manual_lon == 5.2


@pytest.mark.asyncio
async def test_advert_upsert_does_not_clobber_annotations(db):
    key = "a" * 64
    await ContactRepository.upsert(ContactUpsert(public_key=key, name="Node"))
    await ContactRepository.set_annotations(key, {"notes": "keep me"})
    # A later radio-sync upsert supplies None for annotation fields.
    await ContactRepository.upsert(ContactUpsert(public_key=key, name="Node", lat=1.0, lon=2.0))
    c = await ContactRepository.get_by_key(key)
    assert c.notes == "keep me"


@pytest.mark.asyncio
async def test_set_annotations_clears_with_none(db):
    key = "a" * 64
    await ContactRepository.upsert(ContactUpsert(public_key=key, name="Node"))
    await ContactRepository.set_annotations(key, {"notes": "temp"})
    await ContactRepository.set_annotations(key, {"notes": None})
    c = await ContactRepository.get_by_key(key)
    assert c.notes is None


@pytest.mark.asyncio
async def test_set_owner_info_if_empty(db):
    key = "a" * 64
    await ContactRepository.upsert(ContactUpsert(public_key=key, name="Node"))
    assert await ContactRepository.set_owner_info_if_empty(key, "PA0AAA") is True
    assert (await ContactRepository.get_by_key(key)).owner_info == "PA0AAA"
    # Does not overwrite an existing value.
    assert await ContactRepository.set_owner_info_if_empty(key, "PA0BBB") is False
    assert (await ContactRepository.get_by_key(key)).owner_info == "PA0AAA"
```

Use whatever `db` fixture name `tests/test_repository.py` already uses (check the top of that file / `conftest.py`); mirror an existing test's fixture signature rather than introducing a new one.

- [ ] **Step 2: Run to verify failure**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_repository.py -k "annotations or owner_info_if_empty" -v`
Expected: FAIL — `AttributeError: ... has no attribute 'set_annotations'` (and the schema lacks the columns until Task 1 migration ran; the test DB is created from `database.py` schema which Task 1 updated).

- [ ] **Step 3: Carry columns through `upsert`**

In `app/repository/contacts.py`, `upsert` (line ~40). Extend the INSERT column list and VALUES, and add COALESCE lines to the `ON CONFLICT ... DO UPDATE SET`. Replace the INSERT/VALUES header:

```python
                INSERT INTO contacts (public_key, name, type, flags, direct_path, direct_path_len,
                                      direct_path_hash_mode, direct_path_updated_at,
                                      route_override_path, route_override_len,
                                      route_override_hash_mode,
                                      last_advert, lat, lon, last_seen,
                                      on_radio, last_contacted, first_seen,
                                      notes, owner_info, owner_key, manual_lat, manual_lon)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

Add to the `DO UPDATE SET` block (after the `first_seen = ...` line, before the closing `"""`):

```python
                    ,
                    notes = COALESCE(excluded.notes, contacts.notes),
                    owner_info = COALESCE(excluded.owner_info, contacts.owner_info),
                    owner_key = COALESCE(excluded.owner_key, contacts.owner_key),
                    manual_lat = COALESCE(excluded.manual_lat, contacts.manual_lat),
                    manual_lon = COALESCE(excluded.manual_lon, contacts.manual_lon)
```

Add to the params tuple (after `contact_row.first_seen,`):

```python
                    contact_row.notes,
                    contact_row.owner_info,
                    contact_row.owner_key,
                    contact_row.manual_lat,
                    contact_row.manual_lon,
```

- [ ] **Step 4: Read columns in `_row_to_contact`**

In `_row_to_contact` (line ~132), add to the `Contact(...)` constructor (after `first_seen=row["first_seen"],`). Use the `available_columns` guard pattern already used in that method so partial-column rows (from older selects) don't KeyError:

```python
            notes=row["notes"] if "notes" in available_columns else None,
            owner_info=row["owner_info"] if "owner_info" in available_columns else None,
            owner_key=row["owner_key"] if "owner_key" in available_columns else None,
            manual_lat=row["manual_lat"] if "manual_lat" in available_columns else None,
            manual_lon=row["manual_lon"] if "manual_lon" in available_columns else None,
```

- [ ] **Step 5: Add `set_annotations` and `set_owner_info_if_empty`**

Add these static methods to `ContactRepository` (near `set_routing_override`, line ~422). `set_annotations` only writes the keys present in the passed dict, so "absent" vs "null" is decided by the caller (the router):

```python
    _ANNOTATION_COLUMNS = ("notes", "owner_info", "owner_key", "manual_lat", "manual_lon")

    @staticmethod
    async def set_annotations(public_key: str, changes: dict) -> None:
        """Update only the annotation columns present in ``changes``.

        A key mapped to ``None`` clears that column. Keys absent from ``changes``
        are left untouched. Unknown keys are ignored.
        """
        cols = [c for c in ContactRepository._ANNOTATION_COLUMNS if c in changes]
        if not cols:
            return
        assignments = ", ".join(f"{c} = ?" for c in cols)
        params = [changes[c] for c in cols]
        params.append(public_key.lower())
        async with db.tx() as conn:
            async with conn.execute(
                f"UPDATE contacts SET {assignments} WHERE public_key = ?",
                params,
            ):
                pass

    @staticmethod
    async def set_owner_info_if_empty(public_key: str, owner_info: str) -> bool:
        """Set ``owner_info`` only when it is currently NULL or empty.

        Returns True if a row was actually updated (auto-filled), False otherwise
        (already had a value, or contact not found).
        """
        async with db.tx() as conn:
            async with conn.execute(
                """
                UPDATE contacts
                SET owner_info = ?
                WHERE public_key = ?
                  AND (owner_info IS NULL OR owner_info = '')
                """,
                (owner_info, public_key.lower()),
            ) as cursor:
                rowcount = cursor.rowcount
        return rowcount > 0
```

- [ ] **Step 6: Run tests to verify pass**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_repository.py -k "annotations or owner_info_if_empty" -v`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the full repository suite for regressions**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_repository.py -v`
Expected: no new failures vs. baseline.

- [ ] **Step 8: Stage**

```bash
git add app/repository/contacts.py tests/test_repository.py
```

---

## Task 4: Annotations endpoint

**Files:**
- Modify: `app/routers/contacts.py` (import `ContactAnnotationsUpdate`; add `POST /{public_key}/annotations`)
- Test: `tests/test_contacts_router.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_contacts_router.py` (mirror the existing client/fixture setup in that file — it already exercises contact endpoints, so reuse its `client` fixture and contact-seeding helper):

```python
@pytest.mark.asyncio
async def test_set_annotations_notes_and_manual_gps(client, seed_contact):
    key = "a" * 64
    await seed_contact(key)
    resp = await client.post(
        f"/api/contacts/{key}/annotations",
        json={"notes": "hello", "manual_lat": 52.0, "manual_lon": 5.0},
    )
    assert resp.status_code == 200
    get = await client.get("/api/contacts")
    row = next(c for c in get.json() if c["public_key"] == key)
    assert row["notes"] == "hello"
    assert row["manual_lat"] == 52.0


@pytest.mark.asyncio
async def test_owner_key_must_reference_existing_contact(client, seed_contact):
    key = "a" * 64
    await seed_contact(key)
    resp = await client.post(
        f"/api/contacts/{key}/annotations", json={"owner_key": "c" * 64}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_owner_key_accepts_existing_and_clears(client, seed_contact):
    key = "a" * 64
    owner = "b" * 64
    await seed_contact(key)
    await seed_contact(owner)
    ok = await client.post(f"/api/contacts/{key}/annotations", json={"owner_key": owner})
    assert ok.status_code == 200
    clear = await client.post(f"/api/contacts/{key}/annotations", json={"owner_key": None})
    assert clear.status_code == 200
    get = await client.get("/api/contacts")
    row = next(c for c in get.json() if c["public_key"] == key)
    assert row["owner_key"] is None


@pytest.mark.asyncio
async def test_annotations_unknown_contact_404(client):
    resp = await client.post(f"/api/contacts/{'a' * 64}/annotations", json={"notes": "x"})
    assert resp.status_code == 404
```

If `test_contacts_router.py` has no `seed_contact` helper, insert one that calls `ContactRepository.upsert(ContactUpsert(public_key=key, name="n"))`, matching how other tests in the file create contacts.

- [ ] **Step 2: Run to verify failure**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_contacts_router.py -k annotations -v`
Expected: FAIL — 404/405 (route not defined).

- [ ] **Step 3: Implement the endpoint**

In `app/routers/contacts.py`, add `ContactAnnotationsUpdate` to the `from app.models import (...)` block. Then add the endpoint near `set_contact_routing_override` (line ~591). It reuses the file's existing `_resolve_contact_or_404` and `_broadcast_contact_update` helpers:

```python
@router.post("/{public_key}/annotations")
async def set_contact_annotations(
    public_key: str, request: ContactAnnotationsUpdate
) -> dict:
    """Update user-editable annotations (notes, owner info, owner pubkey, manual GPS).

    Only fields explicitly present in the request body are changed; a field sent
    as ``null`` clears it. ``owner_key`` must reference an existing contact.
    """
    contact = await _resolve_contact_or_404(public_key)

    provided = request.model_dump(include=request.model_fields_set)

    if "owner_key" in provided:
        raw = provided["owner_key"]
        owner_key = (raw or "").strip().lower()
        if owner_key == "":
            provided["owner_key"] = None
        else:
            if len(owner_key) != 64 or not all(c in "0123456789abcdef" for c in owner_key):
                raise HTTPException(status_code=422, detail="owner_key must be 64-char hex")
            if await ContactRepository.get_by_key(owner_key) is None:
                raise HTTPException(status_code=422, detail="owner_key is not a known contact")
            provided["owner_key"] = owner_key

    await ContactRepository.set_annotations(contact.public_key, provided)

    updated = await ContactRepository.get_by_key(contact.public_key)
    if updated:
        await _broadcast_contact_update(updated)

    return {"status": "ok", "public_key": contact.public_key}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_contacts_router.py -k annotations -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Stage**

```bash
git add app/routers/contacts.py tests/test_contacts_router.py
```

---

## Task 5: Owner-info auto-fill

**Files:**
- Modify: `app/routers/repeaters.py` (owner-info endpoint, line ~465-490)
- Test: `tests/test_repeater_routes.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_repeater_routes.py`. The suite already mocks the radio/binary owner-info fetch; mirror the existing mock for `fetch_repeater_owner_info_binary` and reuse the file's contact-seeding + client fixtures:

```python
@pytest.mark.asyncio
async def test_owner_info_autofills_when_empty(client, seed_contact, monkeypatch):
    key = "a" * 64
    await seed_contact(key, type=2)

    async def fake_fetch(contact, *a, **k):
        return {"owner_info": "PA0AAA", "firmware_version": "v2", "name": "Rep"}

    monkeypatch.setattr("app.routers.repeaters.fetch_repeater_owner_info_binary", fake_fetch)
    resp = await client.post(f"/api/contacts/{key}/repeater/owner-info")
    body = resp.json()
    assert body["owner_info_updated"] is True
    assert body["stored_owner_info"] == "PA0AAA"


@pytest.mark.asyncio
async def test_owner_info_does_not_overwrite(client, seed_contact, monkeypatch):
    key = "a" * 64
    await seed_contact(key, type=2)
    from app.repository import ContactRepository
    await ContactRepository.set_annotations(key, {"owner_info": "MINE"})

    async def fake_fetch(contact, *a, **k):
        return {"owner_info": "PA0AAA", "firmware_version": "v2", "name": "Rep"}

    monkeypatch.setattr("app.routers.repeaters.fetch_repeater_owner_info_binary", fake_fetch)
    resp = await client.post(f"/api/contacts/{key}/repeater/owner-info")
    body = resp.json()
    assert body["owner_info_updated"] is False
    assert body["stored_owner_info"] == "MINE"
    assert body["owner_info"] == "PA0AAA"
```

Match the actual monkeypatch target to how `repeaters.py` references the fetch function (it imports `fetch_repeater_owner_info_binary` from `server_control`, so patch `app.routers.repeaters.fetch_repeater_owner_info_binary`). If the file's existing owner-info test uses a different patching style, copy that style.

- [ ] **Step 2: Run to verify failure**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_repeater_routes.py -k owner_info -v`
Expected: FAIL — response has no `owner_info_updated` / value not persisted.

- [ ] **Step 3: Implement auto-fill**

In `app/routers/repeaters.py`, the `repeater_owner_info` handler currently ends by returning `RepeaterOwnerInfoResponse(owner_info=..., firmware_version=..., name=...)` (line ~487). Replace that return with auto-fill + broadcast. Import `ContactRepository` (already imported in this router for other endpoints — confirm; if not, add `from app.repository import ContactRepository`). Use the same contact resolution the handler already does (it takes `public_key` and fetches the contact). After computing `owner = await fetch_repeater_owner_info_binary(contact) or {}`:

```python
    fetched_owner_info = owner.get("owner_info")
    owner_info_updated = False
    if fetched_owner_info:
        owner_info_updated = await ContactRepository.set_owner_info_if_empty(
            contact.public_key, fetched_owner_info
        )

    refreshed = await ContactRepository.get_by_key(contact.public_key)
    stored_owner_info = refreshed.owner_info if refreshed else None
    if owner_info_updated and refreshed:
        await _broadcast_contact_update(refreshed)

    return RepeaterOwnerInfoResponse(
        owner_info=fetched_owner_info,
        firmware_version=owner.get("firmware_version"),
        name=owner.get("name"),
        stored_owner_info=stored_owner_info,
        owner_info_updated=owner_info_updated,
    )
```

For `_broadcast_contact_update`: check whether `repeaters.py` already has a contact-broadcast helper. If not, import and call the same broadcast used elsewhere for contact updates (the WS `contact` event). If wiring a broadcast here is non-trivial in this router, it is acceptable to skip the broadcast in this task and rely on the client refetching contacts after the owner-info call — but prefer the broadcast for live map/pane update. Document whichever choice you make in the commit message.

- [ ] **Step 4: Run tests to verify pass**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_repeater_routes.py -k owner_info -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Stage**

```bash
git add app/routers/repeaters.py tests/test_repeater_routes.py
```

---

## Task 6: Frontend types + api client

**Files:**
- Modify: `frontend/src/types.ts` (`Contact`, `RepeaterOwnerInfoResponse`; add `ContactAnnotationsUpdate`)
- Modify: `frontend/src/api.ts` (`updateContactAnnotations`)

- [ ] **Step 1: Extend the `Contact` interface**

In `frontend/src/types.ts`, `interface Contact` (line ~185), add before the closing brace (line ~210):

```typescript
  notes?: string | null;
  owner_info?: string | null;
  owner_key?: string | null;
  manual_lat?: number | null;
  manual_lon?: number | null;
```

- [ ] **Step 2: Extend `RepeaterOwnerInfoResponse` and add the update type**

In `frontend/src/types.ts`, `interface RepeaterOwnerInfoResponse` (line ~688), add:

```typescript
  stored_owner_info?: string | null;
  owner_info_updated?: boolean;
```

Add a new type nearby:

```typescript
export interface ContactAnnotationsUpdate {
  notes?: string | null;
  owner_info?: string | null;
  owner_key?: string | null;
  manual_lat?: number | null;
  manual_lon?: number | null;
}
```

- [ ] **Step 3: Add the api method**

In `frontend/src/api.ts`, add `ContactAnnotationsUpdate` to the type imports from `./types`, and add a method alongside the other contact methods (near `repeaterOwnerInfo`, line ~579):

```typescript
  updateContactAnnotations: (publicKey: string, update: ContactAnnotationsUpdate) =>
    fetchJson<{ status: string; public_key: string }>(`/contacts/${publicKey}/annotations`, {
      method: 'POST',
      body: JSON.stringify(update),
    }),
```

- [ ] **Step 4: Verify type-check**

Run (from `frontend/`): `npm run build` (or `npx tsc --noEmit`)
Expected: no new type errors.

- [ ] **Step 5: Stage**

```bash
git add frontend/src/types.ts frontend/src/api.ts
```

---

## Task 7: Effective-location helper

**Files:**
- Modify: `frontend/src/utils/pathUtils.ts` (add `getEffectiveLocation`)
- Test: `frontend/src/test/effectiveLocation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/effectiveLocation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getEffectiveLocation } from '../utils/pathUtils';
import type { Contact } from '../types';

function contact(overrides: Partial<Contact>): Contact {
  return {
    public_key: 'a'.repeat(64),
    name: 'n',
    type: 0,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: -1,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    radio_policy: 'auto',
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
    ...overrides,
  } as Contact;
}

describe('getEffectiveLocation', () => {
  it('prefers advertised coords when valid', () => {
    const c = contact({ lat: 52, lon: 5, manual_lat: 10, manual_lon: 10 });
    expect(getEffectiveLocation(c)).toEqual({ lat: 52, lon: 5 });
  });

  it('falls back to manual when advertised invalid', () => {
    const c = contact({ lat: null, lon: null, manual_lat: 10, manual_lon: 11 });
    expect(getEffectiveLocation(c)).toEqual({ lat: 10, lon: 11 });
  });

  it('returns null when neither is valid', () => {
    expect(getEffectiveLocation(contact({}))).toBeNull();
  });

  it('ignores a lone manual coordinate', () => {
    const c = contact({ manual_lat: 10, manual_lon: null });
    expect(getEffectiveLocation(c)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `frontend/`): `npm run test -- effectiveLocation`
Expected: FAIL — `getEffectiveLocation` is not exported.

- [ ] **Step 3: Implement the helper**

In `frontend/src/utils/pathUtils.ts`, after `isValidLocation` (line ~375), add:

```typescript
/** Resolve a contact's display location: advertised coords win when valid,
 *  otherwise fall back to manually-entered coords, otherwise none. */
export function getEffectiveLocation(
  contact: {
    lat: number | null;
    lon: number | null;
    manual_lat?: number | null;
    manual_lon?: number | null;
  }
): { lat: number; lon: number } | null {
  if (isValidLocation(contact.lat, contact.lon)) {
    return { lat: contact.lat!, lon: contact.lon! };
  }
  const mlat = contact.manual_lat ?? null;
  const mlon = contact.manual_lon ?? null;
  if (isValidLocation(mlat, mlon)) {
    return { lat: mlat!, lon: mlon! };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify pass**

Run (from `frontend/`): `npm run test -- effectiveLocation`
Expected: PASS (4 tests).

- [ ] **Step 5: Stage**

```bash
git add frontend/src/utils/pathUtils.ts frontend/src/test/effectiveLocation.test.ts
```

---

## Task 8: ContactInfoPane editing sections

**Files:**
- Modify: `frontend/src/components/ContactInfoPane.tsx`
- Test: `frontend/src/test/contactInfoPane.test.tsx`

This task adds four editable sections (Notes, Owner info, Owner, Manual location) and one read-only reverse list (Owned nodes). Each editable section saves via `api.updateContactAnnotations` then relies on the WS `contact` broadcast to refresh `contacts` (the pane already reads `liveContact` from the `contacts` array). Use i18n keys added in Task 11.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/test/contactInfoPane.test.tsx` (reuse the file's existing render helper + `contacts` prop). Mock `api.updateContactAnnotations`:

```typescript
it('saves notes via the annotations endpoint', async () => {
  const spy = vi.spyOn(api, 'updateContactAnnotations').mockResolvedValue({
    status: 'ok',
    public_key: 'a'.repeat(64),
  });
  renderPane({ contactKey: 'a'.repeat(64), contacts: [contact({ public_key: 'a'.repeat(64) })] });
  const box = await screen.findByLabelText(/notes/i);
  fireEvent.change(box, { target: { value: 'field note' } });
  fireEvent.click(screen.getByRole('button', { name: /save notes/i }));
  await waitFor(() =>
    expect(spy).toHaveBeenCalledWith('a'.repeat(64), { notes: 'field note' })
  );
});

it('lists owned nodes (reverse owner link)', async () => {
  const owner = 'a'.repeat(64);
  const owned = 'b'.repeat(64);
  renderPane({
    contactKey: owner,
    contacts: [
      contact({ public_key: owner, name: 'Companion' }),
      contact({ public_key: owned, name: 'MyRepeater', owner_key: owner }),
    ],
  });
  expect(await screen.findByText('MyRepeater')).toBeInTheDocument();
});
```

Match `renderPane`/`contact` helpers and imports (`api`, `screen`, `fireEvent`, `waitFor`) to the file's existing setup.

- [ ] **Step 2: Run to verify failure**

Run (from `frontend/`): `npm run test -- contactInfoPane`
Expected: FAIL — no notes field / owned-nodes list rendered.

- [ ] **Step 3: Add an annotations editor block to the pane**

In `ContactInfoPane.tsx`, inside the `contact ?` branch (after the Favorite toggle block, around line ~501), render a new `<ContactAnnotations>` section component. Add this component at the bottom of the file (near `InfoItem`):

```tsx
function ContactAnnotations({
  contact,
  contacts,
  t,
  onOpenContact,
  onOpenConversation,
}: {
  contact: Contact;
  contacts: Contact[];
  t: TFn;
  onOpenContact?: (publicKey: string) => void;
  onOpenConversation?: (publicKey: string) => void;
}) {
  const [notes, setNotes] = useState(contact.notes ?? '');
  const [ownerInfo, setOwnerInfo] = useState(contact.owner_info ?? '');
  const [ownerKey, setOwnerKey] = useState(contact.owner_key ?? '');
  const [manualLat, setManualLat] = useState(
    contact.manual_lat != null ? String(contact.manual_lat) : ''
  );
  const [manualLon, setManualLon] = useState(
    contact.manual_lon != null ? String(contact.manual_lon) : ''
  );

  // Re-seed local state when switching to a different contact.
  useEffect(() => {
    setNotes(contact.notes ?? '');
    setOwnerInfo(contact.owner_info ?? '');
    setOwnerKey(contact.owner_key ?? '');
    setManualLat(contact.manual_lat != null ? String(contact.manual_lat) : '');
    setManualLon(contact.manual_lon != null ? String(contact.manual_lon) : '');
  }, [contact.public_key, contact.notes, contact.owner_info, contact.owner_key, contact.manual_lat, contact.manual_lon]);

  const ownerContact = ownerKey ? contacts.find((c) => c.public_key === ownerKey) ?? null : null;
  const ownedNodes = useMemo(
    () => contacts.filter((c) => c.owner_key === contact.public_key),
    [contacts, contact.public_key]
  );

  const save = async (update: import('../types').ContactAnnotationsUpdate) => {
    try {
      await api.updateContactAnnotations(contact.public_key, update);
      toast.success(t('contact_annotations_saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('contact_annotations_save_failed'));
    }
  };

  return (
    <div className="px-5 py-3 border-b border-border space-y-4">
      {/* Notes */}
      <div>
        <label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
          {t('contact_notes_label')}
        </label>
        <textarea
          className="w-full text-sm rounded border border-border bg-background p-2 min-h-16"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button
          type="button"
          className="mt-1 text-xs px-2 py-0.5 rounded border border-border hover:bg-accent"
          onClick={() => save({ notes: notes.trim() === '' ? null : notes })}
        >
          {t('contact_notes_save')}
        </button>
      </div>

      {/* Owner info (free text; may be auto-filled from CLI) */}
      <div>
        <label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
          {t('contact_owner_info_label')}
        </label>
        <input
          type="text"
          className="w-full text-sm rounded border border-border bg-background p-2"
          value={ownerInfo}
          onChange={(e) => setOwnerInfo(e.target.value)}
        />
        <button
          type="button"
          className="mt-1 text-xs px-2 py-0.5 rounded border border-border hover:bg-accent"
          onClick={() => save({ owner_info: ownerInfo.trim() === '' ? null : ownerInfo })}
        >
          {t('contact_owner_info_save')}
        </button>
      </div>

      {/* Owner pubkey (existing contact); link opens DM */}
      <div>
        <label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
          {t('contact_owner_label')}
        </label>
        {ownerContact && onOpenConversation ? (
          <button
            type="button"
            className="text-sm text-primary underline"
            onClick={() => onOpenConversation(ownerContact.public_key)}
            title={t('contact_owner_open_dm')}
          >
            {getContactDisplayName(
              ownerContact.name,
              ownerContact.public_key,
              ownerContact.last_advert
            )}
          </button>
        ) : ownerKey ? (
          <span className="text-sm font-mono break-all">{ownerKey}</span>
        ) : null}
        <input
          type="text"
          placeholder={t('contact_owner_placeholder')}
          className="w-full text-sm rounded border border-border bg-background p-2 mt-1 font-mono"
          value={ownerKey}
          onChange={(e) => setOwnerKey(e.target.value.trim().toLowerCase())}
        />
        {ownerKey !== '' && !contacts.some((c) => c.public_key === ownerKey) && (
          <p className="text-xs text-destructive mt-0.5">{t('contact_owner_unknown')}</p>
        )}
        <button
          type="button"
          className="mt-1 text-xs px-2 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-50"
          disabled={ownerKey !== '' && !contacts.some((c) => c.public_key === ownerKey)}
          onClick={() => save({ owner_key: ownerKey === '' ? null : ownerKey })}
        >
          {t('contact_owner_save')}
        </button>
      </div>

      {/* Owned nodes (reverse link) */}
      {ownedNodes.length > 0 && (
        <div>
          <h3 className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
            {t('contact_owned_nodes')}
          </h3>
          <div className="space-y-1">
            {ownedNodes.map((n) => (
              <button
                key={n.public_key}
                type="button"
                className="block text-sm text-primary hover:underline truncate"
                onClick={() => onOpenContact?.(n.public_key)}
              >
                {getContactDisplayName(n.name, n.public_key, n.last_advert)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual location (fallback) */}
      <div>
        <label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
          {t('contact_manual_location_label')}
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            step="any"
            placeholder={t('contact_manual_lat')}
            className="w-full text-sm rounded border border-border bg-background p-2"
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
          />
          <input
            type="number"
            step="any"
            placeholder={t('contact_manual_lon')}
            className="w-full text-sm rounded border border-border bg-background p-2"
            value={manualLon}
            onChange={(e) => setManualLon(e.target.value)}
          />
        </div>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded border border-border hover:bg-accent"
            onClick={() =>
              save({
                manual_lat: manualLat.trim() === '' ? null : Number(manualLat),
                manual_lon: manualLon.trim() === '' ? null : Number(manualLon),
              })
            }
          >
            {t('contact_manual_location_save')}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded border border-border hover:bg-accent"
            onClick={() => {
              setManualLat('');
              setManualLon('');
              save({ manual_lat: null, manual_lon: null });
            }}
          >
            {t('common_clear')}
          </button>
        </div>
      </div>
    </div>
  );
}
```

Add the required imports at the top of the file if missing: `useMemo` is already imported; ensure `useState`, `useEffect` are imported (they are). `api`, `toast`, `getContactDisplayName`, `TFn`, `Contact` are already imported.

- [ ] **Step 4: Render the section and thread callbacks**

In the pane body (after the Favorite toggle, ~line 501), add:

```tsx
            <ContactAnnotations
              contact={contact}
              contacts={contacts}
              t={t}
              onOpenContact={onOpenContactInfo}
              onOpenConversation={onOpenConversation}
            />
```

Add `onOpenContactInfo?: (publicKey: string) => void;` and `onOpenConversation?: (publicKey: string) => void;` to `ContactInfoPaneProps` (line ~100) and to the destructured props (line ~119). In `App.tsx`, pass these into `contactInfoPaneProps` (line ~821) using the existing conversation-navigation handlers: `onOpenContactInfo` = the same setter that sets `infoPaneContactKey` (from `useConversationNavigation`, exposed as e.g. `openInfoPane`), and `onOpenConversation` = the existing open-DM-conversation handler. If `useConversationNavigation` does not already expose an `openInfoPane(publicKey)`, add a thin wrapper that calls `setInfoPaneContactKey(publicKey)`.

- [ ] **Step 5: Run tests to verify pass**

Run (from `frontend/`): `npm run test -- contactInfoPane`
Expected: PASS (new tests + existing pane tests).

- [ ] **Step 6: Lint + format**

Run (from `frontend/`): `npm run lint && npm run format:check`
Expected: no errors (i18n keys must exist — if lint fails on missing keys, complete Task 11 first, then re-run).

- [ ] **Step 7: Stage**

```bash
git add frontend/src/components/ContactInfoPane.tsx frontend/src/App.tsx frontend/src/hooks/useConversationNavigation.ts frontend/src/test/contactInfoPane.test.tsx
```

---

## Task 9: Map effective-location + popup enrich + Details button

**Files:**
- Modify: `frontend/src/components/MapView.tsx`
- Modify: `frontend/src/components/ConversationPane.tsx`
- Test: `frontend/src/test/mapView.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/test/mapView.test.tsx` (reuse the file's `contact` helper + map stub):

```typescript
it('maps a contact that has only manual coordinates', async () => {
  const stub = renderMapAndLoad([
    contact({ public_key: 'm', lat: null, lon: null, manual_lat: 52, manual_lon: 5 }),
  ]);
  // The node layer should receive the manual-only contact as a feature.
  expect(stub.getNodeFeatureKeys()).toContain('m');
});
```

Adapt to the file's actual stub API (it already asserts on "mappable contacts fed to the node layer" — reuse that assertion mechanism; the point is that a manual-only contact now appears).

- [ ] **Step 2: Run to verify failure**

Run (from `frontend/`): `npm run test -- mapView`
Expected: FAIL — manual-only contact not mapped (current filter uses `contact.lat/lon`).

- [ ] **Step 3: Use effective location in MapView**

In `MapView.tsx`, import the helper:

```typescript
import { getEffectiveLocation } from '../utils/pathUtils';
```

Replace the `mappableContacts` location gate and the `openContactPopup`/`buildContactPopup` coordinate reads to use `getEffectiveLocation(contact)` instead of `contact.lat`/`contact.lon`. For `openContactPopup` (line ~632):

```typescript
  const openContactPopup = useCallback(
    (id: string) => {
      const map = mapRef.current;
      const contact = contactByKey.get(id);
      const loc = contact ? getEffectiveLocation(contact) : null;
      if (!map || !contact || !loc) return;
      popupRef.current?.remove();
      popupRef.current = new MlPopup({ closeButton: true, offset: 12 })
        .setLngLat([loc.lon, loc.lat])
        .setDOMContent(buildContactPopup(contact))
        .addTo(map);
    },
    [contactByKey, buildContactPopup]
  );
```

In `buildContactPopup` (line ~596), compute `const loc = getEffectiveLocation(contact);` and use `loc` for the coords line (guard null). Wherever `mappableContacts` is derived (the node-layer feature source), change the filter predicate from `isValidLocation(contact.lat, contact.lon)` to `getEffectiveLocation(contact) !== null`, and use the effective lat/lon when building each feature's geometry.

- [ ] **Step 4: Enrich the popup and add a Details button**

Extend `MapView`'s props with `onOpenContactInfo?: (publicKey: string) => void;` (near `onSelectContact`, line ~57) and destructure it (line ~195). In `buildContactPopup`, after the coords line, append a notes snippet, an owner link, and a Details button:

```typescript
      if (contact.notes) {
        const notes = document.createElement('div');
        notes.className = 'text-xs mt-1 whitespace-pre-wrap break-words';
        notes.textContent =
          contact.notes.length > 140 ? contact.notes.slice(0, 140) + '…' : contact.notes;
        root.appendChild(notes);
      }
      if (contact.owner_key && onSelectContact) {
        const ownerLink = document.createElement('button');
        ownerLink.type = 'button';
        ownerLink.className = 'text-xs text-primary underline mt-1 block';
        ownerLink.textContent = t('map_owner_link');
        ownerLink.addEventListener('click', (e) => {
          e.stopPropagation();
          const owner = contactByKey.get(contact.owner_key!);
          if (owner) onSelectContact(owner);
        });
        root.appendChild(ownerLink);
      }
      if (onOpenContactInfo) {
        const details = document.createElement('button');
        details.type = 'button';
        details.className = 'text-xs text-primary underline mt-1 block';
        details.textContent = t('map_node_details');
        details.addEventListener('click', (e) => {
          e.stopPropagation();
          onOpenContactInfo(contact.public_key);
        });
        root.appendChild(details);
      }
```

Add `contactByKey` and `onOpenContactInfo` to `buildContactPopup`'s `useCallback` dependency array.

- [ ] **Step 5: Thread the callback from ConversationPane**

In `ConversationPane.tsx`, the `<MapView>` render (line ~240) receives `onSelectContact`. Add `onOpenContactInfo` sourced from a new prop on `ConversationPane` that ultimately calls `App`'s open-info handler (the same `openInfoPane` from Task 8). Pass it down: `App.tsx` → `ConversationPane` → `MapView`.

- [ ] **Step 6: Run tests to verify pass**

Run (from `frontend/`): `npm run test -- mapView`
Expected: PASS.

- [ ] **Step 7: Lint + format + build**

Run (from `frontend/`): `npm run lint && npm run format:check && npm run build`
Expected: no errors.

- [ ] **Step 8: Stage**

```bash
git add frontend/src/components/MapView.tsx frontend/src/components/ConversationPane.tsx frontend/src/App.tsx frontend/src/test/mapView.test.tsx
```

---

## Task 10: Owner-info auto-fill toast + override prompt

**Files:**
- Modify: `frontend/src/components/repeater/RepeaterOwnerInfoPane.tsx`
- Modify: `frontend/src/components/RepeaterDashboard.tsx` (pass the contact key + a save callback into the pane)
- Test: `frontend/src/test/repeaterDashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/test/repeaterDashboard.test.tsx` (reuse the file's render + `OwnerInfoPane` usage):

```typescript
it('shows an override prompt when repeater owner differs from saved', () => {
  render(
    <I18nProvider>
      <OwnerInfoPane
        data={{
          owner_info: 'PA0NEW',
          firmware_version: 'v2',
          name: 'Rep',
          guest_password: null,
          stored_owner_info: 'PA0OLD',
          owner_info_updated: false,
        }}
        state={{ loading: false, attempt: 1, error: null }}
        onRefresh={() => {}}
        publicKey={'a'.repeat(64)}
        onSaveOwnerInfo={vi.fn()}
      />
    </I18nProvider>
  );
  expect(screen.getByRole('button', { name: /override/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `frontend/`): `npm run test -- repeaterDashboard`
Expected: FAIL — no override button / prop not accepted.

- [ ] **Step 3: Extend OwnerInfoPane**

In `RepeaterOwnerInfoPane.tsx`, add props `publicKey: string` and `onSaveOwnerInfo: (publicKey: string, ownerInfo: string) => void`. After the existing `LabeledBlock` for owner info, add conditional UI:

```tsx
{data.owner_info_updated && (
  <p className="text-xs text-green-600">{t('repeater_owner_info_autofilled')}</p>
)}
{!data.owner_info_updated &&
  data.owner_info &&
  data.stored_owner_info &&
  data.owner_info !== data.stored_owner_info && (
    <div className="mt-1">
      <p className="text-xs text-muted-foreground">
        {t('repeater_owner_info_conflict', {
          fetched: data.owner_info,
          stored: data.stored_owner_info,
        })}
      </p>
      <button
        type="button"
        className="mt-1 text-xs px-2 py-0.5 rounded border border-border hover:bg-accent"
        onClick={() => onSaveOwnerInfo(publicKey, data.owner_info!)}
      >
        {t('repeater_owner_info_override')}
      </button>
    </div>
  )}
```

- [ ] **Step 4: Wire it in RepeaterDashboard**

In `RepeaterDashboard.tsx`, the `<OwnerInfoPane ... />` render (line ~396) gains `publicKey={<the dashboard's contact public key>}` and `onSaveOwnerInfo={async (pk, info) => { await api.updateContactAnnotations(pk, { owner_info: info }); await refreshPane('ownerInfo'); }}`. Use the contact key the dashboard already has in scope (the `activeConversation.id` / contact prop). Import `api` if not already imported.

- [ ] **Step 5: Run tests to verify pass**

Run (from `frontend/`): `npm run test -- repeaterDashboard`
Expected: PASS.

- [ ] **Step 6: Lint + format**

Run (from `frontend/`): `npm run lint && npm run format:check`
Expected: no errors.

- [ ] **Step 7: Stage**

```bash
git add frontend/src/components/repeater/RepeaterOwnerInfoPane.tsx frontend/src/components/RepeaterDashboard.tsx frontend/src/test/repeaterDashboard.test.tsx
```

---

## Task 11: i18n keys (EN/NL/DE)

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Add keys to en.json**

Add these flat keys (alongside the other `contact_` / `map_` / `repeater_` keys; JSON is a flat key→string map):

```json
  "contact_annotations_saved": "Saved",
  "contact_annotations_save_failed": "Failed to save",
  "contact_notes_label": "Notes",
  "contact_notes_save": "Save notes",
  "contact_owner_info_label": "Owner info",
  "contact_owner_info_save": "Save owner info",
  "contact_owner_label": "Owner",
  "contact_owner_placeholder": "Owner contact public key",
  "contact_owner_unknown": "Not a known contact",
  "contact_owner_open_dm": "Open direct message",
  "contact_owner_save": "Save owner",
  "contact_owned_nodes": "Owned nodes",
  "contact_manual_location_label": "Manual location (fallback)",
  "contact_manual_lat": "Latitude",
  "contact_manual_lon": "Longitude",
  "contact_manual_location_save": "Save location",
  "common_clear": "Clear",
  "map_owner_link": "Message owner",
  "map_node_details": "Details",
  "repeater_owner_info_autofilled": "Saved to contact",
  "repeater_owner_info_conflict": "Repeater reports \"{{fetched}}\"; saved owner info is \"{{stored}}\".",
  "repeater_owner_info_override": "Override saved owner info"
```

If `common_clear` already exists, reuse it (do not duplicate).

- [ ] **Step 2: Add the same keys to nl.json (Dutch)**

```json
  "contact_annotations_saved": "Opgeslagen",
  "contact_annotations_save_failed": "Opslaan mislukt",
  "contact_notes_label": "Notities",
  "contact_notes_save": "Notities opslaan",
  "contact_owner_info_label": "Eigenaarinfo",
  "contact_owner_info_save": "Eigenaarinfo opslaan",
  "contact_owner_label": "Eigenaar",
  "contact_owner_placeholder": "Publieke sleutel van eigenaar",
  "contact_owner_unknown": "Geen bekend contact",
  "contact_owner_open_dm": "Direct bericht openen",
  "contact_owner_save": "Eigenaar opslaan",
  "contact_owned_nodes": "Eigen nodes",
  "contact_manual_location_label": "Handmatige locatie (fallback)",
  "contact_manual_lat": "Breedtegraad",
  "contact_manual_lon": "Lengtegraad",
  "contact_manual_location_save": "Locatie opslaan",
  "common_clear": "Wissen",
  "map_owner_link": "Eigenaar berichten",
  "map_node_details": "Details",
  "repeater_owner_info_autofilled": "Opgeslagen bij contact",
  "repeater_owner_info_conflict": "Repeater meldt \"{{fetched}}\"; opgeslagen eigenaarinfo is \"{{stored}}\".",
  "repeater_owner_info_override": "Opgeslagen eigenaarinfo overschrijven"
```

- [ ] **Step 3: Add the same keys to de.json (German)**

```json
  "contact_annotations_saved": "Gespeichert",
  "contact_annotations_save_failed": "Speichern fehlgeschlagen",
  "contact_notes_label": "Notizen",
  "contact_notes_save": "Notizen speichern",
  "contact_owner_info_label": "Besitzerinfo",
  "contact_owner_info_save": "Besitzerinfo speichern",
  "contact_owner_label": "Besitzer",
  "contact_owner_placeholder": "Öffentlicher Schlüssel des Besitzers",
  "contact_owner_unknown": "Kein bekannter Kontakt",
  "contact_owner_open_dm": "Direktnachricht öffnen",
  "contact_owner_save": "Besitzer speichern",
  "contact_owned_nodes": "Eigene Knoten",
  "contact_manual_location_label": "Manueller Standort (Fallback)",
  "contact_manual_lat": "Breitengrad",
  "contact_manual_lon": "Längengrad",
  "contact_manual_location_save": "Standort speichern",
  "common_clear": "Löschen",
  "map_owner_link": "Besitzer anschreiben",
  "map_node_details": "Details",
  "repeater_owner_info_autofilled": "Beim Kontakt gespeichert",
  "repeater_owner_info_conflict": "Repeater meldet \"{{fetched}}\"; gespeicherte Besitzerinfo ist \"{{stored}}\".",
  "repeater_owner_info_override": "Gespeicherte Besitzerinfo überschreiben"
```

- [ ] **Step 4: Run the i18n parity test + lint**

Run (from `frontend/`): `npm run test -- i18n` then `npm run lint`
Expected: PASS — all three locales have identical key sets; no `i18next/no-literal-string` violations.

- [ ] **Step 5: Stage**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
```

---

## Task 12: Documentation

**Files:**
- Modify: `app/AGENTS.md`, `frontend/AGENTS.md`, `CHANGELOG-DMC-EV.md`

- [ ] **Step 1: Update app/AGENTS.md**

In the "Data Model Notes" section, under the `contacts` table bullet, note the five new user-annotation columns (`notes`, `owner_info`, `owner_key`, `manual_lat`, `manual_lon`), that they are user-set and preserved through radio-sync upserts via `COALESCE`, and that `owner_key` references another contact. In "API Surface → Contacts", add:

```markdown
- `POST /contacts/{public_key}/annotations` — set user annotations (notes, owner_info, owner_key, manual_lat, manual_lon); partial update, `null` clears; `owner_key` must reference an existing contact; broadcasts `contact`
```

And under the owner-info endpoint note that it auto-fills `owner_info` when the stored value is empty and returns `stored_owner_info` + `owner_info_updated`.

- [ ] **Step 2: Update frontend/AGENTS.md**

Note: contact annotations are edited in `ContactInfoPane` and saved via `api.updateContactAnnotations`; effective map location is resolved by `getEffectiveLocation` (advertised-wins, manual-fallback) in `utils/pathUtils.ts`; the map popup exposes a Details button that opens the info pane; the repeater Owner Info pane auto-fills/overrides the contact's owner_info.

- [ ] **Step 3: Add a CHANGELOG-DMC-EV.md entry**

Follow the file's existing format (grouped by area). Add an entry describing: DB-stored contact annotations (notes, owner info, owner pubkey with click-to-DM + Owned-nodes reverse list, manual fallback GPS), the new `/contacts/{key}/annotations` endpoint, owner-info auto-fill, and migration `_085`.

- [ ] **Step 4: Stage**

```bash
git add app/AGENTS.md frontend/AGENTS.md CHANGELOG-DMC-EV.md
```

---

## Final verification

- [ ] **Backend full suite**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/ -v`
Expected: new tests pass; no regressions beyond the known pre-existing Windows env failures.

- [ ] **Frontend full checks**

Run (from `frontend/`): `npm run test && npm run lint && npm run format:check && npm run build`
Expected: all pass.

- [ ] **Runtime verification (required before claiming done)**

Rebuild the local container against this branch and verify in the running app (per project rule "Never claim it works without proof"):
1. Open a contact's info pane; set notes, owner info, an owner (existing contact), and manual GPS; confirm each persists across a reload (WS `contact` update or refetch).
2. Confirm the owner link opens the DM conversation, and the owner contact's pane shows the node under "Owned nodes".
3. Confirm a contact with only manual GPS now appears on the map, and the popup shows the notes snippet + Details button.
4. Run the repeater Owner Info pane against a repeater: confirm auto-fill toast when empty, and the override prompt when a different value is already saved.

Record the two independent checks actually run (e.g. backend suite output + observed UI behavior) when reporting completion.

---

## Self-review notes

- **Spec coverage:** notes (Tasks 2,3,8), owner_info free text + CLI auto-fill (Tasks 2,3,5,10), owner_key pubkey + DM link + Owned-nodes reverse list (Tasks 2,3,4,8), manual GPS fallback + effective location (Tasks 2,3,7,8,9), annotations endpoint (Task 4), WS broadcast (Tasks 4,5), map surfacing + Details (Task 9), docs (Task 12), i18n EN/NL/DE (Task 11). All spec sections mapped.
- **Deferred spec decision (FK cascade on owner_key):** the spec flagged whether deleting a referenced contact should null dangling `owner_key`. Decision for this plan: no schema FK; the owner link degrades gracefully (renders raw key, no navigation) and Owned-nodes simply won't match — already handled by the `ownerContact` null-guard in Task 8. Revisit only if dangling keys prove noisy in practice.
- **Type consistency:** `updateContactAnnotations(publicKey, ContactAnnotationsUpdate)`, `getEffectiveLocation(contact) -> {lat,lon}|null`, `set_annotations(public_key, dict)`, `set_owner_info_if_empty(public_key, str) -> bool`, response fields `stored_owner_info` / `owner_info_updated` used consistently across backend and frontend tasks.
