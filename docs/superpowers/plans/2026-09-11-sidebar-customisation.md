# Sidebar customisation (plan 17, Phases 1-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the old fork's sidebar customisation (section reorder, tool reorder, gear settings panel + reset, rail collapse, favourites-by-type sub-sections) into RTFM-EV as frontend + localStorage only, respecting the 768px responsive model and enforced EN/NL/DE i18n.

**Architecture:** Extract reorder persistence into a new isolated util (`utils/sidebarLayout.ts`) and the drag/move list into a new component (`components/sidebar/DragList.tsx`). Refactor `Sidebar.tsx`'s hardcoded tool rows and fixed-order sections into data-driven maps rendered by user-ordered key arrays. Add a rail-collapse width toggle with a `forceExpanded` prop that `AppShell` sets true in the mobile drawer mount so rail state never leaks into the drawer.

**Tech Stack:** React 18 + TypeScript, Tailwind, lucide-react icons, vitest + @testing-library/react, i18next (flat `nav_*` keys in `src/i18n/locales/{en,nl,de}.json`).

**Scope:** Phases 1-2 only. Phase 3 "Owned" grouping and any `owner_id`/sensor-type backend work are OUT OF SCOPE (deferred to plan 18). No migration.

**Spec:** `docs/superpowers/specs/2026-09-11-sidebar-customisation-design.md`

---

## Commit policy (repo override)

This repo's CLAUDE.md says: never create commits unless explicitly instructed. Therefore **the TDD "Commit" step in each task is replaced by a checkpoint**: stage nothing, just confirm the task's tests + typecheck pass, then move on. If the user later says to commit, group commits per task. Do NOT auto-commit.

## Cross-session coordination

`feat/sidebar-section-counters` is a live parallel worktree editing `Sidebar.tsx`, `sidebar.test.tsx`, `types.ts`, and the i18n locales. Before starting, run `git fetch origin && git log --oneline origin/main -3` and rebase this branch on the latest `origin/main`. Expect merge coordination on `Sidebar.tsx`; if that branch has merged, re-read `Sidebar.tsx` before editing and re-anchor the edits below.

## File structure

- **Create** `frontend/src/utils/sidebarLayout.ts` — types + localStorage load/save for section order, tool order, rail-collapsed. One responsibility: layout-preference persistence.
- **Create** `frontend/src/test/sidebarLayout.test.ts` — unit tests for the util.
- **Create** `frontend/src/components/sidebar/DragList.tsx` — reusable reorder list: HTML5 drag for pointer + up/down move buttons for touch/keyboard.
- **Create** `frontend/src/test/dragList.test.tsx` — unit tests for DragList.
- **Modify** `frontend/src/components/Sidebar.tsx` — keyed tool map, data-driven section render, rail collapse + `forceExpanded`, gear settings panel + reset, favourites-by-type sub-sections.
- **Modify** `frontend/src/components/AppShell.tsx:229-233,266,282` — pass `forceExpanded` per mount.
- **Modify** `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json` — new `nav_*` keys.
- **Extend** `frontend/src/test/sidebar.test.tsx` — reorder, rail, settings, reset, forceExpanded, favourites-by-type.

Run commands from `frontend/`. Test runner: `npm run test -- <file>` (vitest). Typecheck/build: `npm run build`.

---

## Task 1: Layout persistence util

**Files:**
- Create: `frontend/src/utils/sidebarLayout.ts`
- Test: `frontend/src/test/sidebarLayout.test.ts`

Keys reuse the old fork's names for clean migration: `remoteterm-sidebar-section-order`, `remoteterm-sidebar-tool-order`, `remoteterm-sidebar-rail-collapsed`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/test/sidebarLayout.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_SECTION_KEYS,
  ALL_TOOL_KEYS,
  loadSectionOrder,
  saveSectionOrder,
  loadToolOrder,
  saveToolOrder,
  loadRailCollapsed,
  saveRailCollapsed,
  type SidebarSectionKey,
  type SidebarToolKey,
} from '../utils/sidebarLayout';

