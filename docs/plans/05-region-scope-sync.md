# 05. Region-scope list sync

Date: 2026-09-10
Status: draft plan (local planning only, no code changes)
Model: Sonnet
State: Partial (extends shipped `known_regions` + shipped Channel Registry sync)

## Implementation status (updated 2026-09-10)

**SHIPPED** (single PR). Deviations from this draft, all deliberate:

- **Migration is `_073_add_region_sync_url.py`**, not `_069` (section 4.1's
  number was stale; `_072_add_analyzer_sites.py` was the highest on `origin/main`
  at build time). Column shape is identical to `_068`.
- **`region_sync_url` ships blank** (Risk 6.1a), mirroring `registry_sync_url`'s
  default exactly. Documentation points operators at
  `https://meshcore-analyzer.eu/api/regions/scopes` rather than hardcoding it as
  a default third-party dependency (Risk 6.2).
- **Primary path only.** `GET /api/regions/sync` (new `app/routers/regions.py`,
  `/regions` prefix, Open Question 6.4) parses the analyzer's bare
  `{code, name}` array, maps `name || code`, and dedupes via the reused
  `_dedupe_region_names` helper. The `scopes[]`-flattening **fallback path
  (section 4.2) is NOT implemented** — it is explicitly "kept only for a source
  that does not expose a regions endpoint", a defensive nicety rather than the
  resolved requirement, so it is deferred (smallest change). A `region_sync_url`
  pointed at `/api/channels` returns channel records and 502s.
- **Frontend**: sync-URL input + "Sync Regions" button in Settings > Radio next
  to `known_regions` (section 4.3 / Risk 6.5). Sync stages names into the
  textarea for review (mirrors `handleAddDiscoveredRegions`); the operator
  persists via Save Messaging Settings, which is the single `PATCH /api/settings`
  write path (so the region backfill fires once, on Save, not per sync).
- **Not done (was never in scope for the code slice):** live-fetch verification
  of `meshcore-analyzer.eu` endpoints (section 7 items 1-2, Risk 6.7) and the
  `docs/sources-of-truth.md` entry for that host (Risk 6.2). The Risk 6.3
  scan-cost concern (a bulk international list bloating `known_regions`) is
  mitigated by the review-before-Save staging but not otherwise filtered.

## 1. Summary

`known_regions` (an `app_settings` list used to decode incoming MeshCore
region/flood-scope transport codes) is currently populated only by manual
textarea entry or by a live BLE/Serial/TCP repeater sweep
(`POST /api/radio/discover-regions`). There is no way to pull in region names
that other operators have already named, the way the shipped Channel Registry
pulls in channel names via `GET /api/registry/sync`.

This plan reuses the Channel Registry sync mechanism verbatim (same
`{registry_sync_url}` setting pattern, same GET-proxy-and-merge shape) for a
second, independent `region_sync_url` setting and a new
`GET /api/regions/sync` endpoint, feeding an "Sync" button placed next to the
existing `known_regions` textarea in Settings > Radio.

The one open item that changes the shape of "Design" below: DMC's toolbox does
not serve its own curated region list. Its channel-browser page proxies a
third-party analyzer's channel feed and only exposes region names as a
per-channel `scopes[]` array. See section 3.2 and section 6 for what that
means for this plan's data-source URL and format.

**Superseded by the Decision below**: the analyzer itself (not the toolbox)
turns out to expose a dedicated flat regions endpoint, `GET
/api/regions/scopes`, sibling to `/api/channels` on the same host. Section 3.2's
finding about the toolbox proxy is still accurate as written (the toolbox has
no regions proxy of its own), but it is no longer the load-bearing constraint
on this plan's design — see "Decision (2026-09-10)" and section 3.3.

## Decision (2026-09-10)

**Sync source is the analyzer's dedicated regions endpoint, not
channel-scope flattening.** Confirmed by reading source in the local
`EU-Meshcore-Analyzer` repo (`G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer`,
branch `main`):

- `GET /api/regions/scopes` is registered at
  `cmd/api-analysis/main.go:502` (`channelview.NewScopesHandler(pool,
  scopeNames, maxAge)`) — the same backend service (`api-analysis`) that
  serves `/api/channels` (`cmd/api-analysis/main.go:303`). Both prefixes are
  routed to `api-analysis:8080` at the public edge
  (`deploy/web/Caddyfile:303-305` for `/api/channels*`,
  `deploy/web/Caddyfile:379-381` for `/api/regions*`), so the full URL is
  `https://meshcore-analyzer.eu/api/regions/scopes`, sibling to the
  already-cited `https://meshcore-analyzer.eu/api/channels`.
