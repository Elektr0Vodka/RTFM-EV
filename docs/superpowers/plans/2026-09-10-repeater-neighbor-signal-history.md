# Per-link signal history (X2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-link signal samples for repeater neighbors — from active repeater queries and from passive 0-hop advert receptions — and surface the trend in the repeater neighbors pane as an inline sparkline plus an on-click detail chart.

**Architecture:** One new SQLite table `link_signal` holds samples from two perspectives (`observer_pubkey` = the queried repeater or our own node; `source` = `repeater_query` | `traffic`). Three best-effort capture sites feed it: the on-demand neighbors endpoint, the tracked-telemetry cycle, and the advert processor (0-hop). A read-only history endpoint joins both perspectives per neighbor; the frontend renders a hand-rolled SVG sparkline per row and a recharts detail chart on click.

**Tech Stack:** FastAPI, aiosqlite, Pydantic (backend); React, TypeScript, recharts, custom inline SVG (frontend); pytest + vitest.

> **PROJECT GIT RULE (overrides the skill default):** Do NOT create any commit unless the user explicitly instructs it. The "Commit" steps below mark intended commit boundaries — at each one, pause and ask the user for the go-ahead rather than committing automatically. Branch is already `feat/repeater-neighbor-signal-history` off `origin/main`; never use a `claude/` branch, never push without instruction, no AI attribution in messages.

> **BACKEND TEST ENV:** run backend tests with the worktree-local venv:
> `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest <args>`. The ~6 broker-connecting `tests/test_fanout_integration.py` tests fail on Windows (ProactorEventLoop `add_writer`) — pre-existing, not a regression.

> **FRONTEND:** run from `frontend/`: `npm run lint`, `npx tsc --noEmit`, `npx vitest run --testTimeout=30000`.

---

## File structure

**Backend**
- Create `app/migrations/_075_create_link_signal.py` — the table + indexes. (Re-verify `_075` is free vs `origin/main` before creating; if taken, use the next number.)
- Create `app/repository/link_signal.py` — `LinkSignalRepository` (writes/reads/prune).
- Modify `app/models.py` — response models for the history endpoint.
- Modify `app/routers/repeaters.py` — capture site A (in `repeater_neighbors`) + the history endpoint.
- Modify `app/radio_sync.py` — capture site B (neighbours fetch in `_collect_repeater_telemetry`) + prune once per cycle.
- Modify `app/packet_processor.py` — capture site C (0-hop advert traffic sample) + throttled prune.

**Frontend**
- Modify `frontend/src/api.ts` — `repeaterNeighborHistory`.
- Modify `frontend/src/types.ts` — history response types.
- Create `frontend/src/components/repeater/neighborSignalUtils.ts` — pure `mergeSignalSeries` helper.
- Create `frontend/src/components/repeater/NeighborSnrSparkline.tsx` — inline SVG sparkline.
- Create `frontend/src/components/repeater/NeighborSignalDetailChart.tsx` — recharts detail chart.
- Modify `frontend/src/components/repeater/RepeaterNeighborsPane.tsx` — fetch history, sparkline column, click-to-expand detail.
- Modify `frontend/src/i18n/locales/{en,nl,de}.json` — new keys (equal counts).

**Tests**
- Create `tests/test_link_signal.py` — repository + capture-site-A + endpoint + capture-site-C.
- Modify `tests/test_repeater_routes.py` or add cases — endpoint via client (optional; core covered in `test_link_signal.py`).
- Create `frontend/src/test/neighborSignal.test.ts(x)` — `mergeSignalSeries` + sparkline.

**Docs**
- Modify `docs/parity-audit.md` — correct the neighbor rows + record X2b.

---

## Task 1: Migration — `link_signal` table

**Files:**
- Create: `app/migrations/_075_create_link_signal.py`
- Test: `tests/test_link_signal.py`

- [ ] **Step 1: Verify the migration number is free**

Run: `git ls-tree --name-only origin/main app/migrations/ | sort | tail -3`
Expected: highest is `_074_...`. If `_075` is already taken by a merged/parallel branch, use the next free number for the filename in every step below.

- [ ] **Step 2: Write the failing test**

Create `tests/test_link_signal.py`:

```python
"""link_signal persistence: migration, repository, capture sites, endpoint."""

import time

import pytest


class TestLinkSignalTable:
    @pytest.mark.asyncio
    async def test_table_exists_after_migrations(self, test_db):
        async with test_db.readonly() as conn:
            async with conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='link_signal'"
            ) as cur:
                row = await cur.fetchone()
        assert row is not None
```

- [ ] **Step 3: Run test to verify it fails**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestLinkSignalTable -p no:xdist -v`
Expected: FAIL (table `link_signal` does not exist).

- [ ] **Step 4: Write the migration**

Create `app/migrations/_075_create_link_signal.py`:

```python
import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create link_signal for per-link signal history (X2b).

    Stores per-neighbor signal samples from two perspectives:
    - source='repeater_query': SNR a repeater reported for its neighbours,
      observer_pubkey = the queried repeater's full key, subject_pubkey = the
      neighbour pubkey prefix, secs_ago set, rssi NULL.
    - source='traffic': SNR/RSSI our own node measured on a 0-hop advert,
      observer_pubkey = our own key, subject_pubkey = the advertiser full key,
      rssi set, secs_ago NULL.
    Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS link_signal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            observer_pubkey TEXT NOT NULL,
            subject_pubkey TEXT NOT NULL,
            source TEXT NOT NULL,
            snr REAL NOT NULL,
            rssi INTEGER,
            secs_ago INTEGER,
            observed_at INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_link_signal_lookup "
        "ON link_signal(observer_pubkey, subject_pubkey, observed_at)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_link_signal_subject "
        "ON link_signal(subject_pubkey, observed_at)"
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_link_signal_observed_at "
        "ON link_signal(observed_at)"
    )
    await conn.commit()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestLinkSignalTable -p no:xdist -v`
Expected: PASS.

- [ ] **Step 6: Commit** (per git rule: ask the user first)

```bash
git add app/migrations/_075_create_link_signal.py tests/test_link_signal.py
git commit -m "feat(neighbors): add link_signal table for per-link signal history"
```

---

## Task 2: `LinkSignalRepository`

**Files:**
- Create: `app/repository/link_signal.py`
- Test: `tests/test_link_signal.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_link_signal.py`:

```python
from app.repository.link_signal import LinkSignalRepository

