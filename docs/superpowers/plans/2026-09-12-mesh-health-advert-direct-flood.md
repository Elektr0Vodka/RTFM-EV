# Mesh-health advert direct/flood split + dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the mesh-health advert count into Direct vs Flood, deduped to unique advert transmissions, backed by a new `advert_events` table with configurable retention.

**Architecture:** A new `advert_events` table stores one row per unique advert transmission, keyed by the primary copy's `raw_packets.id` and carrying `min_path_len` (0 = direct, >0 = flood). The advert ingest path upserts into it; the mesh-health endpoint aggregates direct/flood counts per contact over a window; a daily background loop prunes old rows using a new `advert_retention_days` app setting exposed on the Database settings page.

**Tech Stack:** Python 3 / FastAPI / aiosqlite (backend), React / TypeScript / Vitest (frontend), SQLite user_version migrations.

---

## Conventions for this plan

- **Git policy (repo CLAUDE.md overrides the skill default):** Do NOT run `git commit` unless the user explicitly authorizes it. Each task ends at a "Checkpoint: stage and prepare commit" step: run `git add` for the listed paths and hold with the prepared message. Only commit when told.
- **No AI attribution** in any commit message or PR body.
- **Running backend tests:** tests run in the `rtfm-ev-local` container against its venv, with this worktree bind-mounted to `/work`:
  `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest <path> -v`
  The step commands below write `pytest <path>` for brevity; run them through that wrapper.
- **Running frontend tests:** from `frontend/`: `npm run test -- <file>`, `npm run lint`, `npx prettier --check <file>`. The i18n parity test is part of the frontend suite.
- **No em dashes** in any user-facing string or code comment (repo style).

---

## File structure

Backend:
- Create `app/migrations/_080_create_advert_events.py` — table, indexes, `app_settings.advert_retention_days` column, backfill.
- Create `app/repository/advert_events.py` — `AdvertEventRepository` (record, mesh-health aggregation, prune).
- Create `app/services/advert_pruner.py` — daily prune loop (`start_advert_prune` / `stop_advert_prune`).
- Modify `app/repository/__init__.py` — export `AdvertEventRepository`.
- Modify `app/packet_processor.py` — call `AdvertEventRepository.record(...)` in `_process_advertisement`.
- Modify `app/routers/packets.py` — recompute `/mesh-health` from `advert_events`; add `direct_count`/`flood_count` to `MeshHealthContact`.
- Modify `app/models.py` — add `advert_retention_days` to `AppSettings`.
- Modify `app/repository/settings.py` — SELECT/parse/update the new column.
- Modify `app/routers/settings.py` — `AppSettingsUpdate.advert_retention_days` + kwargs wiring.
- Modify `app/main.py` — start/stop the prune loop in `lifespan`.

Tests:
- Create `tests/test_migrations/test_migration_080.py`.
- Create `tests/test_advert_events.py`.
- Modify `tests/test_mesh_health_endpoints.py`.
- Modify `tests/test_migrations/conftest.py` — bump `LATEST_SCHEMA_VERSION`.

Frontend:
- Modify `frontend/src/types.ts` — `AppSettings` / `AppSettingsUpdate` gain `advert_retention_days`; (interfaces for mesh-health live inside the view file).
- Modify `frontend/src/components/MeshHealthView.tsx` — Direct/Flood/Total columns + summary.
- Modify `frontend/src/components/settings/SettingsDatabaseSection.tsx` — retention input.
- Modify `frontend/src/i18n/locales/{en,nl,de}.json` — new keys.
- Modify `frontend/src/test/*` — view + settings coverage.

---

## Task 1: Migration `_080_create_advert_events`

**Files:**
- Create: `app/migrations/_080_create_advert_events.py`
- Modify: `tests/test_migrations/conftest.py:5`
- Test: `tests/test_migrations/test_migration_080.py`

- [ ] **Step 1: Bump the schema version constant**

In `tests/test_migrations/conftest.py`, change:

```python
LATEST_SCHEMA_VERSION = 79
```

- [ ] **Step 2: Write the failing migration test**

Create `tests/test_migrations/test_migration_080.py`:

```python
"""Tests for database migration 079: create advert_events + retention setting."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration079:
    @pytest.mark.asyncio
    async def test_creates_table_column_and_backfills(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 78)
            # Minimal app_settings single row (migration adds the new column).
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            # Existing advert paths to backfill from: one direct, one flooded.
            await conn.execute(
                """
                CREATE TABLE contact_advert_paths (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    public_key TEXT NOT NULL,
                    path_hex TEXT NOT NULL,
                    path_len INTEGER NOT NULL,
                    first_seen INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL,
                    last_primary_seen INTEGER,
                    heard_count INTEGER NOT NULL DEFAULT 1
                )
                """
            )
            await conn.execute(
                "INSERT INTO contact_advert_paths "
                "(public_key, path_hex, path_len, first_seen, last_seen, last_primary_seen, heard_count) "
                "VALUES ('aa', '', 0, 100, 500, 500, 3), "
                "       ('aa', 'bbbbccccdddd', 3, 100, 600, 600, 2)"
            )
            await conn.commit()

            applied = await run_migrations(conn)
            assert await get_version(conn) == LATEST_SCHEMA_VERSION
            assert applied == LATEST_SCHEMA_VERSION - 78

            # New column on app_settings, default 30.
            cur = await conn.execute("PRAGMA table_info(app_settings)")
            cols = {r[1]: r for r in await cur.fetchall()}
            assert "advert_retention_days" in cols

            cur = await conn.execute("SELECT advert_retention_days FROM app_settings WHERE id = 1")
            assert (await cur.fetchone())["advert_retention_days"] == 30

            # Backfilled events: one direct (min_path_len 0), one flood (3).
            cur = await conn.execute(
                "SELECT public_key, transmission_id, min_path_len, path_hex, hop_width, first_seen "
                "FROM advert_events ORDER BY min_path_len"
            )
            rows = await cur.fetchall()
            assert len(rows) == 2
            assert rows[0]["min_path_len"] == 0
            assert rows[0]["transmission_id"] is None  # backfill rows have no txid
            assert rows[0]["first_seen"] == 500
            assert rows[1]["min_path_len"] == 3
            assert rows[1]["hop_width"] == 2  # 12 hex / 3 hops / 2 = 2 bytes per hop
        finally:
            await conn.close()

    @pytest.mark.asyncio
    async def test_idempotent_without_source_tables(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 78)
            await conn.execute("CREATE TABLE app_settings (id INTEGER PRIMARY KEY)")
            await conn.execute("INSERT INTO app_settings (id) VALUES (1)")
            await conn.commit()
            await run_migrations(conn)  # must not raise with no contact_advert_paths
            cur = await conn.execute("SELECT COUNT(*) AS n FROM advert_events")
            assert (await cur.fetchone())["n"] == 0
        finally:
            await conn.close()
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pytest tests/test_migrations/test_migration_080.py -v`
Expected: FAIL (module `_080_create_advert_events` does not exist; `advert_events` missing).

