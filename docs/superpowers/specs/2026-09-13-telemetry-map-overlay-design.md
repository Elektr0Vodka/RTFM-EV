# Telemetry map overlay (battery + temperature at a glance)

Date: 2026-09-13
Status: Approved-by-delegation design (user answered clarifying questions then went to bed; proceed to build, flag for morning review)
Scope: Feature A of the four-part request. B (map labels) shipped to the same branch. C (fleet mgmt) and D (data store) remain separate.

## Problem

Per-node telemetry (battery, temperature, sensors) is already collected and stored (on-demand and on the tracked-telemetry interval) in `repeater_telemetry_history` and `contact_telemetry_history`, and forwarded to MQTT on receipt (opt-in, `publish_telemetry` default off). What is missing is a way to see it **at a glance on the map**: an opt-in overlay showing each node's latest battery level and temperature.

## Decisions (from brainstorming)

- **Presentation:** a **separate icon overlay**, independently toggled, that does NOT change the existing node marker colors (recency tier stays intact).
- **Metrics:** **battery primary** (the icon), **temperature secondary** (shown next to it); everything else (voltage, humidity, pressure, uptime) stays in the existing contact/repeater telemetry panes.
- **Staleness:** show the **latest** reading with its **relative age**; **grey/fade** readings older than a threshold (default 24h, tunable).
- **Opt-in:** the user clarified the "opt in" in the original request refers to **forwarding received telemetry to MQTT**, which already exists. The map overlay itself is simply an **off-by-default toggle**; it shows whatever telemetry is already stored, for any mapped node. No new collection, no new per-node flag.

## Grounding (verified, with citations)

- Repeater `data` blob keys incl. `battery_volts` (volts; raw `bat` mV / 1000) and `lpp_sensors` (`[{channel, type_name, value}]`): `app/radio_sync.py:1896-1938`. Contact `data` has `lpp_sensors` only: `app/radio_sync.py:2042-2054`.
- Temperature is an LPP entry with `type_name == "temperature"` (string type name; numeric LPP codes are decoded inside the `meshcore` pip package, not this repo).
- Battery %: `frontend/src/utils/batteryDisplay.ts` `mvToPercent(mv)` (Meshtastic OCV table), `formatBatteryLabel(...)`. **Input is millivolts**; stored `battery_volts` must be `* 1000`.
- Latest access: `RepeaterTelemetryRepository.get_latest(public_key)` / `ContactTelemetryRepository.get_latest(public_key)` (both `app/repository/*_telemetry.py:80`), single-key only. **No bulk latest-per-node method or endpoint exists.**
- Map contacts come from the `contacts` prop (REST initial + WebSocket mutations); the WS stream and `Contact` objects carry **no** telemetry (`MapView.tsx:52-53,514-546`). So the overlay needs its own fetch.
- `broadcast_telemetry` (MQTT forward) fires wherever telemetry is recorded (`radio_sync.py:1996,2073`, `routers/contacts.py:748`, `routers/repeaters.py:183`). Community MQTT `publish_telemetry` default off (`mqtt_community.py:112`).

## Out of scope / deferred findings

- **Room + lpp-only receipt endpoints don't forward.** `POST /contacts/{pk}/room/status`, `/room/lpp-telemetry` (`routers/rooms.py:47,85`) and `/repeater/lpp-telemetry` (`routers/repeaters.py:220`) fetch telemetry but neither record nor broadcast it. Closing this (record + `broadcast_telemetry`) would make "forward on receipt" complete, but it changes behavior (room telemetry would start being stored + forwarded). Left as a **separate decision for the user**, not built in A.
- No change to how telemetry is collected, the interval scheduler, or existing MQTT config.
- No DB migration (no schema change).

## Design

### Backend: bulk latest-telemetry endpoint (no schema change)

1. **Repo methods** (new), on both `RepeaterTelemetryRepository` and `ContactTelemetryRepository`:
   - `async def get_latest_all(self) -> dict[str, dict]` — returns `{public_key: {"timestamp": int, "data": dict}}` for the newest row per `public_key`. SQL: for each `public_key`, the row with `MAX(timestamp)`. Implement with a correlated/group-max query:
     ```sql
     SELECT t.public_key, t.timestamp, t.data
     FROM <table> t
     JOIN (SELECT public_key, MAX(timestamp) AS ts FROM <table> GROUP BY public_key) m
       ON t.public_key = m.public_key AND t.timestamp = m.ts
     ```
     (`data` is stored JSON text; decode with the same `json.loads` the existing `get_latest` uses.)

