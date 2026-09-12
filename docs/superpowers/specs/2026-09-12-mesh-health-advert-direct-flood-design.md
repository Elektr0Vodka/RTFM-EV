# Mesh-health advert direct/flood split + dedup

Date: 2026-09-12
Status: approved (design)
Branch: claude/mesh-health-advert-dedup-5994b8

This is spec 1 of 3 from the request "check mesh health... distinction between direct
and flood adverts... dedupe the same advert received over different paths." The other
two (map links from advert-path truth + confidence toggle; FAB declutter) are separate
specs and are out of scope here.

## Problem

The mesh-health view shows a single `advert_count` per contact. Two defects:

1. No direct-vs-flood distinction. A node heard directly (0-hop RF neighbour) looks the
   same as one only reached via relays.
2. The same advert transmission, flooded to us over several paths, is not cleanly counted
   once. The current query sums a per-path expression over `contact_advert_paths` and
   mixes `heard_count` (increments on every copy) with `last_primary_seen` logic, so the
   count is inflated by multi-path arrival.

## Key facts established during exploration

- `raw_packets` dedupes on `sha256(payload)` with routing/path bytes stripped
  (`extract_payload`), via `INSERT OR IGNORE` on a unique `payload_hash`
  (`app/repository/raw_packets.py:38`). Therefore:
  - The same advert flooded over N paths shares one payload hash. The first copy is
    `is_new_packet=True`; the rest are `False`. All copies resolve to the **same**
    `raw_packets.id` (duplicates return the existing row id). That id is a natural
    "transmission id".
  - Adverts carry an in-payload timestamp, so two different transmissions from one node
    hash differently. Count of distinct transmissions = count of `is_new_packet=True`
    adverts.
- `contact_advert_paths` is keyed `(public_key, path_hex, path_len)`. `path_len = 0` is a
  direct (0-hop) reception; `path_len > 0` is relayed. It stores only `last_primary_seen`
  (a single timestamp per path row), not a per-window count, so exact windowed unique
  counts cannot be reconstructed from it.
- Definitional tension: direct reception is proven by any `path_len = 0` copy regardless
  of payload dedup. If a transmission arrives both direct and relayed, only the
  first-arriving copy is `is_new`, so classification must be by **minimum path length seen
  across all copies of a transmission**, not by whichever copy happened to arrive first.

## Decisions (from brainstorming)

