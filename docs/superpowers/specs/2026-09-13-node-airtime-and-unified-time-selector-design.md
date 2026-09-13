# Node airtime utilization graph + unified time-range selector — design

Date: 2026-09-13
Branch: `claude/node-airtime-utilization-graph-517f76`
Status: design, pending user review

## Problem

1. The My Node page has no TX/RX airtime utilization (%) graph, even though the
   companion radio reports the underlying data and the backend already receives it.
2. Time-range selection is inconsistent across pages: four independent, one-off
   selectors with four different option sets and two unit conventions (seconds vs
   hours). The user wants one aligned selector, using this base set:
   `20m 1h 3h 6h 12h 24h 48h 3d 7d 14d 30d` + `Custom (From/To) + Apply`.

## Grounding facts (verified against current code and firmware)

### Firmware side (`G:\Github\repositories\Dutch-MeshCore\MeshCore`, companion `v1.17.1`, proto v14)
- The companion firmware exposes airtime over `CMD_GET_STATS` (56) sub-type
  `STATS_TYPE_RADIO` (1) → `RESP_CODE_STATS` (24), a 14-byte little-endian frame:
  - offset 2: `noise_floor` (i16, dBm)
  - offset 4: `last_rssi` (i8, dBm)
  - offset 5: `last_snr` (i8, dB×4)
  - **offset 6: `tx_air_secs` (u32)** — cumulative TX airtime, seconds since boot
  - **offset 10: `rx_air_secs` (u32)** — cumulative RX airtime, seconds since boot
  Source: `examples/companion_radio/MyMesh.cpp:1914-1928`, matches
  `docs/stats_binary_frames.md:65-91`.
- Counters are cumulative-from-boot (ms internally, `/1000`), reset on
  reboot/`clearStats` (`src/Dispatcher.cpp:130-131,166,252-253`). They can wrap.
- `rx_air_secs` is built from **estimated** per-packet airtime
  (`getEstAirtimeFor`) for packets the node successfully parsed — it is not a
  true carrier-sense channel-busy timer. This must be stated in the UI/help.
- The firmware's windowed "AIR %" (`RadioActivityWindow::airtimePercentX10()`,
  RX-only, ~20-min sliding window) is repeater/room-server only, is NOT built
  into the companion, and is NOT transmitted over the companion API. There is no
  ready-made utilization percentage on the wire. We compute % host-side.

### Host side (RTFM-EV, this worktree)
- The backend already samples `get_stats_radio()` every 60s and already parses
  `tx_air_secs`/`rx_air_secs` (`app/services/radio_stats.py:_sample_all_stats`,
  interval `STATS_SAMPLE_INTERVAL_SECONDS = 60`). They surface as latest values in
  `GET /api/health` `radio_stats.{tx_air_secs,rx_air_secs}`
  (`app/routers/health.py:171-172`) and are shown as a cumulative total in
  Settings → Radio (`frontend/src/components/settings/SettingsRadioSection.tsx:139-154`,
  `formatAirtime()`). **They are never persisted and never charted.**
- Precedent for per-metric history tables that come off the *same* 60s sampler:
  - `noise_floor_samples` — migration `_069`, repo `app/repository/noise_floor.py`,
    endpoint `GET /api/statistics/noise-floor` (`app/routers/statistics.py:54-59`),
    written in `_persist_samples()` (`app/services/radio_stats.py:97-101`),
    consumed by `api.getNoiseFloorHistory` (`frontend/src/api.ts:560-561`).
  - `battery_history` — migration `_070`, repo `app/repository/battery_history.py`,
    endpoint `GET /api/statistics/battery/range` (`app/routers/statistics.py:46-51`),
    written at `radio_stats.py:103-107`, consumed by `api.getBatteryRange`.
- Raw packets are persisted (`raw_packets` table, `app/database.py:76`), and
  DB-side stat breakdowns already exist via `GET /api/packets/historical-stats`
  and `GET /api/packets/timeseries` (both already used by My Node).