REP = "aa" * 32
SELF = "bb" * 32


class TestLinkSignalRepository:
    @pytest.mark.asyncio
    async def test_record_repeater_samples_row_per_neighbor(self, test_db):
        await LinkSignalRepository.record_repeater_samples(
            REP,
            [
                {"pubkey": "11223344", "snr": 7.25, "secs_ago": 30},
                {"pubkey": "55667788", "snr": -3.0, "secs_ago": 90},
            ],
            observed_at=1700000000,
        )
        rows = await LinkSignalRepository.get_repeater_history(REP, since=0)
        assert len(rows) == 2
        by_subject = {r["subject_pubkey"]: r for r in rows}
        assert by_subject["11223344"]["snr"] == 7.25
        assert by_subject["11223344"]["secs_ago"] == 30

    @pytest.mark.asyncio
    async def test_record_repeater_samples_empty_noop(self, test_db):
        await LinkSignalRepository.record_repeater_samples(REP, [], observed_at=1700000000)
        assert await LinkSignalRepository.get_repeater_history(REP, since=0) == []

    @pytest.mark.asyncio
    async def test_get_repeater_history_window(self, test_db):
        await LinkSignalRepository.record_repeater_samples(
            REP, [{"pubkey": "11223344", "snr": 1.0, "secs_ago": 1}], observed_at=1000
        )
        await LinkSignalRepository.record_repeater_samples(
            REP, [{"pubkey": "11223344", "snr": 2.0, "secs_ago": 1}], observed_at=5000
        )
        rows = await LinkSignalRepository.get_repeater_history(REP, since=2000)
        assert [r["snr"] for r in rows] == [2.0]

    @pytest.mark.asyncio
    async def test_record_and_match_traffic_sample(self, test_db):
        # subject full key starts with the repeater neighbour prefix "11223344"
        full = "11223344" + "cc" * 28
        await LinkSignalRepository.record_traffic_sample(
            SELF, full, snr=4.5, rssi=-80, observed_at=1700000000
        )
        rows = await LinkSignalRepository.get_traffic_history_for_subjects(
            ["11223344"], since=0
        )
        assert len(rows) == 1
        assert rows[0]["snr"] == 4.5
        assert rows[0]["rssi"] == -80
        # unrelated prefix returns nothing
        assert await LinkSignalRepository.get_traffic_history_for_subjects(["99999999"], 0) == []

    @pytest.mark.asyncio
    async def test_traffic_sample_requires_snr(self, test_db):
        await LinkSignalRepository.record_traffic_sample(
            SELF, "11223344" + "cc" * 28, snr=None, rssi=-80, observed_at=1700000000
        )
        assert await LinkSignalRepository.get_traffic_history_for_subjects(["11223344"], 0) == []

    @pytest.mark.asyncio
    async def test_prune_deletes_only_old(self, test_db):
        now = int(time.time())
        await LinkSignalRepository.record_repeater_samples(
            REP, [{"pubkey": "11223344", "snr": 1.0, "secs_ago": 1}], observed_at=now
        )
        await LinkSignalRepository.record_repeater_samples(
            REP, [{"pubkey": "55667788", "snr": 1.0, "secs_ago": 1}],
            observed_at=now - 40 * 86400,
        )
        deleted = await LinkSignalRepository.prune(older_than_days=30)
        assert deleted == 1
        rows = await LinkSignalRepository.get_repeater_history(REP, since=0)
        assert [r["subject_pubkey"] for r in rows] == ["11223344"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestLinkSignalRepository -p no:xdist -v`
Expected: FAIL (`No module named 'app.repository.link_signal'`).

- [ ] **Step 3: Write the repository**

Create `app/repository/link_signal.py`:

```python
import time

from app.database import db


class LinkSignalRepository:
    """Persistence for per-link signal samples (link_signal, X2b).

    Two perspectives distinguished by ``source``:
    - ``repeater_query``: SNR a repeater reported for its neighbours.
    - ``traffic``: SNR/RSSI our node measured on a direct (0-hop) advert.
    """

    @staticmethod
    async def record_repeater_samples(
        repeater_pubkey: str, neighbors: list[dict], observed_at: int
    ) -> None:
        """Insert one row per neighbour from a fetch_all_neighbours result.

        ``neighbors`` items use the meshcore dict shape: ``pubkey`` (hex prefix),
        ``snr`` (float), ``secs_ago`` (int). No-op on an empty list.
        """
        rows = [
            (
                repeater_pubkey,
                str(n.get("pubkey", "")),
                "repeater_query",
                float(n.get("snr", 0.0)),
                None,
                int(n.get("secs_ago", 0)),
                observed_at,
            )
            for n in neighbors
            if n.get("pubkey")
        ]
        if not rows:
            return
        async with db.tx() as conn:
            await conn.executemany(
                "INSERT INTO link_signal "
                "(observer_pubkey, subject_pubkey, source, snr, rssi, secs_ago, observed_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                rows,
            )

    @staticmethod
    async def record_traffic_sample(
        observer_pubkey: str,
        subject_pubkey: str,
        snr: float | None,
        rssi: int | None,
        observed_at: int,
    ) -> None:
        """Insert one my-node 0-hop sample. Skips samples with no SNR."""
        if snr is None or not subject_pubkey:
            return
        async with db.tx() as conn:
            await conn.execute(
                "INSERT INTO link_signal "
                "(observer_pubkey, subject_pubkey, source, snr, rssi, secs_ago, observed_at) "
                "VALUES (?, ?, 'traffic', ?, ?, NULL, ?)",
                (observer_pubkey, subject_pubkey, float(snr), rssi, observed_at),
            )

    @staticmethod
    async def get_repeater_history(repeater_pubkey: str, since: int) -> list[dict]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT subject_pubkey, snr, secs_ago, observed_at FROM link_signal "
                "WHERE source='repeater_query' AND observer_pubkey=? AND observed_at>=? "
                "ORDER BY subject_pubkey ASC, observed_at ASC",
                (repeater_pubkey, since),
            ) as cur:
                rows = await cur.fetchall()
        return [
            {
                "subject_pubkey": r["subject_pubkey"],
                "snr": r["snr"],
                "secs_ago": r["secs_ago"],
                "observed_at": r["observed_at"],
            }
            for r in rows
        ]

    @staticmethod
    async def get_traffic_history_for_subjects(prefixes: list[str], since: int) -> list[dict]:
        """Traffic samples whose subject_pubkey starts with any given prefix."""
        clean = [p for p in prefixes if p]
        if not clean:
            return []
        like_clause = " OR ".join("subject_pubkey LIKE ?" for _ in clean)
        params: list = [since, *[f"{p}%" for p in clean]]
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT subject_pubkey, snr, rssi, observed_at FROM link_signal "
                f"WHERE source='traffic' AND observed_at>=? AND ({like_clause}) "
                "ORDER BY subject_pubkey ASC, observed_at ASC",
                params,
            ) as cur:
                rows = await cur.fetchall()
        return [
            {
                "subject_pubkey": r["subject_pubkey"],
                "snr": r["snr"],
                "rssi": r["rssi"],
                "observed_at": r["observed_at"],
            }
            for r in rows
        ]

    @staticmethod
    async def prune(older_than_days: int = 30) -> int:
        cutoff = int(time.time()) - older_than_days * 86400
        async with db.tx() as conn:
            cur = await conn.execute(
                "DELETE FROM link_signal WHERE observed_at < ?", (cutoff,)
            )
            return cur.rowcount
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestLinkSignalRepository -p no:xdist -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit** (ask the user first)