- [ ] **Step 4: Write the migration**

Create `app/migrations/_080_create_advert_events.py`:

```python
import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create advert_events + add app_settings.advert_retention_days.

    advert_events holds one row per unique advert transmission (deduped across
    paths). transmission_id is the primary copy's raw_packets.id; NULL for
    backfilled rows. min_path_len is the smallest hop count seen across copies
    (0 = heard direct). Backfill seeds one approximate event per existing
    contact_advert_paths row. Idempotent.
    """
    tables_cursor = await conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = {row[0] for row in await tables_cursor.fetchall()}

    # advert_events table + indexes.
    if "advert_events" not in tables:
        await conn.execute(
            """
            CREATE TABLE advert_events (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                transmission_id INTEGER,
                public_key      TEXT NOT NULL,
                first_seen      INTEGER NOT NULL,
                min_path_len    INTEGER NOT NULL,
                path_hex        TEXT,
                hop_width       INTEGER
            )
            """
        )
        await conn.execute(
            "CREATE UNIQUE INDEX ux_advert_events_txid ON advert_events(transmission_id)"
        )
        await conn.execute(
            "CREATE INDEX ix_advert_events_pk_seen ON advert_events(public_key, first_seen)"
        )
        await conn.execute("CREATE INDEX ix_advert_events_seen ON advert_events(first_seen)")

        # Approximate backfill from contact_advert_paths (per-path, not per-transmission).
        if "contact_advert_paths" in tables:
            async with conn.execute(
                """
                SELECT public_key, path_hex, path_len,
                       COALESCE(last_primary_seen, first_seen) AS seen
                FROM contact_advert_paths
                """
            ) as cur:
                rows = await cur.fetchall()
            for row in rows:
                path_hex = row["path_hex"] or ""
                path_len = row["path_len"] or 0
                hop_width = None
                if path_len > 0 and path_hex:
                    hex_per_hop = len(path_hex) // path_len
                    if hex_per_hop > 0:
                        hop_width = hex_per_hop // 2
                await conn.execute(
                    """
                    INSERT INTO advert_events
                        (transmission_id, public_key, first_seen, min_path_len, path_hex, hop_width)
                    VALUES (NULL, ?, ?, ?, ?, ?)
                    """,
                    (row["public_key"], row["seen"], path_len, path_hex, hop_width),
                )

    # app_settings.advert_retention_days (default 30 days).
    if "app_settings" in tables:
        col_cursor = await conn.execute("PRAGMA table_info(app_settings)")
        existing = {row[1] for row in await col_cursor.fetchall()}
        if "advert_retention_days" not in existing:
            await conn.execute(
                "ALTER TABLE app_settings ADD COLUMN advert_retention_days INTEGER DEFAULT 30"
            )

    await conn.commit()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pytest tests/test_migrations/test_migration_080.py -v`
Expected: PASS (both tests).

- [ ] **Step 6: Checkpoint - stage and prepare commit**

```bash
git add app/migrations/_080_create_advert_events.py tests/test_migrations/test_migration_080.py tests/test_migrations/conftest.py
# Prepared message (commit only when authorized):
# feat(mesh-health): add advert_events table + advert_retention_days setting (migration 079)
```

---

## Task 2: `AdvertEventRepository` (record + aggregate + prune)

**Files:**
- Create: `app/repository/advert_events.py`
- Modify: `app/repository/__init__.py`
- Test: `tests/test_advert_events.py`

- [ ] **Step 1: Write the failing repository test**

Create `tests/test_advert_events.py`:

```python
"""Tests for AdvertEventRepository: dedup, direct/flood aggregation, prune."""

import pytest

from app.repository.advert_events import AdvertEventRepository


class TestAdvertEventRecord:
    @pytest.mark.asyncio
    async def test_dedup_and_min_path_len_refinement(self, test_db):
        pk = "aa" * 32
        # Flood copy first (path_len 2), then a direct copy of the SAME transmission.
        await AdvertEventRepository.record(
            transmission_id=1, public_key=pk, timestamp=100, path_len=2, path_hex="bbbbcccc"
        )
        await AdvertEventRepository.record(
            transmission_id=1, public_key=pk, timestamp=101, path_len=0, path_hex=""
        )
        rows = await AdvertEventRepository.mesh_health_rows(0, 1000)
        assert len(rows) == 1
        assert rows[0]["public_key"] == pk
        assert rows[0]["direct_count"] == 1  # refined to direct
        assert rows[0]["flood_count"] == 0

    @pytest.mark.asyncio
    async def test_direct_and_flood_counted_separately(self, test_db):
        pk = "bb" * 32
        # Two distinct direct transmissions, one flood-only transmission.
        await AdvertEventRepository.record(
            transmission_id=10, public_key=pk, timestamp=100, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=11, public_key=pk, timestamp=150, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=12, public_key=pk, timestamp=200, path_len=1, path_hex="cccc"
        )
        rows = await AdvertEventRepository.mesh_health_rows(0, 1000)
        assert rows[0]["direct_count"] == 2
        assert rows[0]["flood_count"] == 1
        assert rows[0]["min_path_len"] == 0

    @pytest.mark.asyncio
    async def test_window_filtering(self, test_db):
        pk = "cc" * 32
        await AdvertEventRepository.record(
            transmission_id=20, public_key=pk, timestamp=50, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=21, public_key=pk, timestamp=500, path_len=0, path_hex=""
        )
        rows = await AdvertEventRepository.mesh_health_rows(100, 1000)
        assert rows[0]["direct_count"] == 1  # only the ts=500 event is in-window

    @pytest.mark.asyncio
    async def test_prune_older_than(self, test_db):
        pk = "dd" * 32
        await AdvertEventRepository.record(
            transmission_id=30, public_key=pk, timestamp=1000, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=31, public_key=pk, timestamp=5000, path_len=0, path_hex=""
        )
        deleted = await AdvertEventRepository.prune_older_than(cutoff_ts=4000)
        assert deleted == 1
        rows = await AdvertEventRepository.mesh_health_rows(0, 10000)
        assert rows[0]["direct_count"] == 1
```

Note: `test_db` fixture (from `tests/conftest.py`) provisions a fully-migrated in-memory DB, so `advert_events` exists.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_advert_events.py -v`
Expected: FAIL (`app.repository.advert_events` does not exist).

- [ ] **Step 3: Write the repository**

Create `app/repository/advert_events.py`:

```python
from app.database import db


class AdvertEventRepository:
    """One row per unique advert transmission (deduped across paths).

    transmission_id is the primary copy's raw_packets.id; all copies of a
    payload share it, so it is the dedup key. min_path_len is the smallest hop
    count seen across copies (0 = direct). record() is called on every advert
    reception so a later direct copy can lower min_path_len to 0.
    """

    @staticmethod
    def _hop_width(path_len: int, path_hex: str) -> int | None:
        if path_len > 0 and path_hex:
            hex_per_hop = len(path_hex) // path_len
            if hex_per_hop > 0:
                return hex_per_hop // 2
        return None

    @staticmethod
    async def record(
        transmission_id: int,
        public_key: str,
        timestamp: int,
        path_len: int,
        path_hex: str,
    ) -> None:
        normalized_key = public_key.lower()
        normalized_path = (path_hex or "").lower()
        hop_width = AdvertEventRepository._hop_width(path_len, normalized_path)
        async with db.tx() as conn:
            await conn.execute(
                """
                INSERT INTO advert_events
                    (transmission_id, public_key, first_seen, min_path_len, path_hex, hop_width)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(transmission_id) DO UPDATE SET
                    path_hex = CASE
                        WHEN excluded.min_path_len < advert_events.min_path_len
                        THEN excluded.path_hex ELSE advert_events.path_hex END,
                    hop_width = CASE
                        WHEN excluded.min_path_len < advert_events.min_path_len
                        THEN excluded.hop_width ELSE advert_events.hop_width END,
                    min_path_len = MIN(advert_events.min_path_len, excluded.min_path_len),
                    first_seen = MIN(advert_events.first_seen, excluded.first_seen)
                """,
                (transmission_id, normalized_key, timestamp, path_len, normalized_path, hop_width),
            )

    @staticmethod
    async def mesh_health_rows(start_ts: int, end_ts: int) -> list[dict]:
        """Per-contact direct/flood aggregation over [start_ts, end_ts)."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT
                    ae.public_key AS public_key,
                    MIN(ae.first_seen) AS first_seen,
                    MAX(ae.first_seen) AS last_event,
                    MIN(ae.min_path_len) AS min_path_len,
                    SUM(CASE WHEN ae.min_path_len = 0 THEN 1 ELSE 0 END) AS direct_count,
                    SUM(CASE WHEN ae.min_path_len > 0 THEN 1 ELSE 0 END) AS flood_count
                FROM advert_events ae
                WHERE ae.first_seen >= :start_ts AND ae.first_seen < :end_ts
                GROUP BY ae.public_key
                """,
                {"start_ts": start_ts, "end_ts": end_ts},
            ) as cur:
                rows = await cur.fetchall()
        return [
            {
                "public_key": r["public_key"],
                "first_seen": r["first_seen"],
                "last_event": r["last_event"],
                "min_path_len": r["min_path_len"],
                "direct_count": int(r["direct_count"]),
                "flood_count": int(r["flood_count"]),
            }
            for r in rows
        ]

    @staticmethod
    async def prune_older_than(cutoff_ts: int) -> int:
        """Delete events with first_seen < cutoff_ts. Returns rows deleted."""
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM advert_events WHERE first_seen < ?", (cutoff_ts,)
            ) as cur:
                return cur.rowcount