2. **Service/endpoint**: `GET /api/contacts/telemetry/latest` (read-only, no radio I/O) in a suitable router (`routers/contacts.py`, near the existing telemetry-history route). Returns a typed map keyed by public key:
   ```json
   {
     "<public_key>": {
       "timestamp": 1757000000,
       "battery_volts": 3.98,
       "temperature": 24.1,
       "source": "repeater" | "contact"
     }
   }
   ```
   - Merge repeater-latest and contact-latest. If a key appears in both (shouldn't normally), prefer the newer `timestamp`.
   - `battery_volts`: from repeater `data.battery_volts` (contacts have none → omit/null).
   - `temperature`: first `lpp_sensors` entry with `type_name == "temperature"` and a scalar `value` (from either table's `data`).
   - Keep the payload small: only `timestamp`, `battery_volts`, `temperature`, `source`. Other sensors stay in the per-node panes.
   - Pydantic response model `LatestTelemetryEntry` (typed, not a raw dict), returned as `dict[str, LatestTelemetryEntry]`.

3. **Tests** (`tests/`): repo `get_latest_all` returns newest-per-key across multiple rows; endpoint merges sources, extracts temperature from `lpp_sensors`, prefers newer on key collision, returns `{}` when empty. Follow existing telemetry test patterns (`tests/test_repeater_telemetry.py`).

### Frontend: telemetry overlay layer

4. **API client** (`frontend/src/api.ts`): `getLatestTelemetry(): Promise<Record<string, LatestTelemetry>>` calling `GET /contacts/telemetry/latest`. Type `LatestTelemetry { timestamp: number; battery_volts?: number | null; temperature?: number | null; source: 'repeater' | 'contact' }` in `types.ts`.

5. **Overlay layer** `frontend/src/map/layers/telemetryLayer.ts` (new), mirroring the `nodesLayer` controller shape:
   - New GeoJSON source `rt-telemetry` + a MapLibre `symbol` layer `rt-telemetry-badges`, added ABOVE `rt-nodes`/`rt-node-labels` so badges sit on top.
   - **Battery icon**: register 5 small runtime-generated canvas icons (`batt-0`..`batt-4`) via `map.addImage()` in `ensure()` — a battery glyph filled to the level and colored by bucket (0 red, 1-2 amber, 3-4 green). `icon-image: ['concat', 'batt-', ['get','battLevel']]`. Nodes with no battery reading (contacts) get `battLevel = -1` → a distinct `batt-none` icon or no icon (temperature-only badge).
   - **Text**: `text-field` shows temperature + compact age, e.g. `"24° · 3h"` (temperature omitted if absent → just age; age omitted if very fresh). `text-offset` beside the icon, `text-size` ~10.
   - **Staleness**: `icon-opacity` / `text-opacity` data-driven on a `stale` boolean (age > STALE_SEC, default 24h) → e.g. 0.45 when stale, 1.0 otherwise.
   - `minzoom` = reuse a telemetry threshold (default 10) so badges don't clutter the world view.
   - Feature builder `buildTelemetryFeatures(contacts, latest, nowSec)`: join mapped contacts (lat/lon) with the latest-telemetry map by public key; compute `battLevel` (from `mvToPercent(battery_volts*1000)` → bucket), `temperature`, `ageSec`, `stale`, and the `label` text. Drop nodes with neither battery nor temperature.
   - Controller API: `ensure()`, `reattach()`, `setData(contacts, latest, nowSec)`, `setVisible(on)`, plus image registration. Non-interactive (no click handler; the underlying `rt-nodes` click still opens the contact).

6. **MapView wiring** (`frontend/src/components/MapView.tsx`):
   - State `telemetryOn` (off by default), persisted to `localStorage` (`remoteterm-map-telemetry`).
   - State `latestTelemetry: Record<string, LatestTelemetry>`.
   - When `telemetryOn` flips on: fetch `getLatestTelemetry()`, start a refresh interval (default 60s) while on; clear on off. Also refetch on reconnect is out of scope (simple interval is enough).
   - Instantiate `createTelemetryLayer` in `handleReady`, `ensure()`, re-`reattach()` in `handleBasemapReapply` (basemap restyle drops custom layers/images — re-register icons).
   - Push data: effect on `[mappableContacts, latestTelemetry, nowSec]` → `telemetryRef.current?.setData(...)`; effect on `[telemetryOn]` → `setVisible`.
   - Pass `telemetryOn` + `onToggleTelemetry` through `MapSurface` to `MapControls`.

7. **Control** (`MapControls.tsx` + `MapSurface.tsx`): a toggle in the **Overlays** group (alongside links/packets), off by default. `fabs.telemetry` + `telemetryOn` + `onToggleTelemetry` props, mirroring the links passthrough. i18n `map_` keys for the label in en/nl/de.

### Data flow

Toggle on → `MapView` fetches `GET /contacts/telemetry/latest` (+ 60s refresh) → `latestTelemetry` state → joined with `mappableContacts` in `buildTelemetryFeatures` → `rt-telemetry` source → symbol layer renders battery icon + temp/age badge, greyed when stale. Toggle off → layer hidden, interval cleared. Node colors and labels (Feature B) are untouched.

## Testing

- **Backend:** repo `get_latest_all` (newest-per-key, multi-row); endpoint (merge, temperature extraction, collision prefers newer, empty case). `PYTHONPATH=. uv run pytest`. CI also runs `ruff check` + `ruff format --check`.
- **Frontend unit:** `buildTelemetryFeatures` (battery bucket from volts incl. the ×1000 unit fix, temperature join, age/stale computation, drops nodes with no telemetry); API client method; control toggle renders + reports. Vitest.
- **Frontend gates:** `lint`, `format:check`, `test:run`, `build`.
- **Runtime (REQUIRED before "works"):** on the live instance, enable the overlay, confirm battery icons + temp badges appear for nodes with telemetry, colors track battery level, stale readings grey out, toggle persists, and node colors/labels are unaffected. Mark NOT VERIFIED until observed.

## Risks / limitations

- **Battery % only meaningful for nodes that report voltage** (repeaters); contacts/sensors without a voltage LPP channel show a temperature-only badge. Accepted.
- **N-row scan:** `get_latest_all` does a group-max over history tables; these are pruned to 30 days / 1000 rows per key, so the tables stay small. Acceptable; add an index only if profiling shows need (existing `SCHEMA_INDEXES` already covers `(public_key, timestamp)` for these tables — verify during implementation).
- **Runtime icon generation** must be re-run after a basemap `setStyle` (handled in `reattach`). Glyph/image availability is visual; verify at runtime.
- Staleness threshold (24h) and refresh interval (60s) are fixed defaults, tunable later.