```bash
git add app/repository/link_signal.py tests/test_link_signal.py
git commit -m "feat(neighbors): add LinkSignalRepository (record/query/prune)"
```

---

## Task 3: Response models

**Files:**
- Modify: `app/models.py` (add after `class RepeaterNeighborsResponse`)

- [ ] **Step 1: Add the models**

In `app/models.py`, immediately after `class RepeaterNeighborsResponse(...)` (ends ~line 737), add:

```python
class RepeaterSignalSample(BaseModel):
    """One SNR sample measured by a repeater for a neighbour."""

    observed_at: int = Field(description="Unix epoch seconds (UTC) of capture")
    snr: float = Field(description="Per-link SNR in dB")
    secs_ago: int | None = Field(
        default=None, description="Repeater's 'heard N secs ago' at sample time"
    )


class SelfSignalSample(BaseModel):
    """One SNR/RSSI sample our own node measured on a 0-hop advert."""

    observed_at: int = Field(description="Unix epoch seconds (UTC) of capture")
    snr: float = Field(description="Per-link SNR in dB")
    rssi: int | None = Field(default=None, description="RSSI in dBm if available")


class NeighborHistoryEntry(BaseModel):
    """Per-neighbour signal history from both perspectives."""

    neighbor_pubkey: str = Field(description="Neighbour pubkey prefix (hex)")
    repeater_samples: list[RepeaterSignalSample] = Field(default_factory=list)
    self_samples: list[SelfSignalSample] = Field(default_factory=list)


class RepeaterNeighborHistoryResponse(BaseModel):
    """Signal history for a repeater's neighbours."""

    neighbors: list[NeighborHistoryEntry] = Field(default_factory=list)
```

- [ ] **Step 2: Verify import/typecheck**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -c "from app.models import RepeaterNeighborHistoryResponse, NeighborHistoryEntry, RepeaterSignalSample, SelfSignalSample; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit** (ask the user first)

```bash
git add app/models.py
git commit -m "feat(neighbors): add neighbor signal-history response models"
```

---

## Task 4: Capture site A — persist on the on-demand neighbors endpoint

**Files:**
- Modify: `app/routers/repeaters.py` (`repeater_neighbors`, ~line 240-272)
- Test: `tests/test_link_signal.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_link_signal.py`:

```python
from unittest.mock import AsyncMock, MagicMock, patch

from app.models import Contact
from app.repository.link_signal import LinkSignalRepository as LSR


def _repeater_contact(pubkey: str) -> Contact:
    return Contact(public_key=pubkey, name="Rep", type=2)


class TestCaptureSiteEndpoint:
    @pytest.mark.asyncio
    async def test_neighbors_endpoint_persists_snapshot(self, test_db):
        from app.routers import repeaters

        rep_key = "cc" * 32
        neighbours = {
            "neighbours_count": 1,
            "neighbours": [{"pubkey": "11223344", "snr": 6.5, "secs_ago": 12}],
        }

        mc = MagicMock()
        mc.commands.fetch_all_neighbours = AsyncMock(return_value=neighbours)

        class _Op:
            async def __aenter__(self):
                return mc

            async def __aexit__(self, *a):
                return False

        with (
            patch.object(repeaters.radio_manager, "require_connected", MagicMock()),
            patch.object(repeaters.radio_manager, "radio_operation", MagicMock(return_value=_Op())),
            patch.object(repeaters, "_resolve_contact_or_404",
                         AsyncMock(return_value=_repeater_contact(rep_key))),
            patch.object(repeaters, "_ensure_on_radio", AsyncMock()),
            patch.object(repeaters.ContactRepository, "get_by_key_prefix",
                         AsyncMock(return_value=None)),
        ):
            await repeaters.repeater_neighbors(rep_key)

        rows = await LSR.get_repeater_history(rep_key, since=0)
        assert len(rows) == 1
        assert rows[0]["subject_pubkey"] == "11223344"
        assert rows[0]["snr"] == 6.5
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestCaptureSiteEndpoint -p no:xdist -v`
Expected: FAIL (no rows persisted).

- [ ] **Step 3: Add the persistence**

