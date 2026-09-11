# [14] Historical device-info persistence

Date: 2026-09-10
Status: draft for review
Category: H (Persistence), see `docs/plans/README.md`
Model: Sonnet
State: Partial (extends shipped signal-storage foundation + existing telemetry
history tables)

Scope: local planning only. No code changes, no migrations, no commits/PRs/issues
from this document.

---

## 1. Summary

RTFM-EV already has two historical stores that this plan builds on: raw-packet
signal history (`raw_packets.rssi/snr/payload_type`, shipped PR #12) and
telemetry snapshot history (`repeater_telemetry_history` /
`contact_telemetry_history`, migrations `_050`/`_062`). What is still
latest-only is contact **identity metadata that changes over time but is
overwritten in place**: location (`lat`/`lon`), and the four
CLI/binary-request repeater panes (node-info, radio-settings, regions,
owner-info/firmware, advert-intervals) that are fetched on demand and returned
to the frontend but never written to the database at all.

This plan proposes:
- A new append-on-change **contact location history** table, using the same
  shape and capture points as the existing `contact_name_history` table
  (fact: this table and pattern already exist and are cited below).
- A new append-on-fetch **repeater config snapshot** table that stores the
  already-fetched CLI/binary-request pane responses (node-info,
  radio-settings, regions, owner-info, advert-intervals) as JSON blobs keyed
  by a `kind` discriminator, mirroring the existing
  `repeater_telemetry_history` JSON-blob shape rather than inventing four
  separate typed tables.
- Read endpoints and retention rules modeled directly on the two existing
  history tables (telemetry: age + count cap pruned on every write; raw
  packets: manual `POST /api/packets/maintenance`).
- Explicit de-confliction with the fork-port "My Node / MeshHealth" idea and
  with plan [11] (DMC MQTT ingestion / NOC), since both are consumers of this
  data, not owners of the schema.

Next free migration number, verified against `origin/main`: **`_069`**
(`git ls-tree -r --name-only origin/main app/migrations` shows `_068_add_registry_sync_url.py`
as the highest; the local worktree matches).

## 2. Current state

### 2a. Already historical (do not duplicate)

| Data | Table | Migration | Capture point | Retention |
|---|---|---|---|---|
| Raw packet signal/type | `raw_packets.rssi/snr/payload_type` | `app/migrations/_065_add_raw_packet_signal_columns.py` | `RawPacketRepository.create()` (`app/repository/raw_packets.py:16`), called from `packet_processor.py` after `parse_packet()` | Manual: `POST /api/packets/maintenance` (`app/routers/packets.py:732-775`) - `prune_undecrypted_days` + `purge_linked_raw_packets` + `VACUUM` |
| Advert-path best signal | `contact_advert_paths.best_rssi/best_snr` | `app/migrations/_066_add_advert_path_signal.py` | `ContactAdvertPathRepository.record_observation()` (`app/repository/contacts.py:752-798`) - NULL-safe `MAX()` on conflict | Row count cap: only the 10 most recent unique `(public_key, path_hex, path_len)` rows kept per contact (`app/repository/contacts.py:800-815`), confirmed also in `AGENTS.md` §"Contact Advert Path Memory" |
| Repeater telemetry (status/battery/airtime/LPP) | `repeater_telemetry_history` | `app/migrations/_050_repeater_telemetry_history.py` | `RepeaterTelemetryRepository.record()` (`app/repository/repeater_telemetry.py:18-56`), called from `POST /contacts/{key}/repeater/status` (`app/routers/repeaters.py:163-168`) and the auto-collect loop in `radio_sync.py` (per `app/AGENTS.md` §"Fanout bus") | Auto: 30-day age cutoff (`_MAX_AGE_SECONDS`) + 1000-row cap per repeater, both applied inside `record()` on every insert |
| Contact LPP telemetry | `contact_telemetry_history` | `app/migrations/_062_contact_telemetry_history.py` | `ContactTelemetryRepository.record()` (`app/repository/contact_telemetry.py:16-56`) - same shape/limits as repeater telemetry | Same as above (30 days / 1000 rows) |
| Contact name changes | `contact_name_history` | `app/migrations/_024_create_contact_name_history.py` | `ContactNameHistoryRepository.record_name()` (`app/repository/contacts.py:874-886`), called via `record_contact_name_and_reconcile()` (`app/services/contact_reconciliation.py:93-133`) from advert ingest (`app/packet_processor.py:634`), the `CONTACT_MSG_RECV` fallback (`app/event_handlers.py:272`), and contact create/sync (`app/routers/contacts.py:290,331`) | Unbounded, but naturally small: `UNIQUE(public_key, name)` upserts `last_seen` instead of growing per-observation (`app/database.py:96-104`) |
| Read surface | `GET /api/packets/recent`, `/timeseries`, `/historical-stats`; `GET /contacts/{key}/repeater/telemetry-history`; `GET /contacts/{key}/telemetry-history` | - | `app/routers/packets.py:150-554`, `app/routers/repeaters.py:197-208`, contacts router (contact telemetry-history endpoint) | Read-only, no radio access required |

### 2b. Latest-only today (candidates for history)

| Field/data | Where stored | Overwrite behavior | Evidence |
|---|---|---|---|
| Contact `lat`/`lon` | `contacts.lat`, `contacts.lon` | `ON CONFLICT` upsert uses `COALESCE(excluded.lat, contacts.lat)` - a new non-NULL value (including the `0.0` "no GPS" sentinel) always overwrites the stored value, no history kept | `app/repository/contacts.py:96-97`; documented as intentional in `app/AGENTS.md` §"Errata & Known Non-Issues" → "Contact lat/lon 0.0 vs NULL" |
| Contact `direct_path`/`direct_path_len`/`direct_path_hash_mode` (learned route) | `contacts.direct_path*` | `UPDATE ... SET direct_path = ?` on every new PATH observation (`ContactRepository.update_direct_path`, `app/repository/contacts.py:370-415`); no history of prior routes | `app/repository/contacts.py:370-415` |
| Repeater node-info (name, lat, lon, clock) | Not persisted at all - returned directly in the response | `RepeaterNodeInfoResponse` built from a live CLI batch (`get name`/`get lat`/`get lon`/`clock`) with no repository write | `app/routers/repeaters.py:316-333`; response model `app/models.py:594-600` |
| Repeater radio settings (firmware version, radio params, tx power, airtime factor, duty cycle, repeat/flood settings) | Not persisted | Live CLI batch only | `app/routers/repeaters.py:336-365`; response model `app/models.py:603-620` |
| Repeater advert intervals | Not persisted | Live CLI batch only | `app/routers/repeaters.py:368-385`; response model `app/models.py:623-627` |
| Repeater owner info / firmware / name (binary request) + guest password | Not persisted | Live binary request + CLI, no write | `app/routers/repeaters.py:388-415`; response model `app/models.py:630-646` |
| Repeater region hierarchy / flood-allowed scopes | Not persisted | Live CLI dump or anon fallback, no write | `app/routers/repeaters.py:536-566`; response model `app/models.py:658-675` |
| Contact `type`, `flags`, `on_radio`, `favorite` | `contacts.type/flags/on_radio/favorite` | Latest-only columns, upsert-overwritten | `app/database.py:14-35` |

**Fact, not assumption**: none of the five repeater CLI/binary-request panes
(node-info, radio-settings, advert-intervals, owner-info, regions) call any
`*Repository` write method - confirmed by reading every handler in
`app/routers/repeaters.py:316-566`. This is a genuine gap, not an oversight
this plan needs to guess at: repeater `status` (telemetry) is the only pane
wired to persistence today.

### 2c. Global (not per-device) region/scope state

`app_settings.known_regions` and `app_settings.flood_scope` are app-wide
settings, not per-contact history (`app/database.py:106-125`, `app/AGENTS.md`
§"Region scope decoding"). A repeater's own region hierarchy (2b, last row) is
per-device and currently has no persistence at all, historical or otherwise -
this plan's "regions" gap is about that per-repeater fetch result, not the
global list.

## 3. Design

### 3a. Schema - two new tables, not one generic table and not five targeted tables

**Decision: two tables**, matching the two different change patterns already
established elsewhere in this codebase:

1. **`contact_location_history`** - append-on-change, same shape as
   `contact_name_history`. Location changes are a single (lat, lon) pair
   observed from adverts/contact sync, exactly like names, so the existing
   pattern (`app/database.py:96-104`, `app/repository/contacts.py:873-886`)
   is the direct precedent. A generic table would need a JSON payload for a
   fact that is naturally two REAL columns - worse for the
   "nearest-repeaters"/map-trend queries this is meant to feed.

   ```sql
   CREATE TABLE IF NOT EXISTS contact_location_history (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_key TEXT NOT NULL,
       lat REAL NOT NULL,
       lon REAL NOT NULL,
       first_seen INTEGER NOT NULL,
       last_seen INTEGER NOT NULL,
       UNIQUE(public_key, lat, lon),
       FOREIGN KEY (public_key) REFERENCES contacts(public_key) ON DELETE CASCADE
   );
   CREATE INDEX IF NOT EXISTS idx_contact_location_history_key
       ON contact_location_history(public_key, last_seen DESC);
   ```

   OPEN QUESTION: exact-value `UNIQUE(lat, lon)` will not coalesce GPS jitter
   (e.g. `52.123401` vs `52.123402` on every advert) the way name dedup does
   naturally (names rarely change by one character repeatedly). Rounding to
   ~4-5 decimal places (≈11m/1m precision) before the uniqueness check is a
   reasonable mitigation, but the right precision is a product decision, not
   something to invent here - ask before implementing.

2. **`device_config_history`** - a single append-on-fetch table for the four
   currently-unpersisted repeater panes plus room-server equivalents, with a
   `kind` discriminator, JSON-blob payload, and the *same* shape as
   `repeater_telemetry_history`/`contact_telemetry_history`
   (`app/database.py:140-146`). This is the "generic table" half of the
   design, justified because:
   - The four response shapes (`RepeaterNodeInfoResponse`,
     `RepeaterRadioSettingsResponse`, `RepeaterAdvertIntervalsResponse`,
     `RepeaterOwnerInfoResponse`, `RepeaterRegionsResponse`) are all small,
     heterogeneous, CLI-string-keyed dicts (`app/models.py:594-675`) - exactly
     the shape the existing telemetry tables already store as JSON rather
     than as typed columns.
   - These panes change rarely (firmware upgrade, admin reconfiguration), so
     one row per fetch is cheap, and a single table avoids four more
     near-identical migrations/repositories for what is structurally the
     same "snapshot of a CLI response" operation already proven by
     `RepeaterTelemetryRepository`.

   ```sql
   CREATE TABLE IF NOT EXISTS device_config_history (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       public_key TEXT NOT NULL,
       kind TEXT NOT NULL,       -- 'node_info' | 'radio_settings' | 'advert_intervals'
                                 -- | 'owner_info' | 'regions'
       timestamp INTEGER NOT NULL,
       data TEXT NOT NULL,       -- JSON-serialized response model
       FOREIGN KEY (public_key) REFERENCES contacts(public_key) ON DELETE CASCADE
   );
   CREATE INDEX IF NOT EXISTS idx_device_config_history_pk_kind_ts
       ON device_config_history(public_key, kind, timestamp DESC);
   ```

   Append-on-**change**, not append-on-every-fetch: before inserting, compare
   the new JSON blob to the most recent row for `(public_key, kind)` and skip
   the insert if identical. This differs from telemetry (which inserts
   unconditionally because every sample is expected to differ) because CLI
   config panes are typically static between admin actions - inserting an
   identical row on every "Load All" click would be pure bloat with no
   trend value.

   Migration: new file `app/migrations/_069_device_history.py` (per-file
   package format, matching every existing migration in
   `app/migrations/_050_repeater_telemetry_history.py` and
   `_062_contact_telemetry_history.py`), creating both tables above in one
   migration since they ship together.

Rejected alternative: one fully generic `device_history(public_key, kind,
timestamp, data)` table covering *both* location and config. Rejected because
location needs indexed numeric columns for map/trend queries (the historical
neighbor-by-signal query pattern in `app/routers/packets.py:482-515` is the
kind of query this should support), and stuffing lat/lon into a JSON blob
would force `json_extract()` on every such query for no benefit over the
existing two-column pattern already used by name history.

### 3b. Capture points

| Table | Capture point | Trigger |
|---|---|---|
| `contact_location_history` | New `ContactLocationHistoryRepository.record_location()`, called from the same three call sites as `record_contact_name_and_reconcile()` (`app/packet_processor.py:634`, `app/event_handlers.py:272`, `app/routers/contacts.py:290,331`) - likely by extending `record_contact_name_and_reconcile()` itself (or a sibling `record_contact_location`) in `app/services/contact_reconciliation.py:93-133` so both fire from one reconciliation call | Advert received with non-null/non-sentinel lat/lon, or contact sync from radio |
| `device_config_history` | One insert at the end of each of the five repeater-pane handlers in `app/routers/repeaters.py` (`repeater_node_info`, `repeater_radio_settings`, `repeater_advert_intervals`, `repeater_owner_info`, `repeater_regions`), mirroring the existing `RepeaterTelemetryRepository.record()` call already present in `repeater_status` (`app/routers/repeaters.py:163-168`) | Each successful on-demand fetch (user opens/refreshes a repeater dashboard pane) |

OPEN QUESTION: should room-server panes (`app/routers/rooms.py` - status,
ACL, LPP telemetry) get the same `device_config_history` treatment? The task
description scopes this to "device identity, name, location, radio settings,
region/scope, firmware, and telemetry" without naming rooms explicitly, and
`app/AGENTS.md`'s API summary lists room panes as a smaller, separate set
(`room/login`, `room/status`, `room/lpp-telemetry`, `room/acl`). Recommend
scoping the first slice to repeaters only and treating room-server history as
a fast-follow using the same `kind` discriminator, but this needs sign-off
before implementation.

### 3c. Retention / pruning

Two different existing precedents to choose from, and this plan recommends
different rules for the two new tables:

- **`contact_location_history`**: unbounded like `contact_name_history`
  (`app/database.py:96-104`). Location changes are rare (unlike telemetry
  samples), so row growth is naturally small per contact. No pruning needed
  at this scale; revisit if the rounding fix in 3a still produces high churn
  from a moving node.
- **`device_config_history`**: same age+count pruning as
  `RepeaterTelemetryRepository.record()` (`app/repository/repeater_telemetry.py:23-56`)
  - 30-day age cutoff and a per-`(public_key, kind)` row cap (suggest 200,
  looser than telemetry's 1000 since config changes far less often),
  applied inside the repository's `record()` method on every insert, not as
  a separate maintenance step. This matches the "mirror the packet
  maintenance/vacuum approach" instruction only partially: packet
  maintenance (`POST /api/packets/maintenance`,
  `app/routers/packets.py:732-775`) is a manual, operator-triggered
  VACUUM+prune because `raw_packets` is high-volume and disk-heavy (BLOB
  payloads). `device_config_history` rows are small JSON snapshots at a low
  write rate, so the telemetry tables' automatic on-write pruning is the
  better-fitting precedent, not the packet-maintenance one. No new VACUUM
  hook is needed for this table; it can ride along the next time
  `POST /api/packets/maintenance` is invoked (VACUUM reclaims space
  database-wide) without adding table-specific logic there.

### 3d. Read endpoints and typed contracts

Mirror the existing telemetry-history GET pattern exactly
(`app/routers/repeaters.py:197-208`):

```
GET /api/contacts/{public_key}/location-history
    -> list[ContactLocationHistoryEntry]  # {lat, lon, first_seen, last_seen}

GET /api/contacts/{public_key}/repeater/config-history?kind={kind}
    -> list[DeviceConfigHistoryEntry]     # {kind, timestamp, data: <the matching response model>}
```

Typed contracts (new, in `app/models.py`, next to the existing
`TelemetryHistoryEntry`):

```python
class ContactLocationHistoryEntry(BaseModel):
    lat: float
    lon: float
    first_seen: int
    last_seen: int

class DeviceConfigHistoryEntry(BaseModel):
    kind: Literal["node_info", "radio_settings", "advert_intervals", "owner_info", "regions"]
    timestamp: int
    data: dict  # JSON-decoded; frontend re-validates against the matching *Response shape
```

Read-only, no radio access required - same guarantee as
`GET /contacts/{public_key}/repeater/telemetry-history`
(`app/AGENTS.md` API surface table).

### 3e. Frontend consumption (out of scope for backend-only first slice, noted for phasing)

`RepeaterTelemetryHistoryPane.tsx` (`frontend/AGENTS.md` §Frontend Map,
`components/repeater/`) is the existing precedent for a "chart/table of
history" pane. A future `RepeaterNodeInfoPane`/`RepeaterRadioSettingsPane`
diff view, or a dedicated "My Node" history tab (see §5), would follow the
same fetch-and-render shape. No frontend changes are proposed in this plan's
first slice.

## 4. Phasing (first slice)

Smallest change that unblocks trending without speculative scope:

1. Migration `_069_device_history.py`: both tables (3a). Single migration
   because they ship together and are small/independent of each other.
2. `ContactLocationHistoryRepository` (new file or added to
   `app/repository/contacts.py` next to `ContactNameHistoryRepository`,
   following the existing convention of co-locating small per-contact
   history repositories in that file).
3. Wire location capture into `record_contact_name_and_reconcile()` (rename
   or add a sibling) so it fires from the three existing call sites - no new
   call sites needed, this is a "smallest change" argument for reusing the
   name-history wiring rather than inventing a fourth capture point.
4. `DeviceConfigHistoryRepository` (new file
   `app/repository/device_config_history.py`, following the one-repository-
   per-table convention already used for `repeater_telemetry.py`/
   `contact_telemetry.py`).
5. Wire one `record()` call into each of the five repeater-pane handlers in
   `app/routers/repeaters.py`, matching the existing `repeater_status`
   pattern.
6. Two new GET endpoints (3d) plus the two new Pydantic models.
7. Tests: extend `tests/test_repository.py` (per `app/AGENTS.md` test-suite
   list) for both new repositories, and `tests/test_repeater_routes.py` for
   the new capture-on-fetch behavior, matching how `test_repeater_telemetry.py`
   already tests `RepeaterTelemetryRepository.record()` wiring.

Deferred to a later slice: frontend panes/diff views, room-server config
history (3b open question), any pruning UI/maintenance-endpoint surfacing
for `device_config_history` (3c already argues automatic pruning suffices).

## 5. De-confliction

**With fork-port "My Node / MeshHealth" (Phase 3, per `rtfm-ev-fork-port-plan`
memory)**: That backlog item is explicitly described as consuming the
already-shipped `/recent`, `/timeseries`, and `/historical-stats` packet
endpoints (`app/routers/packets.py`) to build a local-node history/health UI.
This plan does not touch those endpoints or raw-packet signal history at
all - it only adds contact-location and repeater-config history, which are
new data sources those future pages could *also* read from once built, but
this plan does not implement or scope any "My Node" page. No schema overlap:
Phase 3 reads from `raw_packets`/`contact_advert_paths`; this plan adds
`contact_location_history`/`device_config_history`. Sequencing: Phase 3's
scoped work (packet-feed history, My Node, MeshHealth UI) can proceed
independently of this plan, but if it wants to show "device config over
time" it should consume `device_config_history` from this plan rather than
inventing a second store.

**With plan [11] (DMC MQTT ingestion + "My Local Nodes / My Mesh NOC",**
`docs/plans/README.md` §F**)**: Plan [11] is explicitly listed in the README
dependency graph as informed by [14] (`[14] historical-device-info ──┐ ├──
informs telemetry panels in [11] NOC`). This plan's `device_config_history`
table is a natural sink for MQTT-ingested `config`/`status` topic payloads
from DMC-MQTT-Repeater/Observer nodes (per `docs/sources-of-truth.md`
§"DMC-MeshCore" - six topic types including `config`(5)) if [11] chooses to
reuse it rather than build a parallel history store for MQTT-sourced device
info. This is a recommendation for [11]'s authors, not a decision made here:
[11] ingests from a different transport (inbound MQTT vs. host-initiated CLI
fetch) and may reasonably want its own `kind` values in the same
`device_config_history` table (e.g. `kind='mqtt_config'`) rather than a
separate table, keeping one place to query "everything we know about this
device's config over time" regardless of transport.

**With plan [10] (DMC firmware-aware management)**: not directly related -
[10] is about gating *which* CLI commands are offered based on detected
firmware, not about storing results. No conflict.

**With plan [18] (multi-radio identity, added 2026-09-11)**: [18]'s general
contact identity merge (`merge_contact_identity(old_key -> new_key)`) MUST
re-key this plan's `contact_location_history` rows in the same transaction as it
re-keys `messages`/`link_signal`/telemetry. When [14] is built, its
`public_key` column and `ON DELETE CASCADE` FK make it one more child table the
[18] merge has to cover; [14] should be listed in [18] §3d's re-key set (it is).
If a per-radio notion of `device_config_history` is ever wanted, key it to
[18]'s `radio_identities` rather than inventing a second registry.

**With plan [19] (analyzer-grade persistence/retention, added 2026-09-11)**:
[19] owns the retention *policy*; [14] owns the *capture*. This plan's proposed
retention rules (unbounded location history; 30-day + per-kind cap on
`device_config_history`, §3c) should be expressed as [19] policy fields rather
than hard-coded here, so the operator's "analyzer mode" preset governs them.
[19] Phase 2 is, in effect, this plan's implementation slot. Build [14]'s
capture and [19]'s policy knob together.

## 6. Risks / open questions

- **DB growth**: `device_config_history` growth is bounded by fetch frequency
  (user-initiated dashboard opens) and the change-detection skip (3a), so
  worst case is one row per pane per admin session - much lower volume than
  `raw_packets` or telemetry. `contact_location_history` growth depends on
  how often adverts carry a genuinely different lat/lon; see the rounding
  OPEN QUESTION in 3a - without it, a mobile/vehicle-mounted node could
  write one row per advert forever. **This must be resolved before
  implementation**, not deferred, because it directly determines whether
  `contact_location_history` needs the same age/count pruning as telemetry
  or can stay unbounded like name history.
- **Capture-on-fetch vs. capture-on-push**: repeater config panes are only
  captured when a user manually opens/refreshes that dashboard pane
  (`app/routers/repeaters.py`), so `device_config_history` will have gaps
  for repeaters nobody has checked recently - it is not a background poll.
  This is consistent with how those endpoints already work (single-attempt,
  no server-side retry, per `frontend/AGENTS.md` §"Repeater Dashboard"), but
  it means "historical device info" here is best-effort/observation-driven,
  not a guaranteed periodic audit trail. If periodic auto-collection is
  wanted (mirroring the telemetry auto-collect loop in `radio_sync.py`),
  that is materially more scope (new periodic task, radio-lock contention
  with existing sync loops) and should be a separate follow-up decision, not
  assumed here.
- **`ON DELETE CASCADE` and contact deletion**: `ContactRepository.delete()`
  explicitly preserves messages but relies on FK cascade for
  `contact_name_history`/`contact_advert_paths` (`app/repository/contacts.py:496-503`).
  The two new tables should follow the same cascade convention - confirmed
  consistent with existing intent, not a new decision.
- **Region/scope history scope**: this plan covers per-repeater region
  hierarchy snapshots (2c), not the app-wide `known_regions`/`flood_scope`
  settings, which are configuration, not per-device telemetry. If a future
  need arises to track *changes* to `known_regions` over time, that is a
  distinct, smaller feature (an app-settings changelog) not covered here.
- **OPEN QUESTION**: exact lat/lon rounding precision for location-history
  dedup (3a).
- **OPEN QUESTION**: whether room-server panes should share
  `device_config_history` in this first slice or be deferred (3b).
- **OPEN QUESTION**: retention cap size for `device_config_history`
  (suggested 200/kind/public_key in 3c, not yet validated against real
  usage patterns).

## 7. Verification plan

Before claiming this plan's eventual implementation "works":
1. `PYTHONPATH=. uv run pytest tests/test_repository.py tests/test_repeater_routes.py -v`
   - new repository methods and route-level capture wiring.
2. Fresh-DB migration check: delete a scratch `data/meshcore.db`, start the
   app, confirm `PRAGMA user_version` reaches `69` and both new tables exist
   (`sqlite3 data/meshcore.db ".schema device_config_history"`).
3. Existing-DB migration check: run migration `_069` against a pre-`_069`
   database fixture (same pattern other migrations use) to confirm it is
   idempotent and non-destructive.
4. Manual: open a repeater dashboard pane twice with no change on the
   radio side, confirm only one `device_config_history` row is written
   (change-detection skip working) via direct DB inspection.
5. `./scripts/quality/all_quality.sh` per `AGENTS.md` before considering the
   implementation branch done.

No runtime UI verification is needed for this backend-only first slice since
no frontend changes are proposed (§4).

## 8. Effort

Backend-only first slice: **Sonnet**, small-to-medium - one migration, two
repositories (one new file, one addition to an existing file), five call-site
insertions in an already-well-factored router, two new endpoints, and tests
that closely mirror three existing test files
(`test_repository.py`/`test_repeater_routes.py`/`test_repeater_telemetry.py`).
No protocol/firmware risk: this plan does not change what is fetched from the
radio, only what happens to responses already being fetched today. Estimated
1 focused session, contingent on the two open questions in §6/§3a being
resolved before implementation starts.
