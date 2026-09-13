# Map Node Labels and Observed-Width ID Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Off / Name / ID-tag label control to the map, where the ID tag is each node's public-key prefix sized to its observed path-hash width (1/2/3 bytes → 2/4/6 hex).

**Architecture:** Pure frontend. A new MapLibre `symbol` layer (`rt-node-labels`) bound to the existing `rt-nodes` GeoJSON source renders a computed `label` feature property, gated by `minzoom`. A three-state control in `MapControls` (display group) drives a `labelMode` state in `MapView`, persisted to `localStorage`, pushed into the nodes-layer controller.

**Tech Stack:** React 18, TypeScript, MapLibre GL 4, Vitest, ESLint, Prettier, i18next (en/nl/de).

> **PROJECT GIT RULE (overrides skill default):** Do NOT `git commit` or push. Where a step below says "Stage", run only `git add` and stop. The user integrates/commits explicitly later.

---

### Task 1: `observedIdTag` helper

**Files:**
- Modify: `frontend/src/map/layers/nodesLayer.ts`
- Test: `frontend/src/test/map/nodesLayer.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/test/map/nodesLayer.test.ts` (add `observedIdTag` to the import on line 2):

```typescript
import {
  buildNodeFeatures,
  circleRadiusExpr,
  recencyTier,
  observedIdTag,
} from '../../map/layers/nodesLayer';
```

Then append:

```typescript
describe('observedIdTag', () => {
  const pk = '0123456789abcdef0123456789abcdef'; // 32 hex chars

  it('sizes the tag to the observed hash width (mode+1 bytes, uppercase)', () => {
    expect(observedIdTag(pk, 0)).toBe('01'); // 1 byte  -> 2 hex
    expect(observedIdTag(pk, 1)).toBe('0123'); // 2 bytes -> 4 hex
    expect(observedIdTag(pk, 2)).toBe('012345'); // 3 bytes -> 6 hex
  });

  it('defaults unknown / out-of-range modes to 1 byte', () => {
    expect(observedIdTag(pk, -1)).toBe('01');
    expect(observedIdTag(pk, 3)).toBe('01');
    expect(observedIdTag(pk, null)).toBe('01');
    expect(observedIdTag(pk, undefined)).toBe('01');
    expect(observedIdTag(pk, 1.5)).toBe('01');
  });

  it('returns what exists when the pubkey is shorter than the width', () => {
    expect(observedIdTag('ab', 2)).toBe('AB');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- nodesLayer`
Expected: FAIL — `observedIdTag is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/map/layers/nodesLayer.ts`, add after `recencyTier` (after line 39):

```typescript
/**
 * Short ID tag for a node: the public-key prefix sized to the path-hash width
 * observed for that node. hash_mode 0/1/2 -> 1/2/3 bytes -> 2/4/6 hex chars.
 * Unknown / out-of-range modes (null, -1, 3, non-integer) fall back to 1 byte.
 */
export function observedIdTag(
  publicKey: string,
  hashMode: number | null | undefined
): string {
  const mode =
    typeof hashMode === 'number' && Number.isInteger(hashMode) && hashMode >= 0 && hashMode <= 2
      ? hashMode
      : 0;
  return publicKey.slice(0, (mode + 1) * 2).toUpperCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- nodesLayer`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add frontend/src/map/layers/nodesLayer.ts frontend/src/test/map/nodesLayer.test.ts
