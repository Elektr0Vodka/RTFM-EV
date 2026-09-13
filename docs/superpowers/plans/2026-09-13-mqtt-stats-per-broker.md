# MQTT statistics per broker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-broker MQTT statistics block (status, last error, messages published, publish failures, reconnects) to the Statistics page, with counts persisted across restarts.

**Architecture:** Live in-memory counters on `BaseMqttPublisher` (incremented on the existing publish/reconnect paths, zero hot-path DB cost), flushed as idempotent totals (`baseline + session`) to a new `fanout_mqtt_stats` table on the ~60s connection-loop wake and on `stop()`. `FanoutManager.get_mqtt_stats()` surfaces cumulative counters per active MQTT module; the `/api/statistics` endpoint attaches them to `StatisticsResponse.mqtt_brokers`, which the React statistics section renders as a table.

**Tech Stack:** FastAPI + Pydantic, aiosqlite migrations (SQLite `user_version`), `aiomqtt` publishers, React + TypeScript, i18n (en/de/nl), pytest + vitest.

**Reference spec:** `docs/superpowers/specs/2026-09-13-mqtt-stats-per-broker-design.md`

**Backend test command (run in the local container — see memory "Run backend tests in container"):**
```bash
docker exec rtfm-ev-local /app/.venv/bin/python -m pytest <path> -v
```
If running tests on the host instead, use `python -m pytest <path> -v` from the worktree root. Use whichever the environment supports; the container is authoritative for backend.

**Frontend test command (from `frontend/`):**
```bash
npm run test:run -- <path>
```

**Commit note:** This repo forbids commits unless the user explicitly instructs. The "Commit" steps below are the plan's standard structure; DO NOT run them unless the user has said to commit. Otherwise complete each task and leave the changes staged/unstaged for the user.

---

## File Structure

**Backend (create):**
- `app/migrations/_088_create_fanout_mqtt_stats.py` — new stats table.
- `tests/test_migrations/test_migration_088.py` — migration test.

**Backend (modify):**
- `tests/test_migrations/conftest.py` — bump `LATEST_SCHEMA_VERSION` 87 → 88.
- `tests/test_migrations/test_migration_087.py` — pin its start version to an absolute `86` so the `LATEST` bump doesn't skip migration 087.
- `app/repository/fanout.py` — add `FanoutMqttStatsRepository`; add stats-row cleanup to `FanoutConfigRepository.delete`.
- `app/fanout/mqtt_base.py` — counters, baseline load, flush, `set_config_id`, counter properties.
- `app/fanout/base.py` — `mqtt_counters` property (returns `None`).
- `app/fanout/mqtt_private.py`, `app/fanout/mqtt_community.py`, `app/fanout/mqtt_ha.py` — `set_config_id` call + `mqtt_counters` override.
- `app/fanout/manager.py` — `get_mqtt_stats()`.
- `app/models.py` — `MqttBrokerStats`, add `mqtt_brokers` to `StatisticsResponse`.
- `app/routers/statistics.py` — attach `mqtt_brokers`.

**Backend (tests, create/modify):**
- `tests/test_fanout_mqtt_stats.py` — repository + publisher counter/flush + manager tests.
- extend an existing statistics endpoint test (or add one) asserting `mqtt_brokers` is present.

**Frontend (modify):**
- `frontend/src/types.ts` — `MqttBrokerStats` + `StatisticsResponse.mqtt_brokers`.
- `frontend/src/components/settings/SettingsStatisticsSection.tsx` — MQTT Brokers table section.
- `frontend/src/i18n/locales/{en,de,nl}.json` — new keys.
- `frontend/src/test/settingsStatisticsMqtt.test.tsx` (create) — component render + empty-state test.

**Docs:**
- `CHANGELOG-DMC-EV.md` — add an entry.

---

## Task 1: Migration `_088_create_fanout_mqtt_stats`

**Files:**
- Create: `app/migrations/_088_create_fanout_mqtt_stats.py`
- Modify: `tests/test_migrations/conftest.py`
- Modify: `tests/test_migrations/test_migration_087.py`
- Test: `tests/test_migrations/test_migration_088.py`

- [ ] **Step 1: Write the migration**

Create `app/migrations/_088_create_fanout_mqtt_stats.py`:

```python
import logging

import aiosqlite

logger = logging.getLogger(__name__)


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create ``fanout_mqtt_stats``: per-broker cumulative MQTT publish counters.

    One row per ``fanout_configs.id`` (MQTT modules only). Counts are cumulative
    totals written by the publisher's periodic flush as ``baseline + session``.
    Idempotent: ``CREATE TABLE IF NOT EXISTS`` and independent of other tables.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fanout_mqtt_stats (
            config_id TEXT PRIMARY KEY,
            messages_published INTEGER NOT NULL DEFAULT 0,
            publish_failures INTEGER NOT NULL DEFAULT 0,
            reconnects INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT
        )
        """
    )
    await conn.commit()
```

- [ ] **Step 2: Bump the schema version in the test conftest**

In `tests/test_migrations/conftest.py`, change:
```python
LATEST_SCHEMA_VERSION = 87
```
to:
```python
LATEST_SCHEMA_VERSION = 88
```

- [ ] **Step 3: Pin migration-087 test so the bump doesn't skip it**

In `tests/test_migrations/test_migration_087.py`, the test currently starts one below `LATEST` and asserts `applied == 1`. With `LATEST` now 88 that would run only 088 and skip 087. Replace the version/assert lines so it starts at an absolute `86` and runs 087 (+088):

