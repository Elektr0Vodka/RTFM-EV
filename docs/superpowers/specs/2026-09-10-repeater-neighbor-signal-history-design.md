# Per-link signal history (X2b) — design

Date: 2026-09-10
Status: approved for planning (expanded to two perspectives)
Author: Elektr0Vodka (with agent research)

## 1. Background and correction of the parity audit

The parity audit (`docs/parity-audit.md:137-138`) lists two neighbor-discovery
rows as **Absent**:

- "Query a repeater's neighbors"
- "Neighbors on map + per-link signal"

Both are **factual errors**. The feature is already implemented and live, and it
predates the audit (upstream jkingsman "Repeater UI overhaul"). Verified in
source on 2026-09-10:

- Backend endpoint `POST /contacts/{public_key}/repeater/neighbors`
  (`app/routers/repeaters.py:240`) calls `mc.commands.fetch_all_neighbours(...)`.
- Models `NeighborInfo` / `RepeaterNeighborsResponse` (`app/models.py:704`).
- Frontend: `RepeaterNeighborsPane.tsx` (sortable name / SNR / distance /
  last-heard, count / partial-count) and `NeighborsMiniMap.tsx` (radio node,
  SNR-colored neighbor markers, link lines), wired into `RepeaterDashboard.tsx`.
- Tests: `tests/test_repeater_routes.py::TestRepeaterNeighbors`.

### Why `scopes` and `status` are out of scope (companion-unreachable)

The audit named the DMC `neighbors` payload fields
`pubkey / snr / heard_secs_ago / scopes / status` as the parity target. Only the
first three are obtainable by a host bridging through a companion radio:

- The binary `REQ_TYPE_GET_NEIGHBOURS` (`0x06`) response carries **only**
  pubkey-prefix + `secs_ago` (uint32 LE) + `snr` (int8/4). Verified in the
  pinned `meshcore==2.3.9.1` parser (`reader.py:907-912`) and the DMC firmware
  repeater encoder (`examples/simple_repeater/MyMesh.cpp:410-434`, branch
  `dmc-observer-dev-1171-regiongating`).
- `scopes` and `status` exist only in the repeater's `NeighborDiscoverEntry`
  overlay (`#if defined(WITH_MQTT_NEIGHBORS)`), populated by the repeater firing
  its own anon-regions probes, and are published **only** to the MQTT
  `neighbors` topic. There is no companion/binary command that returns them →
  later item **L3**, not X2.

### Why room-server neighbors are out of scope

`REQ_TYPE_GET_NEIGHBOURS 0x06` is **repeater-only**. The room server's binary
`handleRequest` recognizes only STATUS / TELEMETRY / ACCESS_LIST and returns
`0; // unknown command` for `0x06` (`examples/simple_room_server/MyMesh.cpp`).
The shared CLI `neighbors` text command exists but is gated on the
`WITH_MQTT_NEIGHBORS` build flag and would need a fragile remote-CLI + text-parse
path. Dropped by decision.

## 2. What this builds: X2b — per-link signal history (two perspectives)

The one buildable, host-side increment is **per-link signal history**. The live
snapshot is already shown; history adds "is this link getting better or worse."

There are two distinct, complementary perspectives on a link, and this feature
captures **both**:

1. **Repeater perspective (active query).** SNR the *repeater* measured for *its*
   neighbors, obtained by querying the repeater (`fetch_all_neighbours`). This is
   the only source of the repeater's-view data and cannot come from passive
   traffic.
2. **My-node perspective (passive traffic).** SNR/RSSI *my companion* measured
   for nodes it heard **directly (0-hop)**, recorded passively from the ongoing
   packet stream. Zero extra radio traffic.

Both feed one unified per-link time series so the neighbors detail chart can
overlay "how the repeater hears node X" against "how I hear node X."

Note on existing data: N1 persists per-packet `rssi`/`snr` on `raw_packets`
(`app/database.py:70`) but with **no queryable sender/path-length column** (the
identity is inside the `data` blob), and `contact_advert_paths` stores only a
`best_rssi`/`best_snr` aggregate (migration `_066`), not a time series. So the
my-node perspective genuinely needs a new, subject-keyed time-series capture; it
is additive to N1, not duplicative.

## 3. Goal and non-goals

**Goal:** Persist per-link signal samples from both perspectives and surface the
trend in the existing neighbors pane (inline sparkline + on-click detail chart).

**Non-goals:**
- No `scopes` / `status` (companion-unreachable).
- No room-server support (opcode absent).
- No MQTT `neighbors` publish (that is L3).
- No new sampling interval/scheduler for the repeater query (reuse the
  tracked-telemetry cadence).
- My-node capture is limited to **0-hop ADVERT receptions** (identity always
  present, low volume) — not every packet type.
- No MyNodeView UI changes in this increment (the my-node series is captured
  globally and surfaced in the repeater neighbors detail chart as an overlay;
  a dedicated MyNodeView history view is a possible follow-up, out of scope).

## 4. Architecture

### 4.1 Storage — migration `_075_create_link_signal`

