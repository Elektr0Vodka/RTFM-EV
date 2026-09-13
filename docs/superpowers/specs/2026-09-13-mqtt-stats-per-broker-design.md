# MQTT statistics per broker (statistics page)

Date: 2026-09-13
Branch: `claude/mqtt-stats-per-broker-49ba63`

## Goal

Add a dedicated **MQTT Brokers** block to the Statistics page showing, per configured
MQTT broker: connection status, last error, messages published, publish failures, and
reconnects. Counts persist across app restarts.

## Context / current state

- The Statistics page is a tab in the Settings modal:
  `frontend/src/components/settings/SettingsStatisticsSection.tsx`. It does a single
  `api.getStatistics()` (`GET /api/statistics`) on mount into
  `StatisticsResponse` (`frontend/src/types.ts:1051`).
- Backend endpoint: `app/routers/statistics.py` `GET /api/statistics` →
  `StatisticsResponse`. Data comes from `StatisticsRepository.get_all()`
  (`app/repository/settings.py`). The router already attaches one in-memory sub-object
  (`noise_floor_24h` from `app/services/radio_stats.py`) before returning — the same
  seam we reuse for MQTT.
- MQTT runs as **fanout modules** keyed by `fanout_configs.id` (`config_id`). Three MQTT
  module types (`mqtt_private`, `mqtt_community`, `mqtt_ha`) each wrap a subclass of
  `BaseMqttPublisher` (`app/fanout/mqtt_base.py`). `FanoutManager.get_statuses()`
  (`app/fanout/manager.py:336`) already returns `{name, type, status, last_error}` per
  `config_id`.
- **No message counters exist today.** `BaseMqttPublisher` tracks only `connected` and
  `last_error`. This feature is net-new tracking.

## Decisions (from brainstorming)

- Scope per broker: connection status, last error, **messages published**,
  **publish failures**, **reconnects**. (Messages received is out of scope — MQTT
  modules are publish-only.)
- **Persist counts across restarts** (not session-only).
- Persistence approach: **A — live in-memory counters + periodic/lifecycle flush.**
  No DB write on the publish hot path.
- Layout: **table**, one row per broker, matching the existing Activity-table idiom.

## Data model

New migration `app/migrations/_088_create_fanout_mqtt_stats.py`. Bump
`LATEST_SCHEMA_VERSION` 87 → 88 in `tests/test_migrations/conftest.py` and add
`tests/test_migrations/test_migration_088.py` following the `_087` test pattern.

Table `fanout_mqtt_stats`:

| column               | type    | notes                                   |
| -------------------- | ------- | --------------------------------------- |
| `config_id`          | TEXT    | PRIMARY KEY, → `fanout_configs.id`      |
| `messages_published` | INTEGER | NOT NULL DEFAULT 0, cumulative total    |
| `publish_failures`   | INTEGER | NOT NULL DEFAULT 0, cumulative total    |
| `reconnects`         | INTEGER | NOT NULL DEFAULT 0, cumulative total    |
| `updated_at`         | TEXT    | ISO timestamp of last flush             |

Rows are cumulative totals (`baseline + session`), written by flush as an idempotent
**set** (not increment), so a flush is safe to repeat and never double-counts.

Cleanup: delete the stats row inside `FanoutConfigRepository.delete(config_id)`, so a
deleted broker leaves no orphan row. It must NOT go in `FanoutManager.remove_config`,
which `reload_config` also calls on every broker config edit — deleting there would wipe
counts on a mere edit. Reload path is safe: `remove_config` → `module.stop()` flushes the
total to DB, then the new module's `load_baseline` reads it back, so counts survive an
edit.

## Backend

### `BaseMqttPublisher` (`app/fanout/mqtt_base.py`)

Add per-instance session counters and a persisted baseline:

- `self._msg_published: int = 0`, `self._publish_failures: int = 0`,
  `self._reconnects: int = 0` (session counts since this publisher started).
- `self._baseline: dict[str, int]` loaded on `start()` via `load_baseline(config_id)`
  from `FanoutMqttStatsRepository`. The publisher must know its `config_id`; pass it in
  (each module already has `self.config_id`, e.g. `MqttPrivateModule` passes
  `name or config_id` to `set_integration_name` — add an explicit
  `set_config_id(config_id)` or a constructor arg).

Increment sites (minimal, on the existing paths):