Change:
```python
            # Isolate this migration: start one version below the latest so only
            # migration 087 runs against the minimal fixture table below.
            await set_version(conn, LATEST_SCHEMA_VERSION - 1)
```
to:
```python
            # Start just below migration 087 so it runs against the fixture below.
            # (Pinned to an absolute version so later LATEST bumps don't skip it.)
            await set_version(conn, 86)
```
and change:
```python
            assert applied == 1
```
to:
```python
            assert applied == LATEST_SCHEMA_VERSION - 86
```
(The `openhop_*` column assertions and the `app_settings` fixture stay unchanged; migration 088 creates an independent table and needs no fixture.)

- [ ] **Step 4: Write the migration-088 test**

Create `tests/test_migrations/test_migration_088.py`:

```python
"""Tests for database migration 088: create fanout_mqtt_stats table."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration088:
    """Test migration 088: create the fanout_mqtt_stats table."""

    @pytest.mark.asyncio
    async def test_creates_fanout_mqtt_stats_table(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            # Start just below 088 so only this migration runs.
            await set_version(conn, LATEST_SCHEMA_VERSION - 1)

            applied = await run_migrations(conn)

            assert applied == 1
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(fanout_mqtt_stats)")
            columns = {row["name"] for row in await cursor.fetchall()}
            assert columns == {
                "config_id",
                "messages_published",
                "publish_failures",
                "reconnects",
                "updated_at",
            }
        finally:
            await conn.close()
```

- [ ] **Step 5: Run the migration tests**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_migrations/test_migration_088.py tests/test_migrations/test_migration_087.py tests/test_migrations/test_migration_085.py -v`
Expected: PASS (087 now expects `LATEST-86 == 2` applied; 085 expects `LATEST-84 == 4`).

- [ ] **Step 6: Commit** (only if the user instructed commits)

```bash
git add app/migrations/_088_create_fanout_mqtt_stats.py tests/test_migrations/
git commit -m "feat(db): add fanout_mqtt_stats table (migration 088)"
```

---

## Task 2: `FanoutMqttStatsRepository` + delete-cleanup

**Files:**
- Modify: `app/repository/fanout.py`
- Test: `tests/test_fanout_mqtt_stats.py`

- [ ] **Step 1: Write the failing repository test**

Create `tests/test_fanout_mqtt_stats.py`:

```python
"""Tests for FanoutMqttStatsRepository and per-broker MQTT stat tracking."""

import pytest

from app.repository.fanout import FanoutConfigRepository, FanoutMqttStatsRepository


class TestFanoutMqttStatsRepository:
    @pytest.mark.asyncio
    async def test_get_missing_returns_none(self, test_db):
        assert await FanoutMqttStatsRepository.get("nope") is None

    @pytest.mark.asyncio
    async def test_set_then_get_round_trips(self, test_db):
        await FanoutMqttStatsRepository.set(
            "cfg-1", messages_published=5, publish_failures=2, reconnects=1
        )
        row = await FanoutMqttStatsRepository.get("cfg-1")
        assert row["messages_published"] == 5
        assert row["publish_failures"] == 2
        assert row["reconnects"] == 1
        assert row["updated_at"]  # non-empty ISO timestamp

    @pytest.mark.asyncio
    async def test_set_is_idempotent_upsert(self, test_db):
        await FanoutMqttStatsRepository.set("cfg-1", 1, 0, 0)
        await FanoutMqttStatsRepository.set("cfg-1", 9, 3, 2)
        row = await FanoutMqttStatsRepository.get("cfg-1")
        assert (row["messages_published"], row["publish_failures"], row["reconnects"]) == (9, 3, 2)

    @pytest.mark.asyncio
    async def test_delete_removes_row(self, test_db):
        await FanoutMqttStatsRepository.set("cfg-1", 1, 1, 1)
        await FanoutMqttStatsRepository.delete("cfg-1")
        assert await FanoutMqttStatsRepository.get("cfg-1") is None

    @pytest.mark.asyncio
    async def test_config_delete_also_removes_stats(self, test_db):
        cfg = await FanoutConfigRepository.create(
            "mqtt_private", "P", {"broker_host": "h"}, {}, enabled=False
        )
        await FanoutMqttStatsRepository.set(cfg["id"], 3, 0, 0)
        await FanoutConfigRepository.delete(cfg["id"])
        assert await FanoutMqttStatsRepository.get(cfg["id"]) is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_fanout_mqtt_stats.py -v`
Expected: FAIL with `ImportError: cannot import name 'FanoutMqttStatsRepository'`.

- [ ] **Step 3: Add the repository**

In `app/repository/fanout.py`, add the `datetime` import at the top (near the existing `import time`):

```python
from datetime import datetime, timezone
```

Append this class after `FanoutConfigRepository`:

```python
class FanoutMqttStatsRepository:
    """Cumulative per-broker MQTT publish counters (one row per fanout config id)."""

    @staticmethod
    async def get(config_id: str) -> dict[str, Any] | None:
        """Return the stored counters for a broker, or None if never flushed."""
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT config_id, messages_published, publish_failures, reconnects, updated_at "
                "FROM fanout_mqtt_stats WHERE config_id = ?",
                (config_id,),
            ) as cursor:
                row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "config_id": row["config_id"],
            "messages_published": row["messages_published"] or 0,
            "publish_failures": row["publish_failures"] or 0,
            "reconnects": row["reconnects"] or 0,
            "updated_at": row["updated_at"],
        }

    @staticmethod
    async def set(
        config_id: str,
        messages_published: int,
        publish_failures: int,
        reconnects: int,
    ) -> None:
        """Upsert the cumulative counters for a broker (idempotent set, not increment)."""
        now = datetime.now(timezone.utc).isoformat()
        async with db.tx() as conn:
            async with conn.execute(
                """
                INSERT INTO fanout_mqtt_stats
                    (config_id, messages_published, publish_failures, reconnects, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(config_id) DO UPDATE SET
                    messages_published = excluded.messages_published,
                    publish_failures = excluded.publish_failures,
                    reconnects = excluded.reconnects,
                    updated_at = excluded.updated_at
                """,
                (config_id, messages_published, publish_failures, reconnects, now),
            ):
                pass

    @staticmethod
    async def delete(config_id: str) -> None:
        """Remove a broker's stats row (called when its config is deleted)."""
        async with db.tx() as conn:
            async with conn.execute(
                "DELETE FROM fanout_mqtt_stats WHERE config_id = ?", (config_id,)
            ):
                pass