describe('sidebarLayout persistence', () => {
  beforeEach(() => localStorage.clear());

  it('returns defaults when nothing stored', () => {
    expect(loadSectionOrder()).toEqual(ALL_SECTION_KEYS);
    expect(loadToolOrder()).toEqual(ALL_TOOL_KEYS);
    expect(loadRailCollapsed()).toBe(false);
  });

  it('round-trips a custom section order', () => {
    const order: SidebarSectionKey[] = ['favorites', 'tools', 'channels', 'contacts', 'repeaters', 'rooms'];
    saveSectionOrder(order);
    expect(loadSectionOrder()).toEqual(order);
  });

  it('appends newly-added keys missing from stored order and drops unknown keys', () => {
    localStorage.setItem('remoteterm-sidebar-tool-order', JSON.stringify(['map', 'bogus-old-key']));
    const loaded = loadToolOrder();
    expect(loaded[0]).toBe('map');
    expect(loaded).not.toContain('bogus-old-key');
    // every canonical key present exactly once
    expect([...loaded].sort()).toEqual([...ALL_TOOL_KEYS].sort());
  });

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('remoteterm-sidebar-section-order', '{not json');
    expect(loadSectionOrder()).toEqual(ALL_SECTION_KEYS);
  });

  it('round-trips rail collapsed', () => {
    saveRailCollapsed(true);
    expect(loadRailCollapsed()).toBe(true);
  });

  const tk: SidebarToolKey = 'cracker';
  it('has cracker as a valid tool key', () => expect(ALL_TOOL_KEYS).toContain(tk));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/sidebarLayout.test.ts`
Expected: FAIL — cannot resolve `../utils/sidebarLayout`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/utils/sidebarLayout.ts

// Reorderable list sections (Mark-All-Read is a pinned action row, not reorderable).
export type SidebarSectionKey =
  | 'tools'
  | 'favorites'
  | 'channels'
  | 'contacts'
  | 'repeaters'
  | 'rooms';

export const ALL_SECTION_KEYS: SidebarSectionKey[] = [
  'tools',
  'favorites',
  'channels',
  'contacts',
  'repeaters',
  'rooms',
];

// Tool rows, keyed to match the existing render in Sidebar.tsx.
export type SidebarToolKey =
  | 'my-node'
  | 'mesh-health'
  | 'raw'
  | 'map'
  | 'visualizer'
  | 'trace'
  | 'search'
  | 'channel-registry'
  | 'cracker';

export const ALL_TOOL_KEYS: SidebarToolKey[] = [
  'my-node',
  'mesh-health',
  'raw',
  'map',
  'visualizer',
  'trace',
  'search',
  'channel-registry',
  'cracker',
];

const SECTION_ORDER_KEY = 'remoteterm-sidebar-section-order';
const TOOL_ORDER_KEY = 'remoteterm-sidebar-tool-order';
const RAIL_KEY = 'remoteterm-sidebar-rail-collapsed';

// Reconcile a stored order against the canonical key list: keep stored keys that
// are still valid (in order), drop unknown ones, append any newly-added keys.
function reconcile<T extends string>(stored: unknown, all: T[]): T[] {
  if (!Array.isArray(stored)) return [...all];
  const valid = stored.filter((k): k is T => all.includes(k as T));
  const missing = all.filter((k) => !valid.includes(k));
  return [...valid, ...missing];
}

function loadOrder<T extends string>(key: string, all: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [...all];
    return reconcile<T>(JSON.parse(raw), all);
  } catch {
    return [...all];
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage write failures (private mode, disabled storage).
  }
}

export function loadSectionOrder(): SidebarSectionKey[] {
  return loadOrder(SECTION_ORDER_KEY, ALL_SECTION_KEYS);
}
export function saveSectionOrder(order: SidebarSectionKey[]): void {
  saveJson(SECTION_ORDER_KEY, order);
}
export function loadToolOrder(): SidebarToolKey[] {
  return loadOrder(TOOL_ORDER_KEY, ALL_TOOL_KEYS);
}
export function saveToolOrder(order: SidebarToolKey[]): void {
  saveJson(TOOL_ORDER_KEY, order);
}
export function loadRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === 'true';
  } catch {
    return false;
  }
}
export function saveRailCollapsed(collapsed: boolean): void {
  saveJson(RAIL_KEY, collapsed);
}

export function resetSidebarLayout(): void {
  try {
    localStorage.removeItem(SECTION_ORDER_KEY);
    localStorage.removeItem(TOOL_ORDER_KEY);
    localStorage.removeItem(RAIL_KEY);
  } catch {
    // Ignore.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/test/sidebarLayout.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Checkpoint** — `npm run build` typechecks. No commit (see Commit policy).

---

## Task 2: DragList component (DnD + move buttons)

**Files:**
- Create: `frontend/src/components/sidebar/DragList.tsx`
- Test: `frontend/src/test/dragList.test.tsx`

Adapts the old fork's `DragList` (native HTML5 drag) and adds always-visible up/down move buttons so touch and keyboard users reorder identically (per the locked decision).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/test/dragList.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DragList } from '../components/sidebar/DragList';

const items = ['a', 'b', 'c'];
const labels = { a: 'Alpha', b: 'Bravo', c: 'Charlie' };

describe('DragList move buttons', () => {
  it('moves an item down when its move-down button is clicked', () => {
    const onReorder = vi.fn();
    render(<DragList items={items} labels={labels} onReorder={onReorder} moveUpLabel="Move up" moveDownLabel="Move down" />);
    const rows = screen.getAllByRole('listitem');
    const downBtn = within(rows[0]).getByRole('button', { name: 'Move down' });
    fireEvent.click(downBtn);
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('disables move-up on the first row and move-down on the last', () => {
    render(<DragList items={items} labels={labels} onReorder={vi.fn()} moveUpLabel="Move up" moveDownLabel="Move down" />);
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(rows[2]).getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('reorders via HTML5 drag drop', () => {
    const onReorder = vi.fn();
    render(<DragList items={items} labels={labels} onReorder={onReorder} moveUpLabel="Move up" moveDownLabel="Move down" />);
    const rows = screen.getAllByRole('listitem');
    fireEvent.dragStart(rows[2]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b']);
  });
});

import { within } from '@testing-library/react';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/dragList.test.tsx`
Expected: FAIL — cannot resolve `../components/sidebar/DragList`.

- [ ] **Step 3: Write the implementation**