- Highest committed migration is `_085_add_contact_annotations.py`; next free
  number on this branch is **`_086`** (parallel branches can also claim 086 —
  re-check at merge). `LATEST_SCHEMA_VERSION = 85`
  (`tests/test_migrations/conftest.py:5`) must bump to 86, with a new
  `tests/test_migrations/test_migration_086.py`.
- No dedicated time-based pruner for `raw_packets` was found (advert_events and
  link_signal have pruners; raw_packets do not). Phase 3 "fill in" reaches as far
  back as `raw_packets` physically exist; confirm at implementation whether any
  cascade/maintenance bounds this.

### The four existing selectors (all one-off; no shared component)
- My Node — `MyNodeView.tsx:92-101` `TIME_WINDOWS`: `20m 1h 6h 1d 7d 30d 1y Custom`
  (seconds; `20m` is live/in-memory, rest hit DB). Button row + custom pickers at
  `:1811-1855`.
- Map — `MapView.tsx:66-82` `MAP_SINCE_PRESETS`: `1h 1d 3d 7d All` + `custom`
  (seconds; localStorage `remoteterm-map-since`; default `7d`).
- Mesh Health — `MeshHealthView.tsx:108-116` `TIME_WINDOWS`: `30m 1h 3h 6h 12h 24h 7d`
  (hours; `autoRefresh` flag on 30m/1h; no custom; default `30m`).
- Raw Packet Feed — `rawPacketStats.ts:6-7` `RAW_PACKET_STATS_WINDOWS`:
  `1m 5m 10m 30m session` (in-memory ring buffer; `<select>` dropdown).

## Scope and decisions (confirmed with user)

- All three phases in **one spec**, implemented in order.
- Unified selector adopted on **all four pages**; **every existing extra is kept**
  per page (My Node `1y`; Map `All`; Mesh Health `30m`; Raw Packet Feed
  `1m/5m/10m/session`). Base set is used verbatim as given.
- Airtime chart: **one ChartCard, two line series** (RX %, TX %), 0–100% y-axis.
- Phase 3: Raw Packet Feed adopts the base set and its stat cards **fill from the
  persisted `raw_packets` DB** for ranges the in-memory session buffer does not
  cover; short windows stay live/in-memory.

## Design

### Phase 1 — Unified time-range selector (foundation)

**New single source of truth:** `frontend/src/utils/timeRanges.ts`
- Exports the ordered base ranges, each `{ id, labelKey, seconds }`:
  `20m=1200, 1h=3600, 3h=10800, 6h=21600, 12h=43200, 24h=86400, 48h=172800,
  3d=259200, 7d=604800, 14d=1209600, 30d=2592000`, plus the `custom` sentinel.
- Helper `resolveRange(id, { customStart, customEnd, now })` → `{ startTs, endTs }`
  (seconds). `custom` uses the picker values; `All`-style extras with
  `seconds: null` resolve to `startTs = 0` (no lower bound).

**New component:** `frontend/src/components/TimeRangeSelector.tsx`
- Props: `value: string`, `onChange(id)`, `customStart`, `customEnd`,
  `onCustomChange(start, end)`, `onApply()`, and optional page extras
  `extrasBefore?`, `extrasAfter?`, `extrasSpecial?` (each `{ id, labelKey, seconds }`,
  `seconds: null` allowed for `All`).
- Renders: `[extrasBefore] [base buttons] [extrasAfter] | [extrasSpecial] [Custom]`,
  and, when `value === 'custom'`, the inline `From <datetime-local> To
  <datetime-local> [Apply]` row (matches the approved mockup). Custom validation:
  `Apply` disabled while `From > To` or either is empty.
- The component owns only the option list, selection, and custom range. It does
  **not** decide live-vs-DB or auto-refresh — those stay per page, keyed off `value`.

