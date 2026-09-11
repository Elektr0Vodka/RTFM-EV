# Sidebar Section Counters and New/Unread Pills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a total-item counter and a green "new" pill (newly discovered items not yet opened) to each sidebar section header, keep the existing unread pill, add a per-row new marker and a per-section clear control, and change one Dutch locale string.

**Architecture:** Frontend only. A new `useSeenItems` hook tracks a per-client "seen" set in localStorage (baseline-seeded on first load so nothing shows as new initially), keyed by the canonical `getStateKey(type, id)`. `Sidebar` consumes it to render totals, new pills, per-row dots, and a per-section clear button. Unread clearing for a section reuses per-conversation mark-read via a new `markConversationsRead` on `useUnreadCounts`. A new `--badge-new` theme token drives the green across all themes.

**Tech Stack:** React 18 + TypeScript, Tailwind with HSL CSS custom properties, Vitest + Testing Library, i18n JSON catalogs (en/nl/de) with `{count}` interpolation.

---

## Repo-specific constraints (read before executing)

- **Git:** Per `CLAUDE.md`, never commit/push/PR unless the user explicitly says so. The `- [ ] Commit` steps below are the intended checkpoints; run them only once the user has authorized committing (batch them or ask at each checkpoint). Do not add AI attribution or co-author lines.
- **No em dashes** in any user-visible string (locale values, aria-labels, tooltips).
- **i18n parity is enforced** (`src/test/i18nParity.test.ts`): every key added to `en.json` MUST also be added to `nl.json` and `de.json`, or that test fails.
- **Windows test env:** roughly 14 backend tests and some charmap collection errors fail pre-existing; that is environmental, not a regression. This plan touches only frontend (`cd frontend`).
- Run all frontend commands from `frontend/`: tests `npm run test:run`, lint `npm run lint`, typecheck/build `npm run build`.

## File structure

- Create `frontend/src/hooks/useSeenItems.ts` - seen-set tracking + persistence + new detection.
- Create `frontend/src/test/useSeenItems.test.ts` - unit tests for the hook.
- Modify `frontend/src/hooks/useUnreadCounts.ts` - add `markConversationsRead`.
- Modify `frontend/src/App.tsx` - wire `onMarkSectionRead` into `sidebarProps`.
- Modify `frontend/src/components/Sidebar.tsx` - totals, new pills, per-row dot, per-section clear button, hook wiring, new prop.
- Modify `frontend/src/test/sidebar.test.tsx` - disambiguate existing header assertions, add new tests.
- Modify `frontend/src/index.css` - add `--badge-new` tokens.
- Modify `frontend/tailwind.config.js` - map `badge-new`.
- Modify `frontend/src/themes.css` - per-theme `--badge-new` overrides where needed.
- Modify `frontend/src/i18n/locales/{en,nl,de}.json` - new keys + the Dutch `# Kanaal` change.

---

## Task 1: Change the Dutch bulk-delete hashtag label

**Files:**
- Modify: `frontend/src/i18n/locales/nl.json:2147`

- [ ] **Step 1: Make the edit**

Change the value of `bulkdelete_channels_type_hashtag` in `nl.json` from `"Hashtag-kamers"` to `"# Kanaal"`. Leave `en.json` (`Hashtag rooms`) and `de.json` (`Hashtag-Räume`) unchanged.

Current line:
```json
  "bulkdelete_channels_type_hashtag": "Hashtag-kamers",
```
New line:
```json
  "bulkdelete_channels_type_hashtag": "# Kanaal",
```

- [ ] **Step 2: Verify the change and that parity still holds**

Run: `cd frontend && npm run test:run -- src/test/i18nParity.test.ts`
Expected: PASS (keys unchanged, only a value changed).

Also confirm the new value is present:
Run: `grep -n "# Kanaal" src/i18n/locales/nl.json`
Expected: one match on the `bulkdelete_channels_type_hashtag` line.

- [ ] **Step 3: Commit** (only once authorized)

```bash
git add frontend/src/i18n/locales/nl.json
git commit -m "i18n(nl): rename bulk-delete hashtag label to # Kanaal"
```

---

## Task 2: Add i18n keys for the new sidebar features

Add four keys to all three catalogs. Placement does not matter for the parity test (it sorts keys), but put them near related `a11y_*` / `nav_*` keys for readability.

**Files:**
- Modify: `frontend/src/i18n/locales/en.json`
- Modify: `frontend/src/i18n/locales/nl.json`
- Modify: `frontend/src/i18n/locales/de.json`

- [ ] **Step 1: Add keys to `en.json`**