```

- [ ] **Step 4: Add cleanup to `FanoutConfigRepository.delete`**

In `app/repository/fanout.py`, `FanoutConfigRepository.delete` currently deletes only the config row. Extend it to also drop the stats row in the same transaction:

Change:
```python
    @staticmethod
    async def delete(config_id: str) -> None:
        """Delete a fanout config."""
        async with db.tx() as conn:
            async with conn.execute("DELETE FROM fanout_configs WHERE id = ?", (config_id,)):
                pass
        _configs_cache.pop(config_id, None)
```
to:
```python
    @staticmethod
    async def delete(config_id: str) -> None:
        """Delete a fanout config and its MQTT stats row (if any)."""
        async with db.tx() as conn:
            async with conn.execute("DELETE FROM fanout_configs WHERE id = ?", (config_id,)):
                pass
            async with conn.execute(
                "DELETE FROM fanout_mqtt_stats WHERE config_id = ?", (config_id,)
            ):
                pass
        _configs_cache.pop(config_id, None)
```

- [ ] **Step 5: Run to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_fanout_mqtt_stats.py -v`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Commit** (only if instructed)

```bash
git add app/repository/fanout.py tests/test_fanout_mqtt_stats.py
git commit -m "feat(fanout): add FanoutMqttStatsRepository + delete cleanup"
```

---

## Task 3: `BaseMqttPublisher` counters, baseline, flush

**Files:**
- Modify: `app/fanout/mqtt_base.py`
- Test: `tests/test_fanout_mqtt_stats.py` (extend)

- [ ] **Step 1: Write the failing publisher tests**

Append to `tests/test_fanout_mqtt_stats.py`:

```python
from unittest.mock import AsyncMock

from app.fanout.mqtt_base import BaseMqttPublisher


class _StubPublisher(BaseMqttPublisher):
    """Minimal concrete BaseMqttPublisher for exercising the counters."""

    def _is_configured(self) -> bool:
        return True

    def _build_client_kwargs(self, settings):
        return {}

    def _on_connected(self, settings):
        return ("t", "d")

    def _on_error(self):
        return ("t", "d")


class TestPublisherCounters:
    @pytest.mark.asyncio
    async def test_publish_success_increments_messages_published(self):
        pub = _StubPublisher()
        pub._client = AsyncMock()
        pub.connected = True
        await pub.publish("topic", {"a": 1})
        assert pub.messages_published == 1
        assert pub.publish_failures == 0

    @pytest.mark.asyncio
    async def test_publish_failure_increments_publish_failures(self):
        pub = _StubPublisher()
        pub._client = AsyncMock()
        pub._client.publish.side_effect = RuntimeError("boom")
        pub.connected = True
        await pub.publish("topic", {"a": 1})
        assert pub.messages_published == 0
        assert pub.publish_failures == 1

    @pytest.mark.asyncio
    async def test_load_baseline_adds_to_session(self, test_db):
        pub = _StubPublisher()
        pub.set_config_id("cfg-b")
        await FanoutMqttStatsRepository.set("cfg-b", 10, 4, 2)
        await pub.load_baseline()
        # Session starts at 0, cumulative == baseline.
        assert pub.messages_published == 10
        assert pub.publish_failures == 4
        assert pub.reconnects == 2
        # A new publish adds on top of the baseline.
        pub._client = AsyncMock()
        pub.connected = True
        await pub.publish("t", {})
        assert pub.messages_published == 11

    @pytest.mark.asyncio
    async def test_flush_writes_baseline_plus_session_and_is_idempotent(self, test_db):
        pub = _StubPublisher()
        pub.set_config_id("cfg-c")
        await FanoutMqttStatsRepository.set("cfg-c", 5, 0, 0)
        await pub.load_baseline()
        pub._client = AsyncMock()
        pub.connected = True
        await pub.publish("t", {})  # session +1
        await pub.flush_stats()
        await pub.flush_stats()  # repeat must not double count
        row = await FanoutMqttStatsRepository.get("cfg-c")
        assert row["messages_published"] == 6  # 5 baseline + 1 session

    @pytest.mark.asyncio
    async def test_flush_without_config_id_is_noop(self, test_db):
        pub = _StubPublisher()  # no config_id set
        await pub.flush_stats()  # must not raise
        assert await FanoutMqttStatsRepository.get("") is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_fanout_mqtt_stats.py::TestPublisherCounters -v`
Expected: FAIL (`AttributeError: 'BaseMqttPublisher' object has no attribute 'messages_published'` / `set_config_id`).

- [ ] **Step 3: Add counters/baseline/flush to `BaseMqttPublisher`**