- Payload is a bare JSON array of `{"code": string, "name": string}` objects
  (`internal/channelview/view.go:180-183`, type `Scope`; handler
  `:1211-1281`). Never an envelope, never `null` (empty array when no data).
  `name` may be `""` when the shipped catalog has no label for that code —
  consumers fall back to `s.name || s.code`.
- This is a flat, already-deduplicated list of the region codes actually
  present in the read-model's data (not the full ~1493-entry shipped
  catalog), ordered busiest-first (`internal/channelview/view.go:1198-1199`).
  It is exactly the shape this plan needs for `known_regions` — no
  client-side flattening of a per-channel `scopes[]` array required.
- The DMC toolbox itself does not proxy this endpoint. Its only Cloudflare
  Pages Functions are `channels-data.js` (proxies
  `https://meshcore-analyzer.eu/api/channels`, confirmed at
  `Dutch-Meshcore-Toolbox/functions/channels-data.js:15`, local repo
  `G:\Github\repositories\Dutch-MeshCore\Dutch-Meshcore-Toolbox`) and
  `fw-proxy.js` (unrelated firmware proxy). Grepping the toolbox's
  `functions/`, `src/hooks`, and `src/utils` for "region" turns up only
  client-side scope-to-region-name derivation
  (`src/utils/analyzerChannels.ts`) and serial-radio region-gating config
  builders (`src/hooks/useSerialDevice.ts`, `src/lib/config/regionCommands.ts`)
  — unrelated to a regions list endpoint. So this plan's sync must call the
  analyzer directly, the same third-party call already accepted for option
  3.2(a); there is no toolbox-side equivalent of 3.2(b) for regions.
