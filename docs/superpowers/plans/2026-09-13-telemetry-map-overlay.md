# Telemetry Map Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or subagent-driven-development. Checkbox steps track progress.

**Goal:** An opt-in map overlay showing each node's latest battery level (icon) + temperature (badge), greyed when stale, fed by a new bulk latest-telemetry endpoint.

**Architecture:** New backend `get_latest_all` repo methods + `GET /contacts/telemetry/latest` (no schema change). New frontend MapLibre symbol overlay `rt-telemetry-badges` on its own source, toggled from the Overlays group, fetched on toggle + 60s refresh.

**Tech Stack:** FastAPI, aiosqlite, Pydantic, pytest, ruff; React 18, TypeScript, MapLibre GL 4, Vitest.

> **PROJECT GIT RULE:** Do NOT commit/push. "Stage" = `git add` only.

---

### Task 1: Backend repo `get_latest_all`

**Files:** Modify `app/repository/repeater_telemetry.py`, `app/repository/contact_telemetry.py`; Test `tests/test_telemetry_latest_all.py` (new).

- [ ] **Step 1 (test):** newest-per-key across multiple rows, empty→`{}`.

```python
import pytest
from app.repository.repeater_telemetry import RepeaterTelemetryRepository as R

@pytest.mark.asyncio
async def test_get_latest_all_returns_newest_per_key(telemetry_db):
    await R.record("aa", 100, {"battery_volts": 3.9})
    await R.record("aa", 200, {"battery_volts": 4.0})
    await R.record("bb", 150, {"battery_volts": 3.5})
    latest = await R.get_latest_all()
    assert set(latest) == {"aa", "bb"}
    assert latest["aa"]["timestamp"] == 200
    assert latest["aa"]["data"]["battery_volts"] == 4.0

@pytest.mark.asyncio
async def test_get_latest_all_empty(telemetry_db):
    assert await R.get_latest_all() == {}
```

(Reuse the DB fixture pattern from `tests/test_repeater_telemetry.py`; name it to match. If that suite uses an autouse in-memory db fixture, depend on the same one instead of `telemetry_db`.)

- [ ] **Step 2:** run → FAIL (no method). `PYTHONPATH=. uv run pytest tests/test_telemetry_latest_all.py -v`
- [ ] **Step 3 (impl):** add identical method to both repos (swap table name):

```python
    @staticmethod
    async def get_latest_all() -> dict[str, dict]:
        """Return the newest telemetry row per public_key: {pk: {timestamp, data}}."""
        async with db.readonly() as conn:
            async with conn.execute(
                """
                SELECT t.public_key AS public_key, t.timestamp AS timestamp, t.data AS data
                FROM repeater_telemetry_history t
                JOIN (
                    SELECT public_key, MAX(timestamp) AS ts
                    FROM repeater_telemetry_history
                    GROUP BY public_key
                ) m ON t.public_key = m.public_key AND t.timestamp = m.ts
                """
            ) as cursor:
                rows = await cursor.fetchall()
        return {
            row["public_key"]: {
                "timestamp": row["timestamp"],
                "data": json.loads(row["data"]),
            }
            for row in rows
        }
```

(For `contact_telemetry.py`, replace `repeater_telemetry_history` with `contact_telemetry_history`.)

- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** Stage.

---

### Task 2: `LatestTelemetryEntry` model + endpoint

**Files:** Modify `app/models.py` (add model), `app/routers/contacts.py` (add route); Test `tests/test_telemetry_latest_endpoint.py` (new).

- [ ] **Step 1 (test):** merge repeater+contact, extract temperature from `lpp_sensors`, collision prefers newer, empty→`{}`. Use the app's TestClient pattern from `tests/test_api.py`.

```python
# Pseudocode shape — adapt to the repo's TestClient/async fixtures in tests/test_api.py
async def test_latest_endpoint_merges_and_extracts(client, telemetry_db):
    await RepeaterTelemetryRepository.record("aa", 200, {"battery_volts": 4.0,
        "lpp_sensors": [{"channel": 1, "type_name": "temperature", "value": 21.5}]})
    await ContactTelemetryRepository.record("bb", 210, {
        "lpp_sensors": [{"channel": 1, "type_name": "temperature", "value": 9.0}]})
    resp = client.get("/api/contacts/telemetry/latest")
    body = resp.json()
    assert body["aa"] == {"timestamp": 200, "battery_volts": 4.0, "temperature": 21.5, "source": "repeater"}
    assert body["bb"]["temperature"] == 9.0 and body["bb"]["source"] == "contact"
    assert body["bb"].get("battery_volts") is None
```

