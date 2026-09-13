# Node airtime utilization + unified time-range selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TX/RX airtime utilization (%) chart to the My Node page and replace the four bespoke time-range selectors with one shared selector using the base set `20m 1h 3h 6h 12h 24h 48h 3d 7d 14d 30d + Custom`.

**Architecture:** Phase 1 builds a shared `timeRanges` module + `<TimeRangeSelector>` component and migrates all four pages (each keeps its extras). Phase 2 persists the already-received `tx_air_secs`/`rx_air_secs` counters to a new `airtime_history` table, serves per-bin utilization % from a new endpoint (computed from adjacent-sample deltas, reset-safe), and charts it on My Node. Phase 3 makes the Raw Packet Feed's session stats fill from the persisted `raw_packets` DB for long ranges.

**Tech Stack:** FastAPI + aiosqlite (backend), React + TypeScript + Tailwind + Vitest (frontend), pytest (backend tests).

**Spec:** `docs/superpowers/specs/2026-09-13-node-airtime-and-unified-time-selector-design.md`

---

## Conventions for this repo (read once)

- **Backend tests run in the container** (`rtfm-ev-local`, `/app/.venv`), worktree bind-mounted to `/work`. Run pytest via that venv. Example:
  `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/... -v`
- **CI gates before pushing** (`docs/agents/ci-checks.md`): backend `ruff check .` and `ruff format --check .`; frontend `npm run lint`, `npm run format:check`, `npm run test:run`, `npm run build`. Run `npm run format` before `format:check`.
- **i18n is enforced.** Every new user-facing string needs a `t()` key in `frontend/src/i18n/locales/{en,nl,de}.json`; a parity test fails otherwise. Compact time labels (`3h`, `12h`, …) are locale-invariant unit shorthand — same text in all three locales (matches the existing `node_window_*` convention, `MyNodeView.tsx:175-187`).
- **Commits:** the repo forbids committing unless the human running the plan says so, and forbids AI attribution lines. The commit steps below are written for when execution is authorized; do not push without explicit instruction. No `Co-authored-by`/attribution lines.
- **No em dashes in user-visible strings.**

## The shared component API (defined in Task 1.2, referenced by every page migration)

`<TimeRangeSelector>` props:
```ts
interface TimeRangeSelectorProps {
  value: string;                       // active range id, e.g. '1h' or 'custom'
  onChange: (id: string) => void;
  extrasBefore?: TimeRange[];          // rendered before the base buttons (shorter windows)
  extrasAfter?: TimeRange[];           // rendered after the base buttons (longer windows, e.g. 1y)
  extrasSpecial?: TimeRange[];         // rendered after a divider (e.g. 'All', 'session')
  showCustom?: boolean;                // default true
  customStart: string;                 // datetime-local value
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  onApplyCustom: (startSec: number, endSec: number) => void;
  className?: string;
}
```
Every page migration: build its `extras*` arrays, render `<TimeRangeSelector>`, and map the selected id to a start/end via `resolveRange(...)` (Task 1.1).

---

# PHASE 1 — Unified time-range selector

## Task 1.1: `timeRanges` module (single source of truth)

**Files:**
- Create: `frontend/src/utils/timeRanges.ts`
- Test: `frontend/src/utils/timeRanges.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/utils/timeRanges.test.ts
import { describe, it, expect } from 'vitest';
import { BASE_TIME_RANGES, CUSTOM_RANGE_ID, resolveRange, type TimeRange } from './timeRanges';

describe('timeRanges', () => {
  it('has the 11 base ranges in order', () => {
    expect(BASE_TIME_RANGES.map((r) => r.id)).toEqual([
      '20m', '1h', '3h', '6h', '12h', '24h', '48h', '3d', '7d', '14d', '30d',
    ]);
  });

  it('resolves a base id to now - seconds .. now', () => {
    const now = 1_000_000;
    expect(resolveRange('1h', { nowSec: now })).toEqual({ startTs: now - 3600, endTs: now });
    expect(resolveRange('48h', { nowSec: now })).toEqual({ startTs: now - 172800, endTs: now });
  });

  it('resolves custom from provided seconds', () => {
    expect(
      resolveRange(CUSTOM_RANGE_ID, { customStartSec: 100, customEndSec: 200 }),
    ).toEqual({ startTs: 100, endTs: 200 });
  });

  it('returns null for custom without both bounds', () => {
    expect(resolveRange(CUSTOM_RANGE_ID, { customStartSec: 100 })).toBeNull();
  });

  it('resolves an extra with null seconds (All) to startTs 0', () => {
    const extras: TimeRange[] = [{ id: 'all', labelKey: 'x', seconds: null }];
    expect(resolveRange('all', { nowSec: 500, extras })).toEqual({ startTs: 0, endTs: 500 });
  });

  it('returns null for an unknown id', () => {
    expect(resolveRange('nope', { nowSec: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd frontend && npx vitest run src/utils/timeRanges.test.ts`
Expected: FAIL — cannot resolve module `./timeRanges`.

- [ ] **Step 3: Implement the module**

```ts
// frontend/src/utils/timeRanges.ts
export interface TimeRange {
  /** Stable id used as the selection value and persistence key. */
  id: string;
  /** i18n key for the button label. */
  labelKey: string;
  /** Window length in seconds, or null for "no lower bound" (e.g. All). */
  seconds: number | null;
}

export const CUSTOM_RANGE_ID = 'custom';

export const BASE_TIME_RANGES: TimeRange[] = [
  { id: '20m', labelKey: 'time_range_20m', seconds: 20 * 60 },
  { id: '1h', labelKey: 'time_range_1h', seconds: 60 * 60 },
  { id: '3h', labelKey: 'time_range_3h', seconds: 3 * 60 * 60 },
  { id: '6h', labelKey: 'time_range_6h', seconds: 6 * 60 * 60 },
  { id: '12h', labelKey: 'time_range_12h', seconds: 12 * 60 * 60 },
  { id: '24h', labelKey: 'time_range_24h', seconds: 24 * 60 * 60 },
  { id: '48h', labelKey: 'time_range_48h', seconds: 48 * 60 * 60 },
  { id: '3d', labelKey: 'time_range_3d', seconds: 3 * 24 * 60 * 60 },
  { id: '7d', labelKey: 'time_range_7d', seconds: 7 * 24 * 60 * 60 },
  { id: '14d', labelKey: 'time_range_14d', seconds: 14 * 24 * 60 * 60 },
  { id: '30d', labelKey: 'time_range_30d', seconds: 30 * 24 * 60 * 60 },
];

interface ResolveOpts {
  nowSec?: number;
  customStartSec?: number | null;
  customEndSec?: number | null;
  extras?: TimeRange[];
}

/** Resolve a range id to absolute {startTs,endTs} in Unix seconds, or null if unresolvable. */
export function resolveRange(id: string, opts: ResolveOpts = {}): { startTs: number; endTs: number } | null {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (id === CUSTOM_RANGE_ID) {
    if (opts.customStartSec == null || opts.customEndSec == null) return null;
    return { startTs: opts.customStartSec, endTs: opts.customEndSec };
  }
  const all = [...BASE_TIME_RANGES, ...(opts.extras ?? [])];
  const range = all.find((r) => r.id === id);
  if (!range) return null;
  if (range.seconds == null) return { startTs: 0, endTs: now };
  return { startTs: now - range.seconds, endTs: now };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd frontend && npx vitest run src/utils/timeRanges.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/timeRanges.ts frontend/src/utils/timeRanges.test.ts
git commit -m "feat(frontend): shared timeRanges module for unified time selection"
```