- Cross-check, not the sync source: a separate, unrelated self-hosted
  project, `cornmeister-mesh-analyzer` (local repo
  `G:\Github\repositories\Elektr0Vodka\cornmeister-mesh-analyzer`, deployed at
  `cornmeister.elektrovodka.nl` per that repo's own docs — a different
  operator's instance, not affiliated with `meshcore-analyzer.eu`)
  independently implements the identical `GET /api/regions/scopes` path and
  `{code,name}` bare-array shape (`internal/api/api.go:2049`, handler
  `:2340-2349`). It is not wired into DMC's toolbox and is not what this plan
  syncs from; it only corroborates that `/api/regions/scopes` is an
  established convention for this class of analyzer, not a one-off.

This replaces the "flatten every channel's `scopes[]`" design in the original
section 3.2/4.2 draft. That flattening logic is retained in section 4.2 below
only as a documented fallback path, in case a deployment's
`/api/regions/scopes` is ever unreachable or intentionally empty (the handler
degrades to `[]` rather than erroring, per
`internal/channelview/view.go:1201-1205`, so an empty response is
indistinguishable from "no regions in the data yet" and from "endpoint
down" — this plan does not attempt to tell those apart).

## 2. Current state (cited)

### 2.1 `known_regions` setting

- Column added and seeded by `app/migrations/_063_message_region_scope.py`:
  seeds from the global `flood_scope` and any per-channel
  `flood_scope_override` values already in the DB
  (`app/migrations/_063_message_region_scope.py:43-86`).
- Repository read/write: `AppSettingsRepository` parses `known_regions` as a
  JSON list column (`app/repository/settings.py:85-92`, read `:161`), accepts
  it as an `update()` kwarg (`app/repository/settings.py:184`, `:228-230`),
  and threads it through `create()` (`:294`, `:316`).
- API contract: `AppSettingsUpdate.known_regions` in
  `app/routers/settings.py:49-55`. `PATCH /api/settings` cleans the list
  (strip blanks, strip a leading `#`, case-insensitive dedupe, preserve order)
  in `app/routers/settings.py:233-248`, then on change schedules
  `backfill_message_regions(...)` as a background task
  (`app/routers/settings.py:318-325`) to retag stored messages whose raw
  packet is still retained.
- Consumption: `app/region_resolver.py` has no reverse lookup for the 16-bit
  transport code; it recomputes `HMAC-SHA256(SHA256("#"+name)[:16], ...)` for
  every name in the candidate list and checks for a match
  (`app/region_resolver.py:63-79`, `compute_transport_code` at `:45-60`).
  This is an O(len(known_regions)) scan per scoped packet — see Risk 6.3.
- Frontend surface: `SettingsRadioSection.tsx` owns a local `knownRegions`
  textarea state (one name per line or comma-separated), loads it from
  `appSettings.known_regions` (`frontend/src/components/settings/SettingsRadioSection.tsx:213`,
  `:243`), and diff-saves it into `PATCH /api/settings` on "Save"
  (`:486-493`). Textarea UI at `:1322-1339`. Type contract:
  `AppSettings.known_regions: string[]` /
  `AppSettingsUpdate.known_regions?: string[]` in `frontend/src/types.ts:435`,
  `:454`.

### 2.2 Existing sync-from-mesh path (not a registry sync, cited for contrast)

- `POST /api/radio/discover-regions` sweeps nearby repeaters live over the
  radio connection (direct-routed anon regions request) and returns a
  deduplicated union of flood-allowed region names
  (`app/routers/radio.py:706-745`, request/response models
  `app/models.py:897-939`, dedupe helper `app/routers/radio.py:664-678`).
  Root `AGENTS.md:332` and `app/AGENTS.md:245` document this endpoint.
- Frontend wires this to an "Add Discovered Regions" flow that merges into
  the same `knownRegions` textarea state
  (`SettingsRadioSection.tsx:548-566`), so the sync feature in this plan adds
  a *third* way to grow the same list, alongside manual entry and live
  discovery. All three write through the same `PATCH /api/settings`
  `known_regions` cleaning logic in `app/routers/settings.py:233-248`, so
  reusing that endpoint (not inventing a parallel write path) is required.

### 2.3 Region scope stats (context, not touched by this plan)

`GET /api/statistics` reports `region_scope_24h` adoption using the current
`known_regions` list against a fixed false-positive floor
(`app/AGENTS.md:176-185`). A larger `known_regions` list changes nothing about
this floor computation but does change match confidence for `region_resolver`
(see 6.3).

## 3. Reference research

### 3.1 Channel Registry sync (the shipped template, mirror this exactly)

Shipped in PR #14 (`feat/channel-registry`, merged per git log). Shape to
copy:

- **Setting**: `registry_sync_url: str` column, added by
  `app/migrations/_068_add_registry_sync_url.py` (`ALTER TABLE app_settings
  ADD COLUMN registry_sync_url TEXT NOT NULL DEFAULT ''`, idempotent
  column-exists check). Threaded through `AppSettingsRepository` the same way
  as `known_regions` (`app/repository/settings.py:148-152`, `:171`, `:194`,
  `:268-270`, `:304`, `:326`) and `AppSettingsUpdate.registry_sync_url`
  (`app/routers/settings.py:98-101`, applied at `:290-291`).
- **Backend proxy endpoint**: `GET /api/registry/sync`
  (`app/routers/registry.py:22-75`). Reads `settings.registry_sync_url`,
  400s if blank, fetches it server-side with `httpx.AsyncClient(timeout=10.0,
  follow_redirects=True)`, 502s on transport error / non-200 / non-JSON /
  non-dict body, otherwise normalizes into a typed `SyncResponse` (`list[{name,
  key}]`), filtering out any entry whose `name`/`key` aren't both strings.
  Purpose of the server-side fetch: the sync source is treated as untrusted
  and possibly CORS-blocked for a browser fetch; the backend is also the only
  side allowed to make outbound calls in this repo's architecture (frontend
  never calls a third-party URL directly for this reason).
- **Frontend storage**: sync results are *not* stored server-side. The
  Channel Registry is entirely a `localStorage`-backed structure
  (`STORAGE_KEY = 'meshcore-channel-registry'`,
  `frontend/src/lib/channelManager.ts:30`, `loadRegistry`/`saveRegistry` at
  `:61-72`). `GET /api/registry/sync` is a pure pass-through proxy; the
  "registry" itself lives entirely in the browser.
- **Merge semantics**: `addMissingFromSync(channels, existing)`
  (`frontend/src/lib/channelManager.ts:222-246`) is strictly additive — it
  never mutates or removes existing entries, only appends names not already
  present (case-insensitive), tagging new rows `source: 'imported'`.
- **UI**: `ChannelRegistryView.tsx` "Sync" button
  (`frontend/src/components/ChannelRegistryView.tsx:973-987`) calls
  `handleSync()` (`:930-948`), which calls `api.syncRegistry()`
  (`frontend/src/api.ts:363-364`, `GET /registry/sync`), validates the
  response shape, calls `addMissingFromSync`, persists if anything was added,
  and toasts the result (`n new channels added` / `Already up to date` /
  error). Sync URL itself is configured in **Settings > Database**
  (`frontend/src/components/settings/SettingsDatabaseSection.tsx:213-239`): a
  single `url`-type `<Input>` that PATCHes `registry_sync_url` on blur.

Everything above should be mirrored 1:1 for regions: new setting column, new
GET proxy endpoint, additive-merge helper, Sync button next to the
`known_regions` textarea, and a settings input for the sync URL. No new
architecture is needed; this is a repeat of a shipped pattern.

### 3.2 DMC toolbox data source (local repo:
`G:\Github\repositories\Dutch-MeshCore\Dutch-Meshcore-Toolbox`)