```

- [ ] **Step 4: Export the repository**

In `app/repository/__init__.py`, add an import + `__all__` entry mirroring the existing exports. Add near the other repository imports:

```python
from app.repository.advert_events import AdvertEventRepository
```

And add `"AdvertEventRepository",` to the `__all__` list.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pytest tests/test_advert_events.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Checkpoint - stage and prepare commit**

```bash
git add app/repository/advert_events.py app/repository/__init__.py tests/test_advert_events.py
# feat(mesh-health): AdvertEventRepository with dedup, direct/flood aggregation, prune
```

---

## Task 3: Record advert events at ingest

**Files:**
- Modify: `app/packet_processor.py:674-684` (after `ContactAdvertPathRepository.record_observation`)
- Test: `tests/test_packet_pipeline.py` (add a case) OR `tests/test_advert_events.py` (integration via processor)

- [ ] **Step 1: Write the failing integration test**

Append to `tests/test_advert_events.py`:

```python
class TestAdvertEventIngest:
    @pytest.mark.asyncio
    async def test_process_advertisement_records_event(self, test_db, monkeypatch):
        import app.packet_processor as pp
        from app.repository.advert_events import AdvertEventRepository

        recorded = {}

        async def fake_record(transmission_id, public_key, timestamp, path_len, path_hex):
            recorded.update(
                transmission_id=transmission_id,
                public_key=public_key,
                path_len=path_len,
                path_hex=path_hex,
            )

        monkeypatch.setattr(AdvertEventRepository, "record", fake_record)
        # Call the recorder wiring directly with representative values, mirroring
        # the call site in _process_advertisement (packet_id, path_len, path_hex).
        await pp.AdvertEventRepository.record(
            transmission_id=42,
            public_key=("ab" * 32),
            timestamp=1700000000,
            path_len=0,
            path_hex="",
        )
        assert recorded["transmission_id"] == 42
        assert recorded["path_len"] == 0
```

Note: this is a wiring smoke test. It asserts `AdvertEventRepository` is imported into `packet_processor` (`pp.AdvertEventRepository`) and callable with the agreed signature. It does NOT prove `_process_advertisement` invokes it during real advert processing (constructing a validly-signed advert packet is out of scope here) — that is confirmed by the runtime cross-check in Task 9. Step 5 below only guards against regressions in the existing pipeline tests.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_advert_events.py::TestAdvertEventIngest -v`
Expected: FAIL (`packet_processor` has no `AdvertEventRepository` attribute).

- [ ] **Step 3: Wire the recorder into `_process_advertisement`**

In `app/packet_processor.py`, add `AdvertEventRepository` to the repository import block (find the existing `from app.repository import (...)` group and add `AdvertEventRepository,`).

Then, immediately after the `await ContactAdvertPathRepository.record_observation(...)` call (ends at line ~684), add:

```python
    # Record a deduped advert-transmission event. All copies of one payload share
    # the same raw_packets.id (packet_id), so it is the transmission id; a later
    # direct copy (is_new_packet=False) lowers min_path_len to 0. Recorded on every
    # reception, not only is_new_packet, so direct/flood classification is accurate.
    await AdvertEventRepository.record(
        transmission_id=packet_id,
        public_key=advert.public_key.lower(),
        timestamp=timestamp,
        path_len=new_path_len,
        path_hex=new_path_hex,
    )
```

Note: `packet_id` is passed into `process_raw_packet` and is in scope where `_process_advertisement` is invoked (line ~396). If `_process_advertisement` does not currently receive `packet_id`, add a `packet_id: int` parameter to its signature and pass it from the call site at `app/packet_processor.py:393-397`. Confirm by reading the call site before editing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_advert_events.py::TestAdvertEventIngest -v`
Expected: PASS.

- [ ] **Step 5: Run the broader packet pipeline tests (no regressions)**

Run: `pytest tests/test_packet_pipeline.py tests/test_event_handlers.py -v`
Expected: PASS (pre-existing Windows-only env failures, if any, are unrelated).

- [ ] **Step 6: Checkpoint - stage and prepare commit**

```bash
git add app/packet_processor.py tests/test_advert_events.py
# feat(mesh-health): record deduped advert events on advert ingest
```

---

## Task 4: Settings plumbing for `advert_retention_days`

**Files:**
- Modify: `app/models.py:1064+` (`AppSettings`)
- Modify: `app/repository/settings.py` (SELECT list, parse, `_apply_updates`, `update`)
- Modify: `app/routers/settings.py:36+` (`AppSettingsUpdate`) and `:263+` (kwargs)
- Test: `tests/test_settings_router.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_settings_router.py` (match the file's existing style; adapt fixture names if needed):

```python
class TestAdvertRetentionSetting:
    @pytest.mark.asyncio
    async def test_default_is_30(self, test_db, client):
        resp = await client.get("/api/settings")
        assert resp.status_code == 200
        assert resp.json()["advert_retention_days"] == 30

    @pytest.mark.asyncio
    async def test_update_persists(self, test_db, client):
        resp = await client.patch("/api/settings", json={"advert_retention_days": 7})
        assert resp.status_code == 200
        assert resp.json()["advert_retention_days"] == 7
        again = await client.get("/api/settings")
        assert again.json()["advert_retention_days"] == 7

    @pytest.mark.asyncio
    async def test_rejects_out_of_range(self, test_db, client):
        resp = await client.patch("/api/settings", json={"advert_retention_days": 0})
        assert resp.status_code == 422
```

Note: confirm the settings GET path and update HTTP method/route by reading `tests/test_settings_router.py` and `app/routers/settings.py` (use the same route/verb the file already uses, e.g. `GET /api/settings` and the existing update endpoint). Adjust the three calls above to match.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_settings_router.py::TestAdvertRetentionSetting -v`
Expected: FAIL (field absent from response; update ignored).

- [ ] **Step 3: Add the field to `AppSettings`**

In `app/models.py`, inside `class AppSettings`, add (place near the other scalar settings):

```python
    advert_retention_days: int = Field(
        default=30,
        description="Days of advert_events history to keep; older events are pruned daily",
    )
```

- [ ] **Step 4: Plumb the repository**

In `app/repository/settings.py`:

1. Add `advert_retention_days` to the SELECT column list in `_get_in_conn` (append to the trailing columns).
2. Parse it with a guard before the `return AppSettings(...)`:

```python
        try:
            advert_retention_days = row["advert_retention_days"]
            advert_retention_days = int(advert_retention_days) if advert_retention_days is not None else 30
        except (KeyError, TypeError, ValueError):
            advert_retention_days = 30
```

3. Pass `advert_retention_days=advert_retention_days` into the `AppSettings(...)` constructor.
4. Add `advert_retention_days: int | None = None` to both `_apply_updates` and `update` signatures.
5. In `_apply_updates`, add:

```python
        if advert_retention_days is not None:
            updates.append("advert_retention_days = ?")
            params.append(advert_retention_days)
```

6. In `update`, forward `advert_retention_days=advert_retention_days` to `_apply_updates`.

- [ ] **Step 5: Plumb the router**

In `app/routers/settings.py`:

1. Add to `class AppSettingsUpdate`:

```python
    advert_retention_days: int | None = Field(
        default=None,
        ge=1,
        le=365,
        description="Days of advert history to keep before daily pruning",
    )
```

2. In `update_settings`, after the other scalar kwargs (near line ~278), add:

```python
    if update.advert_retention_days is not None:
        kwargs["advert_retention_days"] = update.advert_retention_days
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pytest tests/test_settings_router.py::TestAdvertRetentionSetting -v`
Expected: PASS (3 tests).

- [ ] **Step 7: Checkpoint - stage and prepare commit**

```bash
git add app/models.py app/repository/settings.py app/routers/settings.py tests/test_settings_router.py
# feat(mesh-health): configurable advert_retention_days app setting
```

---

## Task 5: Mesh-health endpoint direct/flood recompute

**Files:**
- Modify: `app/routers/packets.py:565-693` (`MeshHealthContact`, `get_mesh_health`)
- Test: `tests/test_mesh_health_endpoints.py`

- [ ] **Step 1: Write/replace the failing endpoint test**

In `tests/test_mesh_health_endpoints.py`, replace the body of `TestMeshHealth.test_advert_count_and_alert_thresholds` and add a direct/flood case. Use `AdvertEventRepository` to seed events (the endpoint now reads from `advert_events`):

```python
    @pytest.mark.asyncio
    async def test_direct_flood_split_and_alert(self, test_db, client):
        from app.repository.advert_events import AdvertEventRepository

        start, end = 1700000000, 1700003600  # 1h window
        pk = "aa" * 32
        await _contact(pk, start + 10)
        # 3 direct transmissions + 1 flood-only -> direct 3, flood 1, total 4 -> MEDIUM (>2).
        for i, txid in enumerate((1, 2, 3)):
            await AdvertEventRepository.record(
                transmission_id=txid, public_key=pk, timestamp=start + 10 + i,
                path_len=0, path_hex="",
            )
        await AdvertEventRepository.record(
            transmission_id=4, public_key=pk, timestamp=start + 20, path_len=2, path_hex="bbbbcccc",
        )

        resp = await client.get(f"/api/packets/mesh-health?start_ts={start}&end_ts={end}")
        assert resp.status_code == 200
        body = resp.json()
        c = next(x for x in body["contacts"] if x["public_key"] == pk)
        assert c["direct_count"] == 3
        assert c["flood_count"] == 1
        assert c["advert_count"] == 4
        assert c["min_path_len"] == 0
        assert body["medium_alert_count"] == 1
        assert body["alerts"][0]["level"] == "MEDIUM"
```

Keep `test_rejects_bad_range` as-is.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_mesh_health_endpoints.py::TestMeshHealth -v`
Expected: FAIL (`direct_count`/`flood_count` absent; counts read from old table).

- [ ] **Step 3: Update the response model**

In `app/routers/packets.py`, add to `class MeshHealthContact`:

```python
    direct_count: int = 0
    flood_count: int = 0
```

- [ ] **Step 4: Rewrite `get_mesh_health` aggregation**

Replace the SQL block + row loop in `get_mesh_health` (lines ~611-660) so it reads from `AdvertEventRepository.mesh_health_rows` and joins contact metadata. Keep the alert logic below it, but base counts on `advert_count = direct + flood`:

```python
    from app.repository.advert_events import AdvertEventRepository
    from app.repository import ContactRepository

    event_rows = await AdvertEventRepository.mesh_health_rows(start_ts, end_ts)

    contacts: list[MeshHealthContact] = []
    alerts: list[MeshHealthAlert] = []
    high_count = 0
    medium_count = 0

    for row in event_rows:
        pk = row["public_key"]
        contact = await ContactRepository.get_by_key(pk)
        direct = row["direct_count"]
        flood = row["flood_count"]
        advert_count = direct + flood
        first_seen = row["first_seen"]
        if first_seen is not None and first_seen < start_ts:
            first_seen = start_ts
        contacts.append(
            MeshHealthContact(
                public_key=pk,
                name=contact.name if contact else None,
                advert_count=advert_count,
                direct_count=direct,
                flood_count=flood,
                first_seen=first_seen,
                last_seen=(contact.last_seen if contact else None) or row["last_event"],
                lat=contact.lat if contact else None,
                lon=contact.lon if contact else None,
                min_path_len=row["min_path_len"],
                hash_mode=None,
            )
        )

        adverts_per_hour = advert_count / max(window_hours, 0.01)
        if advert_count > MESH_HEALTH_HIGH_THRESHOLD:
            level = "HIGH"
            high_count += 1
        elif advert_count > MESH_HEALTH_MEDIUM_THRESHOLD:
            level = "MEDIUM"
            medium_count += 1
        else:
            continue
        alerts.append(
            MeshHealthAlert(
                level=level,
                public_key=pk,
                name=contact.name if contact else None,
                advert_count=advert_count,
                adverts_per_hour=round(adverts_per_hour, 2),
            )
        )

    contacts.sort(key=lambda c: c.advert_count, reverse=True)