In `app/fanout/mqtt_base.py`, extend `__init__` (after `self._suppress_next_connect_toast = False`):

```python
        # Per-broker publish statistics. Session counts are since this publisher
        # started; the baseline is the cumulative total loaded from the DB on
        # start(). Cumulative = baseline + session (see the *_published etc.
        # properties). Flushed to fanout_mqtt_stats periodically and on stop().
        self._config_id: str | None = None
        self._session_published: int = 0
        self._session_failures: int = 0
        self._session_reconnects: int = 0
        self._baseline_published: int = 0
        self._baseline_failures: int = 0
        self._baseline_reconnects: int = 0
```

Add a setter next to `set_integration_name`:

```python
    def set_config_id(self, config_id: str) -> None:
        """Attach the owning fanout config id (key for persisted stats)."""
        self._config_id = config_id
```

Add cumulative-count properties (near the `last_error` property):

```python
    @property
    def messages_published(self) -> int:
        """Cumulative messages published (persisted baseline + this session)."""
        return self._baseline_published + self._session_published

    @property
    def publish_failures(self) -> int:
        """Cumulative publish failures (persisted baseline + this session)."""
        return self._baseline_failures + self._session_failures

    @property
    def reconnects(self) -> int:
        """Cumulative reconnects (persisted baseline + this session)."""
        return self._baseline_reconnects + self._session_reconnects

    async def load_baseline(self) -> None:
        """Load persisted cumulative counters and reset the session counts to 0."""
        self._session_published = 0
        self._session_failures = 0
        self._session_reconnects = 0
        if not self._config_id:
            self._baseline_published = 0
            self._baseline_failures = 0
            self._baseline_reconnects = 0
            return
        from app.repository.fanout import FanoutMqttStatsRepository

        row = await FanoutMqttStatsRepository.get(self._config_id)
        self._baseline_published = row["messages_published"] if row else 0
        self._baseline_failures = row["publish_failures"] if row else 0
        self._baseline_reconnects = row["reconnects"] if row else 0

    async def flush_stats(self) -> None:
        """Persist the current cumulative counters (idempotent set). No-op without config id."""
        if not self._config_id:
            return
        from app.repository.fanout import FanoutMqttStatsRepository

        try:
            await FanoutMqttStatsRepository.set(
                self._config_id,
                self.messages_published,
                self.publish_failures,
                self.reconnects,
            )
        except Exception:
            logger.warning(
                "%s failed to flush MQTT stats", self._integration_label(), exc_info=True
            )
```

- [ ] **Step 4: Increment on the publish path**

In `publish()`, after the successful `await self._client.publish(...)` line, add the success increment; in the `except` block add the failure increment. The method becomes:

```python
    async def publish(self, topic: str, payload: dict[str, Any], *, retain: bool = False) -> None:
        """Publish a JSON payload. Drops silently if not connected."""
        if self._client is None or not self.connected:
            return
        try:
            await self._client.publish(topic, json.dumps(payload), retain=retain)
            self._session_published += 1
        except Exception as e:
            self._session_failures += 1
            logger.warning(
                "%s publish failed on %s. This is usually transient network noise; "
                "if it self-resolves and reconnects, it is generally not a concern. Persistent errors may indicate a problem with your network connection or MQTT broker. Original error: %s",
                self._integration_label(),
                topic,
                e,
                exc_info=True,
            )
            self.connected = False
            self._last_error = _format_error_detail(e)
            # Wake the connection loop so it exits the wait and reconnects
            self._settings_version += 1
            self._version_event.set()
```

- [ ] **Step 5: Increment reconnects + flush in the connection loop; load baseline on start; flush on stop**

In `start()`, load the baseline only when actually (re)creating the loop task, so a live settings-update `start()` (task still running) does not zero the counters:

```python
    async def start(self, settings: object) -> None:
        """Start the background connection loop."""
        self._settings = settings
        self._last_error = None
        self._settings_version += 1
        self._version_event.set()
        if self._task is None or self._task.done():
            await self.load_baseline()
            self._task = asyncio.create_task(self._connection_loop())
```

In `stop()`, flush before clearing state (add the flush as the first line of the body):

```python
    async def stop(self) -> None:
        """Cancel the background task and disconnect."""
        await self.flush_stats()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        self._client = None
        self.connected = False
        self._last_error = None
        self._error_notified = False
        self._suppress_next_connect_toast = False
```

In `_connection_loop`, flush on each periodic wake — change the `except TimeoutError:` block inside the inner wait loop from:

```python
                        except TimeoutError:
                            elapsed = time.monotonic() - connect_time
                            await self._on_periodic_wake(elapsed)
                            if self._should_break_wait(elapsed):
```
to:
```python
                        except TimeoutError:
                            elapsed = time.monotonic() - connect_time
                            await self._on_periodic_wake(elapsed)
                            await self.flush_stats()
                            if self._should_break_wait(elapsed):
```

And count a reconnect on each connection-drop error — in the loop's outer `except Exception as e:` block, add the increment as its first statement:

```python
            except Exception as e:
                self._session_reconnects += 1
                self.connected = False
                self._client = None
                self._last_error = _format_error_detail(e)
```

- [ ] **Step 6: Run to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_fanout_mqtt_stats.py -v`
Expected: PASS.

- [ ] **Step 7: Run the existing MQTT tests for regressions**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_mqtt.py tests/test_community_mqtt.py tests/test_mqtt_ha.py tests/test_health_mqtt_status.py -v`
Expected: PASS (no regressions from the publish/loop changes).

- [ ] **Step 8: Commit** (only if instructed)