The task description's URL,
`https://toolbox.dutchmeshcore.nl/#/channel-browser`, is a client-side hash
route (`Route path="/channel-browser"` → `IndexPage`,
`Dutch-Meshcore-Toolbox/src/App.tsx:23`). Tracing what that page actually
fetches:

- `src/hooks/useChannelData.ts:38-45`: tries `fetch('/channels-data')`
  (same-origin), and only on failure falls back to a committed static sample,
  `./data/channels-sample.json`.
- `/channels-data` is a Cloudflare Pages Function,
  `Dutch-Meshcore-Toolbox/functions/channels-data.js:13-58`. It is a
  same-origin **proxy**, not the toolbox's own data: it server-side-fetches
  `UPSTREAM = 'https://meshcore-analyzer.eu/api/channels'`
  (`functions/channels-data.js:15`), edge-caches for 300s
  (`cf.cacheTtl`/`cacheEverything`), maps the response through
  `mapAnalyzerResponse` (`src/utils/analyzerChannels.ts:51-62`), and returns
  JSON with permissive CORS headers.
- The mapped shape (`ChannelMeta`, per channel, `src/utils/analyzerChannels.ts:34-47`):
  ```
  {
    channel: string,          // e.g. "#drenthe"
    channel_hash: string,     // hex secret, empty if not disclosed
    scopes: string[],         // raw MeshCore scope tags, e.g. ["nl-dr","nl","eu"]
    countries: string[],      // derived display names
    regions: string[],        // derived display names (NL provinces only, see below)
    country: string,          // first derived country
    region: string,           // first derived region
    last_seen: string | null,
    last_sender: string,
    last_message: string,
    encrypted: boolean,
    message_amount: number,
  }
  ```
  Confirmed against the fallback sample file,
  `Dutch-Meshcore-Toolbox/public/data/channels-sample.json` (10 example
  records with this exact shape).
- **There is no dedicated "list of valid region names" endpoint.** The only
  region-shaped data is the per-channel `scopes: string[]` array embedded in
  the channel feed. A "known regions" list would have to be *derived* as the
  deduplicated union of every channel's `scopes` array across the whole feed
  — there is no upstream endpoint that already returns that union.
- The toolbox's only static, curated region vocabulary is two small local
  maps used purely for display labels, not for validation or listing:
  `SCOPE_COUNTRY` (broad ISO-ish country-code → name map, ~46 entries) and
  `SCOPE_REGION` (the 12 Dutch provinces only, e.g. `nl-nh` →
  `Noord-Holland`) in `Dutch-Meshcore-Toolbox/src/utils/scopeMeta.ts:14-76`.
  Any scope tag outside these two maps (e.g. `de-bw-str`, `besgw`,
  `hansemesh`) still appears in the raw `scopes` array but has no display
  mapping in the toolbox itself.
- `RegionSettingsForm.tsx` / `regionCommands.ts` in the same repo
  (`src/components/config/`, `src/lib/config/regionCommands.ts`) are CLI
  command builders for pushing region-gating config to a single connected
  DMC repeater over serial/USB config — free-text entry, not a list source.
  Not relevant to sync.

**Consequence for this plan (see also Risk 6.1):** the URL an operator would
put into a `region_sync_url` setting is not a DMC-controlled URL. It is
either (a) `https://meshcore-analyzer.eu/api/channels` directly (third
party, undocumented stability/versioning contract, UNVERIFIED whether it
allows direct cross-origin browser or server calls at volume), or (b) the
toolbox's own `https://toolbox.dutchmeshcore.nl/channels-data` proxy, which
is captioned in its own source as "same-origin" for the toolbox's app and
edge-cached for the toolbox's own traffic pattern — using it as a
general-purpose third-party integration point was not its intended design,
though nothing in the function code rejects unrelated callers (permissive
CORS, no referrer check). Either way, the payload this plan's backfill would
consume is **channel records with a `scopes[]` field**, not a flat region
list, so the sync endpoint's job includes flattening/deduplicating that
before it looks like `known_regions`.