```tsx
// frontend/src/components/sidebar/DragList.tsx
import { useRef, useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DragListProps<T extends string> {
  items: T[];
  labels: Record<string, string>;
  onReorder: (next: T[]) => void;
  moveUpLabel: string;
  moveDownLabel: string;
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m);
  return next;
}

export function DragList<T extends string>({
  items,
  labels,
  onReorder,
  moveUpLabel,
  moveDownLabel,
}: DragListProps<T>) {
  const dragIndex = useRef<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDrop = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    const from = dragIndex.current;
    dragIndex.current = null;
    setOverIndex(null);
    if (from === null || from === i) return;
    onReorder(move(items, from, i));
  };

  return (
    <ul className="space-y-1" role="list">
      {items.map((item, i) => (
        <li
          key={item}
          role="listitem"
          draggable
          onDragStart={() => (dragIndex.current = i)}
          onDragOver={(e) => {
            e.preventDefault();
            setOverIndex(i);
          }}
          onDrop={(e) => handleDrop(e, i)}
          onDragEnd={() => {
            dragIndex.current = null;
            setOverIndex(null);
          }}
          className={cn(
            'flex items-center gap-2 rounded px-2 py-1.5 bg-background border border-border select-none transition-all',
            overIndex === i && dragIndex.current !== i && 'border-primary bg-accent'
          )}
        >
          <GripVertical
            className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50 cursor-grab active:cursor-grabbing"
            aria-hidden="true"
          />
          <span className="text-[13px] text-foreground flex-1 truncate">{labels[item] ?? item}</span>
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onReorder(move(items, i, i - 1))}
            disabled={i === 0}
            aria-label={moveUpLabel}
            title={moveUpLabel}
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="p-0.5 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onReorder(move(items, i, i + 1))}
            disabled={i === items.length - 1}
            aria-label={moveDownLabel}
            title={moveDownLabel}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/test/dragList.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Checkpoint** — `npm run build` typechecks. No commit.

---

## Task 3: Data-driven tool rows (keyed map + tool order)

Refactor the inline `toolRows` array (`Sidebar.tsx:770-888`) into a keyed map rendered in stored tool order. Behaviour is unchanged at default order.

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `frontend/src/test/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test** (append to `sidebar.test.tsx`)

```tsx
describe('Sidebar tool order', () => {
  beforeEach(() => localStorage.clear());

  it('renders tools in a stored custom order', () => {
    localStorage.setItem(
      'remoteterm-sidebar-tool-order',
      JSON.stringify(['map', 'my-node', 'mesh-health', 'raw', 'visualizer', 'trace', 'search', 'channel-registry', 'cracker'])
    );
    renderSidebar();
    const mapRow = screen.getByRole('button', { name: 'Node Map' });
    const myNodeRow = screen.getByRole('button', { name: 'My Node' });
    expect(
      mapRow.compareDocumentPosition(myNodeRow) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/sidebar.test.tsx -t "renders tools in a stored custom order"`
Expected: FAIL — tools still render in hardcoded order (map after my-node).

- [ ] **Step 3: Implement**

Add imports at top of `Sidebar.tsx`:

```tsx
import { GripVertical, Settings2, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import {
  loadSectionOrder,
  saveSectionOrder,
  loadToolOrder,
  saveToolOrder,
  loadRailCollapsed,
  saveRailCollapsed,
  resetSidebarLayout,
  ALL_SECTION_KEYS,
  ALL_TOOL_KEYS,
  type SidebarSectionKey,
  type SidebarToolKey,
} from '../utils/sidebarLayout';
import { DragList } from './sidebar/DragList';
```

Add `forceExpanded` to the props interface (`SidebarProps`, after `blockedNames`):

```tsx
  /** When true (mobile drawer mount), pin the rail open and hide the rail toggle. */
  forceExpanded?: boolean;
```

Destructure it in the component signature with a default: add `forceExpanded = false,` to the destructured props.

Add state near the other layout state (after line ~220):

```tsx
  const [toolOrder, setToolOrder] = useState<SidebarToolKey[]>(loadToolOrder);
  const [sectionOrder, setSectionOrder] = useState<SidebarSectionKey[]>(loadSectionOrder);
```

Replace the `toolRows` const (`Sidebar.tsx:770-888`) with a keyed builder and an ordered array. Keep every existing `renderSidebarActionRow({...})` call body verbatim; only move each into the map under its key:

```tsx
  const toolRowByKey: Record<SidebarToolKey, React.ReactNode> = {
    'my-node': renderSidebarActionRow({
      key: 'tool-my-node',
      active: isActive('node', 'node'),
      icon: <Gauge className="h-4 w-4" />,
      label: t('nav_my_node'),
      onClick: () => handleSelectConversation({ type: 'node', id: 'node', name: t('nav_my_node') }),
    }),
    'mesh-health': renderSidebarActionRow({
      key: 'tool-mesh-health',
      active: isActive('mesh-health', 'mesh-health'),
      icon: <Activity className="h-4 w-4" />,
      label: t('nav_mesh_health'),
      onClick: () =>
        handleSelectConversation({ type: 'mesh-health', id: 'mesh-health', name: t('nav_mesh_health') }),
    }),
    raw: renderSidebarActionRow({
      key: 'tool-raw',
      active: isActive('raw', 'raw'),
      icon: <Logs className="h-4 w-4" />,
      label: t('nav_packet_feed'),
      onClick: () =>
        handleSelectConversation({ type: 'raw', id: 'raw', name: t('nav_raw_packet_feed_name') }),
    }),
    map: renderSidebarActionRow({
      key: 'tool-map',
      active: isActive('map', 'map'),
      icon: <Map className="h-4 w-4" />,
      label: t('nav_node_map'),
      onClick: () => handleSelectConversation({ type: 'map', id: 'map', name: t('nav_node_map') }),
    }),
    visualizer: renderSidebarActionRow({
      key: 'tool-visualizer',
      active: isActive('visualizer', 'visualizer'),
      icon: <ChartNetwork className="h-4 w-4" />,
      label: t('nav_mesh_visualizer'),
      onClick: () =>
        handleSelectConversation({ type: 'visualizer', id: 'visualizer', name: t('nav_mesh_visualizer') }),
    }),
    trace: renderSidebarActionRow({
      key: 'tool-trace',
      active: isActive('trace', 'trace'),
      icon: <Cable className="h-4 w-4" />,
      label: t('nav_trace'),
      onClick: () => handleSelectConversation({ type: 'trace', id: 'trace', name: t('nav_trace') }),
    }),
    search: renderSidebarActionRow({
      key: 'tool-search',
      active: isActive('search', 'search'),
      icon: <SearchIcon className="h-4 w-4" />,
      label: t('nav_message_search'),
      onClick: () =>
        handleSelectConversation({ type: 'search', id: 'search', name: t('nav_message_search') }),
    }),
    'channel-registry': renderSidebarActionRow({
      key: 'tool-channel-registry',
      active: isActive('channel-registry', 'channel-registry'),
      icon: <Library className="h-4 w-4" />,
      label: 'Channel Registry',
      onClick: () =>
        handleSelectConversation({ type: 'channel-registry', id: 'channel-registry', name: 'Channel Registry' }),
    }),
    cracker: renderSidebarActionRow({
      key: 'tool-cracker',
      active: showCracker,
      icon: <LockOpen className="h-4 w-4" />,
      label: (
        <>
          {t(showCracker ? 'nav_hide_channel_finder' : 'nav_show_channel_finder')}
          <span
            className={cn('ml-1 text-[0.6875rem]', crackerRunning ? 'text-primary' : 'text-muted-foreground')}
          >
            {t(crackerRunning ? 'chat_cracker_status_running' : 'chat_cracker_status_idle')}
          </span>
        </>
      ),
      onClick: onToggleCracker,
    }),
  };

  const toolRows = !query ? toolOrder.map((k) => toolRowByKey[k]) : [];
```