```bash
git add app/fanout/mqtt_base.py tests/test_fanout_mqtt_stats.py
git commit -m "feat(mqtt): track per-broker publish/failure/reconnect counters"
```

---

## Task 4: Wire counters through modules + `FanoutManager.get_mqtt_stats`

**Files:**
- Modify: `app/fanout/base.py`
- Modify: `app/fanout/mqtt_private.py`, `app/fanout/mqtt_community.py`, `app/fanout/mqtt_ha.py`
- Modify: `app/fanout/manager.py`
- Test: `tests/test_fanout_mqtt_stats.py` (extend)

- [ ] **Step 1: Write the failing manager test**

Append to `tests/test_fanout_mqtt_stats.py`:

```python
from app.fanout.manager import FanoutManager
from app.fanout.mqtt_private import MqttPrivateModule


class TestGetMqttStats:
    @pytest.mark.asyncio
    async def test_get_mqtt_stats_reports_active_mqtt_modules(self, test_db):
        from app.repository.fanout import _configs_cache

        mgr = FanoutManager()
        module = MqttPrivateModule("cfg-x", {"broker_host": "h"}, name="Private")
        # Simulate an active, running module without a real broker connection.
        module._publisher._session_published = 7
        module._publisher._session_failures = 1
        module._publisher._session_reconnects = 2
        mgr._modules["cfg-x"] = (module, {})
        _configs_cache["cfg-x"] = {"name": "Private", "type": "mqtt_private", "enabled": True}

        stats = mgr.get_mqtt_stats()

        assert len(stats) == 1
        entry = stats[0]
        assert entry["config_id"] == "cfg-x"
        assert entry["name"] == "Private"
        assert entry["type"] == "mqtt_private"
        assert entry["messages_published"] == 7
        assert entry["publish_failures"] == 1
        assert entry["reconnects"] == 2
        assert "status" in entry and "last_error" in entry

    @pytest.mark.asyncio
    async def test_get_mqtt_stats_excludes_non_mqtt_modules(self, test_db):
        from app.fanout.base import FanoutModule

        mgr = FanoutManager()
        mgr._modules["w1"] = (FanoutModule("w1", {}, name="hook"), {})
        assert mgr.get_mqtt_stats() == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_fanout_mqtt_stats.py::TestGetMqttStats -v`
Expected: FAIL (`AttributeError: 'FanoutManager' object has no attribute 'get_mqtt_stats'`).

- [ ] **Step 3: Add the `mqtt_counters` hook to base `FanoutModule`**

In `app/fanout/base.py`, add this property to `FanoutModule` (after the `last_error` property):

```python
    @property
    def mqtt_counters(self) -> dict[str, int] | None:
        """MQTT publish counters, or None for non-MQTT modules.

        MQTT modules override this to expose their publisher's cumulative
        counters; the fanout manager uses ``None`` to skip non-MQTT modules.
        """
        return None
```

- [ ] **Step 4: Set config id + override `mqtt_counters` in each MQTT module**

In `app/fanout/mqtt_private.py`, in `MqttPrivateModule.__init__`, after `self._publisher.set_integration_name(name or config_id)` add:
```python
        self._publisher.set_config_id(config_id)
```
and add the override (after the existing `last_error` property):
```python
    @property
    def mqtt_counters(self) -> dict[str, int]:
        return {
            "messages_published": self._publisher.messages_published,
            "publish_failures": self._publisher.publish_failures,
            "reconnects": self._publisher.reconnects,
        }
```

In `app/fanout/mqtt_community.py`, in `MqttCommunityModule.__init__`, after `self._publisher.set_integration_name(name or config_id)` add:
```python
        self._publisher.set_config_id(config_id)
```
and add the same `mqtt_counters` property to `MqttCommunityModule` (after its `last_error`/`status` properties):
```python
    @property
    def mqtt_counters(self) -> dict[str, int]:
        return {
            "messages_published": self._publisher.messages_published,
            "publish_failures": self._publisher.publish_failures,
            "reconnects": self._publisher.reconnects,
        }
```

In `app/fanout/mqtt_ha.py`, in `MqttHaModule.__init__`, after `self._publisher.set_integration_name(name or config_id)` add:
```python
        self._publisher.set_config_id(config_id)
```
and add the same `mqtt_counters` property to `MqttHaModule`:
```python
    @property
    def mqtt_counters(self) -> dict[str, int]:
        return {
            "messages_published": self._publisher.messages_published,
            "publish_failures": self._publisher.publish_failures,
            "reconnects": self._publisher.reconnects,
        }
```

- [ ] **Step 5: Add `get_mqtt_stats` to `FanoutManager`**

In `app/fanout/manager.py`, add this method to `FanoutManager` (after `get_statuses`):

```python
    def get_mqtt_stats(self) -> list[dict[str, Any]]:
        """Return per-broker MQTT publish stats for each active MQTT module."""
        from app.repository.fanout import _configs_cache

        result: list[dict[str, Any]] = []
        for config_id, (module, _scope) in list(self._modules.items()):
            counters = module.mqtt_counters
            if counters is None:
                continue
            info = _configs_cache.get(config_id, {})
            result.append(
                {
                    "config_id": config_id,
                    "name": info.get("name", config_id),
                    "type": info.get("type", "unknown"),
                    "status": module.status,
                    "last_error": module.last_error,
                    **counters,
                }
            )
        return result
```