- **`publish()` success** (after `await self._client.publish(...)`): `_msg_published += 1`.
- **`publish()` failure** (the existing `except Exception` block): `_publish_failures += 1`.
- **Reconnect** (the connection loop's `except Exception` reconnect/backoff block):
  `_reconnects += 1`. Definition: incremented once per connection drop/error that
  triggers a backoff retry. The initial connect is not a reconnect.

Flush:

- `async def flush_stats(self)`: write
  `total = baseline + session` for each counter via `FanoutMqttStatsRepository.set(...)`.
- Called from `_on_periodic_wake` (already fires ~60s while connected) and from `stop()`.
- On next process start, `load_baseline` reloads the flushed totals and session counts
  reset to 0 — so restart continuity holds to within one flush interval.

Read accessors: expose `messages_published`, `publish_failures`, `reconnects`
properties returning `baseline + session` (live cumulative).

### Repository (`app/repository/fanout.py`)

New `FanoutMqttStatsRepository`:

- `async get(config_id) -> dict | None`
- `async set(config_id, messages_published, publish_failures, reconnects)` (upsert)
- `async delete(config_id)`

### `FanoutManager` (`app/fanout/manager.py`)

- `get_mqtt_stats() -> list[dict]`: for each active module exposing `mqtt_counters`
  (a new base-`FanoutModule` property returning `None`, overridden by the three MQTT
  modules to return the publisher's cumulative counters), return
  `{config_id, name, type, status, last_error, messages_published, publish_failures, reconnects}`.
  Non-MQTT modules (`mqtt_counters is None`) are excluded. Only currently-active
  (running) brokers appear; a disabled broker's persisted totals are not shown (YAGNI).

### Endpoint / model (`app/routers/statistics.py`, `app/models`)

- Add Pydantic `MqttBrokerStats` (`config_id`, `name`, `type`, `status`,
  `last_error: str | None`, `messages_published: int`, `publish_failures: int`,
  `reconnects: int`).
- Add `mqtt_brokers: list[MqttBrokerStats] = []` to `StatisticsResponse`.
- In `GET /api/statistics`, after `StatisticsRepository.get_all()`, set
  `data["mqtt_brokers"] = fanout_manager.get_mqtt_stats()` (mirrors the existing
  `noise_floor_24h` attach).

## Frontend

### Types (`frontend/src/types.ts`)

- Add `MqttBrokerStats` interface and `mqtt_brokers: MqttBrokerStats[]` to
  `StatisticsResponse`.

### Component (`SettingsStatisticsSection.tsx`)

- New **MQTT Brokers** section (own `<Separator/>` block, placed after Packets).
- Rendered as a `<table>` matching the Activity table idiom: one row per broker.
  Columns: broker name, Status (colored dot: connected=green, disconnected=muted,
  error=red, with the type as secondary text), Published, Failures, Reconnects,
  Last error (truncated, title=full).
- If `mqtt_brokers` is empty, the section is not rendered.

### i18n (`frontend/src/i18n/locales/{en,de,nl}.json`)

New keys under the existing `settings_statistics_*` namespace:
`settings_statistics_mqtt_title`, `_mqtt_broker`, `_mqtt_status`, `_mqtt_published`,
`_mqtt_failures`, `_mqtt_reconnects`, `_mqtt_last_error`,
`_mqtt_status_connected`, `_mqtt_status_disconnected`, `_mqtt_status_error`.
All three locales must have identical key sets (enforced by the i18n parity test).

## Testing

Backend:
- `BaseMqttPublisher` counter increments: publish success → `messages_published`;
  publish exception → `publish_failures`; connection-loop error → `reconnects`.
- `load_baseline` + idempotent `flush_stats` (repeat flush does not double count;
  `total == baseline + session`).
- `FanoutMqttStatsRepository` CRUD + `remove_config` deletes the row.
- Migration `_088` test (version bump, table exists) mirroring `_087`.
- `GET /api/statistics` response includes `mqtt_brokers` with the expected shape.

Frontend:
- Section renders one row per broker with the correct counts/status.
- Empty `mqtt_brokers` hides the section.
- i18n parity test passes (new keys in all three locales).

## Verification (before any "works"/push claim)

- Backend tests in the container (`rtfm-ev-local`, `/app/.venv`).
- CI-equivalent gates: `ruff check`, `ruff format --check`; frontend `lint`,
  `format:check`, `test:run`, `build`. See `docs/agents/ci-checks.md`.
- Runtime: rebuild the local container on this branch, open the Statistics tab, confirm
  the MQTT Brokers table renders with live counts for a configured broker, and that
  counts survive a container restart (persistence).

## Docs

- `CHANGELOG-DMC-EV.md`: add an entry (grouped by area).
- Update `frontend/AGENTS.md` / `app/AGENTS.md` only if the statistics-data flow
  description changes materially.

## Out of scope

- Messages received counters (MQTT is publish-only here).
- Per-topic or per-message-type breakdowns.
- Historical time-series charts of MQTT throughput.