In `app/routers/repeaters.py`, add the import near the other repository import (line 29):

```python
from app.repository.link_signal import LinkSignalRepository
```

In `repeater_neighbors`, after `reported_count = ...` and before `return`, add:

```python
    # Best-effort: persist a signal snapshot for history (X2b). Never fail the
    # response on a persistence error.
    if neighbors_data and neighbors_data.get("neighbours"):
        try:
            await LinkSignalRepository.record_repeater_samples(
                contact.public_key,
                neighbors_data["neighbours"],
                observed_at=int(time.time()),
            )
        except Exception as exc:  # noqa: BLE001 - best-effort telemetry
            logger.warning("Failed to persist neighbor signal snapshot: %s", exc)
```

(`time` and `logger` are already imported at the top of the file.)

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestCaptureSiteEndpoint -p no:xdist -v`
Expected: PASS.

- [ ] **Step 5: Commit** (ask the user first)

```bash
git add app/routers/repeaters.py tests/test_link_signal.py
git commit -m "feat(neighbors): persist neighbor signal snapshot on fetch"
```

---

## Task 5: History endpoint

**Files:**
- Modify: `app/routers/repeaters.py` (add route after `repeater_neighbors`)
- Test: `tests/test_link_signal.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_link_signal.py`:

```python
class TestHistoryEndpoint:
    @pytest.mark.asyncio
    async def test_history_joins_both_perspectives(self, test_db):
        from app.routers import repeaters

        rep_key = "dd" * 32
        self_key = "ee" * 32
        full_neighbor = "11223344" + "ff" * 28

        await LSR.record_repeater_samples(
            rep_key, [{"pubkey": "11223344", "snr": 5.0, "secs_ago": 10}],
            observed_at=1700000000,
        )
        await LSR.record_traffic_sample(
            self_key, full_neighbor, snr=-2.0, rssi=-95, observed_at=1700000050
        )

        with patch.object(repeaters, "_resolve_contact_or_404",
                          AsyncMock(return_value=_repeater_contact(rep_key))):
            resp = await repeaters.repeater_neighbor_history(rep_key, since_hours=720)

        assert len(resp.neighbors) == 1
        entry = resp.neighbors[0]
        assert entry.neighbor_pubkey == "11223344"
        assert [s.snr for s in entry.repeater_samples] == [5.0]
        assert [s.snr for s in entry.self_samples] == [-2.0]
        assert entry.self_samples[0].rssi == -95

    @pytest.mark.asyncio
    async def test_history_empty(self, test_db):
        from app.routers import repeaters

        rep_key = "ab" * 32
        with patch.object(repeaters, "_resolve_contact_or_404",
                          AsyncMock(return_value=_repeater_contact(rep_key))):
            resp = await repeaters.repeater_neighbor_history(rep_key, since_hours=720)
        assert resp.neighbors == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestHistoryEndpoint -p no:xdist -v`
Expected: FAIL (`repeater_neighbor_history` not defined).

- [ ] **Step 3: Add the endpoint**

In `app/routers/repeaters.py`, add `RepeaterNeighborHistoryResponse`, `NeighborHistoryEntry`, `RepeaterSignalSample`, `SelfSignalSample` to the `from app.models import (...)` block, then add this route right after `repeater_neighbors`:

```python
@router.get(
    "/{public_key}/repeater/neighbors/history",
    response_model=RepeaterNeighborHistoryResponse,
)
async def repeater_neighbor_history(
    public_key: str, since_hours: int = 720
) -> RepeaterNeighborHistoryResponse:
    """Per-neighbor signal history for a repeater (DB read; no radio needed)."""
    contact = await _resolve_contact_or_404(public_key)
    since_hours = max(1, min(since_hours, 720))
    since = int(time.time()) - since_hours * 3600

    rep_rows = await LinkSignalRepository.get_repeater_history(contact.public_key, since)

    # Group repeater samples by neighbour prefix, preserving first-seen order.
    grouped: dict[str, list[RepeaterSignalSample]] = {}
    for r in rep_rows:
        grouped.setdefault(r["subject_pubkey"], []).append(
            RepeaterSignalSample(
                observed_at=r["observed_at"], snr=r["snr"], secs_ago=r["secs_ago"]
            )
        )

    prefixes = list(grouped.keys())
    self_rows = await LinkSignalRepository.get_traffic_history_for_subjects(prefixes, since)

    neighbors: list[NeighborHistoryEntry] = []
    for prefix, rep_samples in grouped.items():
        self_samples = [
            SelfSignalSample(observed_at=s["observed_at"], snr=s["snr"], rssi=s["rssi"])
            for s in self_rows
            if s["subject_pubkey"].startswith(prefix)
        ]
        neighbors.append(
            NeighborHistoryEntry(
                neighbor_pubkey=prefix,
                repeater_samples=rep_samples,
                self_samples=self_samples,
            )
        )

    return RepeaterNeighborHistoryResponse(neighbors=neighbors)
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestHistoryEndpoint -p no:xdist -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit** (ask the user first)

```bash
git add app/routers/repeaters.py tests/test_link_signal.py
git commit -m "feat(neighbors): add neighbor signal-history endpoint"
```

---

## Task 6: Capture site B — periodic sample in the tracked-telemetry cycle

**Files:**
- Modify: `app/radio_sync.py` (`_collect_repeater_telemetry` ~line 1786; `_run_telemetry_cycle` ~line 1975-2060)
- Test: `tests/test_link_signal.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_link_signal.py`:

```python
class TestCaptureSiteCycle:
    @pytest.mark.asyncio
    async def test_collect_persists_neighbor_samples(self, test_db):
        import app.radio_sync as rs

        rep_key = "ba" * 32
        contact = _repeater_contact(rep_key)

        mc = MagicMock()
        mc.commands.add_contact = AsyncMock()
        mc.commands.req_status_sync = AsyncMock(return_value=None)  # skip telemetry store
        mc.commands.fetch_all_neighbours = AsyncMock(
            return_value={
                "neighbours_count": 1,
                "neighbours": [{"pubkey": "aabbccdd", "snr": 3.0, "secs_ago": 5}],
            }
        )

        await rs._collect_repeater_neighbor_signal(mc, contact)

        rows = await LSR.get_repeater_history(rep_key, since=0)
        assert [r["subject_pubkey"] for r in rows] == ["aabbccdd"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestCaptureSiteCycle -p no:xdist -v`