```

---

### Task 2: `buildNodeFeatures` label mode + `label` property

**Files:**
- Modify: `frontend/src/map/layers/nodesLayer.ts:63-78`
- Test: `frontend/src/test/map/nodesLayer.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/test/map/nodesLayer.test.ts`:

```typescript
describe('buildNodeFeatures label property', () => {
  const pk = '0123456789abcdef0123456789abcdef';

  it("defaults to an empty label ('off')", () => {
    const fc = buildNodeFeatures([contact({ public_key: pk, name: 'Alice' })], now);
    expect(fc.features[0].properties.label).toBe('');
  });

  it("uses the advert name in 'name' mode, falling back to a 12-char prefix", () => {
    const named = buildNodeFeatures([contact({ public_key: pk, name: 'Alice' })], now, 'name');
    expect(named.features[0].properties.label).toBe('Alice');
    const unnamed = buildNodeFeatures(
      [contact({ public_key: pk, name: null })],
      now,
      'name'
    );
    expect(unnamed.features[0].properties.label).toBe(pk.slice(0, 12));
  });

  it("uses the observed-width ID tag in 'tag' mode", () => {
    const fc = buildNodeFeatures(
      [contact({ public_key: pk, direct_path_hash_mode: 1 })],
      now,
      'tag'
    );
    expect(fc.features[0].properties.label).toBe('0123');
  });
});
```

Note: `contact()` already allows `name: null`? The helper's default `name: 'n'`; `name` is overridable to `null` via `Partial<Contact>` since `Contact.name` is `string | null`. Confirm `Contact.name` type allows null in `types.ts`; if not, cast `{ name: null as unknown as string }` is NOT needed — `types.ts:187` declares `name: string | null`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- nodesLayer`
Expected: FAIL — `properties.label` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

Replace `buildNodeFeatures` (`frontend/src/map/layers/nodesLayer.ts:63-78`) with:

```typescript
export type NodeLabelMode = 'off' | 'name' | 'tag';

function nodeLabel(c: Contact, mode: NodeLabelMode): string {
  if (mode === 'name') return c.name ?? c.public_key.slice(0, 12);
  if (mode === 'tag') return observedIdTag(c.public_key, c.direct_path_hash_mode);
  return '';
}

export function buildNodeFeatures(
  contacts: Contact[],
  nowSec: number,
  labelMode: NodeLabelMode = 'off'
) {
  const features = contacts
    .filter((c) => c.lat != null && c.lon != null)
    .map((c) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [c.lon as number, c.lat as number] },
      properties: {
        id: c.public_key,
        name: c.name ?? c.public_key.slice(0, 12),
        label: nodeLabel(c, labelMode),
        type: c.type,
        repeater: c.type === CONTACT_TYPE_REPEATER,
        tier: recencyTier(c.last_seen, nowSec),
      },
    }));
  return { type: 'FeatureCollection' as const, features };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- nodesLayer`
Expected: PASS (all prior `buildNodeFeatures` tests still pass — the default arg keeps two-arg callers valid).

- [ ] **Step 5: Stage**

```bash
git add frontend/src/map/layers/nodesLayer.ts frontend/src/test/map/nodesLayer.test.ts
```

---

### Task 3: Symbol layer + `setLabelMode` in `createNodesLayer`

**Files:**
- Modify: `frontend/src/map/layers/nodesLayer.ts` (`createNodesLayer`: `addSourceAndLayer`, `setData`, controller return ~97-162)

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/test/map/nodesLayer.test.ts` a constant assertion guarding the zoom threshold so it is covered and not silently changed:

```typescript
import { LABEL_MIN_ZOOM } from '../../map/layers/nodesLayer';

describe('label layer config', () => {
  it('hides labels below the density zoom threshold', () => {
    expect(LABEL_MIN_ZOOM).toBe(11);
  });
});
```

(Add `LABEL_MIN_ZOOM` to the existing import block from `../../map/layers/nodesLayer`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- nodesLayer`
Expected: FAIL — `LABEL_MIN_ZOOM` not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/map/layers/nodesLayer.ts`:

Add near the top-level consts (after `NODE_TYPE_STROKE`, ~line 30):

```typescript
// Labels only render at/above this zoom to keep wide views uncluttered.
export const LABEL_MIN_ZOOM = 11;
```

In `createNodesLayer`, add internal state next to `nodeScale` (~line 91):

```typescript
  let labelMode: NodeLabelMode = 'off';
  let lastContacts: Contact[] = [];
  let lastNowSec = 0;
```

Extend `addSourceAndLayer` (after the `rt-nodes` circle `addLayer`, before its closing `}` at ~line 112) to add the symbol layer:

```typescript
    if (!m.getLayer('rt-node-labels')) {
      m.addLayer({
        id: 'rt-node-labels',
        type: 'symbol',
        source: 'rt-nodes',
        minzoom: LABEL_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-allow-overlap': false,
          'text-optional': true,
          'text-font': ['Noto Sans Regular', 'Open Sans Regular', 'sans-serif'],
        },
        paint: {
          // Outlined label: near-white fill with a dark halo reads on both
          // light and dark basemaps without needing theme detection.
          'text-color': '#f8fafc',
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.5,
        },
      });
    }