- [ ] **Step 2:** run → FAIL (404 / no route).
- [ ] **Step 3 (impl):**

In `app/models.py` add:

```python
class LatestTelemetryEntry(BaseModel):
    timestamp: int
    battery_volts: float | None = None
    temperature: float | None = None
    source: str  # "repeater" | "contact"
```

In `app/routers/contacts.py` (import `LatestTelemetryEntry`; add near the telemetry-history route). Define it as a static path that cannot collide with `/{public_key}/...`:

```python
def _extract_temperature(data: dict) -> float | None:
    for entry in data.get("lpp_sensors") or []:
        if entry.get("type_name") == "temperature":
            v = entry.get("value")
            if isinstance(v, (int, float)):
                return float(v)
    return None


@router.get("/telemetry/latest", response_model=dict[str, LatestTelemetryEntry])
async def get_latest_telemetry() -> dict[str, LatestTelemetryEntry]:
    """Latest stored telemetry per node (read-only): battery + temperature at a glance."""
    from app.repository.contact_telemetry import ContactTelemetryRepository
    from app.repository.repeater_telemetry import RepeaterTelemetryRepository

    rep = await RepeaterTelemetryRepository.get_latest_all()
    con = await ContactTelemetryRepository.get_latest_all()
    out: dict[str, LatestTelemetryEntry] = {}
    for pk, row in rep.items():
        out[pk] = LatestTelemetryEntry(
            timestamp=row["timestamp"],
            battery_volts=row["data"].get("battery_volts"),
            temperature=_extract_temperature(row["data"]),
            source="repeater",
        )
    for pk, row in con.items():
        existing = out.get(pk)
        if existing is not None and existing.timestamp >= row["timestamp"]:
            continue
        out[pk] = LatestTelemetryEntry(
            timestamp=row["timestamp"],
            battery_volts=row["data"].get("battery_volts"),
            temperature=_extract_temperature(row["data"]),
            source="contact",
        )
    return out
```

- [ ] **Step 4:** run → PASS. Also `ruff check app/ && ruff format --check app/`.
- [ ] **Step 5:** Stage.

---

### Task 3: Frontend API + types

**Files:** Modify `frontend/src/types.ts`, `frontend/src/api.ts`; Test `frontend/src/test/api.test.ts` (extend).

- [ ] **Step 1 (test):** `getLatestTelemetry` calls the right path and returns the map (mirror an existing api.test.ts GET case).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3 (impl):**

`types.ts`:

```typescript
export interface LatestTelemetry {
  timestamp: number;
  battery_volts?: number | null;
  temperature?: number | null;
  source: 'repeater' | 'contact';
}
```

`api.ts` (in the Contacts block):

```typescript
  getLatestTelemetry: (signal?: AbortSignal) =>
    fetchJson<Record<string, LatestTelemetry>>('/contacts/telemetry/latest', { signal }),
```

- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** Stage.

---

### Task 4: Telemetry overlay layer

**Files:** Create `frontend/src/map/layers/telemetryLayer.ts`; Test `frontend/src/test/map/telemetryLayer.test.ts` (new).

- [ ] **Step 1 (test):** `buildTelemetryFeatures` — battery bucket from volts (×1000 unit fix), temperature join, age/stale flag, drops nodes with no telemetry and no coords, temperature-only node gets `battLevel = -1`.