Expected: FAIL (`_collect_repeater_neighbor_signal` not defined).

- [ ] **Step 3: Add the helper and wire it in**

In `app/radio_sync.py`, add the import near the top (with the other repository imports):

```python
from app.repository.link_signal import LinkSignalRepository
```

Add a helper next to `_collect_repeater_telemetry`:

```python
async def _collect_repeater_neighbor_signal(mc: MeshCore, contact: Contact) -> bool:
    """Fetch a repeater's neighbours and persist a signal snapshot (X2b).

    Best-effort: returns True on a stored snapshot, False otherwise (logged,
    not raised). Assumes the contact is already added to the radio by the
    caller's telemetry step.
    """
    try:
        data = await mc.commands.fetch_all_neighbours(
            contact.public_key, timeout=10, min_timeout=5
        )
    except Exception as e:
        logger.debug(
            "Neighbor signal collect: radio command failed for %s: %s",
            contact.public_key[:12], e,
        )
        return False
    if not data or not data.get("neighbours"):
        return False
    try:
        await LinkSignalRepository.record_repeater_samples(
            contact.public_key, data["neighbours"], observed_at=int(time.time())
        )
    except Exception as e:
        logger.warning("Neighbor signal collect: persist failed: %s", e)
        return False
    return True
```

Confirm `import time` exists at the top of `app/radio_sync.py`; if not, add it.

In `_run_telemetry_cycle`, inside the per-candidate loop, after the telemetry call for repeaters, also collect neighbor signal. Change the repeater branch:

```python
                if is_repeater:
                    success = await _collect_repeater_telemetry(mc, contact)
                    await _collect_repeater_neighbor_signal(mc, contact)
                else:
                    success = await _collect_contact_telemetry(mc, contact)
```

After the loop (before/after the final "cycle complete" log), add a prune:

```python
    try:
        await LinkSignalRepository.prune()
    except Exception as e:  # noqa: BLE001 - best-effort maintenance
        logger.debug("Neighbor signal prune failed: %s", e)
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestCaptureSiteCycle -p no:xdist -v`
Expected: PASS.

- [ ] **Step 5: Commit** (ask the user first)

```bash
git add app/radio_sync.py tests/test_link_signal.py
git commit -m "feat(neighbors): sample neighbor signal in tracked-telemetry cycle"
```

---

## Task 7: Capture site C — passive 0-hop advert sample

**Files:**
- Modify: `app/packet_processor.py` (`_process_advertisement` ~line 532)
- Test: `tests/test_link_signal.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_link_signal.py`:

```python
class TestCaptureSiteTraffic:
    @pytest.mark.asyncio
    async def test_zero_hop_advert_persists_traffic_sample(self, test_db):
        import app.packet_processor as pp

        subject = "12" * 32
        await pp._maybe_record_traffic_signal(
            subject_pubkey=subject, path_length=0, rssi=-70, snr=8.0, timestamp=1700000000
        )
        rows = await LSR.get_traffic_history_for_subjects([subject[:8]], since=0)
        assert len(rows) == 1
        assert rows[0]["snr"] == 8.0
        assert rows[0]["rssi"] == -70

    @pytest.mark.asyncio
    async def test_multi_hop_advert_not_persisted(self, test_db):
        import app.packet_processor as pp

        subject = "34" * 32
        await pp._maybe_record_traffic_signal(
            subject_pubkey=subject, path_length=2, rssi=-70, snr=8.0, timestamp=1700000000
        )
        assert await LSR.get_traffic_history_for_subjects([subject[:8]], since=0) == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestCaptureSiteTraffic -p no:xdist -v`
Expected: FAIL (`_maybe_record_traffic_signal` not defined).

- [ ] **Step 3: Add the helper and call it**

In `app/packet_processor.py`, ensure `import time` and `from app.keystore import ... get_public_key` are present (both are — `get_public_key` is imported at line 32). Add a module-level throttle var near the top of the module (after imports):

```python
# X2b: throttled prune timestamp for link_signal, so traffic-only deployments
# (no tracked repeaters, endpoint never called) still bound history growth.
_last_link_signal_prune: float = 0.0
```

Add the helper (near `_process_advertisement`):

```python
async def _maybe_record_traffic_signal(
    subject_pubkey: str,
    path_length: int | None,
    rssi: int | None,
    snr: float | None,
    timestamp: int,
) -> None:
    """Persist a my-node 0-hop signal sample from regular advert traffic (X2b).

    Only direct (path_length == 0) receptions are recorded. Best-effort: never
    disrupts packet processing. Runs a throttled prune (<=1/hour).
    """
    global _last_link_signal_prune
    if path_length != 0 or snr is None or not subject_pubkey:
        return
    from app.repository.link_signal import LinkSignalRepository

    own = get_public_key()
    observer = own.hex() if own else "self"
    try:
        await LinkSignalRepository.record_traffic_sample(
            observer_pubkey=observer,
            subject_pubkey=subject_pubkey.lower(),
            snr=snr,
            rssi=rssi,
            observed_at=timestamp,
        )
        now = time.time()
        if now - _last_link_signal_prune > 3600:
            _last_link_signal_prune = now
            await LinkSignalRepository.prune()
    except Exception as e:  # noqa: BLE001 - best-effort telemetry
        logger.debug("link_signal traffic capture failed: %s", e)
```

In `_process_advertisement`, after the signature-verify block and once `advert` and `packet_info` are known (use the same `new_path_len = packet_info.path_length` already computed near line 571), add the guarded call. Guard on `is_new_packet` so relayed duplicate copies of the same advert do not each record a sample:

```python
    if is_new_packet:
        await _maybe_record_traffic_signal(
            subject_pubkey=advert.public_key,
            path_length=new_path_len,
            rssi=rssi,
            snr=snr,
            timestamp=timestamp,
        )
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py::TestCaptureSiteTraffic -p no:xdist -v`
Expected: PASS.

- [ ] **Step 5: Run the whole backend module + lint/typecheck**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest tests/test_link_signal.py -p no:xdist -v`
Expected: PASS (all classes).
Run: `./.venv/Scripts/python.exe -m ruff check app/ tests/test_link_signal.py`
Run: `./.venv/Scripts/python.exe -m pyright app/`
Expected: no new errors.

- [ ] **Step 6: Commit** (ask the user first)

```bash
git add app/packet_processor.py tests/test_link_signal.py
git commit -m "feat(neighbors): record 0-hop advert signal from regular traffic"
```

---

## Task 8: Frontend API client + types

**Files:**
- Modify: `frontend/src/types.ts` (after `RepeaterNeighborsResponse`, ~line 562)
- Modify: `frontend/src/api.ts` (after `repeaterNeighbors`, ~line 507)

- [ ] **Step 1: Add types**

In `frontend/src/types.ts`, after `RepeaterNeighborsResponse`:

```typescript
export interface RepeaterSignalSample {
  observed_at: number;
  snr: number;
  secs_ago: number | null;
}

export interface SelfSignalSample {
  observed_at: number;
  snr: number;
  rssi: number | null;
}

export interface NeighborHistoryEntry {
  neighbor_pubkey: string;
  repeater_samples: RepeaterSignalSample[];
  self_samples: SelfSignalSample[];
}

export interface RepeaterNeighborHistoryResponse {
  neighbors: NeighborHistoryEntry[];
}
```

- [ ] **Step 2: Add the API call**

In `frontend/src/api.ts`, after `repeaterNeighbors` (and add `RepeaterNeighborHistoryResponse` to the type imports if imports are explicit):

```typescript
  repeaterNeighborHistory: (publicKey: string, sinceHours?: number) =>
    fetchJson<RepeaterNeighborHistoryResponse>(
      `/contacts/${publicKey}/repeater/neighbors/history` +
        (sinceHours ? `?since_hours=${sinceHours}` : '')
    ),
```

- [ ] **Step 3: Typecheck**

Run (from `frontend/`): `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit** (ask the user first)

```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(neighbors): add neighbor signal-history API client + types"
```

---

## Task 9: Pure series-merge helper + sparkline component

**Files:**
- Create: `frontend/src/components/repeater/neighborSignalUtils.ts`
- Create: `frontend/src/components/repeater/NeighborSnrSparkline.tsx`
- Test: `frontend/src/test/neighborSignal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/test/neighborSignal.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { mergeSignalSeries } from '../components/repeater/neighborSignalUtils';
import { NeighborSnrSparkline } from '../components/repeater/NeighborSnrSparkline';

describe('mergeSignalSeries', () => {
  it('merges by observed_at and sorts ascending', () => {
    const merged = mergeSignalSeries(
      [
        { observed_at: 20, snr: 2 },
        { observed_at: 10, snr: 1 },
      ],
      [{ observed_at: 10, snr: 5 }]
    );
    expect(merged).toEqual([
      { observed_at: 10, repeater_snr: 1, self_snr: 5 },
      { observed_at: 20, repeater_snr: 2 },
    ]);
  });

  it('handles empty inputs', () => {
    expect(mergeSignalSeries([], [])).toEqual([]);
  });
});

describe('NeighborSnrSparkline', () => {
  it('renders a polyline with >= 2 samples', () => {
    const { container } = render(
      <NeighborSnrSparkline
        samples={[
          { observed_at: 1, snr: 1 },
          { observed_at: 2, snr: 5 },
        ]}
      />
    );
    expect(container.querySelector('polyline')).not.toBeNull();
  });

  it('renders nothing with < 2 samples', () => {
    const { container } = render(
      <NeighborSnrSparkline samples={[{ observed_at: 1, snr: 1 }]} />
    );
    expect(container.querySelector('polyline')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`): `npx vitest run src/test/neighborSignal.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write the helper**

Create `frontend/src/components/repeater/neighborSignalUtils.ts`:

```typescript
export interface SnrPoint {
  observed_at: number;
  snr: number;
}

export interface MergedSignalPoint {
  observed_at: number;
  repeater_snr?: number;
  self_snr?: number;
}

/** Merge repeater-view and my-node-view SNR series into one time-sorted array
 *  keyed by observed_at, so a chart can plot both lines on a shared X axis. */
export function mergeSignalSeries(
  repeaterSamples: SnrPoint[],
  selfSamples: SnrPoint[]
): MergedSignalPoint[] {
  const map = new Map<number, MergedSignalPoint>();
  for (const s of repeaterSamples) {
    const p = map.get(s.observed_at) ?? { observed_at: s.observed_at };
    p.repeater_snr = s.snr;
    map.set(s.observed_at, p);
  }
  for (const s of selfSamples) {
    const p = map.get(s.observed_at) ?? { observed_at: s.observed_at };
    p.self_snr = s.snr;
    map.set(s.observed_at, p);
  }
  return [...map.values()].sort((a, b) => a.observed_at - b.observed_at);
}
```

- [ ] **Step 4: Write the sparkline**

Create `frontend/src/components/repeater/NeighborSnrSparkline.tsx`:

```tsx
import type { SnrPoint } from './neighborSignalUtils';

interface Props {
  samples: SnrPoint[];
  width?: number;
  height?: number;
  ariaLabel?: string;
}

/** Compact inline SVG SNR trend. Renders nothing with fewer than two samples
 *  (a single point is a misleading "trend"). Line color follows the latest
 *  SNR, matching the table's SNR thresholds. */