Re-verify the next-free number against `origin/main` at implementation time
(parallel branches race for migration numbers). As of 2026-09-10 the highest on
`origin/main` is `_074`, so `_075` is next.

New table `link_signal`:

| Column | Type | Meaning |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | row id |
| `observer_pubkey` | TEXT NOT NULL | who measured: the queried repeater's full key (`repeater_query`), or the companion's own key (`traffic`) |
| `subject_pubkey` | TEXT NOT NULL | the other end: neighbor prefix (`repeater_query`) or advertiser full key (`traffic`) |
| `source` | TEXT NOT NULL | `'repeater_query'` or `'traffic'` |
| `snr` | REAL NOT NULL | per-link SNR in dB |
| `rssi` | INTEGER | RSSI (traffic only; NULL for repeater queries) |
| `secs_ago` | INTEGER | repeater's "heard N secs ago" at sample time (repeater_query only; NULL for traffic) |
| `observed_at` | INTEGER NOT NULL | unix epoch seconds (UTC) when RTFM-EV captured the sample |

Indexes:
- `idx_link_signal_lookup` on `(observer_pubkey, subject_pubkey, observed_at)`.
- `idx_link_signal_subject` on `(subject_pubkey, observed_at)` — cross-observer
  lookups (match a repeater neighbor prefix to my-node samples by prefix).
- `idx_link_signal_observed_at` on `(observed_at)` — pruning.

Bump `LATEST_SCHEMA_VERSION` to 75 (verify the current value and prior pattern
before editing).