```typescript
import { describe, it, expect } from 'vitest';
import { buildTelemetryFeatures, batteryLevelBucket, STALE_SEC } from '../../map/layers/telemetryLayer';
import { CONTACT_TYPE_CLIENT, type Contact, type LatestTelemetry } from '../../types';

const now = 1_000_000;
const c = (over: Partial<Contact>): Contact => ({
  public_key: 'aa', name: 'n', type: CONTACT_TYPE_CLIENT, flags: 0,
  direct_path: null, direct_path_len: 0, direct_path_hash_mode: 0,
  last_advert: null, lat: 52, lon: 5, last_seen: now, on_radio: true,
  favorite: false, radio_policy: 'auto', last_contacted: null,
  last_read_at: null, first_seen: null, ...over,
});

describe('batteryLevelBucket', () => {
  it('buckets battery volts to 0..4 (full->4, empty->0)', () => {
    expect(batteryLevelBucket(4.2)).toBe(4);
    expect(batteryLevelBucket(3.1)).toBe(0);
  });
});

describe('buildTelemetryFeatures', () => {
  const latest: Record<string, LatestTelemetry> = {
    aa: { timestamp: now - 60, battery_volts: 4.0, temperature: 21.5, source: 'repeater' },
    bb: { timestamp: now - 60, battery_volts: null, temperature: 9, source: 'contact' },
    old: { timestamp: now - STALE_SEC - 10, battery_volts: 3.5, temperature: null, source: 'repeater' },
  };
  it('joins telemetry, flags stale, and drops nodes with neither coords nor telemetry', () => {
    const fc = buildTelemetryFeatures(
      [c({ public_key: 'aa' }), c({ public_key: 'bb' }), c({ public_key: 'old' }),
       c({ public_key: 'zz' }), c({ public_key: 'nocoord', lat: null })],
      latest, now
    );
    const byId = Object.fromEntries(fc.features.map((f) => [f.properties.id, f.properties]));
    expect(byId.aa.battLevel).toBeGreaterThanOrEqual(0);
    expect(byId.bb.battLevel).toBe(-1); // temperature-only
    expect(byId.old.stale).toBe(true);
    expect(byId.zz).toBeUndefined(); // no telemetry
    expect(byId.nocoord).toBeUndefined(); // no coords
  });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3 (impl):** Create `telemetryLayer.ts`. Key pieces:
  - `export const STALE_SEC = 24 * 3600;` `export const TELEMETRY_MIN_ZOOM = 10;`
  - `batteryLevelBucket(volts)`: `const pct = mvToPercent(volts * 1000);` then map `pct` → 0..4 (e.g. `<10→0, <30→1, <55→2, <80→3, else 4`). Import `mvToPercent` from `../../utils/batteryDisplay`.
  - `buildTelemetryFeatures(contacts, latest, nowSec)`: for each contact with lat/lon AND a `latest[pk]`, compute `battLevel` (−1 when `battery_volts` null/undefined), `temp`, `ageSec = nowSec - timestamp`, `stale = ageSec > STALE_SEC`, and `label` text = `[temp!=null ? `${Math.round(temp)}°` : '', ageStr(ageSec)].filter(Boolean).join(' · ')`. Drop others.
  - `ageStr(sec)`: compact (`<90s→'now'`, `<3600→'Xm'`, `<86400→'Xh'`, else `'Xd'`).
  - `createTelemetryLayer(map, opts)`: controller with `ensure()` (registers 6 canvas icons `batt-0..4` + `batt-none` via `registerBatteryIcons(map)`, adds source `rt-telemetry` + symbol layer `rt-telemetry-badges`), `reattach()` (re-register icons + re-add layer after a basemap restyle), `setData(contacts, latest, nowSec)`, `setVisible(on)` (toggles layer `visibility`).
  - Symbol layer: `icon-image: ['case', ['>=',['get','battLevel'],0], ['concat','batt-',['to-string',['get','battLevel']]], 'batt-none']`, `icon-size` ~1, `text-field: ['get','label']`, `text-size` 10, `text-offset` [0.9,0], `text-anchor: 'left'`, `text-allow-overlap:false`, `text-optional:true`, outlined text (`#f8fafc` on `#0f172a` halo 1.2), `minzoom: TELEMETRY_MIN_ZOOM`, and opacity via `['case',['get','stale'],0.45,1]` for both `icon-opacity` and `text-opacity`. `layout.visibility` starts `'none'`.
  - `registerBatteryIcons(map)`: for levels 0..4 draw a small battery glyph on an OffscreenCanvas/`document.createElement('canvas')` filled proportionally and colored (0 `#ef4444`, 1 `#f59e0b`, 2 `#f59e0b`, 3 `#22c55e`, 4 `#22c55e`); `map.addImage('batt-'+lvl, {width,height,data:ctx.getImageData(...).data})` guarded by `if (!map.hasImage(...))`. `batt-none`: a faint dot. (Icons are raster ImageData, recolor baked in — no SDF.)

- [ ] **Step 4:** run → PASS (the build step needs jsdom canvas; the UNIT test only exercises `buildTelemetryFeatures`/`batteryLevelBucket`, not canvas — keep icon registration out of the unit-tested path).
- [ ] **Step 5:** Stage.

---

### Task 5: MapView + MapSurface + MapControls wiring

**Files:** Modify `frontend/src/components/MapView.tsx`, `frontend/src/map/MapSurface.tsx`, `frontend/src/map/controls/MapControls.tsx`; Test `frontend/src/test/map/mapControls.test.tsx` (extend).

- [ ] **Step 1 (test):** MapControls renders a telemetry toggle in Overlays and reports toggling.