Note: `toolRows` is still an array of nodes; the existing `{toolRows.length > 0 && ...}` and `{(isSearching || !toolsCollapsed) && toolRows}` render sites (`:1011-1018`) keep working because `toolRows` remains an array.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/test/sidebar.test.tsx -t "renders tools in a stored custom order"`
Expected: PASS. Also run the full file to confirm no regression: `npm run test -- src/test/sidebar.test.tsx`.

- [ ] **Step 5: Checkpoint** — `npm run build`. No commit.

---

## Task 4: Data-driven section order

Render the six list sections in stored order via a `renderSection(key)` switch. Mark-All-Read moves to a fixed position directly after the search box (it is not reorderable). Default order preserves current appearance except Mark-All-Read now sits above Tools instead of between Tools and Favorites (documented, intentional).

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `frontend/src/test/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe('Sidebar section order', () => {
  beforeEach(() => localStorage.clear());

  it('renders sections in a stored custom order (favorites before tools)', () => {
    localStorage.setItem(
      'remoteterm-sidebar-section-order',
      JSON.stringify(['favorites', 'tools', 'channels', 'contacts', 'repeaters', 'rooms'])
    );
    renderSidebar();
    const favorites = screen.getByRole('button', { name: 'Favorites' });
    const tools = screen.getByRole('button', { name: 'Tools' });
    expect(
      favorites.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/sidebar.test.tsx -t "renders sections in a stored custom order"`
Expected: FAIL — Tools always precedes Favorites.

- [ ] **Step 3: Implement**

Extract each existing section JSX block (`:1010-1123`) into a `renderSection` function placed just before the `return (`. Move the existing block bodies verbatim into each `case`:

```tsx
  const renderSection = (key: SidebarSectionKey): React.ReactNode => {
    switch (key) {
      case 'tools':
        return toolRows.length > 0 ? (
          <div key="sec-tools">
            {renderSectionHeader(t('nav_tools_heading'), toolsCollapsed, () =>
              setToolsCollapsed((prev) => !prev)
            )}
            {(isSearching || !toolsCollapsed) && toolRows}
          </div>
        ) : null;
      case 'favorites':
        return favoriteItems.length > 0 ? (
          <div key="sec-favorites">{/* move existing Favorites block :1035-1048 here */}</div>
        ) : null;
      case 'channels':
        return nonFavoriteChannels.length > 0 ? (
          <div key="sec-channels">{/* move existing Channels block :1051-1077 here */}</div>
        ) : null;
      case 'contacts':
        return nonFavoriteContacts.length > 0 ? (
          <div key="sec-contacts">{/* move existing Contacts block :1080-1093 here */}</div>
        ) : null;
      case 'repeaters':
        return nonFavoriteRepeaters.length > 0 ? (
          <div key="sec-repeaters">{/* move existing Repeaters block :1096-1108 here */}</div>
        ) : null;
      case 'rooms':
        return nonFavoriteRooms.length > 0 ? (
          <div key="sec-rooms">{/* move existing Room Servers block :1111-1123 here */}</div>
        ) : null;
      default:
        return null;
    }
  };
```

In the list `<div>` (`:986`), replace the search box + Tools + Mark-All-Read + all five section blocks with: the search box (unchanged, `:987-1008`), then the Mark-All-Read block (moved verbatim from `:1020-1032`), then `{sectionOrder.map(renderSection)}`, then the existing empty-state block (`:1125-1134`) unchanged.

The empty-state condition already checks all five list arrays; it is unaffected by section order.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/test/sidebar.test.tsx`
Expected: PASS (new test + all existing). The existing `renders a full add channel/contact button above search` test asserts search precedes Tools; with default section order Tools still follows search, so it stays green.

- [ ] **Step 5: Checkpoint** — `npm run build`. No commit.

---

## Task 5: Rail collapse + forceExpanded (Sidebar + AppShell)

Add an icon-only rail width toggle. When `railCollapsed && !forceExpanded`, the nav shrinks to `w-12`, hides the search box and section list, and shows tool icons only (with title tooltips). The mobile drawer passes `forceExpanded` so its content always renders full.

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/components/AppShell.tsx:229-233,266,282`
- Test: `frontend/src/test/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe('Sidebar rail collapse', () => {
  beforeEach(() => localStorage.clear());

  it('collapses to an icon rail and hides search + section headers', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.queryByLabelText('Search conversations')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Favorites' })).not.toBeInTheDocument();
    // tool icons remain reachable by their accessible name
    expect(screen.getByRole('button', { name: 'Node Map' })).toBeInTheDocument();
  });

  it('ignores rail state and hides the toggle when forceExpanded', () => {
    localStorage.setItem('remoteterm-sidebar-rail-collapsed', 'true');
    render(
      <Sidebar
        contacts={[]}
        channels={[makeChannel(PUBLIC_CHANNEL_KEY, 'Public')]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
        forceExpanded
      />
    );
    expect(screen.getByLabelText('Search conversations')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse sidebar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expand sidebar' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/sidebar.test.tsx -t "rail"`
Expected: FAIL — no "Collapse sidebar" control exists.

- [ ] **Step 3: Implement in Sidebar.tsx**

Add state and a derived flag (after the `toolOrder`/`sectionOrder` state):

```tsx
  const [railCollapsed, setRailCollapsed] = useState<boolean>(loadRailCollapsed);
  const isRail = railCollapsed && !forceExpanded;

  const toggleRail = () => {
    setRailCollapsed((prev) => {
      const next = !prev;
      saveRailCollapsed(next);
      return next;
    });
  };
```

Add an `iconOnly` option to `renderSidebarActionRow`. Extend its params with `iconOnly = false` and, when true, render a centered icon-only row using the row's label as the `title`/`aria-label`. Add this branch at the top of the function body:

```tsx
    if (iconOnly) {
      const labelText = typeof label === 'string' ? label : key;
      return (
        <div
          key={key}
          data-active={active ? 'true' : undefined}
          className={cn(
            'px-0 py-2 cursor-pointer flex items-center justify-center border-l-2 border-transparent hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active && 'bg-accent border-l-primary'
          )}
          role="button"
          tabIndex={0}
          aria-current={active ? 'page' : undefined}
          aria-label={labelText}
          title={labelText}
          onKeyDown={handleKeyboardActivate}
          onClick={onClick}
        >
          <span aria-hidden="true">{icon}</span>
        </div>
      );
    }
```

Note: the cracker row's label is a fragment, so in rail mode its `title` falls back to `key`. That is acceptable for the icon rail; the full label shows when expanded. (If a better tooltip is wanted, pass an explicit `iconTitle` param — optional, not required.)

Change the root `<nav>` (`:966-969`) to switch width and aria on rail state:

```tsx
    <nav
      className={cn(
        'sidebar h-full min-h-0 overflow-hidden bg-card border-r border-border flex flex-col transition-[width] duration-200',
        isRail ? 'w-12' : 'w-60'
      )}
      aria-label={t('a11y_conversations_nav')}
    >
```

Wrap the existing content so the rail renders a compact column. Immediately inside `<nav>`, branch:

```tsx
      {isRail ? (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center py-2">
          {toolOrder.map((k) =>
            renderSidebarActionRowIcon(k)
          )}
        </div>
      ) : (
        <>
          {/* existing Header (:970-983) and List (:985-1135) go here unchanged */}
        </>
      )}
      {!forceExpanded && (
        <div className="border-t border-border p-1 flex justify-center">
          <button
            type="button"
            className="p-1.5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={toggleRail}
            aria-label={isRail ? t('nav_expand_sidebar') : t('nav_collapse_sidebar')}
            title={isRail ? t('nav_expand_sidebar') : t('nav_collapse_sidebar')}
          >
            {isRail ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      )}
```

Add a small helper that builds an icon-only row for a tool key, reusing the same click/active wiring by calling the map with `iconOnly`. Simplest: build a second keyed map `toolIconByKey` mirroring `toolRowByKey` but with `iconOnly: true` on each `renderSidebarActionRow` call, then `renderSidebarActionRowIcon = (k) => toolIconByKey[k]`. To avoid duplicating nine call sites, extract a `buildToolRow(key, iconOnly)` factory that returns `renderSidebarActionRow({...})` for a given key, and derive both maps from it. Define the factory once and:

```tsx
  const toolRowByKey = Object.fromEntries(
    ALL_TOOL_KEYS.map((k) => [k, buildToolRow(k, false)])
  ) as Record<SidebarToolKey, React.ReactNode>;
  const toolIconByKey = Object.fromEntries(
    ALL_TOOL_KEYS.map((k) => [k, buildToolRow(k, true)])
  ) as Record<SidebarToolKey, React.ReactNode>;
  const renderSidebarActionRowIcon = (k: SidebarToolKey) => toolIconByKey[k];
```

where `buildToolRow(key, iconOnly)` is the switch that returns each `renderSidebarActionRow({ ..., iconOnly })` object built in Task 3 (fold the Task 3 map into this factory so there is a single source of truth).

- [ ] **Step 4: Implement in AppShell.tsx**

Replace the shared `activeSidebarContent` (`:229-233`) so each mount can set `forceExpanded`:

```tsx
  const renderSidebar = (forceExpanded: boolean) =>
    showSettings ? settingsSidebarContent : <Sidebar {...sidebarProps} forceExpanded={forceExpanded} />;
```

Desktop mount (`:266`):

```tsx
        <div className="hidden md:block min-h-0 overflow-hidden">{renderSidebar(false)}</div>
```

Mobile drawer mount (`:282`):

```tsx
              {renderSidebar(true)}
```

(The settings view ignores `forceExpanded`, so `settingsSidebarContent` is unchanged.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test -- src/test/sidebar.test.tsx`
Expected: PASS including both rail tests.

- [ ] **Step 6: Checkpoint** — `npm run build`. No commit.

---

## Task 6: Gear settings panel + Reset to defaults

A gear button in the sidebar header toggles an in-sidebar settings panel containing the two `DragList`s (Section Order, Tool Order) and a Reset-to-defaults button. The panel renders only in the expanded (non-rail) state.

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `frontend/src/test/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe('Sidebar customize panel', () => {
  beforeEach(() => localStorage.clear());

  it('opens the customize panel and reorders a section via move-down', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Customize sidebar' }));
    const panel = screen.getByRole('group', { name: 'Customize sidebar' });
    // Section Order list has Tools first by default; move it down.
    const toolsRow = within(panel).getAllByRole('listitem').find((li) => li.textContent?.includes('Tools'))!;
    fireEvent.click(within(toolsRow).getByRole('button', { name: 'Move down' }));
    expect(JSON.parse(localStorage.getItem('remoteterm-sidebar-section-order')!)[0]).toBe('favorites');
  });

  it('resets layout to defaults', () => {
    localStorage.setItem('remoteterm-sidebar-tool-order', JSON.stringify(['map', 'my-node', 'mesh-health', 'raw', 'visualizer', 'trace', 'search', 'channel-registry', 'cracker']));
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Customize sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(localStorage.getItem('remoteterm-sidebar-tool-order')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/sidebar.test.tsx -t "customize"`
Expected: FAIL — no "Customize sidebar" button.

- [ ] **Step 3: Implement**

Add state:

```tsx
  const [showSettings, setShowSettings] = useState(false);
```

Add handlers:

```tsx
  const handleReorderSections = (next: SidebarSectionKey[]) => {
    setSectionOrder(next);
    saveSectionOrder(next);
  };
  const handleReorderTools = (next: SidebarToolKey[]) => {
    setToolOrder(next);
    saveToolOrder(next);
  };
  const handleResetLayout = () => {
    resetSidebarLayout();
    setSectionOrder([...ALL_SECTION_KEYS]);
    setToolOrder([...ALL_TOOL_KEYS]);
    setRailCollapsed(false);
  };

  const sectionLabels: Record<SidebarSectionKey, string> = {
    tools: t('nav_tools_heading'),
    favorites: t('nav_favorites_heading'),
    channels: t('nav_channels_heading'),
    contacts: t('nav_contacts_heading'),
    repeaters: t('nav_repeaters_heading'),
    rooms: t('nav_room_servers_heading'),
  };
  const toolLabels: Record<SidebarToolKey, string> = {
    'my-node': t('nav_my_node'),
    'mesh-health': t('nav_mesh_health'),
    raw: t('nav_packet_feed'),
    map: t('nav_node_map'),
    visualizer: t('nav_mesh_visualizer'),
    trace: t('nav_trace'),
    search: t('nav_message_search'),
    'channel-registry': 'Channel Registry',
    cracker: t('nav_show_channel_finder'),
  };
```

In the header `<div>` (`:971-983`), change to a flex row containing the existing Add button (kept) plus a gear button:

```tsx
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onNewMessage}
          title={t('a11y_add_channel_or_contact')}
          aria-label={t('a11y_add_channel_or_contact')}
          className="h-8 flex-1 justify-start gap-2 border-primary/20 bg-primary/5 px-3 text-[0.8125rem] text-primary hover:bg-primary/10 hover:text-primary"
        >
          <SquarePen className="h-4 w-4" />
          <span>{t('nav_add_channel_contact')}</span>
        </Button>
        <button
          type="button"
          className="h-8 w-8 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setShowSettings((p) => !p)}
          aria-label={t('nav_customize_sidebar')}
          aria-expanded={showSettings}
          title={t('nav_customize_sidebar')}
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>
```

Render the panel at the top of the list `<div>` (immediately after the search box), only when `showSettings` and not rail:

```tsx
        {showSettings && (
          <div
            role="group"
            aria-label={t('nav_customize_sidebar')}
            className="px-3 py-3 border-b border-border space-y-4"
          >
            <div>
              <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-1.5">
                {t('nav_section_order')}
              </div>
              <DragList
                items={sectionOrder}
                labels={sectionLabels}
                onReorder={handleReorderSections}
                moveUpLabel={t('nav_move_up')}
                moveDownLabel={t('nav_move_down')}
              />
            </div>
            <div>
              <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground mb-1.5">
                {t('nav_tool_order')}
              </div>
              <DragList
                items={toolOrder}
                labels={toolLabels}
                onReorder={handleReorderTools}
                moveUpLabel={t('nav_move_up')}
                moveDownLabel={t('nav_move_down')}
              />
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={handleResetLayout}>
              {t('nav_reset_to_defaults')}
            </Button>
          </div>
        )}
```

(The `showSettings` panel lives inside the non-rail branch from Task 5, so it is automatically hidden in rail mode.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/test/sidebar.test.tsx`
Expected: PASS including the two customize tests.

- [ ] **Step 5: Checkpoint** — `npm run build`. No commit.

---

## Task 7: Favourites-by-type sub-sections

Split the Favorites section into independently-collapsible sub-groups by type (Channels, Contacts, Room Servers, Repeaters). Extends `CollapseState` additively; absent keys default to expanded so current behaviour is preserved for existing users.

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `frontend/src/test/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe('Sidebar favourites by type', () => {
  beforeEach(() => localStorage.clear());

  it('renders per-type favourite sub-headers when favourites of multiple types exist', () => {
    const favChan = { ...makeChannel('BB'.repeat(16), '#flight'), favorite: true };
    const favContact = makeContact('11'.repeat(32), 'Alice', 1, { favorite: true });
    render(
      <Sidebar
        contacts={[favContact]}
        channels={[makeChannel(PUBLIC_CHANNEL_KEY, 'Public'), favChan]}
        activeConversation={null}
        onSelectConversation={vi.fn()}
        onNewMessage={vi.fn()}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={vi.fn()}
        onMarkAllRead={vi.fn()}
      />
    );
    // Sub-headers use existing section labels nested under Favorites.
    expect(screen.getByRole('button', { name: 'Favorites' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Favorite Channels' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Favorite Contacts' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/sidebar.test.tsx -t "favourites by type"`
Expected: FAIL — no per-type favourite sub-headers.

- [ ] **Step 3: Implement**

Extend `CollapseState` (`:117-124`), `DEFAULT_COLLAPSE_STATE` (`:128-135`), and `loadCollapsedState` (`:137-153`) with four additive keys defaulting to `false`: `favChannels`, `favContacts`, `favRooms`, `favRepeaters`. Add matching `useState` pairs and include them in the two persistence/search `useEffect` dependency lists and the persisted `state` object (`:557-564`) and the search snapshot (`:506-513`).

Split `favoriteItems` into four typed lists (channel / non-repeater contact / room / repeater) using the existing `favoriteTypeRank` categories, then in the `favorites` case of `renderSection` render the Favorites header followed by four sub-sections, each guarded by its list length and gated by its collapse boolean. Reuse `renderSectionHeader` for sub-headers with the new labels `t('nav_favorite_channels')`, `t('nav_favorite_contacts')`, `t('nav_favorite_room_servers')`, `t('nav_favorite_repeaters')`, and `renderConversationRow` for the rows. When only one type of favourite exists, still show its sub-header (keeps behaviour predictable and testable); the parent Favorites collapse hides all sub-sections at once.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/test/sidebar.test.tsx`
Expected: PASS. Note the existing test `shows muted section unread totals ... Favorites` asserts a `2` in the Favorites header container; keep the aggregate unread count on the parent Favorites header (do not move it to sub-headers) so that test stays green.

- [ ] **Step 5: Checkpoint** — `npm run build`. No commit.

---

## Task 8: i18n keys (EN/NL/DE)

Add every new user-facing key to all three locales. The `i18nParity.test.ts` fails if any locale is missing a key.

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`
- Test: `frontend/src/test/i18nParity.test.ts` (existing; no edit, must pass)

- [ ] **Step 1: Add keys to en.json** (alphabetical among `nav_*`)

```json
"nav_collapse_sidebar": "Collapse sidebar",
"nav_customize_sidebar": "Customize sidebar",
"nav_expand_sidebar": "Expand sidebar",
"nav_favorite_channels": "Favorite Channels",
"nav_favorite_contacts": "Favorite Contacts",
"nav_favorite_repeaters": "Favorite Repeaters",
"nav_favorite_room_servers": "Favorite Room Servers",
"nav_move_down": "Move down",
"nav_move_up": "Move up",
"nav_reset_to_defaults": "Reset to defaults",
"nav_section_order": "Section Order",
"nav_tool_order": "Tool Order",
```

- [ ] **Step 2: Add the same keys to nl.json**

```json
"nav_collapse_sidebar": "Zijbalk inklappen",
"nav_customize_sidebar": "Zijbalk aanpassen",
"nav_expand_sidebar": "Zijbalk uitklappen",
"nav_favorite_channels": "Favoriete kanalen",
"nav_favorite_contacts": "Favoriete contacten",
"nav_favorite_repeaters": "Favoriete repeaters",
"nav_favorite_room_servers": "Favoriete roomservers",
"nav_move_down": "Omlaag verplaatsen",
"nav_move_up": "Omhoog verplaatsen",
"nav_reset_to_defaults": "Standaardwaarden herstellen",
"nav_section_order": "Sectievolgorde",
"nav_tool_order": "Gereedschapsvolgorde",
```

- [ ] **Step 3: Add the same keys to de.json**

```json
"nav_collapse_sidebar": "Seitenleiste einklappen",
"nav_customize_sidebar": "Seitenleiste anpassen",
"nav_expand_sidebar": "Seitenleiste ausklappen",
"nav_favorite_channels": "Favorisierte Kanäle",
"nav_favorite_contacts": "Favorisierte Kontakte",
"nav_favorite_repeaters": "Favorisierte Repeater",
"nav_favorite_room_servers": "Favorisierte Room-Server",
"nav_move_down": "Nach unten verschieben",
"nav_move_up": "Nach oben verschieben",
"nav_reset_to_defaults": "Auf Standard zurücksetzen",
"nav_section_order": "Abschnittsreihenfolge",
"nav_tool_order": "Werkzeugreihenfolge",
```

> Dutch/German strings are best-effort translations. Flag them for the maintainer to confirm; do not block on it (parity only checks key presence, not translation quality).

- [ ] **Step 4: Run parity + verify no hardcoded-string lint failures**

Run: `npm run test -- src/test/i18nParity.test.ts`
Expected: PASS.
Run: `npm run lint` (the i18n eslint guard must not flag the new labels — every new user-facing string uses `t()`).
Expected: PASS.

- [ ] **Step 5: Checkpoint** — no commit.

---

## Task 9: Full verification + runtime pass

**Files:** none (verification only).

- [ ] **Step 1: Full frontend test suite**

Run: `npm run test`
Expected: PASS (existing + new).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds, no TS errors.

- [ ] **Step 3: Quality gate**

Run (from repo root): `./scripts/quality/all_quality.sh`
Expected: PASS (or only the pre-existing Windows-only failures documented in memory `windows-only-test-failures`; confirm no NEW failures).

- [ ] **Step 4: Runtime verification (mandatory, repo rule)**

Rebuild/refresh the local app (see memory `local-docker-instance` for the container) and observe, do not reason:
1. **Desktop:** open Customize; drag a tool to reorder (pointer DnD works); use move up/down buttons (they reorder); reload and confirm order persists. Toggle the rail; confirm width animates to icon-only, search + section headers hide, tool icons remain and are clickable; reload and confirm rail persists. Reset to defaults; confirm order + rail return to default and localStorage keys are cleared.
2. **Mobile drawer (<768px):** open the drawer; confirm it renders full width (`w-[280px]`) with no rail toggle even if `remoteterm-sidebar-rail-collapsed` is `true` in storage; confirm move up/down buttons reorder (DnD not required on touch); confirm swipe-to-close still works.
3. **Favourites:** with favourites of 2+ types, confirm per-type sub-headers render and collapse independently; the parent Favorites still shows the aggregate unread badge.

Record the two independent checks per the repo "never claim it works without proof" rule: (a) full `npm run test` output, (b) the runtime observations above. Mark anything not observed as NOT VERIFIED.

- [ ] **Step 5: Finish** — report results. Do not commit or open a PR unless the user explicitly asks (see Commit policy / repo git rules).

---

## Self-review notes (author)

- **Spec coverage:** reorder (T3/T4), DnD+move buttons (T2), settings panel + reset (T6), rail + forceExpanded (T5), favourites-by-type (T7), i18n (T8), verification incl. runtime + touch (T9). Phase 3 excluded per spec. All spec sections map to a task.
- **Type consistency:** `SidebarSectionKey`/`SidebarToolKey`, `ALL_SECTION_KEYS`/`ALL_TOOL_KEYS`, `loadSectionOrder/saveSectionOrder/loadToolOrder/saveToolOrder/loadRailCollapsed/saveRailCollapsed/resetSidebarLayout`, and `DragList` props (`items/labels/onReorder/moveUpLabel/moveDownLabel`) are used identically across tasks. `buildToolRow(key, iconOnly)` is the single source for both `toolRowByKey` and `toolIconByKey` (introduced in T3, folded into the factory in T5).
- **No placeholders in new modules:** `sidebarLayout.ts`, `DragList.tsx`, and all tests are complete. Sidebar.tsx edits that move existing JSX are marked with the exact source line ranges to relocate, because reproducing ~150 unchanged lines verbatim adds risk without value; the reviewer moves the cited block, it is not new logic.
```