```

Replace `setData` (`nodesLayer.ts:130-133`) with a caching version:

```typescript
  function setData(contacts: Contact[], nowSec: number) {
    lastContacts = contacts;
    lastNowSec = nowSec;
    const src = m.getSource('rt-nodes');
    if (src) src.setData(buildNodeFeatures(contacts, nowSec, labelMode));
  }

  function setLabelMode(mode: NodeLabelMode) {
    labelMode = mode;
    const src = m.getSource('rt-nodes');
    if (src) src.setData(buildNodeFeatures(lastContacts, lastNowSec, labelMode));
  }
```

Update the controller return (`nodesLayer.ts:161`) to expose `setLabelMode`:

```typescript
  return { ensure, reattach, setData, setNodeScale, setRoleColors, setLabelMode };
```

Note on `text-font`: MapLibre vector styles must provide these glyphs; the project's `map_layer_nova` / `ofm_*` styles use Noto/Open Sans glyph stacks. If a runtime "missing glyph" warning appears for a basemap, fall back to that style's documented font name. Raster-fallback basemaps have no glyphs server — labels still render via MapLibre's local font rendering for Latin text.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- nodesLayer`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add frontend/src/map/layers/nodesLayer.ts frontend/src/test/map/nodesLayer.test.ts
```

---

### Task 4: `labelMode` control in `MapControls`

**Files:**
- Modify: `frontend/src/map/controls/MapControls.tsx` (props ~43-67; sections ~210-408; GROUPS ~410-429)
- Test: `frontend/src/test/mapControls.test.tsx` (create if absent; otherwise extend existing control test)

- [ ] **Step 1: Write the failing test**

Check for an existing control test first: `ls frontend/src/test | grep -i control`. If one exists, extend it; otherwise create `frontend/src/test/mapControls.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MapControls } from '../map/controls/MapControls';