```

Leave the `MeshHealthResponse(...)` return unchanged (it already reports `total_contacts=len(contacts)` etc.).

Efficiency note: this does one `ContactRepository.get_by_key` per in-window contact (N+1). The mesh-health endpoint is low-frequency (manual / 30s auto-refresh) and contact counts are modest (hundreds), so this is acceptable for a first cut. If it shows up as slow, replace the per-row lookup with a single bulk fetch of the in-window public keys.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pytest tests/test_mesh_health_endpoints.py -v`
Expected: PASS (direct/flood test + reachability/scatter/heatmap tests unaffected).

- [ ] **Step 6: Checkpoint - stage and prepare commit**

```bash
git add app/routers/packets.py tests/test_mesh_health_endpoints.py
# feat(mesh-health): compute direct/flood advert counts from advert_events
```

---

## Task 6: Daily prune background loop

**Files:**
- Create: `app/services/advert_pruner.py`
- Modify: `app/main.py:107-167` (lifespan start/stop)
- Test: `tests/test_advert_events.py` (loop unit) — the `prune_older_than` behavior is already covered in Task 2; here test the retention-to-cutoff wiring.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_advert_events.py`:

```python
class TestAdvertPruner:
    @pytest.mark.asyncio
    async def test_prune_once_uses_setting(self, test_db, monkeypatch):
        from app.repository.advert_events import AdvertEventRepository
        from app.services import advert_pruner

        pk = "ee" * 32
        import time as _time
        now = int(_time.time())
        await AdvertEventRepository.record(
            transmission_id=100, public_key=pk, timestamp=now - 40 * 86400, path_len=0, path_hex=""
        )
        await AdvertEventRepository.record(
            transmission_id=101, public_key=pk, timestamp=now - 1 * 86400, path_len=0, path_hex=""
        )

        # Retention default is 30 days -> the 40-day-old event is pruned.
        deleted = await advert_pruner.prune_once()
        assert deleted == 1
        rows = await AdvertEventRepository.mesh_health_rows(0, now + 10)
        assert rows[0]["direct_count"] == 1
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/test_advert_events.py::TestAdvertPruner -v`
Expected: FAIL (`app.services.advert_pruner` does not exist).

- [ ] **Step 3: Write the pruner service**

Create `app/services/advert_pruner.py`:

```python
import asyncio
import logging
import time

from app.repository import AppSettingsRepository
from app.repository.advert_events import AdvertEventRepository

logger = logging.getLogger(__name__)

PRUNE_INTERVAL_SECONDS = 86400  # daily
_prune_task: asyncio.Task | None = None


async def prune_once() -> int:
    """Prune advert_events older than the configured retention, once."""
    settings = await AppSettingsRepository.get()
    days = max(1, int(settings.advert_retention_days or 30))
    cutoff = int(time.time()) - days * 86400
    deleted = await AdvertEventRepository.prune_older_than(cutoff)
    if deleted:
        logger.info("Pruned %d advert_events older than %d days", deleted, days)
    return deleted