```tsx
  it('renders the telemetry overlay toggle and reports it', () => {
    const onToggleTelemetry = vi.fn();
    renderControls({ fabs: { telemetry: true }, telemetryOn: false, onToggleTelemetry });
    fireEvent.click(screen.getByRole('button', { name: 'Overlays' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /telemetry/i }));
    expect(onToggleTelemetry).toHaveBeenCalledWith(true);
  });
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3 (impl):**
  - `MapControls.tsx`: add `telemetry?: boolean` to `FabConfig`; add `telemetryOn?: boolean` + `onToggleTelemetry?: (on:boolean)=>void` to props + destructure (`telemetryOn = false`). Add a `telemetry` section (a single checkbox labeled `t('map_telemetry_label')`) and add `'telemetry'` to the Overlays group `memberIds` (`['packets','links','telemetry']`).
  - `MapSurface.tsx`: add the two props to `MapSurfaceProps` and pass through to `<MapControls>`.
  - `MapView.tsx`:
    - consts: `const MAP_TELEMETRY_STORAGE_KEY = 'remoteterm-map-telemetry';`
    - state: `telemetryOn` (init from localStorage, default false), `latestTelemetry` (`Record<string, LatestTelemetry>`, default `{}`).
    - ref: `telemetryRef = useRef<ReturnType<typeof createTelemetryLayer> | null>(null)`.
    - `handleReady`: create + `ensure()` the telemetry layer; `setData(mappableContacts, latestTelemetry, nowSec)`; `setVisible(telemetryOn)`.
    - `handleBasemapReapply`: `telemetryRef.current?.reattach(); ...setData...; setVisible(telemetryOn)`.
    - effect `[telemetryOn]`: persist; `setVisible`; when turning on, fetch immediately and start a `setInterval(60000)` refresh storing into `latestTelemetry`; when off, clear the interval. Use an AbortController + cleanup.
    - effect `[mappableContacts, latestTelemetry, nowSec]`: `telemetryRef.current?.setData(...)`.
    - pass `fabs.telemetry = true`, `telemetryOn`, `onToggleTelemetry={setTelemetryOn}` to `<MapSurface>`.
- [ ] **Step 4:** run `test:run -- mapControls` and `build` → PASS / clean.
- [ ] **Step 5:** Stage.

---

### Task 6: i18n + changelog + gates

**Files:** Modify `frontend/src/i18n/locales/{en,nl,de}.json`, `CHANGELOG-DMC-EV.md`.

- [ ] **Step 1:** add `map_telemetry_label` to all three locales: en "Telemetry (battery/temp)", nl "Telemetrie (accu/temp)", de "Telemetrie (Akku/Temp)".
- [ ] **Step 2:** i18n parity test passes: `npm run test:run -- i18n`.
- [ ] **Step 3:** changelog entry under a new `## Update 2026-09-13 (telemetry map overlay)` section.
- [ ] **Step 4 (full gate):**
  - Backend: `PYTHONPATH=. uv run pytest tests/ -q`, `uv run ruff check .`, `uv run ruff format --check .` (or run backend tests in the `rtfm-ev-local` container per the documented method if the host venv is unavailable).
  - Frontend: `npm run lint && npm run format:check && npm run test:run && npm run build`.
- [ ] **Step 5:** Stage all.
- [ ] **Step 6 (runtime, REQUIRED before "works"):** live app — enable the overlay, confirm battery icons + temp/age badges render for nodes with telemetry, colors track level, stale greys out, toggle persists, node colors/labels unaffected. Record NOT VERIFIED if not observed.

---

## Self-Review

- **Spec coverage:** separate icon overlay (Task 4/5), battery primary + temp secondary (Task 4 label + icon), latest + age + grey stale (Task 4 `stale`/`ageStr`), opt-in off-by-default toggle (Task 5/6), bulk endpoint since no data source existed (Task 1/2). MQTT left as a flagged finding per spec — no task, intentional.
- **Type consistency:** `LatestTelemetry` (frontend) mirrors `LatestTelemetryEntry` (backend) fields. `get_latest_all` identical across both repos bar table name. `createTelemetryLayer` controller methods (`ensure/reattach/setData/setVisible`) referenced identically in Task 5. `battLevel = -1` sentinel defined in Task 4 test and impl, consumed by the `icon-image` expression.
- **Placeholder scan:** endpoint/model/repo code is complete; the canvas `registerBatteryIcons` is described precisely (inputs, addImage call, guard) rather than pasted pixel-by-pixel because it is drawing code with latitude in exact glyph shape — the contract (6 images named `batt-0..4`,`batt-none`, colored by level) is fixed. This is a deliberate drawing-freedom note, not an unresolved TBD.