- Output: two counts per contact, **Direct** and **Flood**, plus their sum (unique total).
  Alerts fire on the deduped unique total; thresholds stay HIGH > 8, MEDIUM > 2 (they now
  mean unique transmissions, so effectively stricter than today's inflated counts).
- Data model: a new `advert_events` table, one row per unique advert transmission.
- Dedup key: the primary copy's `raw_packets.id` (the transmission id).
- Classification: `min_path_len` maintained across copies. `Direct = min_path_len 0`,
  `Flood = min_path_len > 0`. Mutually exclusive; sum to the unique total.
- Backfill: approximate, seeded from `contact_advert_paths` (per-path, not per-transmission).
- Schema includes `path_hex` and `hop_width` now, so the later map-links spec can consume
  `advert_events` without a second migration.
- Retention is **configurable in the Database settings page** (default 30 days), enforced
  by a daily background prune.

## Data model

New table (migration `_080_create_advert_events.py`; `_078` is the last existing one):

```sql
CREATE TABLE advert_events (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    transmission_id INTEGER,           -- raw_packets.id of the payload; NULL for backfill
    public_key     TEXT NOT NULL,      -- advertiser pubkey, full 64-hex, lowercased
    first_seen     INTEGER NOT NULL,   -- server receive ts of the first copy
    min_path_len   INTEGER NOT NULL,   -- smallest hop count across copies; 0 = direct
    path_hex       TEXT,               -- path of the shortest-observed copy ('' for direct)
    hop_width      INTEGER             -- per-hop address byte width 1/2/3; NULL for direct
);
CREATE UNIQUE INDEX ux_advert_events_txid ON advert_events(transmission_id);
CREATE INDEX ix_advert_events_pk_seen ON advert_events(public_key, first_seen);
CREATE INDEX ix_advert_events_seen ON advert_events(first_seen);
```

Notes:
- SQLite allows multiple NULLs in a UNIQUE index, so backfilled rows (NULL
  `transmission_id`) never conflict, while live upserts conflict correctly on the id.
- `hop_width` derives from `(len(path_hex) / 2) / path_len` bytes when `path_len > 0`
  (same derivation the existing `relay-pairs` endpoint uses). RT does not store a per-path
  hash mode; the width comes from the path hex length.

## Write path

`AdvertEventRepository.record(...)` called from `_process_advertisement`
(`app/packet_processor.py:572`), after the signature check, on **every** advert reception
(not gated on `is_new_packet`), so a later direct copy can lower `min_path_len`:

```sql
INSERT INTO advert_events
    (transmission_id, public_key, first_seen, min_path_len, path_hex, hop_width)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(transmission_id) DO UPDATE SET
    path_hex  = CASE WHEN excluded.min_path_len < advert_events.min_path_len
                     THEN excluded.path_hex ELSE advert_events.path_hex END,
    hop_width = CASE WHEN excluded.min_path_len < advert_events.min_path_len
                     THEN excluded.hop_width ELSE advert_events.hop_width END,
    min_path_len = MIN(advert_events.min_path_len, excluded.min_path_len),
    first_seen = MIN(advert_events.first_seen, excluded.first_seen)
```

Inputs available at the call site: `packet_id` (transmission id), `advert.public_key`,
`timestamp`, `packet_info.path_length`, `packet_info.path.hex()`, and the derived
`hop_width`.

## Backfill (in the migration)

For each `contact_advert_paths` row, insert one approximate event:
`transmission_id = NULL`, `public_key = cap.public_key`,
`first_seen = COALESCE(cap.last_primary_seen, cap.first_seen)`,
`min_path_len = cap.path_len`, `path_hex = cap.path_hex`, `hop_width` derived. This
populates recent windows immediately; the split is per-path (approximate) as agreed. The
migration is idempotent (create-if-absent; backfill only when the table was just created).

## Endpoint changes: `GET /api/packets/mesh-health` (`app/routers/packets.py:598`)

Recompute per-contact aggregates from `advert_events` over `[start_ts, end_ts)`:

- `direct_count = COUNT(*) WHERE min_path_len = 0`
- `flood_count = COUNT(*) WHERE min_path_len > 0`
- `advert_count = direct_count + flood_count` (deduped unique total; field name kept)
- `first_seen`, `last_seen`, `min_path_len` from `advert_events`; `name/lat/lon` joined
  from `contacts`.

Contacts included: those with at least one `advert_event` in the window. Alerts use
`advert_count`; `adverts_per_hour = advert_count / window_hours`. `MeshHealthContact`
gains `direct_count` and `flood_count`. `MeshHealthAlert` is unchanged (its `advert_count`
is now the deduped total).

## Retention setting + prune

New app setting `advert_retention_days` (single-row `app_settings` columnar pattern):

- Migration `_079` also `ALTER TABLE app_settings ADD COLUMN advert_retention_days
  INTEGER DEFAULT 30`.
- `app/models.py` `AppSettings`: add `advert_retention_days: int = 30`.
- `AppSettingsRepository._get_in_conn` (SELECT + parse with guard), `_apply_updates`, and
  `update(...)` gain the field.
- `app/routers/settings.py` `AppSettingsUpdate`: add
  `advert_retention_days: int | None = Field(default=None, ge=1, le=365, ...)`.
- Frontend `types.ts`: add to `AppSettings` and `AppSettingsUpdate`.
- Frontend Database section (`SettingsDatabaseSection.tsx`): a small "Mesh health history"
  subsection with a number input (1-365) bound to `appSettings.advert_retention_days`,
  persisted via the existing `persistAppSettings` optimistic-with-revert helper.

Prune: a daily background loop, following the `_periodic_sync_loop` idiom in
`app/radio_sync.py` (created in the `lifespan` in `app/main.py`, cancelled on shutdown).
Each tick reads `advert_retention_days` and deletes `advert_events` with
`first_seen < now - days * 86400`. Runs once shortly after startup and then daily.

## Frontend view: `MeshHealthView.tsx`

- Table: replace the single "Adverts" column with **Direct** and **Flood** (both
  sortable), and keep a **Total** column (the unique sum). New `SortKey` values
  `direct_count`, `flood_count`.
- One summary tile showing the window's Direct vs Flood split (reuse `DistBars` or a
  compact stat). The existing hop-distance and hash-mode distributions are unchanged.
- `MeshHealthContact` TS interface gains `direct_count`, `flood_count`.
- New i18n keys (column headers, tile labels, retention setting labels/help) added to
  EN, NL, DE (parity test + eslint enforce this).

## Units / boundaries

- `AdvertEventRepository` (new, `app/repository/`): `record(...)` and a windowed
  aggregation query helper. Independently testable.
- `_080_create_advert_events.py`: table + indexes + `app_settings` column + backfill.
- Endpoint recompute in `packets.py` (mesh-health only).
- Settings plumbing (`AppSettings`, repository, `AppSettingsUpdate`, frontend types +
  Database section input).
- Daily prune loop (`radio_sync.py` idiom, wired in `main.py` lifespan).
- Frontend view columns + i18n.

## Verification (per CLAUDE.md "never claim it works")

Backend, run in the `rtfm-ev-local` container against `/app/.venv` (worktree bind-mounted
to `/work`):

- New migration test (`tests/test_migrations/test_migration_080.py`): table + column
  exist; backfill seeds one event per path row with correct `min_path_len`; idempotent.
- `AdvertEventRepository` test: a flood copy then a direct copy of the same
  `transmission_id` yields `min_path_len = 0` and one row (dedup); windowed aggregation
  returns correct direct/flood counts.
- Extended `tests/test_mesh_health_endpoints.py`: direct-only, flood-only, and mixed
  contacts produce correct `direct_count`/`flood_count`/`advert_count`; alert fires on the
  deduped total; window filtering respected.

Frontend:

- `MeshHealthView` test: Direct/Flood/Total columns render and sort; retention input
  round-trips through `persistAppSettings`.
- `prettier --check` (separate CI gate) and the i18n parity test must pass.

Runtime (observed, not reasoned):

- Rebuild the `rtfm-ev-local` container on this branch and open the mesh-health view with
  real data. Confirm Direct/Flood columns populate, the sum matches the old single count's
  intent (deduped, not inflated), and the retention input saves and reloads. Confirm the
  prune loop starts (log line) without error.

## Out of scope / follow-ups

- Map links from advert-path truth + 1b/2b/3b confidence toggle: separate spec; will
  consume `advert_events.path_hex` / `hop_width`.
- FAB declutter: separate spec.
- Exact (non-approximate) historical backfill: not attempted; new adverts are exact from
  deploy.