async def _prune_loop() -> None:
    # Run shortly after startup, then daily.
    while True:
        try:
            await asyncio.sleep(60)
            await prune_once()
            await asyncio.sleep(PRUNE_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("Advert prune task cancelled")
            break
        except Exception as e:
            logger.error("Error in advert prune loop: %s", e, exc_info=True)
            await asyncio.sleep(PRUNE_INTERVAL_SECONDS)


def start_advert_prune() -> None:
    global _prune_task
    if _prune_task is None or _prune_task.done():
        _prune_task = asyncio.create_task(_prune_loop())
        logger.info("Started advert-event prune loop")


async def stop_advert_prune() -> None:
    global _prune_task
    if _prune_task and not _prune_task.done():
        _prune_task.cancel()
        try:
            await _prune_task
        except asyncio.CancelledError:
            pass
        _prune_task = None
        logger.info("Stopped advert-event prune loop")
```

- [ ] **Step 4: Wire it into the lifespan**

In `app/main.py`:

1. Add an import near the other service imports at the top of the file:

```python
from app.services.advert_pruner import start_advert_prune, stop_advert_prune
```

2. In `lifespan`, after `start_external_map_sync()` (line ~130), add:

```python
    # Daily prune of advert_events per the configured retention.
    start_advert_prune()
```

3. In the shutdown block, after `await stop_external_map_sync()` (line ~160), add:

```python
    await stop_advert_prune()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pytest tests/test_advert_events.py::TestAdvertPruner -v`
Expected: PASS.

- [ ] **Step 6: Run the app-startup test (lifespan wiring intact)**

Run: `pytest tests/test_main_startup.py -v`
Expected: PASS.

- [ ] **Step 7: Checkpoint - stage and prepare commit**

```bash
git add app/services/advert_pruner.py app/main.py tests/test_advert_events.py
# feat(mesh-health): daily advert_events prune loop honoring retention setting
```

---

## Task 7: Frontend mesh-health Direct/Flood columns

**Files:**
- Modify: `frontend/src/components/MeshHealthView.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: `frontend/src/test/meshHealthView.test.tsx` (create if absent)

- [ ] **Step 1: Add i18n keys**

Add to `frontend/src/i18n/locales/en.json` (place alphabetically near other `mesh_health_*` keys):

```json
"mesh_health_col_direct": "Direct",
"mesh_health_col_flood": "Flood",
"mesh_health_col_total": "Total",
"mesh_health_direct_flood_heading": "Direct vs flood"
```

Add the same keys to `nl.json`:

```json
"mesh_health_col_direct": "Direct",
"mesh_health_col_flood": "Flood",
"mesh_health_col_total": "Totaal",
"mesh_health_direct_flood_heading": "Direct versus flood"
```

Add to `de.json`:

```json
"mesh_health_col_direct": "Direkt",
"mesh_health_col_flood": "Flood",
"mesh_health_col_total": "Gesamt",
"mesh_health_direct_flood_heading": "Direkt vs. Flood"
```

- [ ] **Step 2: Write the failing view test**

Create `frontend/src/test/meshHealthView.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MeshHealthView } from '../components/MeshHealthView';

const RESPONSE = {
  start_ts: 0, end_ts: 3600, window_hours: 1,
  total_contacts: 1, high_alert_count: 0, medium_alert_count: 0,
  high_advert_threshold: 8, medium_advert_threshold: 2,
  alerts: [],
  contacts: [{
    public_key: 'ab'.repeat(32), name: 'Node A',
    advert_count: 4, direct_count: 3, flood_count: 1,
    first_seen: 100, last_seen: 200, lat: null, lon: null,
    min_path_len: 0, hash_mode: null,
  }],
};

describe('MeshHealthView direct/flood columns', () => {
  beforeEach(() => {
    global.fetch = vi.fn((url: string) => {
      if (String(url).includes('mesh-health')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(RESPONSE) } as Response);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }) as unknown as typeof fetch;
  });

  it('renders Direct and Flood counts', async () => {
    render(<MeshHealthView config={null} />);
    await waitFor(() => expect(screen.getByText('Node A')).toBeInTheDocument());
    // Direct = 3, Flood = 1 present in the row.
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
```

Note: adapt the render/wrapper to the repo's test utilities (look at `frontend/src/test/repeaterDashboard.test.tsx` for the i18n provider wrapper if `useT` needs one).

- [ ] **Step 3: Run the test to verify it fails**

Run (from `frontend/`): `npm run test -- src/test/meshHealthView.test.tsx`
Expected: FAIL (columns not rendered / counts absent).

- [ ] **Step 4: Update the view**

In `frontend/src/components/MeshHealthView.tsx`:

1. Extend the `MeshHealthContact` interface:

```tsx
  direct_count: number;
  flood_count: number;
```

2. Extend `SortKey`:

```tsx
  | 'direct_count'
  | 'flood_count'
```

3. In the `sorted` comparator `switch`, add:

```tsx
        case 'direct_count':
          return dir * (a.direct_count - b.direct_count);
        case 'flood_count':
          return dir * (a.flood_count - b.flood_count);
```

4. Replace the single "Adverts" `<th>` with three headers (Direct, Flood, Total). Direct/Flood sort by their keys; Total keeps sorting by `advert_count`:

```tsx
                      <th className={`${thClass} text-right`} onClick={() => handleSort('direct_count')}>
                        {t('mesh_health_col_direct')}{' '}
                        <SortIcon col="direct_count" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                      <th className={`${thClass} text-right`} onClick={() => handleSort('flood_count')}>
                        {t('mesh_health_col_flood')}{' '}
                        <SortIcon col="flood_count" sortKey={sortKey} sortDir={sortDir} />
                      </th>
                      <th className={`${thClass} text-right`} onClick={() => handleSort('advert_count')}>
                        {t('mesh_health_col_total')}{' '}
                        <SortIcon col="advert_count" sortKey={sortKey} sortDir={sortDir} />
                      </th>
```

5. Replace the single adverts `<td>` in the row body with three cells. Keep the existing alert coloring on the Total cell:

```tsx
                          <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                            {n.direct_count}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                            {n.flood_count}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            <span
                              className={
                                isHighAlert
                                  ? 'font-semibold text-destructive'
                                  : isMedAlert
                                    ? 'font-semibold text-yellow-600 dark:text-yellow-400'
                                    : 'text-muted-foreground'
                              }
                            >
                              {n.advert_count}
                            </span>
                          </td>
```

(The `isHighAlert`/`isMedAlert` locals already exist and are computed from `n.advert_count`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/test/meshHealthView.test.tsx`
Expected: PASS.

- [ ] **Step 6: Lint + format + i18n parity**

Run: `npm run lint && npx prettier --check "src/components/MeshHealthView.tsx" "src/i18n/locales/*.json" && npm run test -- i18n`
Expected: PASS (parity test confirms EN/NL/DE key sets match).

- [ ] **Step 7: Checkpoint - stage and prepare commit**

```bash
git add frontend/src/components/MeshHealthView.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/meshHealthView.test.tsx
# feat(mesh-health): show Direct/Flood/Total advert columns
```

---

## Task 8: Frontend retention setting in the Database page

**Files:**
- Modify: `frontend/src/types.ts:453-520` (`AppSettings`, `AppSettingsUpdate`)
- Modify: `frontend/src/components/settings/SettingsDatabaseSection.tsx`
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json`
- Test: `frontend/src/test/settingsModal.test.tsx` or a new `settingsDatabaseRetention.test.tsx`

- [ ] **Step 1: Add i18n keys**

Add to `en.json`:

```json
"settings_db_mesh_history_heading": "Mesh health history",
"settings_db_advert_retention_label": "Keep advert history (days)",
"settings_db_advert_retention_help": "Older advert events are pruned daily. Controls how far back the mesh-health time windows can show data."
```

`nl.json`:

```json
"settings_db_mesh_history_heading": "Mesh-health-geschiedenis",
"settings_db_advert_retention_label": "Advert-geschiedenis bewaren (dagen)",
"settings_db_advert_retention_help": "Oudere advert-events worden dagelijks opgeruimd. Bepaalt hoe ver terug de mesh-health-tijdvensters data tonen."
```

`de.json`:

```json
"settings_db_mesh_history_heading": "Mesh-Health-Verlauf",
"settings_db_advert_retention_label": "Advert-Verlauf behalten (Tage)",
"settings_db_advert_retention_help": "Ältere Advert-Ereignisse werden täglich bereinigt. Legt fest, wie weit zurück die Mesh-Health-Zeitfenster Daten anzeigen."
```

- [ ] **Step 2: Add the field to the TS types**

In `frontend/src/types.ts`, add to `interface AppSettings`:

```ts
  advert_retention_days: number;
```

and to `interface AppSettingsUpdate`:

```ts
  advert_retention_days?: number;
```

- [ ] **Step 3: Write the failing test**

Create `frontend/src/test/settingsDatabaseRetention.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SettingsDatabaseSection } from '../components/settings/SettingsDatabaseSection';

function makeSettings(overrides = {}) {
  return {
    // minimal AppSettings; extend with required fields the component reads.
    auto_decrypt_dm_on_advert: false,
    registry_sync_url: '',
    wordlist_sync_url: '',
    analyzer_sites: [],
    advert_retention_days: 30,
    ...overrides,
  } as never;
}

describe('Database settings advert retention', () => {
  it('renders the retention input with the current value', () => {
    render(
      <SettingsDatabaseSection
        appSettings={makeSettings()}
        health={null}
        onSaveAppSettings={vi.fn().mockResolvedValue(undefined)}
        onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const input = screen.getByLabelText('Keep advert history (days)') as HTMLInputElement;
    expect(input.value).toBe('30');
  });

  it('persists a changed value on blur', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <SettingsDatabaseSection
        appSettings={makeSettings()}
        health={null}
        onSaveAppSettings={onSave}
        onHealthRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );
    const input = screen.getByLabelText('Keep advert history (days)');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith({ advert_retention_days: 7 });
  });
});
```

Note: adapt to the repo test wrapper / i18n provider as used in `frontend/src/test/settingsModal.test.tsx`.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test -- src/test/settingsDatabaseRetention.test.tsx`
Expected: FAIL (input not rendered).

- [ ] **Step 5: Add the retention subsection**

In `frontend/src/components/settings/SettingsDatabaseSection.tsx`:

1. Add local state + sync from props:

```tsx
  const [advertRetention, setAdvertRetention] = useState('30');
```

In the existing `useEffect([appSettings])` body, add:

```tsx
    setAdvertRetention(String(appSettings.advert_retention_days ?? 30));
```

2. Add a new subsection (after the "Storage Cleanup" block, before its closing `<Separator />` grouping — place it as its own section):

```tsx
      <Separator />

      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">
          {t('settings_db_mesh_history_heading')}
        </h3>
        <div className="space-y-1.5">
          <Label htmlFor="advert-retention-days" className="text-sm font-medium">
            {t('settings_db_advert_retention_label')}
          </Label>
          <Input
            id="advert-retention-days"
            type="number"
            min="1"
            max="365"
            value={advertRetention}
            onChange={(e) => setAdvertRetention(e.target.value)}
            onBlur={() => {
              const days = parseInt(advertRetention, 10);
              if (isNaN(days) || days < 1 || days > 365) {
                setAdvertRetention(String(appSettings.advert_retention_days ?? 30));
                return;
              }
              void persistAppSettings({ advert_retention_days: days }, () =>
                setAdvertRetention(String(appSettings.advert_retention_days ?? 30))
              );
            }}
            className="w-24"
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_db_advert_retention_help')}
          </p>
        </div>
      </div>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -- src/test/settingsDatabaseRetention.test.tsx`
Expected: PASS.

- [ ] **Step 7: Lint + format + i18n parity**

Run: `npm run lint && npx prettier --check "src/components/settings/SettingsDatabaseSection.tsx" "src/types.ts" "src/i18n/locales/*.json" && npm run test -- i18n`
Expected: PASS.

- [ ] **Step 8: Checkpoint - stage and prepare commit**

```bash
git add frontend/src/types.ts frontend/src/components/settings/SettingsDatabaseSection.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/settingsDatabaseRetention.test.tsx
# feat(mesh-health): advert-history retention control in Database settings
```

---

## Task 9: Full-suite verification + runtime observation

**Files:** none (verification only).

- [ ] **Step 1: Backend full suite**

Run: `pytest tests/ -q`
Expected: PASS except the known pre-existing Windows-only env failures (~14 failures + charmap collection errors) documented in project memory. Confirm none of the new tests are among the failures.

- [ ] **Step 2: Frontend full suite + gates**

Run (from `frontend/`): `npm run test && npm run lint && npm run format:check`
Expected: PASS.

- [ ] **Step 3: Rebuild the local container on this branch**

Rebuild `rtfm-ev-local` from the branch (per project memory `local-docker-instance`), then confirm it is serving on :8000 and the migration ran (log line "Applying migration 79").

- [ ] **Step 4: Runtime observation (observed, not reasoned)**

- Open the mesh-health view. Confirm Direct / Flood / Total columns populate with real data and each sorts.
- Confirm the Total is deduped (a node heard via multiple relays does not show an inflated count) by cross-checking one contact against its advert paths.
- Open Settings > Database. Confirm the "Mesh health history" retention input shows the stored value, and changing it persists across a reload.
- Confirm the prune loop started without error (log line "Started advert-event prune loop").

- [ ] **Step 5: Capture evidence**

Record: the two full-suite results (backend, frontend), a screenshot of the mesh-health table with Direct/Flood/Total, and the settings input. Only after these are captured may the work be described as done.

- [ ] **Step 6: Checkpoint**

No new files. If the user authorizes commits, the per-task staged changes can be committed with the prepared messages, or squashed as the user prefers.

---

## Notes carried from the spec

- Backfill is approximate (per-path, not per-transmission): a node heard both direct and relayed before deploy shows as two backfilled events. Exact from deploy forward.
- `advert_events.path_hex` / `hop_width` are stored now but unused by this plan; the later map-links spec consumes them.
- Alert thresholds stay HIGH > 8, MEDIUM > 2, now applied to the deduped total (effectively stricter than the previous path-inflated counts).