**This subsection's finding stands as written** (the toolbox has no
dedicated regions endpoint), but per the Decision above it is no longer the
primary data source for this plan — see 3.3.

### 3.3 Analyzer regions endpoint (confirmed 2026-09-10, this is the sync source)

Source: `GET /api/regions/scopes`, local repo
`G:\Github\repositories\Elektr0Vodka\EU-Meshcore-Analyzer`, branch `main`.

- **Registration**: `mux.Handle("GET /api/regions/scopes",
  channelview.NewScopesHandler(pool, scopeNames, maxAge))`
  (`cmd/api-analysis/main.go:502`), in the same `api-analysis` service and
  same `main.go` as `GET /api/channels`
  (`cmd/api-analysis/main.go:303`), so it shares that service's edge routing.
- **Public URL**: `https://meshcore-analyzer.eu/api/regions/scopes`.
  Confirmed via `deploy/web/Caddyfile`: `handle /api/channels*
  { reverse_proxy api-analysis:8080 }` at `:303-305` and `handle
  /api/regions* { reverse_proxy api-analysis:8080 }` at `:379-381` — both
  prefixes forward to the same backend container, so both are reachable on
  the analyzer's public host the toolbox already calls for `/api/channels`.
- **Handler**: `internal/channelview/view.go:1211-1281`
  (`scopesHandler`/`NewScopesHandler`/`build`). Query:
  `SELECT scope_region, COUNT(*) FROM rm_channel_messages WHERE scope_region
  <> '' GROUP BY scope_region ORDER BY COUNT(*) DESC, scope_region`
  (`:1181-1183`). Display names are resolved from a live region-catalog
  lookup (`knownNames()`) at build time (`:1261-1263`), not from the query
  itself.
- **Response shape**: a bare JSON array (no envelope) of:
  ```
  [{ "code": "nl-dr", "name": "Drenthe" }, { "code": "nl", "name": "" }, ...]
  ```
  Type `Scope{ Code string; Name string }` with `json:"code"` /
  `json:"name"` tags (`internal/channelview/view.go:180-183`). `name` can be
  `""` (no display label in the shipped catalog for that code); consumers
  (`channels.js`/`analytics.js` per the code comment at `:201-205`) render
  `s.name || s.code`. Never `null` — a fresh/empty deployment or nil pool
  serves `[]` (`:1256-1258`), by design, so a fetcher cannot distinguish "no
  regions in this deployment's data" from "endpoint unreachable" purely from
  an empty body (HTTP status still distinguishes actual fetch failure from a
  200 with an empty array).
- **Content is data-driven, not the full catalog**: it lists only the ~136
  region codes actually observed in this deployment's `rm_channel_messages`,
  not the ~1493-entry shipped `lists/regions.txt` catalog
  (`internal/channelview/view.go:1188-1196`). This matches what
  `known_regions` needs (names actually worth decoding for), not an
  exhaustive/irrelevant vocabulary.
- **Caching**: blob-cached, single variant (no facets), `ETag` +
  `Cache-Control: public, max-age=<maxAge>` (`internal/channelview/view.go:1234`,
  `:1283-1295`), matching `/api/channels`'s cache shape already relied on
  elsewhere in this plan.
- **UNVERIFIED**: no live HTTP request was made against
  `https://meshcore-analyzer.eu/api/regions/scopes` for this update — this is
  read from source, same limitation already flagged in Risk 6.7 for
  `/api/channels`. Verify both endpoints together with one live check before
  implementation (see section 7, item 2).

## 4. Design

### 4.1 Setting: `region_sync_url`

New `app_settings` column, same shape as `registry_sync_url`:

- Migration `app/migrations/_069_add_region_sync_url.py` (next free number;
  verified `069` is unused on both `origin/main` and this branch's HEAD via
  `git ls-tree -r --name-only origin/main app/migrations` — highest existing
  is `_068_add_registry_sync_url.py`). `ALTER TABLE app_settings ADD COLUMN
  region_sync_url TEXT NOT NULL DEFAULT ''`, idempotent column-exists guard,
  mirroring `_068` exactly.
- `AppSettingsRepository`: add `region_sync_url` read/write in the same spots
  as `registry_sync_url` (`app/repository/settings.py:148-152`, `:171`,
  `:194`, `:268-270`, `:304`, `:326`).
- `AppSettingsUpdate.region_sync_url: str | None` in
  `app/routers/settings.py`, applied unconditionally like
  `registry_sync_url` (`app/routers/settings.py:290-291` pattern) — no
  validation needed at write time since the fetch endpoint validates at read
  time, same as the channel registry.