## Task 1.2: i18n keys for the shared selector

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Add the keys to all three locale files**

Add these keys to each of `en.json`, `nl.json`, `de.json` (same values in every file — compact labels are locale-invariant; `from`/`to`/`apply`/`custom` you may translate but identical is acceptable and keeps parity):

```json
"time_range_20m": "20m",
"time_range_1h": "1h",
"time_range_3h": "3h",
"time_range_6h": "6h",
"time_range_12h": "12h",
"time_range_24h": "24h",
"time_range_48h": "48h",
"time_range_3d": "3d",
"time_range_7d": "7d",
"time_range_14d": "14d",
"time_range_30d": "30d",
"time_range_1y": "1y",
"time_range_all": "All",
"time_range_session": "session",
"time_range_custom": "Custom",
"time_range_from": "From",
"time_range_to": "To",
"time_range_apply": "Apply"
```

For `nl.json` translate the prose keys (`time_range_custom` → "Aangepast", `_from` → "Van", `_to` → "Tot", `_apply` → "Toepassen"); for `de.json` (`custom` → "Benutzerdef.", `from` → "Von", `to` → "Bis", `apply` → "Anwenden"). Keep the compact unit labels identical across locales.

- [ ] **Step 2: Verify parity**

Run: `cd frontend && npx vitest run` and confirm the i18n parity test passes (search the suite for the locale-parity test; it fails if any key is missing from a locale).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "i18n: add unified time-range selector labels (en/nl/de)"
```

## Task 1.3: `<TimeRangeSelector>` component

**Files:**
- Create: `frontend/src/components/TimeRangeSelector.tsx`
- Test: `frontend/src/components/TimeRangeSelector.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/TimeRangeSelector.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeRangeSelector } from './TimeRangeSelector';

// The component calls useT(); provide a passthrough mock that returns the key.
vi.mock('../i18n', () => ({ useT: () => (k: string) => k }));

function base(overrides = {}) {
  return {
    value: '1h',
    onChange: vi.fn(),
    customStart: '',
    customEnd: '',
    onCustomStartChange: vi.fn(),
    onCustomEndChange: vi.fn(),
    onApplyCustom: vi.fn(),
    ...overrides,
  };
}