**i18n:** add label keys for the new windows and the custom controls in
`frontend/src/i18n/locales/{en,nl,de}.json` (e.g. `time_range_3h`, `_12h`, `_48h`,
`_3d`, `_14d`, plus `time_range_custom`, `_from`, `_to`, `_apply`). Reuse existing
keys where a window already has one. The i18n parity test must pass.

**Per-page refactors (behavior preserved):**
- `MyNodeView.tsx`: replace `TIME_WINDOWS` + the inline row (`:1811-1855`) with
  `<TimeRangeSelector>`; `20m` remains the live/in-memory mapping; `1y`
  (`seconds: 31536000`) passed as `extrasAfter`; keep custom behavior.
- `MeshHealthView.tsx`: replace its `TIME_WINDOWS`; `30m` (`seconds: 1800`) passed
  as `extrasBefore`; gains Custom. Convert its internal hours math to consume the
  shared seconds via a thin adapter; keep the `autoRefresh` behavior for the short
  windows (30m/1h).
- `MapView.tsx`: replace `MAP_SINCE_PRESETS`; `All` (`seconds: null`) passed as
  `extrasSpecial`; keep localStorage persistence and custom.
- `RawPacketFeedView.tsx`: adopt the base set; `1m/5m/10m` as `extrasBefore`,
  `session` as `extrasSpecial`; long-range data source handled in Phase 3.

### Phase 2 — TX/RX airtime utilization graph on My Node

**Migration `app/migrations/_086_create_airtime_history.py`** (mirror `_070`):
```
CREATE TABLE IF NOT EXISTS airtime_history (
  timestamp    INTEGER NOT NULL,
  tx_air_secs  INTEGER NOT NULL,
  rx_air_secs  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_airtime_history_timestamp ON airtime_history(timestamp);
```
Bump `LATEST_SCHEMA_VERSION` 85→86; add `tests/test_migrations/test_migration_086.py`.

**Repository** `app/repository/airtime_history.py` (copy `battery_history.py`, add a
column): `insert(ts, tx_air_secs, rx_air_secs)`, `get_range(start_ts, end_ts)`
returning ordered `[{timestamp, tx_air_secs, rx_air_secs}]`.

**Sampler write:** in `app/services/radio_stats.py:_persist_samples()`, alongside the
existing noise-floor/battery inserts, add (guarded by `isinstance(..., int)`):
`AirtimeHistoryRepository.insert(ts, snapshot["tx_air_secs"], snapshot["rx_air_secs"])`.

**Endpoint** `GET /api/statistics/airtime/range?start_ts&end_ts&bin_count` in
`app/routers/statistics.py`. Returns `[{timestamp, tx_pct, rx_pct}]` per bin.
Utilization is computed from **adjacent cumulative-sample pairs** (robust to resets):
- For each consecutive pair `(s_i, s_{i+1})` with `dt = t_{i+1}-t_i > 0`:
  - `d_tx = tx_{i+1}-tx_i`, `d_rx = rx_{i+1}-rx_i`.
  - If `d_tx < 0` or `d_rx < 0` → counter reset/reboot → skip the pair.
  - If `dt` exceeds a sanity ceiling (e.g. `> 5 × sample interval` = radio was
    disconnected) → skip the pair (avoids a false spike after a gap).
  - Else `pct = clamp(100 * d / dt, 0, 100)` for tx and rx.
  - Assign the pair to the bin containing `t_{i+1}`.
- Each bin's value is the mean of its pairs' pct (tx and rx independently). Bins
  with no valid pair are omitted (rendered as a gap).