describe('MapControls label mode', () => {
  it('renders Off/Name/ID tag and reports selection', () => {
    const onLabelMode = vi.fn();
    render(
      <MapControls
        fabs={{ labelMode: true }}
        labelMode="off"
        onLabelMode={onLabelMode}
      />
    );
    // Open the display group panel.
    fireEvent.click(screen.getByRole('button', { name: /display/i }));
    fireEvent.click(screen.getByRole('radio', { name: /ID tag/i }));
    expect(onLabelMode).toHaveBeenCalledWith('tag');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- mapControls`
Expected: FAIL — `labelMode`/`onLabelMode` props and the control do not exist.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/map/controls/MapControls.tsx`:

Add to `FabConfig` (after `links?: boolean;`, line 28):

```typescript
  labelMode?: boolean;
```

Add to `MapControlsProps` (after the `nodeScale`/role props, ~line 56):

```typescript
  labelMode?: 'off' | 'name' | 'tag';
  onLabelMode?: (mode: 'off' | 'name' | 'tag') => void;
```

Destructure the new props wherever the component destructures its props (add `labelMode = 'off'` and `onLabelMode` to the destructuring list). 

Add a section builder alongside the others (after the `nodeSize` section block, ~line 304):

```tsx
  if (fabs.labelMode) {
    const labelOptions: { value: 'off' | 'name' | 'tag'; label: string }[] = [
      { value: 'off', label: t('map_labels_off') },
      { value: 'name', label: t('map_labels_name') },
      { value: 'tag', label: t('map_labels_tag') },
    ];
    sectionById.labelMode = {
      id: 'labelMode',
      title: t('map_labels_label'),
      body: (
        <div role="radiogroup" aria-label={t('map_labels_label')} className="flex flex-col gap-1">
          {labelOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={labelMode === opt.value}
              className={
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ' +
                (labelMode === opt.value
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50')
              }
              onClick={() => onLabelMode?.(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ),
    };
  }
```

Add `'labelMode'` to the `display` group's `memberIds` (line 415):

```typescript
      memberIds: ['layers', 'nodeSize', 'labelMode', 'legend'],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- mapControls`
Expected: PASS.

- [ ] **Step 5: Stage**

```bash
git add frontend/src/map/controls/MapControls.tsx frontend/src/test/mapControls.test.tsx
```

---

### Task 5: Wire `labelMode` through `MapView`

**Files:**
- Modify: `frontend/src/components/MapView.tsx` (consts ~93; getter ~122; state ~217; persistence effect ~449; push-to-layer effects ~893-899; handleReady ~838; handleBasemapReapply ~882; MapControls JSX ~1140)

- [ ] **Step 1: Write the failing test**

This task is integration wiring; it is covered by the existing `frontend/src/test/mapView.test.tsx` plus Tasks 1-4 unit tests. Add a focused assertion to `mapView.test.tsx` only if that suite already renders `MapControls` with display fabs; otherwise rely on the build + runtime check. Add the storage-key round-trip test to the nodesLayer-adjacent unit layer is not possible (MapView owns it), so add this to `mapView.test.tsx` if it mounts MapView:

```tsx
it('defaults the label mode control to Off', () => {
  // within existing MapView render harness:
  // expect the display panel's labelMode radiogroup to have 'Off' checked.
});
```

If the existing `mapView.test.tsx` harness cannot easily assert this (heavy MapLibre mocking), skip the added test and note it: the behavior is verified by Task 4's control test + runtime. Do NOT leave a failing/empty test in the suite.

- [ ] **Step 2: Run the suite to confirm baseline**

Run: `cd frontend && npm run test:run -- mapView`
Expected: PASS (baseline, before wiring).

- [ ] **Step 3: Implement the wiring**

In `frontend/src/components/MapView.tsx`:

(a) Add the storage key (after line 93):

```typescript
const MAP_LABEL_MODE_STORAGE_KEY = 'remoteterm-map-label-mode';
const NODE_LABEL_MODES = ['off', 'name', 'tag'] as const;
type NodeLabelMode = (typeof NODE_LABEL_MODES)[number];
```

(b) Add a getter (after `getSavedNodeScale`, ~line 130):

```typescript
function getSavedLabelMode(): NodeLabelMode {
  try {
    const stored = localStorage.getItem(MAP_LABEL_MODE_STORAGE_KEY);
    if (stored && (NODE_LABEL_MODES as readonly string[]).includes(stored)) {
      return stored as NodeLabelMode;
    }
  } catch {
    /* ignore */
  }
  return 'off';
}
```

(c) Add state (after line 217):

```typescript
  const [labelMode, setLabelMode] = useState<NodeLabelMode>(getSavedLabelMode);
```

(d) Persist + push to layer (after the nodeScale effect, ~line 455):

```typescript
  useEffect(() => {
    try {
      localStorage.setItem(MAP_LABEL_MODE_STORAGE_KEY, labelMode);
    } catch {
      /* ignore */
    }
    nodesRef.current?.setLabelMode(labelMode);
  }, [labelMode]);
```

(e) Apply on layer creation in `handleReady` (after `nodes.setNodeScale(nodeScale);` at line 838):

```typescript
      nodes.setLabelMode(labelMode);
```

(f) Re-apply after a basemap restyle in `handleBasemapReapply` (after `nodes.setNodeScale(nodeScale);` at line 882):

```typescript
      nodes.setLabelMode(labelMode);
```

Note: `handleReady` has an `eslint-disable-next-line react-hooks/exhaustive-deps` with dep `[openContactPopup]` — `labelMode` read there is intentional-latest; leave the disable. To avoid a stale closure, prefer reading through a ref is unnecessary because the dedicated effect in (d) re-pushes `labelMode` after mount; `handleReady`'s call is a best-effort initial apply. Keep both.

(g) Pass props to `MapControls` (in the JSX, alongside `nodeScale`/`onNodeScale` at ~line 1144):

```tsx
        labelMode={labelMode}
        onLabelMode={setLabelMode}
```

(h) Enable the fab: find where `MapControls` receives its `fabs={{ ... }}` object in this file and add `labelMode: true` to it. (Search `fabs={{` in `MapView.tsx`.)

- [ ] **Step 4: Run tests + typecheck**

Run: `cd frontend && npm run test:run -- mapView && npm run build`
Expected: PASS; `tsc` clean (build runs `tsc && vite build`).

- [ ] **Step 5: Stage**

```bash
git add frontend/src/components/MapView.tsx frontend/src/test/mapView.test.tsx
```

---

### Task 6: i18n keys (en/nl/de)

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`, `frontend/src/i18n/locales/nl.json`, `frontend/src/i18n/locales/de.json`

- [ ] **Step 1: Write the failing check**

The repo enforces locale parity via a test (search: `grep -rl "parity" frontend/src/test`). Run it first:

Run: `cd frontend && npm run test:run -- i18n`
Expected (before adding keys to all three, if you add to only one): FAIL parity. This guards completeness.

- [ ] **Step 2: Add the keys to all three locales**

Add these keys (place them among the other `map_` keys, preserving each file's ordering/format). English (`en.json`):

```json
"map_labels_label": "Labels",
"map_labels_off": "Off",
"map_labels_name": "Name",
"map_labels_tag": "ID tag",
```

Dutch (`nl.json`):

```json
"map_labels_label": "Labels",
"map_labels_off": "Uit",
"map_labels_name": "Naam",
"map_labels_tag": "ID-tag",
```

German (`de.json`):

```json
"map_labels_label": "Beschriftungen",
"map_labels_off": "Aus",
"map_labels_name": "Name",
"map_labels_tag": "ID-Tag",
```

- [ ] **Step 3: Run the parity test**

Run: `cd frontend && npm run test:run -- i18n`
Expected: PASS.

- [ ] **Step 4: Stage**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
```

---

### Task 7: Full quality gate + docs

**Files:**
- Modify: `CHANGELOG-DMC-EV.md` (fork changelog), `frontend/AGENTS.md` (only if adding a line about map labels is warranted)

- [ ] **Step 1: Add a fork changelog entry**

Append under the appropriate area grouping in `CHANGELOG-DMC-EV.md`, matching existing format (e.g. a "Map" group):

```markdown
- Map: node labels with an Off / Name / ID-tag control. ID tags show each node's
  public-key prefix sized to its observed path-hash width (1/2/3 bytes). Labels
  render at/above zoom 11. (feature B)
```

- [ ] **Step 2: Run the full frontend quality gate**

Run each; all must pass:

```bash
cd frontend && npm run lint
cd frontend && npm run format:check
cd frontend && npm run test:run
cd frontend && npm run build
```

Expected: all exit 0. (Prettier `format:check` is a CI gate; if it flags files, run `npm run format` and re-stage. Watch the Windows CRLF caveat in `frontend/AGENTS.md`.)

- [ ] **Step 3: Stage docs**

```bash
git add CHANGELOG-DMC-EV.md frontend/AGENTS.md
```

- [ ] **Step 4: Runtime verification (REQUIRED before any "works" claim)**

Per project CLAUDE.md "Never claim it works without proof": build the branch into the live Docker instance (`rtfm-ev-local` on :8000, see memory), open the map, and:
1. Toggle Off → Name → ID tag; confirm labels appear only at/above zoom 11.
2. Confirm ID-tag widths match each node's observed hash mode (a node known only by flood shows 2 hex; a node with a 2-byte direct path shows 4 hex).
3. Check legibility on a dark/CRT basemap and a light basemap.

If runtime cannot be observed in this session, record the status as **NOT VERIFIED** and do not claim the feature works.

---

## Self-Review

- **Spec coverage:** Off/Name/ID-tag control (Task 4/5), observed-width tag with 1-byte fallback (Task 1), name fallback to 12-char prefix (Task 2), symbol layer + minzoom 11 density (Task 3), i18n parity (Task 6), testing + runtime gate (Task 7). All spec sections mapped.
- **Type consistency:** `NodeLabelMode = 'off'|'name'|'tag'` is defined in `nodesLayer.ts` (Task 2/3) and mirrored as an inline union in `MapControls.tsx` props (Task 4) and as a local type in `MapView.tsx` (Task 5) — three declarations of the same string union; intentional to avoid a cross-module import from a control into the layer. `setLabelMode` name is used identically in Tasks 3 and 5. `LABEL_MIN_ZOOM = 11` single source (Task 3), asserted (Task 3 test) and referenced in runtime check (Task 7).
- **Placeholder scan:** No TBD/TODO. Each code step shows full code. Task 5 step 1 intentionally conditional (existing MapLibre mock harness may not support the assertion) with an explicit instruction not to leave an empty/failing test — this is a real constraint, not a placeholder.