Add these entries (near the other `a11y_` keys, e.g. after `a11y_unread_count`):
```json
  "a11y_total_count": "{count} total",
  "a11y_new_count": "{count} new",
  "a11y_new_item": "New",
  "nav_section_mark_read_seen": "Mark section read and seen",
```

- [ ] **Step 2: Add keys to `nl.json`**

```json
  "a11y_total_count": "{count} totaal",
  "a11y_new_count": "{count} nieuw",
  "a11y_new_item": "Nieuw",
  "nav_section_mark_read_seen": "Sectie als gelezen en gezien markeren",
```

- [ ] **Step 3: Add keys to `de.json`**

```json
  "a11y_total_count": "{count} gesamt",
  "a11y_new_count": "{count} neu",
  "a11y_new_item": "Neu",
  "nav_section_mark_read_seen": "Abschnitt als gelesen und gesehen markieren",
```

- [ ] **Step 4: Verify parity**

Run: `cd frontend && npm run test:run -- src/test/i18nParity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json
git commit -m "i18n: add sidebar total/new/clear strings (en/nl/de)"
```

---

## Task 3: Add the `--badge-new` theme token

**Files:**
- Modify: `frontend/src/index.css` (base `:root`, near the `--badge-*` block around line 88-92)
- Modify: `frontend/tailwind.config.js` (colors map, near `badge-unread`/`badge-mention` around line 66-73)
- Modify: `frontend/src/themes.css` (targeted per-theme overrides)

- [ ] **Step 1: Add base tokens in `index.css`**

In the `Unread badges` block in base `:root`, add below the existing mention tokens:
```css
    --badge-new: 142 71% 45%;
    --badge-new-foreground: 0 0% 100%;
```

- [ ] **Step 2: Map the color in `tailwind.config.js`**

After the `badge-mention` entry, add:
```js
        "badge-new": {
          DEFAULT: "hsl(var(--badge-new))",
          foreground: "hsl(var(--badge-new-foreground))",
        },
```

- [ ] **Step 3: Add targeted theme overrides in `themes.css`**

The base green suits the dark themes. Add `--badge-new` inside these existing theme `:root[data-theme=...]` blocks (put it next to the other color tokens in each block):

`:root[data-theme='light']` (darker green for contrast on light ground):
```css
  --badge-new: 142 64% 34%;
```
`:root[data-theme='high-contrast']` (vivid, high-contrast green):
```css
  --badge-new: 130 90% 40%;
  --badge-new-foreground: 0 0% 0%;
```
`:root[data-theme='monochrome']` (keep greyscale; use the theme foreground so the pill reads as a neutral, not green):
```css
  --badge-new: 0 0% 45%;
  --badge-new-foreground: 0 0% 100%;
```
`:root[data-theme='windows-95']` (classic green):
```css
  --badge-new: 120 60% 30%;
```

- [ ] **Step 4: Typecheck / build to confirm the Tailwind token resolves**

Run: `cd frontend && npm run build`
Expected: build succeeds with no error about `badge-new`.

Note: full per-theme visual confirmation happens in Task 9 in the running app. Other light-ground themes (paper-grove, solar-flare, candy-dusk, lagoon-pop) are checked there; if the green looks wrong on any, add a `--badge-new` override to that theme block the same way.

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add frontend/src/index.css frontend/tailwind.config.js frontend/src/themes.css
git commit -m "feat(theme): add badge-new token for sidebar new pill"
```

---

## Task 4: Create the `useSeenItems` hook (tests first)

**Files:**
- Create: `frontend/src/hooks/useSeenItems.ts`
- Test: `frontend/src/test/useSeenItems.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/test/useSeenItems.test.ts`:
```ts
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSeenItems, SIDEBAR_SEEN_ITEMS_KEY } from '../hooks/useSeenItems';
import { getStateKey } from '../utils/conversationState';

const chan = (k: string) => getStateKey('channel', k);