describe('TimeRangeSelector', () => {
  it('renders all 11 base range buttons plus Custom', () => {
    render(<TimeRangeSelector {...base()} />);
    for (const label of ['time_range_20m','time_range_1h','time_range_30d','time_range_custom']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders extras in the right slots', () => {
    render(
      <TimeRangeSelector
        {...base()}
        extrasAfter={[{ id: '1y', labelKey: 'time_range_1y', seconds: 31536000 }]}
        extrasSpecial={[{ id: 'all', labelKey: 'time_range_all', seconds: null }]}
      />,
    );
    expect(screen.getByText('time_range_1y')).toBeInTheDocument();
    expect(screen.getByText('time_range_all')).toBeInTheDocument();
  });

  it('fires onChange with the clicked id', () => {
    const onChange = vi.fn();
    render(<TimeRangeSelector {...base({ onChange })} />);
    fireEvent.click(screen.getByText('time_range_6h'));
    expect(onChange).toHaveBeenCalledWith('6h');
  });

  it('shows the custom row only when value is custom and gates Apply on both bounds', () => {
    const onApplyCustom = vi.fn();
    const { rerender } = render(<TimeRangeSelector {...base({ value: 'custom' })} />);
    // No apply until both provided
    expect(screen.queryByText('time_range_apply')).toBeNull();
    rerender(
      <TimeRangeSelector
        {...base({ value: 'custom', customStart: '2026-09-01T00:00', customEnd: '2026-09-02T00:00', onApplyCustom })}
      />,
    );
    fireEvent.click(screen.getByText('time_range_apply'));
    expect(onApplyCustom).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd frontend && npx vitest run src/components/TimeRangeSelector.test.tsx`
Expected: FAIL — cannot resolve `./TimeRangeSelector`.

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/components/TimeRangeSelector.tsx
import { useT } from '../i18n';
import {
  BASE_TIME_RANGES,
  CUSTOM_RANGE_ID,
  type TimeRange,
} from '../utils/timeRanges';

interface TimeRangeSelectorProps {
  value: string;
  onChange: (id: string) => void;
  extrasBefore?: TimeRange[];
  extrasAfter?: TimeRange[];
  extrasSpecial?: TimeRange[];
  showCustom?: boolean;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  onApplyCustom: (startSec: number, endSec: number) => void;
  className?: string;
}

export function TimeRangeSelector({
  value,
  onChange,
  extrasBefore = [],
  extrasAfter = [],
  extrasSpecial = [],
  showCustom = true,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
  onApplyCustom,
  className,
}: TimeRangeSelectorProps) {
  const t = useT();
  const mainRanges = [...extrasBefore, ...BASE_TIME_RANGES, ...extrasAfter];

  function btnClass(active: boolean): string {
    return `rounded px-2 py-0.5 text-xs transition ${
      active
        ? 'bg-primary text-primary-foreground font-medium'
        : 'border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
    }`;
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1">
        {mainRanges.map((r) => (
          <button key={r.id} onClick={() => onChange(r.id)} className={btnClass(value === r.id)}>
            {t(r.labelKey)}
          </button>
        ))}
        {(extrasSpecial.length > 0 || showCustom) && (
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        )}
        {extrasSpecial.map((r) => (
          <button key={r.id} onClick={() => onChange(r.id)} className={btnClass(value === r.id)}>
            {t(r.labelKey)}
          </button>
        ))}
        {showCustom && (
          <button
            onClick={() => onChange(CUSTOM_RANGE_ID)}
            className={btnClass(value === CUSTOM_RANGE_ID)}
          >
            {t('time_range_custom')}
          </button>
        )}
      </div>
      {showCustom && value === CUSTOM_RANGE_ID && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">{t('time_range_from')}</span>
          <input
            type="datetime-local"
            value={customStart}
            onChange={(e) => onCustomStartChange(e.target.value)}
            className="rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground"
          />
          <span className="text-xs text-muted-foreground">{t('time_range_to')}</span>
          <input
            type="datetime-local"
            value={customEnd}
            onChange={(e) => onCustomEndChange(e.target.value)}
            className="rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground"
          />
          {customStart && customEnd && (
            <button
              onClick={() => {
                const s = Math.floor(new Date(customStart).getTime() / 1000);
                const e = Math.floor(new Date(customEnd).getTime() / 1000);
                if (e > s) onApplyCustom(s, e);
              }}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-accent transition"
            >
              {t('time_range_apply')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

> Note: if `useT` is not exported from `../i18n`, check how existing components import the translator (e.g. `MyNodeView.tsx` uses `useT()`); match that import path. Adjust the test mock's module path to match.

- [ ] **Step 4: Run it, verify it passes**

Run: `cd frontend && npx vitest run src/components/TimeRangeSelector.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TimeRangeSelector.tsx frontend/src/components/TimeRangeSelector.test.tsx
git commit -m "feat(frontend): shared TimeRangeSelector component"
```

## Task 1.4: Migrate My Node to the shared selector

**Files:**
- Modify: `frontend/src/components/MyNodeView.tsx` (constants `TIME_WINDOWS` `:92-101`, `WINDOW_LABEL_KEYS` `:178-192`, selector JSX `:1810-1855`)

This is the worked reference migration; Tasks 1.5–1.7 follow the same shape.

- [ ] **Step 1: Add the extras + selector state mapping**

At the top of the file, near the other imports, add:
```ts
import { TimeRangeSelector } from './TimeRangeSelector';
import { BASE_TIME_RANGES, CUSTOM_RANGE_ID, resolveRange, type TimeRange } from '../utils/timeRanges';
```

Replace the `TIME_WINDOWS` constant (`:92-101`) with an extras definition and a live-window id set (My Node's `20m` stays the in-memory/live window; `1y` is kept as an extra):
```ts
// My Node keeps 1y as a longer extra; 20m remains the live/in-memory window.
const MYNODE_EXTRAS_AFTER: TimeRange[] = [
  { id: '1y', labelKey: 'time_range_1y', seconds: 365 * 24 * 60 * 60 },
];
const LIVE_WINDOW_IDS = new Set(['20m']);
const DEFAULT_WINDOW_ID = '20m';
```

- [ ] **Step 2: Replace `selectedWindow` object-state with an id + derived lookup**

Find where `selectedWindow` / `setSelectedWindow`, `customStart`, `customEnd`, `showCustomPicker` are declared and used. Change the primary state to an id:
```ts
const [selectedWindowId, setSelectedWindowId] = useState<string>(DEFAULT_WINDOW_ID);
const isLive = LIVE_WINDOW_IDS.has(selectedWindowId);
const rangeSeconds = (() => {
  const r = [...BASE_TIME_RANGES, ...MYNODE_EXTRAS_AFTER].find((x) => x.id === selectedWindowId);
  return r?.seconds ?? null;
})();
```
Everywhere the old code read `selectedWindow.useLive`, use `isLive`; `selectedWindow.seconds` → `rangeSeconds`; `selectedWindow.key` → `selectedWindowId`; `selectedWindow.label` (used in the historical effect dep at `:1464`) → `selectedWindowId`.

- [ ] **Step 3: Replace the selector JSX (`:1810-1855`)** with:
```tsx
<TimeRangeSelector
  value={selectedWindowId}
  onChange={setSelectedWindowId}
  extrasAfter={MYNODE_EXTRAS_AFTER}
  customStart={customStart}
  customEnd={customEnd}
  onCustomStartChange={setCustomStart}
  onCustomEndChange={setCustomEnd}
  onApplyCustom={(s, e) => void fetchHistorical(s, e)}
/>
```
Delete the now-unused `WINDOW_LABEL_KEYS`, `windowLabel`, and `showCustomPicker` state if nothing else references them (check `fmtWindowLabel` at `:194` — keep it but have it call `resolveRange`/label from `BASE_TIME_RANGES` instead of the deleted `windowLabel`; simplest: keep a tiny local `labelFor(id)` that looks up `[...BASE_TIME_RANGES, ...MYNODE_EXTRAS_AFTER]` and returns `t(labelKey)`).

- [ ] **Step 4: Fix the effect deps** that referenced the old object (`:1464`, `:1480`, `:1498-1504`) to use `selectedWindowId`, `isLive`, `rangeSeconds`. For the custom branch compare `selectedWindowId === CUSTOM_RANGE_ID`.

- [ ] **Step 5: Typecheck + run My Node-related tests + build**

Run:
```
cd frontend && npx tsc --noEmit && npx vitest run && npm run build
```
Expected: PASS. (No My Node unit test may exist; the build + typecheck are the guard. If a `MyNodeView` test exists, it must still pass.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/MyNodeView.tsx
git commit -m "refactor(my-node): use shared TimeRangeSelector (keeps 20m live, 1y extra)"
```

## Task 1.5: Migrate Mesh Health

**Files:**
- Modify: `frontend/src/components/MeshHealthView.tsx` (`TIME_WINDOWS` `:108-116`, `TimeWindow` interface `:101-106`, its selector JSX and fetch)

- [ ] **Step 1: Read the current selector + fetch code.** Open `MeshHealthView.tsx`, read the `TIME_WINDOWS` const (`:108-116`), the `autoRefresh` logic, and the selector JSX so you preserve the auto-refresh-on-short-windows behavior.

- [ ] **Step 2: Define extras + auto-refresh set.** Mesh Health keeps `30m` as a shorter extra and gains Custom:
```ts
import { TimeRangeSelector } from './TimeRangeSelector';
import { BASE_TIME_RANGES, CUSTOM_RANGE_ID, resolveRange, type TimeRange } from '../utils/timeRanges';

const MESH_HEALTH_EXTRAS_BEFORE: TimeRange[] = [
  { id: '30m', labelKey: 'time_range_30m', seconds: 30 * 60 },
];
const AUTO_REFRESH_IDS = new Set(['30m', '1h']); // preserve current 30m/1h auto-refresh
const DEFAULT_MESH_HEALTH_ID = '30m';
```
Add the `time_range_30m` key ("30m") to all three locale files (parity).

- [ ] **Step 3: Replace state + selector.** Convert the page's hours-based state to an id + `resolveRange(...)` for start/end (its data fetch currently uses `hours`; compute `hours = (endTs - startTs) / 3600` from the resolved range if the API still wants hours, or pass start/end if it accepts them — match the existing fetch signature). Replace the bespoke button row with:
```tsx
<TimeRangeSelector
  value={selectedId}
  onChange={setSelectedId}
  extrasBefore={MESH_HEALTH_EXTRAS_BEFORE}
  customStart={customStart}
  customEnd={customEnd}
  onCustomStartChange={setCustomStart}
  onCustomEndChange={setCustomEnd}
  onApplyCustom={(s, e) => void fetchForRange(s, e)}
/>
```
Gate auto-refresh on `AUTO_REFRESH_IDS.has(selectedId)`.

- [ ] **Step 4: Typecheck + tests + build.** `cd frontend && npx tsc --noEmit && npx vitest run && npm run build` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/components/MeshHealthView.tsx frontend/src/i18n/locales/*.json
git commit -m "refactor(mesh-health): use shared TimeRangeSelector (keeps 30m, adds Custom)"
```

## Task 1.6: Migrate Map ("Heard since")

**Files:**
- Modify: `frontend/src/components/MapView.tsx` (`MAP_SINCE_PRESETS` `:66-82`, `MapSinceId` type `:84`, FAB/popover JSX `:1063-1076`, localStorage key `remoteterm-map-since` `:86`)

- [ ] **Step 1: Read the current preset + popover + localStorage code** so you preserve persistence and the custom clock behavior.

- [ ] **Step 2: Define extras.** Map keeps `All` as a special extra:
```ts
import { BASE_TIME_RANGES, CUSTOM_RANGE_ID, resolveRange, type TimeRange } from '../utils/timeRanges';
const MAP_EXTRAS_SPECIAL: TimeRange[] = [{ id: 'all', labelKey: 'time_range_all', seconds: null }];
const DEFAULT_MAP_ID = '7d';
```

- [ ] **Step 3: Wire it.** Map uses a FAB/popover rather than an inline bar. Two options — pick to match the current UX:
  (a) keep the FAB popover but render `<TimeRangeSelector>` inside the popover body (recommended: least visual disruption), or
  (b) keep the compact FAB label and reuse only `BASE_TIME_RANGES + MAP_EXTRAS_SPECIAL` for the preset list.
  Persist the selected id under the existing `remoteterm-map-since` key. For `all`, `resolveRange` returns `{startTs: 0, endTs: now}` (matches the old "All"). Keep custom support.

- [ ] **Step 4: Typecheck + tests + build.** `cd frontend && npx tsc --noEmit && npx vitest run && npm run build` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/components/MapView.tsx
git commit -m "refactor(map): use shared time ranges (keeps All, adds base set + custom)"
```

## Task 1.7: Migrate Raw Packet Feed (selector only; DB fill is Phase 3)

**Files:**
- Modify: `frontend/src/components/RawPacketFeedView.tsx` (`WINDOW_LABEL_KEYS` `:287-292`, `selectedWindow` state `:698`, `<select>` `:1040-1047`)
- Reference: `frontend/src/utils/rawPacketStats.ts` (`RAW_PACKET_STATS_WINDOWS` `:6-7`)

- [ ] **Step 1: Read the current dropdown + `rawPacketStats.ts`** to see how `selectedWindow` drives `buildRawPacketStatsSnapshot`.

- [ ] **Step 2: Define extras.** Raw Packet Feed keeps its short live windows before the base set and `session` as special:
```ts
import { TimeRangeSelector } from './TimeRangeSelector';
import { BASE_TIME_RANGES, CUSTOM_RANGE_ID, resolveRange, type TimeRange } from '../utils/timeRanges';

const RAW_FEED_EXTRAS_BEFORE: TimeRange[] = [
  { id: '1m', labelKey: 'time_range_1m', seconds: 60 },
  { id: '5m', labelKey: 'time_range_5m', seconds: 5 * 60 },
  { id: '10m', labelKey: 'time_range_10m', seconds: 10 * 60 },
];
const RAW_FEED_EXTRAS_SPECIAL: TimeRange[] = [
  { id: 'session', labelKey: 'time_range_session', seconds: null },
];
const RAW_FEED_LIVE_IDS = new Set(['1m', '5m', '10m', '20m', '30m', 'session']);
const DEFAULT_RAW_FEED_ID = '10m';
```
Add locale keys `time_range_1m` ("1m"), `time_range_5m` ("5m"), `time_range_10m` ("10m") to all three files (`30m` and `session` added earlier). Parity.

- [ ] **Step 3: Replace the `<select>` with `<TimeRangeSelector>`** (extrasBefore = short live windows, extrasSpecial = session). Keep the existing in-memory `buildRawPacketStatsSnapshot` path for ids in `RAW_FEED_LIVE_IDS`; ids not in that set are the long DB-backed ranges handled in Phase 3 (Task 3.x). Until Phase 3 lands, non-live ids may render empty — acceptable mid-plan.

- [ ] **Step 4: Typecheck + tests + build.** PASS.

- [ ] **Step 5: Commit.**
```bash
git add frontend/src/components/RawPacketFeedView.tsx frontend/src/i18n/locales/*.json
git commit -m "refactor(raw-feed): use shared TimeRangeSelector (keeps live windows + session)"
```

---

# PHASE 2 — TX/RX airtime utilization chart on My Node

## Task 2.1: Migration `_086_create_airtime_history`

**Files:**
- Create: `app/migrations/_086_create_airtime_history.py`
- Modify: `tests/test_migrations/conftest.py:5` (85 → 86)
- Test: `tests/test_migrations/test_migration_086.py`

> Before writing: re-confirm `_086` is still the lowest free number (`ls app/migrations/_0*.py | sort | tail`). If a parallel branch merged `_086`, use the next free number consistently across this task and Task 2.2/2.3.

- [ ] **Step 1: Write the failing migration test**

```python
# tests/test_migrations/test_migration_086.py
"""Tests for database migration 086: create airtime_history table."""

import aiosqlite
import pytest

from app.migrations import get_version, run_migrations, set_version
from tests.test_migrations.conftest import LATEST_SCHEMA_VERSION


class TestMigration086:
    @pytest.mark.asyncio
    async def test_creates_airtime_history_table(self):
        conn = await aiosqlite.connect(":memory:")
        conn.row_factory = aiosqlite.Row
        try:
            await set_version(conn, 85)
            await conn.commit()

            applied = await run_migrations(conn)

            assert applied == LATEST_SCHEMA_VERSION - 85
            assert await get_version(conn) == LATEST_SCHEMA_VERSION

            cursor = await conn.execute("PRAGMA table_info(airtime_history)")
            cols = {row[1] for row in await cursor.fetchall()}
            assert {"timestamp", "tx_air_secs", "rx_air_secs"} <= cols
        finally:
            await conn.close()
```

- [ ] **Step 2: Run it, verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_migrations/test_migration_086.py -v`
Expected: FAIL — `LATEST_SCHEMA_VERSION` is 85 (mismatch) and table missing.

- [ ] **Step 3: Bump the schema version constant**

Edit `tests/test_migrations/conftest.py`:
```python
LATEST_SCHEMA_VERSION = 86
```

- [ ] **Step 4: Write the migration**

```python
# app/migrations/_086_create_airtime_history.py
import aiosqlite


async def migrate(conn: aiosqlite.Connection) -> None:
    """Create airtime_history for persisted cumulative TX/RX airtime counters.

    Persists the tx_air_secs/rx_air_secs counters from the STATS_RADIO frame so
    airtime-utilization history survives restarts and can be queried over a
    range (My Node airtime chart). Values are cumulative-from-boot seconds;
    utilization % is derived at query time from deltas. Idempotent.
    """
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS airtime_history (
            timestamp INTEGER NOT NULL,
            tx_air_secs INTEGER NOT NULL,
            rx_air_secs INTEGER NOT NULL
        )
        """
    )
    await conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_airtime_history_timestamp ON airtime_history(timestamp)"
    )
    await conn.commit()
```

- [ ] **Step 5: Run it, verify it passes**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_migrations/test_migration_086.py -v`
Expected: PASS.
Also run the full migration suite to confirm no other `LATEST - N` assertion broke:
`docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_migrations -q` → PASS.

- [ ] **Step 6: Commit**

```bash
git add app/migrations/_086_create_airtime_history.py tests/test_migrations/test_migration_086.py tests/test_migrations/conftest.py
git commit -m "feat(db): airtime_history table + migration 086"
```

## Task 2.2: `AirtimeHistoryRepository`

**Files:**
- Create: `app/repository/airtime_history.py`
- Test: `tests/test_repository/test_airtime_history.py` (create; if the dir/pattern differs, mirror an existing repository test's location)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_repository/test_airtime_history.py
import pytest

from app.repository.airtime_history import AirtimeHistoryRepository


@pytest.mark.asyncio
async def test_insert_and_get_range(tmp_db):  # tmp_db = existing DB fixture; match your suite's fixture name
    await AirtimeHistoryRepository.insert(1000, 10, 20)
    await AirtimeHistoryRepository.insert(1060, 12, 25)
    await AirtimeHistoryRepository.insert(2000, 99, 99)  # outside range

    rows = await AirtimeHistoryRepository.get_range(900, 1100)
    assert rows == [
        {"timestamp": 1000, "tx_air_secs": 10, "rx_air_secs": 20},
        {"timestamp": 1060, "tx_air_secs": 12, "rx_air_secs": 25},
    ]
```

> Fixture note: use the same DB-init fixture the other repository tests use (grep `tests/` for how `noise_floor`/`battery_history` repos are tested; reuse that fixture name in place of `tmp_db`). If none exists, initialize `app.database.db` against a temp file and run migrations in the fixture.

- [ ] **Step 2: Run it, verify it fails**

Run: `docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_repository/test_airtime_history.py -v`
Expected: FAIL — module `app.repository.airtime_history` not found.

- [ ] **Step 3: Implement the repository**

```python
# app/repository/airtime_history.py
from app.database import db


class AirtimeHistoryRepository:
    """Persistence for periodic cumulative airtime samples (airtime_history)."""

    @staticmethod
    async def insert(timestamp: int, tx_air_secs: int, rx_air_secs: int) -> None:
        async with db.tx() as conn:
            async with conn.execute(
                "INSERT INTO airtime_history (timestamp, tx_air_secs, rx_air_secs) "
                "VALUES (?, ?, ?)",
                (timestamp, tx_air_secs, rx_air_secs),
            ):
                pass

    @staticmethod
    async def get_range(start_ts: int, end_ts: int) -> list[dict]:
        async with db.readonly() as conn:
            async with conn.execute(
                "SELECT timestamp, tx_air_secs, rx_air_secs FROM airtime_history "
                "WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC",
                (start_ts, end_ts),
            ) as cursor:
                rows = await cursor.fetchall()
        return [
            {
                "timestamp": r["timestamp"],
                "tx_air_secs": r["tx_air_secs"],
                "rx_air_secs": r["rx_air_secs"],
            }
            for r in rows
        ]
```

- [ ] **Step 4: Run it, verify it passes** → PASS.

- [ ] **Step 5: Commit**
```bash
git add app/repository/airtime_history.py tests/test_repository/test_airtime_history.py
git commit -m "feat(repo): AirtimeHistoryRepository insert/get_range"
```

## Task 2.3: Persist airtime in the 60s sampler

**Files:**
- Modify: `app/services/radio_stats.py` (`_persist_samples`, `:87-109`)
- Test: `tests/test_services/test_radio_stats_persist.py` (create; or extend an existing radio_stats test)

- [ ] **Step 1: Write the failing test** — assert both counters are inserted when present, and skipped when absent.

```python
# tests/test_services/test_radio_stats_persist.py
import pytest

from app.services import radio_stats


@pytest.mark.asyncio
async def test_persist_writes_airtime(monkeypatch):
    calls = []

    class FakeAirtimeRepo:
        @staticmethod
        async def insert(ts, tx, rx):
            calls.append((ts, tx, rx))

    # Patch the repo where _persist_samples imports it (function-local import).
    import app.repository.airtime_history as air_mod
    monkeypatch.setattr(air_mod, "AirtimeHistoryRepository", FakeAirtimeRepo)
    # Also neutralize noise_floor/battery inserts so the test is isolated.
    import app.repository.noise_floor as nf
    import app.repository.battery_history as bh
    monkeypatch.setattr(nf.NoiseFloorRepository, "insert", staticmethod(lambda *a: _noop()))
    monkeypatch.setattr(bh.BatteryHistoryRepository, "insert", staticmethod(lambda *a: _noop()))

    await radio_stats._persist_samples(
        {"timestamp": 1000, "tx_air_secs": 5, "rx_air_secs": 9,
         "noise_floor": -100, "battery_mv": 4100}
    )
    assert calls == [(1000, 5, 9)]


async def _noop():
    return None
```

> If patching the function-local import is awkward, refactor the airtime import in `_persist_samples` to module top and patch `radio_stats.AirtimeHistoryRepository` instead — keep it consistent with how the test targets it.

- [ ] **Step 2: Run it, verify it fails** → FAIL (no airtime insert yet).

- [ ] **Step 3: Add the airtime insert** to `_persist_samples`, after the battery block (`:107`), inside the existing `try`:
```python
        tx_air_secs = snapshot.get("tx_air_secs")
        rx_air_secs = snapshot.get("rx_air_secs")
        if isinstance(tx_air_secs, int) and isinstance(rx_air_secs, int):
            from app.repository.airtime_history import AirtimeHistoryRepository

            await AirtimeHistoryRepository.insert(ts, tx_air_secs, rx_air_secs)
```

- [ ] **Step 4: Run it, verify it passes** → PASS.

- [ ] **Step 5: Commit**
```bash
git add app/services/radio_stats.py tests/test_services/test_radio_stats_persist.py
git commit -m "feat(radio-stats): persist tx/rx airtime counters each sample"
```

## Task 2.4: Airtime utilization endpoint + binning helper

**Files:**
- Create: `app/services/airtime_util.py` (pure binning/utilization helper — unit-testable without a DB)
- Modify: `app/routers/statistics.py` (add `/airtime/range`)
- Test: `tests/test_services/test_airtime_util.py`

The helper turns ordered cumulative samples into per-bin `{timestamp, tx_pct, rx_pct}`, using adjacent-pair deltas so counter resets and gaps don't create false spikes.

- [ ] **Step 1: Write the failing helper test**

```python
# tests/test_services/test_airtime_util.py
from app.services.airtime_util import compute_airtime_utilization

SAMPLE_INTERVAL = 60


def test_basic_utilization_percent():
    # 60s apart; tx grows 30s -> 50% ; rx grows 6s -> 10%
    samples = [
        {"timestamp": 0, "tx_air_secs": 0, "rx_air_secs": 0},
        {"timestamp": 60, "tx_air_secs": 30, "rx_air_secs": 6},
    ]
    out = compute_airtime_utilization(samples, start_ts=0, end_ts=60, bin_count=1,
                                      sample_interval=SAMPLE_INTERVAL)
    assert len(out) == 1
    assert out[0]["tx_pct"] == 50.0
    assert out[0]["rx_pct"] == 10.0


def test_counter_reset_is_skipped():
    # second pair has negative delta (reboot) -> that pair dropped
    samples = [
        {"timestamp": 0, "tx_air_secs": 100, "rx_air_secs": 100},
        {"timestamp": 60, "tx_air_secs": 130, "rx_air_secs": 106},  # +30/+6 -> valid
        {"timestamp": 120, "tx_air_secs": 5, "rx_air_secs": 1},     # reset -> skip
    ]
    out = compute_airtime_utilization(samples, start_ts=0, end_ts=120, bin_count=2,
                                      sample_interval=SAMPLE_INTERVAL)
    # bin 0 (t in (0,60]) has the valid pair; bin 1 has only the reset pair -> omitted
    ids = {o["_bin"] for o in out}
    assert 0 in ids
    assert 1 not in ids


def test_large_gap_pair_is_skipped():
    # dt = 10*interval -> radio was disconnected; drop to avoid a false spike
    samples = [
        {"timestamp": 0, "tx_air_secs": 0, "rx_air_secs": 0},
        {"timestamp": 600, "tx_air_secs": 300, "rx_air_secs": 60},
    ]
    out = compute_airtime_utilization(samples, start_ts=0, end_ts=600, bin_count=1,
                                      sample_interval=SAMPLE_INTERVAL)
    assert out == []


def test_percent_clamped_to_100():
    samples = [
        {"timestamp": 0, "tx_air_secs": 0, "rx_air_secs": 0},
        {"timestamp": 60, "tx_air_secs": 999, "rx_air_secs": 0},  # >100% raw
    ]
    out = compute_airtime_utilization(samples, start_ts=0, end_ts=60, bin_count=1,
                                      sample_interval=SAMPLE_INTERVAL)
    assert out[0]["tx_pct"] == 100.0


def test_empty_and_single_sample():
    assert compute_airtime_utilization([], 0, 60, 1, SAMPLE_INTERVAL) == []
    assert compute_airtime_utilization(
        [{"timestamp": 0, "tx_air_secs": 1, "rx_air_secs": 1}], 0, 60, 1, SAMPLE_INTERVAL
    ) == []
```

- [ ] **Step 2: Run it, verify it fails** → FAIL (module missing).

- [ ] **Step 3: Implement the helper**

```python
# app/services/airtime_util.py
"""Derive per-bin TX/RX airtime utilization % from cumulative airtime samples.

Input samples are cumulative-from-boot counters (seconds). Utilization for a
pair of consecutive samples is 100 * delta_airtime / delta_wallclock. Pairs
that straddle a counter reset (negative delta) or a long gap (radio was
disconnected) are dropped so they do not create false spikes.
"""

# Drop a pair whose wall-clock gap exceeds this multiple of the sample interval.
GAP_SANITY_MULTIPLE = 5


def compute_airtime_utilization(
    samples: list[dict],
    start_ts: int,
    end_ts: int,
    bin_count: int,
    sample_interval: int,
) -> list[dict]:
    if bin_count < 1 or end_ts <= start_ts or len(samples) < 2:
        return []

    bin_width = (end_ts - start_ts) / bin_count
    max_gap = GAP_SANITY_MULTIPLE * sample_interval
    # accumulate per-bin sums + counts for tx and rx
    acc: dict[int, dict] = {}

    for a, b in zip(samples, samples[1:]):
        dt = b["timestamp"] - a["timestamp"]
        if dt <= 0 or dt > max_gap:
            continue
        d_tx = b["tx_air_secs"] - a["tx_air_secs"]
        d_rx = b["rx_air_secs"] - a["rx_air_secs"]
        if d_tx < 0 or d_rx < 0:
            continue  # counter reset / reboot
        tx_pct = min(100.0, 100.0 * d_tx / dt)
        rx_pct = min(100.0, 100.0 * d_rx / dt)
        idx = int((b["timestamp"] - start_ts) / bin_width)
        if idx < 0 or idx >= bin_count:
            continue
        slot = acc.setdefault(idx, {"tx": 0.0, "rx": 0.0, "n": 0})
        slot["tx"] += tx_pct
        slot["rx"] += rx_pct
        slot["n"] += 1

    out: list[dict] = []
    for idx in sorted(acc):
        slot = acc[idx]
        n = slot["n"]
        out.append(
            {
                "_bin": idx,
                "timestamp": int(start_ts + (idx + 0.5) * bin_width),
                "tx_pct": round(slot["tx"] / n, 2),
                "rx_pct": round(slot["rx"] / n, 2),
            }
        )
    return out
```

> `_bin` is included for the test and is harmless to the frontend; keep it or strip it in the router. The plan keeps it.

- [ ] **Step 4: Run it, verify it passes** → PASS (5 tests).

- [ ] **Step 5: Add the endpoint** to `app/routers/statistics.py`. Add the import near the others:
```python
from app.repository.airtime_history import AirtimeHistoryRepository
from app.services.airtime_util import compute_airtime_utilization
from app.services.radio_stats import STATS_SAMPLE_INTERVAL_SECONDS
```
Add the route after `/noise-floor`:
```python
@router.get("/airtime/range")
async def get_airtime_range(
    start_ts: int = Query(..., description="Start timestamp (Unix seconds)"),
    end_ts: int = Query(..., description="End timestamp (Unix seconds)"),
    bin_count: int = Query(40, ge=1, le=500, description="Number of output bins"),
) -> list[dict]:
    samples = await AirtimeHistoryRepository.get_range(start_ts, end_ts)
    return compute_airtime_utilization(
        samples, start_ts, end_ts, bin_count, STATS_SAMPLE_INTERVAL_SECONDS
    )
```

- [ ] **Step 6: Run backend lint + the two new suites**

Run:
```
docker exec rtfm-ev-local /app/.venv/bin/python -m pytest /work/tests/test_services/test_airtime_util.py -v
docker exec rtfm-ev-local sh -c "cd /work && /app/.venv/bin/ruff check . && /app/.venv/bin/ruff format --check ."
```
Expected: PASS. (If format check flags the new files, run `/app/.venv/bin/ruff format .` and re-commit.)

- [ ] **Step 7: Commit**
```bash
git add app/services/airtime_util.py app/routers/statistics.py tests/test_services/test_airtime_util.py
git commit -m "feat(api): /statistics/airtime/range utilization endpoint (reset-safe binning)"
```

## Task 2.5: Frontend api + types for airtime

**Files:**
- Modify: `frontend/src/types.ts` (near `BatterySample`, `:895-898`)
- Modify: `frontend/src/api.ts` (near `getBatteryRange`, `:563-564`)

- [ ] **Step 1: Add the type** to `types.ts`:
```ts
export interface AirtimeSample {
  timestamp: number;
  tx_pct: number;
  rx_pct: number;
}
```

- [ ] **Step 2: Add the client** to `api.ts` after `getBatteryRange`:
```ts
  getAirtimeRange: (startTs: number, endTs: number, binCount = 40) =>
    fetchJson<AirtimeSample[]>(
      `/statistics/airtime/range?start_ts=${startTs}&end_ts=${endTs}&bin_count=${binCount}`,
    ),
```
Ensure `AirtimeSample` is imported wherever `api.ts` imports its response types (match the existing `BatterySample` import).

- [ ] **Step 3: Typecheck** `cd frontend && npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/types.ts frontend/src/api.ts
git commit -m "feat(frontend): AirtimeSample type + getAirtimeRange client"
```

## Task 2.6: `AirtimeLineChart` + chart card on My Node

**Files:**
- Modify: `frontend/src/components/MyNodeView.tsx` (add the inline `AirtimeLineChart` near `NoiseFloorLineChart` `:801`; add fetch state + effect near the noise-floor effect `:1483-1504`; add the `<ChartCard>` in the grid after the noise-floor card `:1966`)

`AirtimeLineChart` mirrors `NoiseFloorLineChart` (`:801-`) but draws two series against a fixed 0–100 y-domain. Reuse the same `CW/CH/PAD_L/INNER_W/INNER_H` constants already defined in the file.

- [ ] **Step 1: Add state + effect.** Near the noise-floor state (`:1437-1441`) add:
```ts
const [airtimeSamples, setAirtimeSamples] = useState<AirtimeSample[]>([]);
```
Import `AirtimeSample` from `../types` and `BIN_COUNT` already exists (`:104`). After the noise-floor effect (`:1504`), add an airtime effect. Airtime has no in-memory deque, so every non-custom window fetches the DB range (the 20m live window still has 60s DB samples):
```ts
// Airtime utilization: always DB-backed (no in-memory deque). Custom handled by Apply.
useEffect(() => {
  if (selectedWindowId === CUSTOM_RANGE_ID) return;
  const resolved = resolveRange(selectedWindowId, {
    nowSec, extras: MYNODE_EXTRAS_AFTER,
  });
  if (!resolved) return;
  api.getAirtimeRange(resolved.startTs, resolved.endTs, BIN_COUNT).then(
    (samples) => setAirtimeSamples(samples),
    () => {},
  );
}, [selectedWindowId, nowSec]);
```
For the custom Apply path, also fetch airtime: in the `onApplyCustom` handler (Task 1.4 Step 3) call both `fetchHistorical(s,e)` and `api.getAirtimeRange(s, e, BIN_COUNT).then(setAirtimeSamples, () => {})`.

- [ ] **Step 2: Add the `AirtimeLineChart` component** (inline, after `NoiseFloorLineChart` closes). It plots two polylines with a fixed 0–100 domain and a small legend:
```tsx
// ─── AirtimeLineChart (TX/RX utilization %) ─────────────────────────────────
function AirtimeLineChart({
  samples,
  t,
}: {
  samples: AirtimeSample[];
  t: TFn;
}) {
  if (samples.length < 2)
    return (
      <svg width="100%" viewBox={`0 0 ${CW} ${CH}`} style={{ display: 'block' }}>
        <text
          x={(PAD_L + INNER_W / 2).toFixed(1)}
          y={(CH / 2).toFixed(1)}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="9"
          fill="hsl(var(--muted-foreground))"
        >
          {samples.length === 0 ? t('node_chart_no_data') : t('node_chart_need_more_samples')}
        </text>
      </svg>
    );

  const timestamps = samples.map((s) => s.timestamp * 1000);
  const tMin = timestamps[0];
  const tMax = timestamps[timestamps.length - 1];
  const tRange = tMax - tMin || 1;
  const yMin = 0;
  const yMax = 100;

  const xPos = (i: number) => PAD_L + ((timestamps[i] - tMin) / tRange) * INNER_W;
  const yPos = (v: number) => INNER_H - ((v - yMin) / (yMax - yMin)) * INNER_H;

  const buildPath = (key: 'tx_pct' | 'rx_pct') => {
    let p = '';
    for (let i = 0; i < samples.length; i++) {
      p += `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(samples[i][key]).toFixed(1)}`;
    }
    return p;
  };

  const rxColor = 'hsl(var(--info))';
  const txColor = 'hsl(var(--destructive))';
  const yLabels = [0, 25, 50, 75, 100];

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${CW} ${CH}`}
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {yLabels.map((v, li) => {
        const y = yPos(v);
        return (
          <g key={li}>
            <line
              x1={PAD_L}
              x2={CW}
              y1={y.toFixed(1)}
              y2={y.toFixed(1)}
              stroke="hsl(var(--border))"
              strokeWidth="0.5"
              strokeDasharray="2,2"
            />
            <text
              x={PAD_L - 3}
              y={y.toFixed(1)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="8"
              fill="hsl(var(--muted-foreground))"
            >
              {v}
            </text>
          </g>
        );
      })}
      <path d={buildPath('rx_pct')} fill="none" stroke={rxColor} strokeWidth="1.5" strokeLinejoin="round" />
      <path d={buildPath('tx_pct')} fill="none" stroke={txColor} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
```

- [ ] **Step 3: Add the ChartCard** in the grid, after the noise-floor card (`:1966`), before the battery card:
```tsx
{airtimeSamples.length > 0 && (
  <ChartCard
    title={t('node_chart_airtime_title')}
    stat={
      airtimeSamples.length > 0
        ? t('node_chart_airtime_stat', {
            rx: airtimeSamples[airtimeSamples.length - 1].rx_pct.toFixed(1),
            tx: airtimeSamples[airtimeSamples.length - 1].tx_pct.toFixed(1),
          })
        : undefined
    }
  >
    <AirtimeLineChart samples={airtimeSamples} t={t} />
    <div className="mt-1 flex flex-wrap gap-2 px-1">
      <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'hsl(var(--info))' }} />
        {t('node_chart_airtime_rx')}
      </span>
      <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'hsl(var(--destructive))' }} />
        {t('node_chart_airtime_tx')}
      </span>
    </div>
    <p className="px-1 text-[9px] text-muted-foreground italic">{t('node_chart_airtime_note')}</p>
  </ChartCard>
)}
```

- [ ] **Step 4: Add the i18n keys** to `en/nl/de.json`:
```json
"node_chart_airtime_title": "Airtime utilization",
"node_chart_airtime_stat": "RX {rx}% / TX {tx}%",
"node_chart_airtime_rx": "RX %",
"node_chart_airtime_tx": "TX %",
"node_chart_airtime_note": "RX airtime is estimated per packet (parsed packets), not carrier-sense."
```
Translate the prose (`_title`, `_rx`, `_tx`, `_note`) for nl/de; keep the `_stat` placeholder pattern identical. Parity test must pass.

- [ ] **Step 5: Typecheck + tests + build**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/components/MyNodeView.tsx frontend/src/i18n/locales/*.json
git commit -m "feat(my-node): TX/RX airtime utilization chart"
```

---

# PHASE 3 — Raw Packet Feed session stats become historical

## Task 3.1: Verify `/api/packets/historical-stats` field coverage

**Files:** (read-only investigation)
- Read: `app/routers/*` for the `historical-stats` handler; `frontend/src/utils/rawPacketStats.ts` (`buildRawPacketStatsSnapshot`); `RawPacketFeedView.tsx` stat cards.

- [ ] **Step 1:** List the fields the Raw Packet Feed stat cards render (payload types, route mix direct/flood, hop profile, signal distribution, hop byte-width). Compare against what `historical-stats` already returns (it is already used by My Node's DB stats card). Record which fields exist and which are missing.

- [ ] **Step 2:** If all needed fields already exist → no backend change; go to Task 3.3. If some are missing → do Task 3.2 to extend the endpoint.

- [ ] **Step 3:** Record findings inline in this plan file (edit the checklist note) so the next task knows the delta. No commit (investigation only) unless you edited the plan doc.

## Task 3.2 (conditional): Extend `historical-stats` for any missing breakdowns

Only if Task 3.1 found gaps.

**Files:**
- Modify: the `historical-stats` handler + its repository query (paths from Task 3.1)
- Test: add cases to that endpoint's test module (or create one) asserting the new fields are computed from `raw_packets` rows.

- [ ] **Step 1:** Write a failing test that inserts a few `raw_packets` rows and asserts the endpoint returns the missing breakdown(s).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the SQL/aggregation for the missing fields, mirroring the existing breakdowns in the same handler.
- [ ] **Step 4:** Run → PASS; run `ruff check`/`format --check`.
- [ ] **Step 5:** Commit `feat(api): historical-stats covers <fields> for raw-feed history`.

## Task 3.3: Raw Packet Feed picks DB vs in-memory by coverage

**Files:**
- Modify: `frontend/src/components/RawPacketFeedView.tsx` (stat-card data source), possibly `frontend/src/utils/rawPacketStats.ts` (a mapper from `historical-stats` response → the card view-model)
- Test: `frontend/src/utils/rawPacketStats.test.ts` (extend or create) for the source-selection helper

- [ ] **Step 1: Write a failing unit test** for a pure helper `chooseStatsSource(selectedId, bufferEarliestTs, rangeStartTs)` returning `'live' | 'db'`:
```ts
import { describe, it, expect } from 'vitest';
import { chooseStatsSource } from './rawPacketStats';

describe('chooseStatsSource', () => {
  it('uses live for the explicit live ids', () => {
    expect(chooseStatsSource('5m', 0, 0)).toBe('live');
    expect(chooseStatsSource('session', 0, 0)).toBe('live');
  });
  it('uses live when the in-memory buffer already covers the range start', () => {
    expect(chooseStatsSource('1h', 1000, 2000)).toBe('live'); // buffer starts before range start
  });
  it('uses db when the buffer does not reach back far enough', () => {
    expect(chooseStatsSource('7d', 5000, 1000)).toBe('db'); // range starts before buffer
  });
});
```

- [ ] **Step 2: Run → FAIL** (helper missing).

- [ ] **Step 3: Implement `chooseStatsSource`** in `rawPacketStats.ts`:
```ts
const RAW_FEED_LIVE_IDS = new Set(['1m', '5m', '10m', '20m', '30m', 'session']);

export function chooseStatsSource(
  selectedId: string,
  bufferEarliestTs: number,
  rangeStartTs: number,
): 'live' | 'db' {
  if (RAW_FEED_LIVE_IDS.has(selectedId)) return 'live';
  // If the in-memory buffer's earliest sample is at or before the requested
  // range start, the buffer fully covers it; otherwise fall back to the DB.
  return bufferEarliestTs <= rangeStartTs ? 'live' : 'db';
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Wire it into `RawPacketFeedView`.** When `chooseStatsSource(...) === 'db'`, resolve the range via `resolveRange(selectedId, ...)`, call `fetch('/api/packets/historical-stats?start_ts=..&end_ts=..')`, map the response to the same view-model the cards consume (add a small mapper if the shapes differ), and render it. When `'live'`, keep the existing `buildRawPacketStatsSnapshot` path. Show a subtle "from history" hint when DB-backed, and an empty state when the DB range returns nothing (not an error). On fetch failure, fall back to the in-memory snapshot.

- [ ] **Step 6: Typecheck + tests + build.** `cd frontend && npx tsc --noEmit && npx vitest run && npm run build` → PASS.

- [ ] **Step 7: Commit**
```bash
git add frontend/src/components/RawPacketFeedView.tsx frontend/src/utils/rawPacketStats.ts frontend/src/utils/rawPacketStats.test.ts
git commit -m "feat(raw-feed): fill long ranges from persisted raw_packets (DB-backed stats)"
```

---

# Cross-cutting closeout

## Task 4.1: Persist selected window + custom range per page (localStorage)

**Files:** each migrated view (`MyNodeView`, `MeshHealthView`, `RawPacketFeedView`; Map already persists).

- [ ] For each view, persist `selectedWindowId` (and custom start/end) to a per-page `localStorage` key (e.g. `rtfm-mynode-window`, `rtfm-meshhealth-window`, `rtfm-rawfeed-window`), reading it as the initial state with a safe fallback to that page's default. Mirror Map's existing `remoteterm-map-since` pattern. Typecheck + build. Commit `feat(ui): remember selected time range per page`.

## Task 4.2: Docs

**Files:**
- `CHANGELOG-DMC-EV.md` (grouped entry referencing this work; do NOT touch `CHANGELOG.md`)
- `frontend/AGENTS.md` (new shared `TimeRangeSelector` + `utils/timeRanges.ts`; airtime chart)
- `app/AGENTS.md` (new `airtime_history` table, `AirtimeHistoryRepository`, `/statistics/airtime/range`, `airtime_util` helper)
- `README.md` / `README_ADVANCED.md` where My Node charts or time selectors are described
- `docs/sources-of-truth.md` if it enumerates stat tables/selectors

- [ ] Update each file to describe what shipped. Keep entries factual and concise. Commit `docs: airtime chart + unified time selector`.

## Task 4.3: Full CI-equivalent gate + runtime verification

- [ ] **Backend:** `docker exec rtfm-ev-local sh -c "cd /work && /app/.venv/bin/ruff check . && /app/.venv/bin/ruff format --check . && /app/.venv/bin/python -m pytest /work/tests -q"` → PASS. (Windows-only pre-existing failures per `docs`/memory are not regressions; confirm the count did not grow.)
- [ ] **Frontend:** `cd frontend && npm run lint && npm run format:check && npm run test:run && npm run build` → PASS.
- [ ] **Runtime (required — observe, do not reason):** rebuild the branch into the local Docker instance (`rtfm-ev-local`, `:8000`) and verify, recording at least two independent checks:
  1. My Node airtime chart draws two lines with a live radio and updates as the window changes; live `20m` and a longer window both render.
  2. The identical selector renders on My Node / Mesh Health / Map / Raw Packet Feed with each page's extras; changing a range refilters that page.
  3. Raw Packet Feed: a long range (e.g. `7d`) populates stat cards from the DB; `session`/short windows stay live.
- [ ] Only after observing the above, mark the feature done. If any check fails or could not be observed, write "NOT VERIFIED" against it.

---

## Self-review notes (author)

- **Spec coverage:** Phase 1 (Tasks 1.1–1.7 + 4.1) = unified selector on all four pages + extras + persistence. Phase 2 (Tasks 2.1–2.6) = airtime table/repo/sampler/endpoint/chart. Phase 3 (Tasks 3.1–3.3) = raw-feed historical fill. Docs = 4.2. Runtime = 4.3. All spec sections mapped.
- **Type consistency:** `TimeRange`, `resolveRange`, `CUSTOM_RANGE_ID`, `BASE_TIME_RANGES` used identically across Tasks 1.1/1.3/1.4–1.7/2.6; `AirtimeSample {timestamp,tx_pct,rx_pct}` consistent across 2.4/2.5/2.6; repository method names `insert(ts,tx,rx)`/`get_range` consistent across 2.2/2.3/2.4.
- **Open verifications flagged in-task (not placeholders):** exact migration number re-check (2.1); DB test fixture name (2.2); `useT` import path (1.3); `historical-stats` field coverage (3.1) which gates the conditional 3.2.