**Identity trade-off:** `repeater_query` subjects are pubkey *prefixes* (default
4 bytes / 8 hex) because that is all the wire format provides
(`reader.py:909`); `traffic` subjects are full pubkeys. Matching the two
perspectives for one node is done by prefix (a neighbor prefix is a prefix of the
advertiser's full key) — the same `startsWith` match the pane already uses to
resolve neighbors to contacts.

### 4.2 Write path — `LinkSignalRepository`

New repository (follow existing patterns, e.g. `RepeaterTelemetryRepository`):

- `record_repeater_samples(repeater_pubkey, neighbors, observed_at)` — batch
  insert, `source='repeater_query'`, one row per neighbor
  (`subject`, `snr`, `secs_ago`; `rssi` NULL). No-op on empty list.
- `record_traffic_sample(observer_pubkey, subject_pubkey, snr, rssi, observed_at)`
  — single insert, `source='traffic'` (`secs_ago` NULL).
- `get_repeater_history(repeater_pubkey, since)` — `repeater_query` rows for the
  repeater, grouped by subject.
- `get_traffic_history_for_subjects(prefixes, since)` — `traffic` rows whose
  `subject_pubkey` starts with any given prefix, within the window (used to
  overlay my-node series onto a repeater's neighbor list).
- `prune(older_than_days=30)` — delete `observed_at < cutoff`; return count.

All DB access uses the shared `db` helper (readonly for reads); no separate
`aiosqlite.connect`.

### 4.3 Capture site A — repeater query, opportunistic (on-demand endpoint)

In `repeater_neighbors` (`app/routers/repeaters.py:240`), after building the
`neighbors` list, `record_repeater_samples(...)` from the data already fetched.
Best-effort (try/except, never fails the response). Zero extra radio traffic.

### 4.4 Capture site B — repeater query, periodic (tracked-telemetry cycle)

In `app/radio_sync.py` (`_collect_repeater_telemetry` / `_run_telemetry_cycle`):
for each tracked repeater already polled in the cycle, additionally call
`fetch_all_neighbours(...)` under the same per-repeater `radio_operation` lock and
`record_repeater_samples(...)`. Gated on the existing `tracked_telemetry_repeaters`
opt-in list and existing interval — **no new setting or scheduler**. Per-target
failures logged and skipped. `prune()` runs once per cycle.

### 4.5 Capture site C — my-node, passive (regular traffic)

In `_process_advertisement` (`app/packet_processor.py:532`), when
`packet_info.path_length == 0` and `is_new_packet` (exclude relayed copies),
`record_traffic_sample(observer=<companion own pubkey>, subject=advert.public_key,
snr, rssi, observed_at=timestamp)`. The companion's own pubkey comes from radio
config; if unavailable, use the sentinel `"self"`. Best-effort (never disrupts
packet processing). This reuses fully-decoded data already in hand — no extra
radio traffic, low volume (advert cadence is minutes).

**Retention for traffic-only deployments:** because sites A/B may never run if the
user never opens a repeater and tracks nothing, the traffic path enforces a
throttled prune: keep a module-level last-prune timestamp and call
`prune()` at most once per hour from `record_traffic_sample`. This bounds growth
without a dedicated scheduler.

### 4.6 Endpoint

`GET /contacts/{public_key}/repeater/neighbors/history?since_hours=<int>`
(default 720 = 30 days, clamped to 720). Pure DB read — does **not** require the
radio to be connected.

Response `RepeaterNeighborHistoryResponse`:
```
{
  "neighbors": [
    {
      "neighbor_pubkey": "aabbccdd",
      "repeater_samples": [ {"observed_at":..., "snr":..., "secs_ago":...}, ... ],
      "self_samples":     [ {"observed_at":..., "snr":..., "rssi":...}, ... ]
    },
    ...
  ]
}
```
- `repeater_samples`: from `get_repeater_history` (repeater's view).
- `self_samples`: from `get_traffic_history_for_subjects`, matched to each
  neighbor prefix (my node's view, when my companion also hears that node).
- Sample models: `RepeaterSignalSample {observed_at, snr, secs_ago|null}` and
  `SelfSignalSample {observed_at, snr, rssi|null}`.

### 4.7 Frontend

- `api.ts`: `repeaterNeighborHistory(publicKey, sinceHours?)`.
- `types.ts`: sample + response types (both series).
- `useRepeaterDashboard.ts`: fetch history alongside neighbors (same pane
  refresh); expose per-neighbor `{repeaterSamples, selfSamples}`. Cache like
  other panes.
- `RepeaterNeighborsPane.tsx`:
  - Inline **SVG sparkline** per row (hand-rolled, matching `MyNodeView.tsx`'s
    inline-SVG approach), showing the **repeater-view** series when ≥2 samples;
    otherwise nothing / a muted placeholder.
  - Clicking a neighbor row opens a **detail SNR-over-time chart** modeled on
    `RepeaterTelemetryHistoryPane.tsx`, overlaying the repeater-view series and
    (when present) the my-node-view series, with a legend, sample counts, and
    time range. SNR-color thresholds consistent with the table.
- i18n: new EN/NL/DE keys (sparkline/detail titles, legend labels
  "repeater→neighbor" / "my node→neighbor", sample count, empty states). NL/DE
  machine-drafted with `_meta.review`, per convention. Enforced by
  `i18next/no-literal-string`.

### 4.8 Docs

Update `docs/parity-audit.md`: change the two neighbor rows from **Absent** to
reflect what is shipped; note `scopes`/`status` are companion-unreachable
(firmware/MQTT-only → L3) and room-server opcode absent; add X2b (per-link signal
history, two perspectives) as the built increment.

## 5. Data flow

```
ACTIVE (repeater's view)                    PASSIVE (my node's view)
fetch_all_neighbours (repeater-only)        0-hop ADVERT reception
  pubkey-prefix, secs_ago, snr                advert.public_key, snr, rssi
        │                                            │
  endpoint (opportunistic) ─┐          _process_advertisement (path_len==0)
  tracked cycle (periodic) ─┤                        │
        ▼                    ▼                        ▼
 record_repeater_samples          record_traffic_sample (+ throttled prune)
        └──────────────┬───────────────────────────┘
                       ▼
                 link_signal table  ──prune(30d)
                       │
     GET /repeater/neighbors/history (DB read; joins both perspectives by prefix)
                       ▼
     useRepeaterDashboard → NeighborsPane sparkline + detail chart (overlay)
```

## 6. Error handling

- All three capture writes are best-effort: caught, logged, never affect the
  neighbors response, the telemetry cycle, or packet processing.
- History endpoint with no rows: `{ "neighbors": [] }` (200), not 404.
- Sparkline with <2 samples: not rendered (avoids a misleading single point).
- Detail chart: show whichever series has data; if only one perspective exists,
  render it alone (no empty second axis).

## 7. Testing

Backend (`./.venv/Scripts/python.exe -m pytest`, `PYTHONUTF8=1`):
- Repository: `record_repeater_samples` (row-per-neighbor, empty no-op);
  `record_traffic_sample`; `get_repeater_history` window+grouping;
  `get_traffic_history_for_subjects` prefix match; `prune` deletes only old rows
  and returns count.
- Endpoint: joins both perspectives per neighbor; empty when no rows;
  `since_hours` clamping.
- Site A: endpoint call persists repeater samples; forced write error does not
  fail the response.
- Site B: tracked cycle persists repeater samples for a tracked repeater and
  calls prune (mock `fetch_all_neighbours`).
- Site C: a 0-hop advert persists a traffic sample; a >0-hop advert does not;
  throttled prune fires at most once per hour.
- The ~6 broker-connecting `test_fanout_integration` tests fail on Windows
  (ProactorEventLoop `add_writer`) — pre-existing env issue, not a regression.

Frontend (`npm run lint`, `tsc`, `vitest run --testTimeout=30000`):
- Sparkline renders with ≥2 repeater samples; none with <2.
- Detail chart overlays both series; renders one alone when only one exists.
- i18n parity (EN/NL/DE key counts equal; new keys resolve).

## 8. Migration-race and coordination notes

- Re-run `git ls-tree --name-only origin/main app/migrations/` immediately before
  creating the migration; if `_075` is taken, use the next free number and update
  `LATEST_SCHEMA_VERSION` accordingly.
- Branch: `feat/repeater-neighbor-signal-history` off `origin/main`.
- No commits until explicitly instructed (project git rule overrides the skill's
  default-commit step).