export function NeighborSnrSparkline({ samples, width = 64, height = 18, ariaLabel }: Props) {
  if (samples.length < 2) return null;
  const xs = samples.map((s) => s.observed_at);
  const ys = samples.map((s) => s.snr);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const points = samples
    .map((s) => {
      const x = ((s.observed_at - minX) / spanX) * (width - 2) + 1;
      const y = height - 1 - ((s.snr - minY) / spanY) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = ys[ys.length - 1];
  const color = last >= 6 ? '#22c55e' : last >= 0 ? '#eab308' : '#ef4444';
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block' }}
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run (from `frontend/`): `npx vitest run src/test/neighborSignal.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit** (ask the user first)

```bash
git add frontend/src/components/repeater/neighborSignalUtils.ts frontend/src/components/repeater/NeighborSnrSparkline.tsx frontend/src/test/neighborSignal.test.tsx
git commit -m "feat(neighbors): add SNR sparkline + series-merge helper"
```

---

## Task 10: Detail chart component + i18n keys

**Files:**
- Create: `frontend/src/components/repeater/NeighborSignalDetailChart.tsx`
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Add i18n keys (all three catalogs, equal counts)**

Add these keys to `en.json` (English), `nl.json`, and `de.json`. Keep the three catalogs in key parity (the i18nParity test asserts equal key sets). NL/DE are machine-drafted; if a `_meta.review` marker convention is present in the catalog, this batch inherits it.

`en.json`:
```json
"repeater_neighbors_trend_header": "Trend",
"neighbor_signal_history_title": "Signal history: {name}",
"neighbor_signal_series_repeater": "Repeater → neighbor",
"neighbor_signal_series_self": "My node → neighbor",
"neighbor_signal_samples_count": "{count} samples",
"neighbor_signal_no_history": "No signal history yet."
```
`nl.json`:
```json
"repeater_neighbors_trend_header": "Trend",
"neighbor_signal_history_title": "Signaalgeschiedenis: {name}",
"neighbor_signal_series_repeater": "Repeater → buur",
"neighbor_signal_series_self": "Mijn node → buur",
"neighbor_signal_samples_count": "{count} metingen",
"neighbor_signal_no_history": "Nog geen signaalgeschiedenis."
```
`de.json`:
```json
"repeater_neighbors_trend_header": "Verlauf",
"neighbor_signal_history_title": "Signalverlauf: {name}",
"neighbor_signal_series_repeater": "Repeater → Nachbar",
"neighbor_signal_series_self": "Mein Node → Nachbar",
"neighbor_signal_samples_count": "{count} Messungen",
"neighbor_signal_no_history": "Noch kein Signalverlauf."
```

- [ ] **Step 2: Write the detail chart**

Create `frontend/src/components/repeater/NeighborSignalDetailChart.tsx`:

```tsx
import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useT } from '../../i18n';
import { mergeSignalSeries, type SnrPoint } from './neighborSignalUtils';

interface Props {
  name: string;
  repeaterSamples: SnrPoint[];
  selfSamples: SnrPoint[];
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function NeighborSignalDetailChart({ name, repeaterSamples, selfSamples }: Props) {
  const t = useT();
  const data = useMemo(
    () => mergeSignalSeries(repeaterSamples, selfSamples),
    [repeaterSamples, selfSamples]
  );

  const total = repeaterSamples.length + selfSamples.length;

  return (
    <div className="rounded border border-border/70 bg-muted/10 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium">{t('neighbor_signal_history_title', { name })}</span>
        <span className="text-[0.625rem] text-muted-foreground">
          {t('neighbor_signal_samples_count', { count: total })}
        </span>
      </div>
      {data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('neighbor_signal_no_history')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="observed_at"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatTime}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              width={34}
              tickFormatter={(v: number) => `${v}`}
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '6px',
                fontSize: '11px',
                color: 'hsl(var(--popover-foreground))',
              }}
              labelFormatter={(l) => formatTime(Number(l))}
            />
            <Legend wrapperStyle={{ fontSize: '10px' }} />
            <Line
              type="monotone"
              dataKey="repeater_snr"
              name={t('neighbor_signal_series_repeater')}
              stroke="#3b82f6"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="self_snr"
              name={t('neighbor_signal_series_self')}
              stroke="#f59e0b"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + i18n parity**

Run (from `frontend/`): `npx tsc --noEmit`
Run (from `frontend/`): `npx vitest run src/test/i18nParity` (or the project's i18n parity test path)
Expected: no type errors; parity test passes (equal key sets across en/nl/de).

- [ ] **Step 4: Commit** (ask the user first)

```bash
git add frontend/src/components/repeater/NeighborSignalDetailChart.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "feat(neighbors): add neighbor signal detail chart + i18n keys"
```

---

## Task 11: Wire history into the neighbors pane

**Files:**
- Modify: `frontend/src/components/repeater/RepeaterNeighborsPane.tsx`

- [ ] **Step 1: Add imports and state**

At the top of `RepeaterNeighborsPane.tsx`, add:

```tsx
import { api } from '../../api';
import type { RepeaterNeighborHistoryResponse } from '../../types';
import { NeighborSnrSparkline } from './NeighborSnrSparkline';
import { NeighborSignalDetailChart } from './NeighborSignalDetailChart';
```

Inside `NeighborsPane`, add state and a fetch effect (keyed on the repeater key and the current `data` so a fresh opportunistic sample is picked up):

```tsx
  const repeaterKey = repeaterContact?.public_key ?? null;
  const [history, setHistory] = useState<RepeaterNeighborHistoryResponse | null>(null);
  const [selectedNeighbor, setSelectedNeighbor] = useState<string | null>(null);

  useEffect(() => {
    if (!repeaterKey) return;
    let cancelled = false;
    api
      .repeaterNeighborHistory(repeaterKey)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [repeaterKey, data]);
```

Add `useEffect` to the existing `react` import at the top of the file (it currently imports `useMemo, useState, useCallback, lazy, Suspense`).

- [ ] **Step 2: Build a per-neighbor history lookup**

Below the `sorted` memo, add:

```tsx
  const historyByPrefix = useMemo(() => {
    const map = new Map<
      string,
      { repeater: { observed_at: number; snr: number }[]; self: { observed_at: number; snr: number }[] }
    >();
    for (const entry of history?.neighbors ?? []) {
      map.set(entry.neighbor_pubkey, {
        repeater: entry.repeater_samples.map((s) => ({ observed_at: s.observed_at, snr: s.snr })),
        self: entry.self_samples.map((s) => ({ observed_at: s.observed_at, snr: s.snr })),
      });
    }
    return map;
  }, [history]);
```

- [ ] **Step 3: Add the sparkline column header**

In the table `<thead>` row, after the SNR header (and before the distance header), add a non-sortable header:

```tsx
                  <th className="pb-1 font-medium text-right">
                    {t('repeater_neighbors_trend_header')}
                  </th>
```

- [ ] **Step 4: Render the sparkline cell + make rows clickable**

In the `<tbody>` `sorted.map(...)`, change the `<tr>` to toggle selection on click, and add the sparkline cell after the SNR cell:

```tsx
                  <tr
                    key={i}
                    className="border-t border-border/50 cursor-pointer hover:bg-accent/40"
                    onClick={() =>
                      setSelectedNeighbor((cur) => (cur === n.pubkey_prefix ? null : n.pubkey_prefix))
                    }
                  >
```

After the SNR `<td>` (the `{snrStr} dB` cell), add:

```tsx
                      <td className="py-1 text-right">
                        <div className="flex justify-end">
                          <NeighborSnrSparkline
                            samples={historyByPrefix.get(n.pubkey_prefix)?.repeater ?? []}
                            ariaLabel={t('repeater_neighbors_trend_header')}
                          />
                        </div>
                      </td>
```

- [ ] **Step 5: Render the detail chart for the selected neighbor**

Directly after the `</table>`'s wrapping `<div>` (inside the `flex ... flex-col gap-2` container, before the map block), add:

```tsx
          {selectedNeighbor &&
            (() => {
              const h = historyByPrefix.get(selectedNeighbor);
              const nb = sorted.find((x) => x.pubkey_prefix === selectedNeighbor);
              return (
                <NeighborSignalDetailChart
                  name={nb?.name || selectedNeighbor}
                  repeaterSamples={h?.repeater ?? []}
                  selfSamples={h?.self ?? []}
                />
              );
            })()}
```

- [ ] **Step 6: Typecheck + lint + run frontend tests**

Run (from `frontend/`):
```bash
npx tsc --noEmit
npm run lint
npx vitest run --testTimeout=30000
```
Expected: no type errors; lint clean (no `i18next/no-literal-string` errors — all visible strings use `t()`); all tests pass.

- [ ] **Step 7: Commit** (ask the user first)

```bash
git add frontend/src/components/repeater/RepeaterNeighborsPane.tsx
git commit -m "feat(neighbors): show SNR sparkline + detail chart in neighbors pane"
```

---

## Task 12: Correct the parity audit

**Files:**
- Modify: `docs/parity-audit.md`

- [ ] **Step 1: Update the neighbor rows and backlog**

In `docs/parity-audit.md`, change the two "Neighbor discovery" rows (~line 137-138) from `Absent` to reflect reality, and add an X2b note. Replace:

```
| Query a repeater's neighbors | both | Absent | Adapt | Host relays `REQ_TYPE_GET_NEIGHBOURS 0x06` via `CMD_SEND_BINARY_REQ 50`. |
| Neighbors on map + per-link signal | Off | Absent | App | DMC `neighbors` payload has `pubkey/snr/heard_secs_ago/scopes/status`. |
```
with:
```
| Query a repeater's neighbors | both | Present | Adapt | `POST /contacts/{key}/repeater/neighbors` → `fetch_all_neighbours` (`REQ_TYPE_GET_NEIGHBOURS 0x06` via companion). Repeater-only opcode. |
| Neighbors on map + per-link signal | Off | Present | App | `RepeaterNeighborsPane` + `NeighborsMiniMap` (SNR/distance/last-heard + map). `scopes`/`status` are companion-unreachable (firmware/MQTT-only → L3). |
| Per-link signal history (X2b) | Off | Present | App | `link_signal` table + sparkline/detail chart; repeater-query + passive 0-hop traffic perspectives. |
```

Update the "Next → X2" bullet (~line 226) to note the core shipped and X2b delivered the history increment; move the `scopes`/`status` + room-server exclusions into an explicit note referencing the firmware evidence.

- [ ] **Step 2: Commit** (ask the user first)

```bash
git add docs/parity-audit.md
git commit -m "docs(parity): correct neighbor rows; record X2b signal history"
```

---

## Task 13: Full verification

- [ ] **Step 1: Full backend suite**

Run: `PYTHONUTF8=1 ./.venv/Scripts/python.exe -m pytest`
Expected: all pass except the ~6 broker-connecting `test_fanout_integration` tests (pre-existing Windows env failures). Confirm `tests/test_link_signal.py` passes and no other test regressed.

- [ ] **Step 2: Backend lint + types**

Run: `./.venv/Scripts/python.exe -m ruff check app/ tests/`
Run: `./.venv/Scripts/python.exe -m pyright app/`
Expected: clean (no new findings).

- [ ] **Step 3: Full frontend suite**

Run (from `frontend/`):
```bash
npm run lint
npx tsc --noEmit
npx vitest run --testTimeout=30000
```
Expected: lint clean; no type errors; all tests pass; i18n parity holds.

- [ ] **Step 4: Runtime verification (required — do not claim "works" without this)**

Rebuild/run the app against the live radio. Open a repeater contact's dashboard, refresh neighbors, and confirm:
- the neighbors table renders a Trend column (sparklines appear once ≥2 samples exist for a link — may require a second refresh or a wait for a passive advert),
- clicking a neighbor row expands the detail chart with the repeater series (and the my-node series if the companion also hears that node directly),
- no console errors, no raw i18n keys, EN→NL switch renders translated labels.
Capture at least two independent checks (e.g. the HTTP `/neighbors/history` JSON showing persisted rows, and the rendered chart) before reporting done.

- [ ] **Step 5: Finalize**

Use `superpowers:finishing-a-development-branch` to decide integration (PR to origin only, when the user instructs).
```