**Frontend:**
- `types.ts`: `AirtimeSample { timestamp: number; tx_pct: number; rx_pct: number }`.
- `api.ts`: `getAirtimeRange(startTs, endTs, binCount)`.
- New chart in the My Node activity grid (`MyNodeView.tsx`, alongside the existing
  ChartCards): a dual-line chart (RX %, TX %), 0–100% y-axis, driven by the same
  `[start, end]` the page already computes from the shared selector. Reuse the
  existing line-chart primitive if it supports two series; otherwise add a small
  `AirtimeLineChart` mirroring `NoiseFloorLineChart`. A one-line caption notes RX
  airtime is estimated per-packet, not carrier-sense.
- The live `20m` window uses the same endpoint (DB holds 60s samples covering the
  last 20m), so there is one uniform data path.

### Phase 3 — Raw Packet Feed session stats become historical + "filling in"

- Raw Packet Feed adopts the base set (Phase 1). Its stat cards choose a source by
  coverage: if the selected range start is within the in-memory `rawPacketStore`
  buffer's earliest timestamp, render from `buildRawPacketStatsSnapshot`
  (live/in-memory, current behavior); otherwise fetch
  `GET /api/packets/historical-stats?start_ts&end_ts` and render the same cards
  from the DB result. `session` stays as an extra meaning "in-memory since page
  load".
- **Verification required at implementation:** confirm `/historical-stats` returns
  every field the Raw Packet Feed cards need (payload types, route mix
  direct/flood, hop profile, signal distribution, hop byte-width). Extend the
  endpoint only for fields it does not already compute.
- Retention caveat (from grounding facts): historical fill reaches as far back as
  `raw_packets` exist; there is no dedicated time-based prune. Ranges beyond
  available data show partial results.

## Cross-cutting

- **Docs (same change):** `CHANGELOG-DMC-EV.md` grouped entry; README /
  README_ADVANCED feature lists where My Node charts or time selectors are
  described; `frontend/AGENTS.md` (new shared `TimeRangeSelector`, `timeRanges.ts`)
  and `app/AGENTS.md` (new `airtime_history` table, repo, `/statistics/airtime/range`
  endpoint); `docs/sources-of-truth.md` if it enumerates stat tables/selectors.
  Leave `CHANGELOG.md` (upstream, script-managed) alone.
- **CI gates (run before pushing):** backend `ruff check` / `ruff format --check`,
  migration tests; frontend `lint` / `format:check` / `test:run` / `build`; i18n
  parity. See `docs/agents/ci-checks.md`.

## Error handling

- Airtime endpoint: no samples → `[]`; a single sample → no pairs → `[]`;
  reset/gaps skipped as above; all pct clamped 0–100; guard `dt <= 0`.
- Selector: `From > To` or empty → `Apply` disabled/no-op; custom values
  round-tripped through the page's existing state.
- Phase 3: DB fetch failure → fall back to the in-memory snapshot (or an explicit
  error state); empty DB range → empty cards, not an error.

## Testing

- **Backend:** `test_migration_086` (table + version count); repository
  insert/get_range; endpoint tests — binning, reset handling (negative delta
  skipped), gap ceiling, clamp, empty/single-sample; sampler-persist test
  (tx/rx rows written each tick).
- **Frontend:** `timeRanges` resolver unit tests (each id → correct seconds;
  custom; `All`→0); `TimeRangeSelector` tests (renders base + each extras slot,
  custom expand + Apply gating, `onChange`); airtime chart data mapping
  (samples → two series, gaps); per-page smoke that each selector still drives its
  existing filter; i18n parity (EN/NL/DE).
- **Runtime (required, not reasoned):** build the branch into the local Docker
  instance (`rtfm-ev-local`, `:8000`) and observe: the airtime chart drawing with
  a live radio; the identical selector on all four pages; Phase 3 long ranges
  populating from the DB. Record two independent checks per the "never claim it
  works without proof" rule.

## Out of scope / non-goals

- No firmware changes. No repeater airtime changes (repeaters already have their
  own telemetry path).
- No new retention/pruning policy for `raw_packets` (only noted as a caveat).
- No change to the live-vs-DB thresholds or auto-refresh behavior beyond wiring
  them to the shared selector.