- [ ] **Step 6: Run to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_fanout_mqtt_stats.py -v`
Expected: PASS.

- [ ] **Step 7: Commit** (only if instructed)

```bash
git add app/fanout/base.py app/fanout/mqtt_private.py app/fanout/mqtt_community.py app/fanout/mqtt_ha.py app/fanout/manager.py tests/test_fanout_mqtt_stats.py
git commit -m "feat(fanout): expose per-broker MQTT stats via manager"
```

---

## Task 5: Endpoint + model

**Files:**
- Modify: `app/models.py`
- Modify: `app/routers/statistics.py`
- Test: `tests/test_fanout_mqtt_stats.py` (extend) or an existing statistics endpoint test

- [ ] **Step 1: Write the failing endpoint test**

Append to `tests/test_fanout_mqtt_stats.py`:

```python
from unittest.mock import patch

from httpx import ASGITransport, AsyncClient


class TestStatisticsEndpointMqtt:
    @pytest.mark.asyncio
    async def test_statistics_includes_mqtt_brokers(self, test_db):
        from app.main import app

        fake = [
            {
                "config_id": "cfg-x",
                "name": "Private",
                "type": "mqtt_private",
                "status": "connected",
                "last_error": None,
                "messages_published": 7,
                "publish_failures": 1,
                "reconnects": 2,
            }
        ]
        with patch(
            "app.routers.statistics.fanout_manager.get_mqtt_stats", return_value=fake
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/statistics")
        assert resp.status_code == 200
        body = resp.json()
        assert body["mqtt_brokers"] == fake

    @pytest.mark.asyncio
    async def test_statistics_mqtt_brokers_defaults_empty(self, test_db):
        from app.main import app

        with patch(
            "app.routers.statistics.fanout_manager.get_mqtt_stats", return_value=[]
        ):
            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                resp = await client.get("/api/statistics")
        assert resp.status_code == 200
        assert resp.json()["mqtt_brokers"] == []
```

Note: confirm the API prefix. The router uses `prefix="/statistics"`; the test hits `/api/statistics`, so the app must mount it under `/api`. If the existing statistics tests use a different base path, match theirs.

- [ ] **Step 2: Run to verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_fanout_mqtt_stats.py::TestStatisticsEndpointMqtt -v`
Expected: FAIL (`KeyError: 'mqtt_brokers'` / attribute error on patch target).

- [ ] **Step 3: Add the Pydantic model**

In `app/models.py`, add before `class StatisticsResponse`:

```python
class MqttBrokerStats(BaseModel):
    config_id: str
    name: str
    type: str
    status: str = Field(description="connected | disconnected | error")
    last_error: str | None = None
    messages_published: int = 0
    publish_failures: int = 0
    reconnects: int = 0
```

Add the field to `StatisticsResponse` (after `noise_floor_24h`):

```python
    mqtt_brokers: list[MqttBrokerStats] = Field(default_factory=list)
```

- [ ] **Step 4: Attach in the router**

In `app/routers/statistics.py`, add the import and the attach line:

```python
from app.fanout.manager import fanout_manager
```
and in `get_statistics`, after the `noise_floor_24h` line:

```python
    data["mqtt_brokers"] = fanout_manager.get_mqtt_stats()
```

- [ ] **Step 5: Run to verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_fanout_mqtt_stats.py::TestStatisticsEndpointMqtt -v`
Expected: PASS.

- [ ] **Step 6: Commit** (only if instructed)

```bash
git add app/models.py app/routers/statistics.py tests/test_fanout_mqtt_stats.py
git commit -m "feat(statistics): expose mqtt_brokers in /api/statistics"
```

---

## Task 6: Frontend types

**Files:**
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Add the interface + field**

In `frontend/src/types.ts`, add before `export interface StatisticsResponse`:

```typescript
export interface MqttBrokerStats {
  config_id: string;
  name: string;
  /** mqtt_private | mqtt_community | mqtt_ha */
  type: string;
  /** connected | disconnected | error */
  status: string;
  last_error: string | null;
  messages_published: number;
  publish_failures: number;
  reconnects: number;
}
```

Add the field to `StatisticsResponse` (after `noise_floor_24h`):

```typescript
  mqtt_brokers: MqttBrokerStats[];
```

- [ ] **Step 2: Type-check**

Run (from `frontend/`): `npm run build`
Expected: no new type errors from `types.ts`. (Component use comes in Task 8; a build here just confirms the type additions parse.)

- [ ] **Step 3: Commit** (only if instructed)

```bash
git add frontend/src/types.ts
git commit -m "feat(frontend): add MqttBrokerStats type"
```

---

## Task 7: i18n keys

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`, `de.json`, `nl.json`
- Test: `frontend/src/test/i18nParity.test.ts` (existing — run it)

- [ ] **Step 1: Add keys to all three locales**

Add these keys to each of `en.json`, `de.json`, `nl.json`, next to the other `settings_statistics_*` keys. Keep the JSON valid (add commas as needed) and the key set identical across all three files.

`en.json`:
```json
  "settings_statistics_mqtt_title": "MQTT Brokers",
  "settings_statistics_mqtt_broker": "Broker",
  "settings_statistics_mqtt_status": "Status",
  "settings_statistics_mqtt_published": "Published",
  "settings_statistics_mqtt_failures": "Failures",
  "settings_statistics_mqtt_reconnects": "Reconnects",
  "settings_statistics_mqtt_last_error": "Last error",
  "settings_statistics_mqtt_status_connected": "Connected",
  "settings_statistics_mqtt_status_disconnected": "Disconnected",
  "settings_statistics_mqtt_status_error": "Error",
```

`nl.json`:
```json
  "settings_statistics_mqtt_title": "MQTT-brokers",
  "settings_statistics_mqtt_broker": "Broker",
  "settings_statistics_mqtt_status": "Status",
  "settings_statistics_mqtt_published": "Verzonden",
  "settings_statistics_mqtt_failures": "Mislukt",
  "settings_statistics_mqtt_reconnects": "Herverbindingen",
  "settings_statistics_mqtt_last_error": "Laatste fout",
  "settings_statistics_mqtt_status_connected": "Verbonden",
  "settings_statistics_mqtt_status_disconnected": "Niet verbonden",
  "settings_statistics_mqtt_status_error": "Fout",
```

`de.json`:
```json
  "settings_statistics_mqtt_title": "MQTT-Broker",
  "settings_statistics_mqtt_broker": "Broker",
  "settings_statistics_mqtt_status": "Status",
  "settings_statistics_mqtt_published": "Gesendet",
  "settings_statistics_mqtt_failures": "Fehler",
  "settings_statistics_mqtt_reconnects": "Neuverbindungen",
  "settings_statistics_mqtt_last_error": "Letzter Fehler",
  "settings_statistics_mqtt_status_connected": "Verbunden",
  "settings_statistics_mqtt_status_disconnected": "Getrennt",
  "settings_statistics_mqtt_status_error": "Fehler",
```

- [ ] **Step 2: Run the i18n parity + core tests**

Run (from `frontend/`): `npm run test:run -- src/test/i18nParity.test.ts src/test/i18nCore.test.ts`
Expected: PASS (all three locales carry the identical new key set).

- [ ] **Step 3: Commit** (only if instructed)

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/de.json frontend/src/i18n/locales/nl.json
git commit -m "feat(i18n): add MQTT statistics keys (en/de/nl)"
```

---

## Task 8: Statistics page MQTT table

**Files:**
- Modify: `frontend/src/components/settings/SettingsStatisticsSection.tsx`
- Test: `frontend/src/test/settingsStatisticsMqtt.test.tsx` (create)

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/test/settingsStatisticsMqtt.test.tsx`. Match the render/i18n test setup used by the existing settings tests in `frontend/src/test/` (import the same test-utils/provider wrapper those files use; inspect a neighbouring settings test for the exact `render` helper and `api` mock pattern before writing). The behavior to assert:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
// import { renderWithProviders } from '<the shared test util used by sibling settings tests>';
// import { api } from '../api';
// import { SettingsStatisticsSection } from '../components/settings/SettingsStatisticsSection';

// A statistics payload helper: start from a minimal valid StatisticsResponse
// (copy the shape a sibling statistics test already builds) and set mqtt_brokers.

describe('SettingsStatisticsSection MQTT block', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a row per broker with counts', async () => {
    // mock api.getStatistics to resolve with mqtt_brokers:
    //   [{ config_id: 'a', name: 'Private', type: 'mqtt_private',
    //      status: 'connected', last_error: null,
    //      messages_published: 12, publish_failures: 1, reconnects: 3 }]
    // renderWithProviders(<SettingsStatisticsSection />)
    // await screen.findByText('MQTT Brokers')
    expect(await screen.findByText('MQTT Brokers')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('hides the block when there are no brokers', async () => {
    // mock api.getStatistics to resolve with mqtt_brokers: []
    // renderWithProviders(<SettingsStatisticsSection />)
    // wait for the page to settle (e.g. findByText of an always-present heading)
    expect(screen.queryByText('MQTT Brokers')).not.toBeInTheDocument();
  });
});
```

Fill in the commented lines using the exact helpers/mocks a sibling settings test uses. Do not invent a render helper — reuse the established one.

- [ ] **Step 2: Run to verify it fails**

Run (from `frontend/`): `npm run test:run -- src/test/settingsStatisticsMqtt.test.tsx`
Expected: FAIL (`Unable to find text: MQTT Brokers`).

- [ ] **Step 3: Add the MQTT Brokers section to the component**

In `frontend/src/components/settings/SettingsStatisticsSection.tsx`, add a section after the Packets block (after its closing `</div>` and before the `Packets per Hour` block's `<Separator />`, matching the file's `<Separator />`-between-sections pattern). Use the Activity-table idiom already in the file:

```tsx
          {stats.mqtt_brokers?.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="text-base font-semibold tracking-tight mb-2">
                  {t('settings_statistics_mqtt_title')}
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground">
                        <th className="text-left font-normal pb-1">
                          {t('settings_statistics_mqtt_broker')}
                        </th>
                        <th className="text-left font-normal pb-1">
                          {t('settings_statistics_mqtt_status')}
                        </th>
                        <th className="text-right font-normal pb-1">
                          {t('settings_statistics_mqtt_published')}
                        </th>
                        <th className="text-right font-normal pb-1">
                          {t('settings_statistics_mqtt_failures')}
                        </th>
                        <th className="text-right font-normal pb-1">
                          {t('settings_statistics_mqtt_reconnects')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.mqtt_brokers.map((b) => {
                        const dot =
                          b.status === 'connected'
                            ? 'bg-success'
                            : b.status === 'error'
                              ? 'bg-destructive'
                              : 'bg-muted-foreground';
                        const statusLabel =
                          b.status === 'connected'
                            ? t('settings_statistics_mqtt_status_connected')
                            : b.status === 'error'
                              ? t('settings_statistics_mqtt_status_error')
                              : t('settings_statistics_mqtt_status_disconnected');
                        return (
                          <tr key={b.config_id} className="align-top">
                            <td className="py-1 pr-2">
                              <div>{b.name}</div>
                              <div className="text-xs text-muted-foreground">{b.type}</div>
                            </td>
                            <td className="py-1 pr-2">
                              <span className="inline-flex items-center gap-1.5">
                                <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                                {statusLabel}
                              </span>
                              {b.last_error && (
                                <div
                                  className="text-xs text-destructive truncate max-w-[16rem]"
                                  title={b.last_error}
                                >
                                  {t('settings_statistics_mqtt_last_error')}: {b.last_error}
                                </div>
                              )}
                            </td>
                            <td className="text-right py-1">{b.messages_published}</td>
                            <td className="text-right py-1">{b.publish_failures}</td>
                            <td className="text-right py-1">{b.reconnects}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
```

Note: verify the status-color class names (`bg-success`, `bg-destructive`, `bg-muted-foreground`, `text-destructive`) exist in this project's Tailwind theme; the file already uses `text-success`/`text-warning`, so reuse whatever the codebase's convention is for an error/danger color if `destructive` is not defined.

- [ ] **Step 4: Run to verify it passes**

Run (from `frontend/`): `npm run test:run -- src/test/settingsStatisticsMqtt.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** (only if instructed)

```bash
git add frontend/src/components/settings/SettingsStatisticsSection.tsx frontend/src/test/settingsStatisticsMqtt.test.tsx
git commit -m "feat(frontend): MQTT brokers table on statistics page"
```

---

## Task 9: Changelog

**Files:**
- Modify: `CHANGELOG-DMC-EV.md`

- [ ] **Step 1: Add an entry**

Open `CHANGELOG-DMC-EV.md`, find the current/unreleased section and its grouping style (grouped by area, referencing a PR/commit). Add an entry under the appropriate area, e.g.:

```markdown
- Statistics page: per-broker MQTT statistics (connection status, last error, messages
  published, publish failures, reconnects), persisted across restarts via the new
  `fanout_mqtt_stats` table (migration 088). (<PR/commit ref>)
```

Match the exact heading/format already in the file rather than inventing a new one.

- [ ] **Step 2: Commit** (only if instructed)

```bash
git add CHANGELOG-DMC-EV.md
git commit -m "docs: changelog entry for per-broker MQTT statistics"
```

---

## Task 10: Full CI-equivalent gates + runtime verification

**Files:** none (verification only)

- [ ] **Step 1: Backend lint/format + full backend suite**

Run (see `docs/agents/ci-checks.md` for the authoritative commands):
```bash
docker exec rtfm-ev-local /app/.venv/bin/ruff check app tests
docker exec rtfm-ev-local /app/.venv/bin/ruff format --check app tests
docker exec rtfm-ev-local /app/.venv/bin/python -m pytest tests/test_fanout_mqtt_stats.py tests/test_migrations -v
```
Expected: ruff clean; targeted suites PASS. (Windows-only pre-existing failures in the full host suite are noted in memory "Windows-only test failures" — run backend tests in the container to avoid them.)

- [ ] **Step 2: Frontend gates**

Run (from `frontend/`):
```bash
npm run lint
npm run format:check
npm run test:run
npm run build
```
Expected: all PASS. (Note memory "OpenHop Surface": on local Windows, `format:check` may report ~200 CRLF-only diffs that are not real drift; if so, confirm `git diff` is clean after `prettier --write` and rely on CI. Only the files this change touches must be genuinely clean.)

- [ ] **Step 3: Runtime verification on the live container**

Rebuild/redeploy the local container (`rtfm-ev-local` on :8000 — see memory "Local Docker instance") on this branch, then:
1. Open the app, go to Settings → Statistics tab.
2. With at least one MQTT broker configured/enabled, confirm the **MQTT Brokers** table renders with the broker name/type, a status dot, and Published/Failures/Reconnects counts.
3. Publish some traffic (or wait for packets) and confirm the Published count increases on reload.
4. Restart the container and confirm the counts persist (do not reset to 0), proving the flush/baseline path.
5. Confirm the block is absent when no MQTT broker is active.

Record the observed values (screenshot via SendUserFile) as evidence. Per CLAUDE.md "Never claim it works without proof", do not report success until steps 1-5 are observed, not reasoned about.

- [ ] **Step 4: Commit** (only if instructed) — nothing to commit; verification only.

---

## Self-Review Notes (author)

- **Spec coverage:** table (088) → Task 1; repository + delete cleanup → Task 2; publisher counters/baseline/flush → Task 3; module wiring + `get_mqtt_stats` → Task 4; model + endpoint → Task 5; FE types → Task 6; i18n → Task 7; FE table → Task 8; changelog → Task 9; CI + runtime → Task 10. All spec sections mapped.
- **Migration-test bump gotcha:** bumping `LATEST_SCHEMA_VERSION` to 88 breaks `test_migration_087`'s relative `LATEST - 1` anchor (Task 1, Step 3 fixes it); `test_migration_085`'s `LATEST - 84` assertion self-adjusts. Both covered in Step 5's run.
- **Reload vs delete:** cleanup lives in `FanoutConfigRepository.delete` (real deletes only), NOT `remove_config` (also used by reload) — so a broker edit preserves counts via flush-then-reload-baseline.
- **Live-update `start()`:** baseline load/counter-reset is gated to the task-creation branch so a settings-version bump on a running publisher does not zero counters.
- **Type consistency:** `messages_published` / `publish_failures` / `reconnects` and `mqtt_brokers` / `MqttBrokerStats` are spelled identically across migration, repository, publisher, manager, model, TS type, and component.
- **Non-hot-path DB:** counters are in-memory; only the ~60s flush and `stop()` touch the DB.