- `AppSettings.region_sync_url: string` / `AppSettingsUpdate.region_sync_url?:
  string` added to `frontend/src/types.ts` next to `registry_sync_url`
  (`:445`, `:461`).

### 4.2 Backend proxy endpoint: `GET /api/regions/sync`

New router `app/routers/regions.py` (or extend `app/routers/registry.py` with
a second route — smallest-change judgment call, see Open Question 6.4),
mirroring `app/routers/registry.py:22-75` structure:

- 400 if `region_sync_url` is blank. Default value is a user/documentation
  decision (see updated Risk 6.1); the confirmed candidate is
  `https://meshcore-analyzer.eu/api/regions/scopes` (section 3.3).
- `httpx.AsyncClient(timeout=10.0, follow_redirects=True)` GET, same
  502-on-transport-error / non-200 / non-JSON handling as the registry
  endpoint.
- **Primary path — sync directly from the analyzer's regions endpoint**
  (section 3.3), since its payload is already the flat, deduplicated shape
  `known_regions` needs:
  1. Accept a bare JSON array of `{"code": string, "name": string}` objects
     (`Scope`, `internal/channelview/view.go:180-183`). Reject (502, same as
     a malformed-shape response elsewhere in this plan) anything that is not
     a JSON array of objects.
  2. Map each entry to the string RTFM-EV stores: `name` when non-empty,
     else `code` — mirroring the analyzer's own display-fallback convention
     (`s.name || s.code`, noted in `internal/channelview/view.go:201-205`).
     `known_regions` matches by name text at decode time
     (`app/region_resolver.py:63-79` recomputes the HMAC over `"#"+name`),
     so this fallback keeps a code-only entry usable instead of silently
     dropping it.
  3. Drop the wildcard `*` sentinel and blanks after the name/code fallback,
     reusing `_dedupe_region_names` from `app/routers/radio.py:664-678`
     rather than re-implementing it, and dedupe case-insensitively — same
     rules already applied to the `discover-regions` sweep and to manual
     `known_regions` edits (`app/routers/settings.py:233-248`), so all three
     write paths stay consistent.
  4. Return `RegionSyncResponse{regions: list[str]}` — matching what
     `known_regions` stores (unlike Channel Registry's `{name, key}` pairs, a
     region has no accompanying "key" to transport).