describe('useSeenItems', () => {
  beforeEach(() => localStorage.clear());

  it('baselines all current identities on first run so nothing is new', () => {
    const ids = [chan('a'), chan('b')];
    const { result } = renderHook(() => useSeenItems(ids, null));
    expect(result.current.countNew(ids)).toBe(0);
    expect(result.current.isNew(chan('a'))).toBe(false);
    // baseline persisted
    expect(localStorage.getItem(SIDEBAR_SEEN_ITEMS_KEY)).not.toBeNull();
  });

  it('flags identities that appear after the baseline as new', () => {
    const initial = [chan('a')];
    const { result, rerender } = renderHook(
      ({ ids }) => useSeenItems(ids, null),
      { initialProps: { ids: initial } }
    );
    const grown = [chan('a'), chan('b')];
    rerender({ ids: grown });
    expect(result.current.isNew(chan('b'))).toBe(true);
    expect(result.current.countNew(grown)).toBe(1);
  });

  it('clears new state for the active channel/contact conversation', () => {
    // Pre-seed a baseline that excludes 'b' so 'b' is new.
    localStorage.setItem(SIDEBAR_SEEN_ITEMS_KEY, JSON.stringify([chan('a')]));
    const ids = [chan('a'), chan('b')];
    const { result, rerender } = renderHook(
      ({ active }) => useSeenItems(ids, active),
      { initialProps: { active: null as null | { type: 'channel'; id: string; name: string } } }
    );
    expect(result.current.isNew(chan('b'))).toBe(true);
    rerender({ active: { type: 'channel', id: 'b', name: 'B' } });
    expect(result.current.isNew(chan('b'))).toBe(false);
  });

  it('markSeen adds identities and persists', () => {
    localStorage.setItem(SIDEBAR_SEEN_ITEMS_KEY, JSON.stringify([chan('a')]));
    const ids = [chan('a'), chan('b'), chan('c')];
    const { result } = renderHook(() => useSeenItems(ids, null));
    act(() => result.current.markSeen([chan('b'), chan('c')]));
    expect(result.current.countNew(ids)).toBe(0);
    const stored = JSON.parse(localStorage.getItem(SIDEBAR_SEEN_ITEMS_KEY) as string);
    expect(new Set(stored)).toEqual(new Set([chan('a'), chan('b'), chan('c')]));
  });

  it('does not throw when localStorage is unavailable', () => {
    const spy = () => {
      throw new Error('denied');
    };
    const orig = { g: localStorage.getItem, s: localStorage.setItem };
    localStorage.getItem = spy as unknown as typeof localStorage.getItem;
    localStorage.setItem = spy as unknown as typeof localStorage.setItem;
    try {
      const ids = [chan('a')];
      const { result } = renderHook(() => useSeenItems(ids, null));
      expect(result.current.countNew(ids)).toBe(0);
    } finally {
      localStorage.getItem = orig.g;
      localStorage.setItem = orig.s;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:run -- src/test/useSeenItems.test.ts`
Expected: FAIL (module `../hooks/useSeenItems` does not exist).

- [ ] **Step 3: Implement the hook**

Create `frontend/src/hooks/useSeenItems.ts`:
```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Conversation } from '../types';
import { getStateKey } from '../utils/conversationState';

export const SIDEBAR_SEEN_ITEMS_KEY = 'remoteterm-sidebar-seen-items';

function loadSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_SEEN_ITEMS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return null;
  }
}

function persistSeen(seen: Set<string>): void {
  try {
    localStorage.setItem(SIDEBAR_SEEN_ITEMS_KEY, JSON.stringify([...seen]));
  } catch {
    // localStorage may be disabled; keep in-memory only.
  }
}

export interface SeenItems {
  /** True when the identity is not in the seen set (and a baseline exists). */
  isNew: (identity: string) => boolean;
  /** Count of the given identities that are new. */
  countNew: (identities: string[]) => number;
  /** Mark the given identities seen (idempotent, persisted). */
  markSeen: (identities: string[]) => void;
}

/**
 * Tracks which sidebar items the client has already seen so newly discovered
 * items can be surfaced. Identity is the canonical conversation key from
 * getStateKey(type, id).
 *
 * On first run (no stored baseline) the first non-empty identity list is recorded
 * as the baseline, so nothing is flagged new on initial load. Only items that
 * appear after the baseline are new until opened or explicitly cleared.
 */
export function useSeenItems(
  allIdentities: string[],
  activeConversation: Conversation | null
): SeenItems {
  const [seen, setSeen] = useState<Set<string> | null>(() => loadSeen());
  const seenRef = useRef<Set<string> | null>(seen);
  seenRef.current = seen;

  // Baseline: first non-empty identity list with no stored baseline seeds the set.
  useEffect(() => {
    if (seenRef.current !== null) return;
    if (allIdentities.length === 0) return;
    const baseline = new Set(allIdentities);
    persistSeen(baseline);
    setSeen(baseline);
  }, [allIdentities]);

  // Mark the active channel/contact conversation seen when viewed. Deferred until
  // a baseline exists so it cannot pre-empt baseline seeding (the active item is
  // already part of the baseline snapshot).
  useEffect(() => {
    if (seenRef.current === null) return;
    if (!activeConversation) return;
    if (activeConversation.type !== 'channel' && activeConversation.type !== 'contact') return;
    const identity = getStateKey(activeConversation.type, activeConversation.id);
    setSeen((prev) => {
      if (!prev || prev.has(identity)) return prev;
      const next = new Set(prev);
      next.add(identity);
      persistSeen(next);
      return next;
    });
  }, [activeConversation]);

  const markSeen = useCallback((identities: string[]) => {
    setSeen((prev) => {
      const base = prev ?? new Set<string>();
      const next = new Set(base);
      let changed = false;
      for (const id of identities) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (!changed) return prev;
      persistSeen(next);
      return next;
    });
  }, []);

  const isNew = useCallback(
    (identity: string): boolean => {
      if (seen === null) return false;
      return !seen.has(identity);
    },
    [seen]
  );

  const countNew = useCallback(
    (identities: string[]): number => {
      if (seen === null) return 0;
      let count = 0;
      for (const id of identities) if (!seen.has(id)) count++;
      return count;
    },
    [seen]
  );

  return useMemo(() => ({ isNew, countNew, markSeen }), [isNew, countNew, markSeen]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:run -- src/test/useSeenItems.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add frontend/src/hooks/useSeenItems.ts frontend/src/test/useSeenItems.test.ts
git commit -m "feat(sidebar): add useSeenItems hook for new-item tracking"
```

---

## Task 5: Add `markConversationsRead` to `useUnreadCounts`

Adds a section-scoped read clear (local state + per-conversation API), used by the per-section clear button.

**Files:**
- Modify: `frontend/src/hooks/useUnreadCounts.ts` (add the callback and return it; near `markAllRead` around line 284-308)
- Test: `frontend/src/test/useUnreadCounts.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/test/useUnreadCounts.test.ts` a test that renders the hook, seeds unread counts (via the hook's existing setup pattern used by the other tests in that file), calls `markConversationsRead([{ type: 'contact', id: '<pk>' }])`, and asserts that conversation's count is cleared locally and `api.markContactRead` was called with the pk. Follow the existing test's mocking of `../api` (see the top of the file for the established `vi.mock('../api', ...)` pattern) and add `markContactRead`/`markChannelRead` to that mock if not already present.

```ts
it('markConversationsRead clears local unread and calls per-conversation API', async () => {
  // Arrange: use the file's existing render helper / applyUnreads path to seed
  // an unread count for a contact key, then:
  act(() => {
    result.current.markConversationsRead([{ type: 'contact', id: CONTACT_PK }]);
  });
  expect(result.current.unreadCounts[getStateKey('contact', CONTACT_PK)]).toBeUndefined();
  expect(api.markContactRead).toHaveBeenCalledWith(CONTACT_PK);
});
```
(Wire `CONTACT_PK`, `result`, and seeding to match the existing tests in this file; reuse their setup rather than inventing a new one.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:run -- src/test/useUnreadCounts.test.ts`
Expected: FAIL (`markConversationsRead` is not a function).

- [ ] **Step 3: Implement `markConversationsRead`**

In `useUnreadCounts.ts`, add this callback next to `markAllRead`:
```ts
  // Mark a specific set of conversations read (used for per-section clear).
  const markConversationsRead = useCallback(
    (items: { type: 'channel' | 'contact'; id: string }[]) => {
      if (items.length === 0) return;
      const keys = items.map((i) => getStateKey(i.type, i.id));
      const clear = (prev: Record<string, unknown>) => {
        let changed = false;
        const next = { ...prev };
        for (const key of keys) {
          if (key in next) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      };
      setUnreadCounts((prev) => clear(prev) as Record<string, number>);
      setMentions((prev) => clear(prev) as Record<string, boolean>);
      setFirstUnreadIds((prev) => clear(prev) as Record<string, number | null>);
      for (const { type, id } of items) {
        if (type === 'channel') {
          api.markChannelRead(id).catch(() => {});
        } else {
          api.markContactRead(id).catch(() => {});
        }
      }
    },
    []
  );
```
Then add `markConversationsRead,` to the returned object (next to `markAllRead,`).

If the hook's return type is declared via an interface, add:
```ts
  markConversationsRead: (items: { type: 'channel' | 'contact'; id: string }[]) => void;
```
to that interface (search the file for `markAllRead: () => void;`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run test:run -- src/test/useUnreadCounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add frontend/src/hooks/useUnreadCounts.ts frontend/src/test/useUnreadCounts.test.ts
git commit -m "feat(unread): add markConversationsRead for section-scoped clear"
```

---

## Task 6: Wire the new Sidebar prop through App

`Sidebar` needs a callback to clear a section's unread. Add it to props and provide it from `App.tsx`.

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (props interface + destructure)
- Modify: `frontend/src/App.tsx` (`sidebarProps`, around line 589-608, and the `useUnreadCounts` destructure around line 384)

- [ ] **Step 1: Add the prop to `SidebarProps`**

In `Sidebar.tsx`, in `interface SidebarProps` (near `onMarkAllRead: () => void;`), add:
```ts
  onMarkSectionRead: (items: { type: 'channel' | 'contact'; id: string }[]) => void;
```
And add `onMarkSectionRead,` to the destructured params of `export function Sidebar({ ... })`.

- [ ] **Step 2: Provide it from App**

In `App.tsx`, add `markConversationsRead` to the `useUnreadCounts` destructure (next to `markAllRead`). Then in the `sidebarProps` object (next to `onMarkAllRead`), add:
```ts
    onMarkSectionRead: markConversationsRead,
```

- [ ] **Step 3: Update the Sidebar test harness for the new required prop**

In `frontend/src/test/sidebar.test.tsx`, in `renderSidebar`, add to the rendered `<Sidebar ... />`:
```tsx
      onMarkSectionRead={vi.fn()}
```
(Place it near `onMarkAllRead={vi.fn()}`.)

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npm run build`
Expected: build succeeds (no missing-prop type error).

- [ ] **Step 5: Commit** (only once authorized)

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/App.tsx frontend/src/test/sidebar.test.tsx
git commit -m "feat(sidebar): thread onMarkSectionRead prop from App"
```

---

## Task 7: Render the total counter inline in each section header

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (`renderSectionHeader` 890-963 and its call sites 1035-1123)
- Test: `frontend/src/test/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `sidebar.test.tsx` (inside the `describe('Sidebar section summaries', ...)` block). The default `renderSidebar` data yields these non-favorite totals: Channels 2 (Public, #ops), Contacts 1 (Alice), Repeaters 1 (Relay), Room Servers 1 (Ops Board), Favorites 1 (#flight). Assert the total via its aria-label so it does not collide with the unread number:
```ts
it('shows a total-item counter in each section header', () => {
  renderSidebar();
  expect(
    within(getSectionHeaderContainer('Channels')).getByLabelText('2 total')
  ).toBeInTheDocument();
  expect(
    within(getSectionHeaderContainer('Contacts')).getByLabelText('1 total')
  ).toBeInTheDocument();
  expect(
    within(getSectionHeaderContainer('Repeaters')).getByLabelText('1 total')
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:run -- src/test/sidebar.test.tsx -t "total-item counter"`
Expected: FAIL (no element with that label).

- [ ] **Step 3: Extend `renderSectionHeader` to accept and render a total**

Change the signature to add a `totalCount` parameter (insert it right after `title`), keeping later positional params intact by giving it a default:
```ts
  const renderSectionHeader = (
    title: string,
    collapsed: boolean,
    onToggle: () => void,
    sortSection: SidebarSortableSection | null = null,
    unreadCount = 0,
    highlightUnread = false,
    action: React.ReactNode = null,
    totalCount = 0,
    newCount = 0,
    onClearSection: (() => void) | null = null
  ) => {
```
(`newCount` and `onClearSection` are added now so Tasks 8 and 9 do not re-touch the signature.)

Render the total inline after the label span. Replace the label button's trailing `<span>{title}</span>` region so the total sits just after it, inside the same left group:
```tsx
          {effectiveCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{title}</span>
          {totalCount > 0 && (
            <span
              className="text-[0.625rem] font-semibold tabular-nums text-muted-foreground/70"
              aria-label={t('a11y_total_count', { count: totalCount })}
            >
              {totalCount}
            </span>
          )}
```

- [ ] **Step 4: Pass totals at each call site**

The row arrays already exist (`channelRows`, `contactRows`, `roomRows`, `repeaterRows`, `favoriteRows`). Pass each section's `.length` as the new `totalCount` positional argument. Because `action`, `totalCount`, `newCount`, `onClearSection` are positional, pass `null`/`0` for the ones a section does not use.

Favorites call:
```tsx
            {renderSectionHeader(
              t('nav_favorites_heading'),
              favoritesCollapsed,
              () => setFavoritesCollapsed((prev) => !prev),
              'favorites',
              favoritesUnreadCount,
              favoritesHasMention,
              null,
              favoriteRows.length
            )}
```
Channels call (keeps its existing import/export `action` node):
```tsx
            {renderSectionHeader(
              t('nav_channels_heading'),
              channelsCollapsed,
              () => setChannelsCollapsed((prev) => !prev),
              'channels',
              channelsUnreadCount,
              channelsHasMention,
              onOpenChannelImportExport ? (
                /* existing import/export button unchanged */
              ) : null,
              channelRows.length
            )}
```
Contacts call:
```tsx
            {renderSectionHeader(
              t('nav_contacts_heading'),
              contactsCollapsed,
              () => setContactsCollapsed((prev) => !prev),
              'contacts',
              contactsUnreadCount,
              contactsUnreadCount > 0,
              null,
              contactRows.length
            )}
```
Repeaters call:
```tsx
            {renderSectionHeader(
              t('nav_repeaters_heading'),
              repeatersCollapsed,
              () => setRepeatersCollapsed((prev) => !prev),
              'repeaters',
              repeatersUnreadCount,
              false,
              null,
              repeaterRows.length
            )}
```
Room Servers call:
```tsx
            {renderSectionHeader(
              t('nav_room_servers_heading'),
              roomsCollapsed,
              () => setRoomsCollapsed((prev) => !prev),
              'rooms',
              roomsUnreadCount,
              roomsUnreadCount > 0,
              null,
              roomRows.length
            )}
```

- [ ] **Step 5: Fix the pre-existing header assertions that now see two numbers**

The existing test `shows muted section unread totals in each visible section header` uses `getByText('<n>')` inside a header that now also contains the total. Update those assertions to target the unread pill by its aria-label instead:
```ts
  it('shows muted section unread totals in each visible section header', () => {
    renderSidebar();
    expect(within(getSectionHeaderContainer('Favorites')).getByLabelText('2 unread')).toBeInTheDocument();
    expect(within(getSectionHeaderContainer('Channels')).getByLabelText('1 unread')).toBeInTheDocument();
    expect(within(getSectionHeaderContainer('Contacts')).getByLabelText('3 unread')).toBeInTheDocument();
    expect(within(getSectionHeaderContainer('Room Servers')).getByLabelText('5 unread')).toBeInTheDocument();
    expect(within(getSectionHeaderContainer('Repeaters')).getByLabelText('4 unread')).toBeInTheDocument();
  });
```
(The unread pill already sets `aria-label={t('a11y_unread_count', { count })}` = "N unread".)

- [ ] **Step 6: Run the sidebar tests**

Run: `cd frontend && npm run test:run -- src/test/sidebar.test.tsx`
Expected: PASS (updated unread-by-label test + new total test).

- [ ] **Step 7: Commit** (only once authorized)

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/test/sidebar.test.tsx
git commit -m "feat(sidebar): show total-item counter in section headers"
```

---

## Task 8: Wire useSeenItems and render the green "new" pill + per-row dot

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `frontend/src/test/sidebar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `sidebar.test.tsx`. Force an item to be "new" by pre-seeding the seen baseline to exclude it. Alice's contact key is `getStateKey('contact', '11'.repeat(32))`. Seed the baseline with everything except Alice, so the Contacts section shows 1 new and Alice's row shows a new marker.
```ts
it('shows a green new pill and a per-row new dot for newly discovered items', () => {
  const alicePk = '11'.repeat(32);
  const everythingElse = [
    getStateKey('channel', 'AA'.repeat(16)),
    getStateKey('channel', 'BB'.repeat(16)),
    getStateKey('channel', 'CC'.repeat(16)),
    getStateKey('contact', '33'.repeat(32)), // room
    getStateKey('contact', '22'.repeat(32)), // repeater
  ];
  localStorage.setItem(
    'remoteterm-sidebar-seen-items',
    JSON.stringify(everythingElse)
  );
  renderSidebar();
  // Header new pill
  expect(
    within(getSectionHeaderContainer('Contacts')).getByLabelText('1 new')
  ).toBeInTheDocument();
  // Per-row dot (aria-label "New") on Alice's row
  expect(screen.getByLabelText('New')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:run -- src/test/sidebar.test.tsx -t "green new pill"`
Expected: FAIL.

- [ ] **Step 3: Instantiate the hook and compute per-section identities + new counts**

Near the top of the `Sidebar` function body (after the row arrays `channelRows`/`contactRows`/`roomRows`/`repeaterRows`/`favoriteRows` are defined, since they are needed), add:
```ts
  const identitiesOf = (rows: ConversationRow[]): string[] =>
    rows.map((row) => getStateKey(row.type, row.id));

  const allIdentities = useMemo(
    () =>
      identitiesOf([
        ...favoriteRows,
        ...channelRows,
        ...contactRows,
        ...roomRows,
        ...repeaterRows,
      ]),
    [favoriteRows, channelRows, contactRows, roomRows, repeaterRows]
  );

  const { isNew, countNew, markSeen } = useSeenItems(allIdentities, activeConversation);

  const favoritesNewCount = countNew(identitiesOf(favoriteRows));
  const channelsNewCount = countNew(identitiesOf(channelRows));
  const contactsNewCount = countNew(identitiesOf(contactRows));
  const roomsNewCount = countNew(identitiesOf(roomRows));
  const repeatersNewCount = countNew(identitiesOf(repeaterRows));
```
Add the import at the top of the file:
```ts
import { useSeenItems } from '../hooks/useSeenItems';
```
Note: `getStateKey` and `useMemo` are already imported in this file.

Caution on hook order: `useSeenItems` must be called unconditionally on every render (it is, at the top level here). The row arrays are computed with plain `const`/`map` (not hooks), so referencing them before this point is fine.

- [ ] **Step 4: Render the new pill in `renderSectionHeader`**

Inside the right-side group of `renderSectionHeader`, before the existing unread pill block (`{unreadCount > 0 && (...)}`), add the green new pill, and include it in the group's render condition. Update the wrapping condition and add the pill:
```tsx
        {(sortSection || unreadCount > 0 || newCount > 0 || action || onClearSection) && (
          <div className="ml-auto flex items-center gap-1.5">
            {action}
            {/* existing sort toggle button stays here */}
            {newCount > 0 && (
              <span
                className="text-[0.625rem] font-medium px-1.5 py-0.5 rounded-full bg-badge-new/15 text-badge-new"
                aria-label={t('a11y_new_count', { count: newCount })}
              >
                {newCount}
              </span>
            )}
            {unreadCount > 0 && (
              /* existing unread pill unchanged */
            )}
          </div>
        )}
```

- [ ] **Step 5: Pass `newCount` at each call site**

Add the `newCount` positional arg (8th param, right after `totalCount`) to each `renderSectionHeader` call: `favoritesNewCount`, `channelsNewCount`, `contactsNewCount`, `repeatersNewCount`, `roomsNewCount` respectively. Example for Contacts:
```tsx
              contactRows.length,
              contactsNewCount
```
(Append after the `totalCount` argument added in Task 7 for each section.)

- [ ] **Step 6: Render the per-row new dot in `renderConversationRow`**

In `renderConversationRow`, compute `const rowIsNew = isNew(getStateKey(row.type, row.id));` at the top of the function, then add the dot inside the right-side icon group (the `<span className="ml-auto flex items-center gap-1">`), before the unread pill:
```tsx
          {rowIsNew && (
            <span
              className="h-2 w-2 rounded-full bg-badge-new"
              aria-label={t('a11y_new_item')}
              title={t('a11y_new_item')}
            />
          )}
```

- [ ] **Step 7: Run the sidebar tests**

Run: `cd frontend && npm run test:run -- src/test/sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit** (only once authorized)

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/test/sidebar.test.tsx
git commit -m "feat(sidebar): green new pill and per-row new marker"
```

---

## Task 9: Per-section clear button (marks read + seen)

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (`renderSectionHeader` + call sites)
- Test: `frontend/src/test/sidebar.test.tsx`

- [ ] **Step 1: Write the failing test**

The clear button should appear when a section has unread or new, and clicking it should call `onMarkSectionRead` with that section's items and clear the new pill (via `markSeen`). Assert on `onMarkSectionRead`:
```ts
it('per-section clear button marks that section read and seen', () => {
  const onMarkSectionRead = vi.fn();
  // Alice new (seed baseline without her) + Alice has unread in default data.
  const alicePk = '11'.repeat(32);
  localStorage.setItem(
    'remoteterm-sidebar-seen-items',
    JSON.stringify([
      getStateKey('channel', 'AA'.repeat(16)),
      getStateKey('channel', 'BB'.repeat(16)),
      getStateKey('channel', 'CC'.repeat(16)),
      getStateKey('contact', '33'.repeat(32)),
      getStateKey('contact', '22'.repeat(32)),
    ])
  );
  render(
    <Sidebar
      /* same props as renderSidebar, but pass this spy */
      onMarkSectionRead={onMarkSectionRead}
      /* ...all other required props... */
    />
  );
  const header = getSectionHeaderContainer('Contacts');
  const clearBtn = within(header).getByRole('button', {
    name: 'Mark section read and seen',
  });
  fireEvent.click(clearBtn);
  expect(onMarkSectionRead).toHaveBeenCalledWith([{ type: 'contact', id: alicePk }]);
});
```
Implementation note for the test author: rather than duplicating the full props, extend `renderSidebar` to accept and forward `onMarkSectionRead` in its `overrides`, and return it, then use that. Keep it consistent with the existing helper style.

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:run -- src/test/sidebar.test.tsx -t "per-section clear"`
Expected: FAIL.

- [ ] **Step 3: Render the clear button in `renderSectionHeader`**

Import the icon at the top of `Sidebar.tsx` (add `CheckCheck` if not already imported; it is used by the existing global mark-all row, so it is likely already imported):
```ts
// ensure CheckCheck is in the lucide-react import list
```
In the right-side group of `renderSectionHeader`, render the clear button first (before the new pill) when `onClearSection` is provided:
```tsx
            {onClearSection && (
              <button
                className="bg-transparent text-muted-foreground/60 p-0.5 rounded hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearSection();
                }}
                aria-label={t('nav_section_mark_read_seen')}
                title={t('nav_section_mark_read_seen')}
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
```

- [ ] **Step 4: Build the per-section clear handler and pass it at call sites**

Add a helper in the `Sidebar` body (after the row arrays and `markSeen` are available):
```ts
  const clearSection = (rows: ConversationRow[]) => {
    const readItems = rows
      .filter((row) => row.unreadCount > 0)
      .map((row) => ({ type: row.type, id: row.id }));
    onMarkSectionRead(readItems);
    markSeen(identitiesOf(rows));
  };
```
Then pass `onClearSection` (the 10th positional arg) at each call site, only when the section has unread or new so the button hides otherwise. Example for Contacts:
```tsx
              contactRows.length,
              contactsNewCount,
              contactsUnreadCount > 0 || contactsNewCount > 0
                ? () => clearSection(contactRows)
                : null
```
Apply the same pattern to Favorites (`favoriteRows`, `favoritesUnreadCount`, `favoritesNewCount`), Channels (`channelRows`, ...), Repeaters (`repeaterRows`, ...), Room Servers (`roomRows`, ...). For Channels the `action` (import/export) argument stays as-is; only append the three trailing args.

- [ ] **Step 5: Run the sidebar tests**

Run: `cd frontend && npm run test:run -- src/test/sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit** (only once authorized)

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/test/sidebar.test.tsx
git commit -m "feat(sidebar): per-section clear button marks read and seen"
```

---

## Task 10: Full verification and runtime observation

**Files:** none (verification only)

- [ ] **Step 1: Lint**

Run: `cd frontend && npm run lint`
Expected: no errors (including the i18n hardcoded-string rule; all new user-facing strings go through `t()`).

- [ ] **Step 2: Typecheck + build**

Run: `cd frontend && npm run build`
Expected: success.

- [ ] **Step 3: Full frontend test suite**

Run: `cd frontend && npm run test:run`
Expected: PASS for `useSeenItems`, `sidebar`, `useUnreadCounts`, and `i18nParity`. Note any unrelated pre-existing failures explicitly; do not claim success if new tests fail.

- [ ] **Step 4: Run the app and observe (runtime evidence required)**

Rebuild and run the local Docker instance per the project's local-run notes, then load the app in the browser. Observe and record:
- Each section header shows the muted total, and a green new pill / blue unread pill only when non-zero.
- Collapsed sections still show the counts (matches the screenshot use case).
- Expanding a section shows a green dot on newly-discovered rows; opening a row clears its dot and decrements the header new pill.
- The per-section clear button appears only when a section has new or unread, and clicking it clears both for that section.
- The global "Mark all read" row still works and is unchanged.

Capture at least two independent checks (for example: a screenshot of the default dark theme and one of a light-ground theme) per the "never claim it works without proof" rule.

- [ ] **Step 5: Theme sweep**

Switch themes via the settings theme selector and confirm the new pill and dot are legible in at least: default (dark), light, high-contrast, monochrome, and windows-95. For any light-ground theme where the green is too light (paper-grove, solar-flare, candy-dusk, lagoon-pop), add a `--badge-new` override to that theme block in `themes.css` (same as Task 3, Step 3) and re-verify.

- [ ] **Step 6: Responsive check**

At mobile width (open the sidebar Sheet, ~280px) and desktop (~240px), confirm the header right-side group (clear button + new pill + unread pill, plus the import/export icon on Channels) does not wrap or clip.

- [ ] **Step 7: Commit any theme fixes from Step 5** (only once authorized)

```bash
git add frontend/src/themes.css
git commit -m "fix(theme): tune badge-new for light-ground themes"
```

---

## Self-review notes

- Spec coverage: total counter (Task 7), new pill (Task 8), unread pill preserved (unchanged), per-row marker (Task 8), per-section clear distinguishing read vs seen (Tasks 5, 6, 9), baseline seeding + open-to-clear persistence (Task 4), theming across 13 themes (Tasks 3, 10), responsive (Task 10), i18n en/nl/de (Task 2), NL `# Kanaal` change (Task 1). All mapped.
- Type consistency: `markConversationsRead` / `onMarkSectionRead` share the `{ type: 'channel' | 'contact'; id: string }[]` shape across Tasks 5, 6, 9. `useSeenItems` exposes `isNew` / `countNew` / `markSeen` consistently across Tasks 4, 8, 9. `renderSectionHeader` gains `totalCount`, `newCount`, `onClearSection` once (Task 7) and is populated in Tasks 8 and 9 without re-signing.
- Open item confirmed during planning: section-scoped read is implemented via per-conversation mark-read (the `/contacts/{pk}/mark-read` and `/channels/{key}/mark-read` endpoints already exist), not a new bulk endpoint.