- **Fallback path — flatten per-channel `scopes[]`** (the original
  3.2/4.2 design), kept only for a source that does not expose a dedicated
  regions endpoint (e.g. if an operator points `region_sync_url` at
  `/api/channels` directly instead of `/api/regions/scopes`, or at a future
  source shaped like the toolbox's channel feed):
  1. Accept the analyzer/toolbox channel-array shape (`list[{scopes:
     list[str], ...}]` — tolerate a top-level `{"channels": [...]}` wrapper
     too, matching `mapAnalyzerResponse`'s wrapper handling).
  2. Flatten and dedupe every `scopes[]` entry across all records
     case-insensitively into `list[str]`.
  3. Apply the same wildcard/blank drop as the primary path
     (`_dedupe_region_names`).
  4. Return the same `RegionSyncResponse{regions: list[str]}` shape.
  Whether the endpoint should auto-detect which shape it received (array of
  `{code,name}` vs. array of channel records with `scopes[]`) or require a
  config flag naming which mode to use is an implementation-time judgment
  call, not fixed here — auto-detection is straightforward (a `{code,name}`
  object has no `scopes` key) but adds a small amount of branching to what
  would otherwise be a single-shape parser.
- The primary-path mapping (analyzer `{code,name}` array to `known_regions`
  strings) and the fallback flattening logic are both RTFM-EV-side
  normalization with no shared template in the Channel Registry sync (that
  endpoint's source is already a flat `{name: key}` map). Both are new code,
  not copy-paste, and both should get unit tests — the primary path is now
  the one actually expected to run in the common case, so it should get the
  more thorough test coverage of the two.

### 4.3 Frontend: sync button + merge

- `api.ts`: add `syncRegions: () => fetchJson<{ regions: string[] }>(
  '/regions/sync')` next to `syncRegistry` (`frontend/src/api.ts:363-364`).
- Merge helper: additive-only union into the `knownRegions` textarea state,
  mirroring `addMissingFromSync`'s never-clobber semantics
  (`frontend/src/lib/channelManager.ts:222-246`) but simpler since there is
  no per-entry metadata to preserve, just string dedupe. This can live
  inline in `SettingsRadioSection.tsx` next to
  `handleAddDiscoveredRegions` (`:558-566`), which already implements
  exactly this "existing set, case-insensitive, filter additions, toast if
  none" pattern for the live-discovery flow — the new sync button should
  call the same merge shape, not a third slightly-different implementation.
- UI: a "Sync" button next to the existing `known_regions` textarea
  (`SettingsRadioSection.tsx:1322-1339`), loading/disabled state and toast
  copy modeled on `ChannelRegistryView.tsx`'s Sync button
  (`:973-987`/`:930-948`: `Loader2` spinner while in flight, `n new
  region(s) added` / `Already up to date` / error toast).
- Sync URL configuration: a second `url`-type `<Input>` in **Settings >
  Radio** (co-located with `known_regions`, not in Settings > Database where
  the channel registry's URL lives — placing it there keeps both region
  controls in one section rather than splitting one feature across two
  settings tabs; Open Question 6.5 asks whether that's the right call),
  modeled on `SettingsDatabaseSection.tsx:213-239`'s PATCH-on-blur pattern.
- **Important divergence from the Channel Registry pattern**: syncing merges
  directly into the *server-side* `known_regions` setting (via `PATCH
  /api/settings`), not into a browser-only `localStorage` structure. There is
  no client-only "region registry" data model to build — `known_regions`
  already is the server-side list. This makes the frontend piece of this
  plan smaller than the Channel Registry's, at the cost of round-tripping
  through `PATCH /api/settings` (which also triggers the region backfill
  task, `app/routers/settings.py:318-325`) on every sync-driven change, same
  as a manual edit would.

### 4.4 Typed contracts

- Backend: `RegionSyncResponse` Pydantic model (`regions: list[str]`) in the
  new/extended regions router, following `SyncResponse` in
  `app/routers/registry.py:18-19`.
- Frontend: no new TS interface needed beyond `{ regions: string[] }` inline
  in `api.ts`, since (unlike `RegistryChannel`) there is no extra per-region
  metadata to model — `known_regions` is already `string[]`.

## 5. Phasing

1. **Backend plumbing** — migration `_069`, repository fields, settings
   router field, `GET /api/regions/sync` endpoint with the flatten/dedupe
   logic and its own test file (mirroring how the channel registry endpoint
   would be tested; no existing `test_registry_router.py` was found in the
   test inventory in `app/AGENTS.md`, so this may be the first router test
   for either sync endpoint — check for one before assuming none exists,
   flagged as Open Question 6.6).
2. **Frontend sync + merge** — `api.ts` method, merge helper reusing the
   `handleAddDiscoveredRegions` shape, Sync button, sync-URL input.
3. **Docs** — update `app/AGENTS.md` `app_settings` field list (currently
   lists `known_regions` but not a paired sync-url; add `region_sync_url`
   next to it) and the root `AGENTS.md` API table (`/api/regions/sync` row
   near the existing `discover-regions` row).

No phase depends on radio hardware or a live connection — this whole feature
is server + browser, matching the "reuse Channel Registry plumbing" framing
in `docs/plans/README.md:118`, `:149`.

## 6. Risks / open questions

1. **Largely resolved by the Decision (2026-09-10) above, one narrower
   question remains.** Section 3.2's finding still holds — DMC's toolbox
   itself serves no curated region list — but section 3.3 confirms the
   analyzer it proxies for channels does: `GET
   https://meshcore-analyzer.eu/api/regions/scopes`. That is now the
   confirmed candidate for `region_sync_url`, not an open host/path
   question. What is still a human/DMC decision, not something resolvable
   from source alone: (a) whether `https://meshcore-analyzer.eu/api/regions/scopes`
   should ship as the *default* value of `region_sync_url` (vs. blank, like
   `registry_sync_url`'s shipped default, with documentation pointing the
   operator at it instead), and (b) whether depending on this specific
   third-party analyzer by default is acceptable given Risk 6.2 below — DMC's
   own project does not operate or guarantee `meshcore-analyzer.eu`.
2. **Third-party dependency risk.** `meshcore-analyzer.eu` is not a repo
   listed in `docs/sources-of-truth.md`; it is one hop further out than DMC's
   own infrastructure. If that analyzer goes down or changes its response
   shape, both the toolbox's channel browser and (transitively, if option
   6.1(a)/(b) is chosen) this sync feature break. `docs/sources-of-truth.md`
   should gain an entry for it if this plan proceeds, per that file's own
   "keep current" maintenance note.
3. **`region_resolver.py` scan cost.** `resolve_region` is O(known_regions
   length) HMAC-SHA256 computations per scoped packet
   (`app/region_resolver.py:63-79`). Manual entry and live
   `discover-regions` sweeps naturally stay small (a handful of
   locally-relevant names). A bulk sync from an international channel feed's
   `scopes[]` union could plausibly pull in dozens of unrelated
   country/region codes (the sample data alone has ~15 distinct scope tags
   across 10 channels; a full feed will have more). This degrades
   `region_resolver`'s per-packet cost and pollutes the operator's `known_regions`
   textarea with irrelevant entries (e.g. an NL-based operator syncing in
   `de-bw-str`, `bg`, etc.). Consider whether the sync response should be
   filterable (e.g. by country prefix) before merge, or whether this is
   accepted as user-managed noise the same way the Channel Registry accepts
   syncing in channels the operator will never use. Not resolved here;
   flagged for design review.
4. **Router placement**: new file `app/routers/regions.py` vs. extending
   `app/routers/registry.py` with a second route. The existing router is
   named for "channel registry" specifically (`prefix="/registry"`,
   `app/routers/registry.py:10`); a `/registry/regions/sync` path would be
   confusing, so a new `/regions` prefix on a new router file is likely
   correct, but this is a judgment call for implementation time, not fixed
   here.
5. **Settings tab placement**: putting the region sync URL in Settings >
   Radio (next to `known_regions`) instead of Settings > Database (where
   `registry_sync_url` lives) is a deliberate deviation from the "mirror
   exactly" instruction, justified by keeping the whole region feature in one
   tab. If reviewers prefer strict parity with the Channel Registry's
   placement, this would move to Settings > Database instead.
6. **Existing router test coverage is unverified.** This plan did not find a
   `test_registry_router.py`-equivalent in the test inventories in
   `app/AGENTS.md`'s "Testing" section during research; before implementation,
   run `git grep -l registry tests/` to confirm whether `/api/registry/sync`
   has direct test coverage to mirror, or whether this plan's own endpoint
   would be the first for this sync pattern.
7. **UNVERIFIED**: whether `https://meshcore-analyzer.eu/api/channels` is
   still live and returns the shape `mapAnalyzerChannel` expects as of this
   plan's date. This was read from the toolbox's *source code*, not from a
   live network call (no network fetch was performed for this plan). Verify
   with a live request before relying on the shape in section 3.2's code
   block.

## 7. Verification plan

Before implementation is considered complete:

1. `git grep -l registry tests/` (or equivalent) to confirm existing test
   coverage patterns for the sync endpoint being mirrored (Risk 6.6).
2. Live-fetch `https://meshcore-analyzer.eu/api/channels` and
   `https://toolbox.dutchmeshcore.nl/channels-data` to confirm the response
   shape still matches `mapAnalyzerChannel`'s expectations (Risk 6.7) and to
   resolve Open Question 6.1 before hardcoding either URL anywhere in
   RTFM-EV.
3. `PYTHONPATH=. uv run pytest tests/test_settings_router.py -v` after adding
   the migration/repository/router changes, to confirm no regression in
   existing `known_regions`/`registry_sync_url` handling.
4. New backend test for `GET /api/regions/sync`: blank-URL 400, upstream-error
   502, malformed-shape 502, and the flatten/dedupe/wildcard-strip logic
   against a fixture shaped like `channels-sample.json`.
5. Frontend: `npm run test:run` covering the new sync button (loading state,
   toast copy, additive merge not clobbering existing `known_regions`
   entries) — model on any existing test coverage for
   `ChannelRegistryView`'s sync button and `handleAddDiscoveredRegions` in
   `frontend/src/test/`.
6. `./scripts/quality/all_quality.sh` before calling the feature done, per
   root `AGENTS.md:7-13`.
7. Manual check: with a nonsense `region_sync_url`, confirm the error toast
   surfaces the backend's 400/502 detail message rather than a generic
   failure (matching `ChannelRegistryView.tsx:944`'s
   `err.message`-or-fallback pattern).

## 8. Effort

Sonnet-scoped, single PR:

- Backend: migration + repository fields + settings field (~30 min, pure
  copy-paste of the `registry_sync_url` pattern) + new sync endpoint with
  flatten/dedupe logic and its tests (~1-2 hours, this is the one genuinely
  new piece of logic in the whole plan).
- Frontend: types, `api.ts` method, sync button + merge logic reusing
  `handleAddDiscoveredRegions`'s shape, settings URL input (~1-1.5 hours).
- Docs updates to both `AGENTS.md` files (~15 min).
- Total: roughly half a day of focused work, contingent on Open Question 6.1
  being resolved first (otherwise the sync button has no answer for "sync
  from where" to ship with).
