# Sidebar Contacts pills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the sidebar `contacts`, `repeaters`, and `rooms` sections into one `contacts` section with a type-filter pill row (All / Companions / Sensors / Repeaters / Rooms).

**Architecture:** A new persistence + classification util and a small custom radio-group pill component, wired into `Sidebar.tsx` which replaces the three separate section `case`s with one `contacts` case that renders a header, a pill row, and either the grouped-by-type list (All) or a single type's list. The two dropped section keys are removed from `sidebarLayout.ts`; `reconcile()` migrates existing stored orders automatically.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react (jsdom), Tailwind, i18n (`t()` keys in en/nl/de, enforced by eslint `no-literal-string` + `i18nParity` test).

Spec: `docs/superpowers/specs/2026-09-12-sidebar-contacts-pills-design.md`

Working dir: this worktree. Branch: `feat/sidebar-contacts-pills` (already created off `origin/main`).

Commands (run from `frontend/`): `npm run test -- <file>` (vitest), `npx tsc -p tsconfig.json --noEmit`, `npm run lint`, `npm run format:check`.

---

### Task 1: Contact pill classification + persistence util

**Files:**
- Create: `frontend/src/utils/contactPillPreference.ts`
- Test: `frontend/src/test/contactPillPreference.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONTACT_PILL_KEYS,
  contactPillFor,
  loadContactPill,
  saveContactPill,
} from '../utils/contactPillPreference';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
  type Contact,
} from '../types';

function contact(type: number): Contact {
  return {
    public_key: 'aa'.repeat(32),
    name: 'x',
    type,
    flags: 0,
    direct_path: null,
    direct_path_len: -1,
    direct_path_hash_mode: 0,
    last_advert: null,
    lat: null,
    lon: null,
    last_seen: null,
    on_radio: false,
    favorite: false,
    last_contacted: null,
    last_read_at: null,
    first_seen: null,
  };
}

describe('contactPillPreference', () => {
  beforeEach(() => localStorage.clear());

  it('classifies each contact type into the right bucket', () => {
    expect(contactPillFor(contact(CONTACT_TYPE_CLIENT))).toBe('companions');
    expect(contactPillFor(contact(CONTACT_TYPE_SENSOR))).toBe('sensors');
    expect(contactPillFor(contact(CONTACT_TYPE_REPEATER))).toBe('repeaters');
    expect(contactPillFor(contact(CONTACT_TYPE_ROOM))).toBe('rooms');
  });

  it('treats unknown/other types as companions (catch-all)', () => {
    expect(contactPillFor(contact(99))).toBe('companions');
  });

  it('defaults to all when nothing stored', () => {
    expect(loadContactPill()).toBe('all');
  });

  it('round-trips a saved pill', () => {
    saveContactPill('repeaters');
    expect(loadContactPill()).toBe('repeaters');
  });

  it('falls back to all on an unknown stored value', () => {
    localStorage.setItem('remoteterm-sidebar-contacts-pill', 'bogus');
    expect(loadContactPill()).toBe('all');
  });

  it('exposes the canonical pill order', () => {
    expect(CONTACT_PILL_KEYS).toEqual(['all', 'companions', 'sensors', 'repeaters', 'rooms']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/contactPillPreference.test.ts`
Expected: FAIL (module `../utils/contactPillPreference` not found).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/utils/contactPillPreference.ts`:

```ts
import type { Contact } from '../types';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM, CONTACT_TYPE_SENSOR } from '../types';

// The type filter selection for the merged Contacts sidebar section.
export type ContactPill = 'all' | 'companions' | 'sensors' | 'repeaters' | 'rooms';
export type ContactTypePill = Exclude<ContactPill, 'all'>;

export const CONTACT_PILL_KEYS: ContactPill[] = [
  'all',
  'companions',
  'sensors',
  'repeaters',
  'rooms',
];

const CONTACT_PILL_STORAGE_KEY = 'remoteterm-sidebar-contacts-pill';

// Which type bucket a contact belongs to. Companions is the catch-all: clients
// plus any unknown/other type not explicitly a repeater, room, or sensor.
export function contactPillFor(contact: Contact): ContactTypePill {
  switch (contact.type) {
    case CONTACT_TYPE_REPEATER:
      return 'repeaters';
    case CONTACT_TYPE_ROOM:
      return 'rooms';
    case CONTACT_TYPE_SENSOR:
      return 'sensors';
    default:
      return 'companions';
  }
}

export function loadContactPill(): ContactPill {
  try {
    const raw = localStorage.getItem(CONTACT_PILL_STORAGE_KEY);
    if (raw && (CONTACT_PILL_KEYS as string[]).includes(raw)) {
      return raw as ContactPill;
    }
  } catch {
    // Ignore storage read failures (private mode, disabled storage).
  }
  return 'all';
}

export function saveContactPill(pill: ContactPill): void {
  try {
    localStorage.setItem(CONTACT_PILL_STORAGE_KEY, pill);
  } catch {
    // Ignore storage write failures.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/test/contactPillPreference.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/contactPillPreference.ts frontend/src/test/contactPillPreference.test.ts
git commit -m "feat(sidebar): add contact pill classification and persistence util"
```

---

### Task 2: Segmented pill component

**Files:**
- Create: `frontend/src/components/ui/segmented.tsx`
- Test: `frontend/src/test/segmented.test.tsx`

Renders a wrapping radio group of pills. Each option: `value`, `label`, `count`, and `unread` state (`'none' | 'unread' | 'mention'`). Active pill has `aria-checked=true` and `tabIndex=0`; others `tabIndex=-1`. Arrow keys move selection (roving). `flex-wrap` for the 280px drawer.

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedPills, type SegmentedOption } from '../components/ui/segmented';

const options: SegmentedOption[] = [
  { value: 'all', label: 'All', count: 5, unread: 'none' },
  { value: 'companions', label: 'Companions', count: 3, unread: 'mention' },
  { value: 'repeaters', label: 'Repeaters', count: 2, unread: 'unread' },
];

describe('SegmentedPills', () => {
  it('renders a radiogroup with one checked pill and shows counts', () => {
    render(<SegmentedPills ariaLabel="Filter" options={options} value="all" onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Filter' })).toBeTruthy();
    const all = screen.getByRole('radio', { name: /All/ });
    expect(all.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('calls onChange when a pill is clicked', () => {
    const onChange = vi.fn();
    render(
      <SegmentedPills ariaLabel="Filter" options={options} value="all" onChange={onChange} />
    );
    fireEvent.click(screen.getByRole('radio', { name: /Repeaters/ }));
    expect(onChange).toHaveBeenCalledWith('repeaters');
  });

  it('shows an unread dot only on pills with unread or mention state', () => {
    render(<SegmentedPills ariaLabel="Filter" options={options} value="all" onChange={() => {}} />);
    expect(screen.getAllByTestId('pill-unread-dot')).toHaveLength(2);
  });

  it('moves selection with ArrowRight', () => {
    const onChange = vi.fn();
    render(
      <SegmentedPills ariaLabel="Filter" options={options} value="all" onChange={onChange} />
    );
    fireEvent.keyDown(screen.getByRole('radio', { name: /All/ }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('companions');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/segmented.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

Create `frontend/src/components/ui/segmented.tsx`:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export type SegmentedUnread = 'none' | 'unread' | 'mention';

export interface SegmentedOption {
  value: string;
  label: string;
  count: number;
  unread: SegmentedUnread;
}

interface SegmentedPillsProps {
  ariaLabel: string;
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SegmentedPills({
  ariaLabel,
  options,
  value,
  onChange,
  className,
}: SegmentedPillsProps) {
  const move = (delta: number) => {
    const idx = options.findIndex((o) => o.value === value);
    if (idx < 0) return;
    const next = options[(idx + delta + options.length) % options.length];
    onChange(next.value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('flex flex-wrap gap-1 px-2.5 pb-2 pt-0.5', className)}
      onKeyDown={onKeyDown}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'bg-primary/10 text-primary font-medium'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            )}
          >
            <span>{opt.label}</span>
            <span className="tabular-nums opacity-70">{opt.count}</span>
            {opt.unread !== 'none' && (
              <span
                data-testid="pill-unread-dot"
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  opt.unread === 'mention' ? 'bg-badge-mention' : 'bg-badge-unread'
                )}
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/test/segmented.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/segmented.tsx frontend/src/test/segmented.test.tsx
git commit -m "feat(ui): add SegmentedPills radio-group filter component"
```

---

### Task 3: Drop repeaters/rooms section keys from sidebarLayout

**Files:**
- Modify: `frontend/src/utils/sidebarLayout.ts:9-24`
- Modify (test): `frontend/src/test/sidebarLayout.test.ts:27-40`

- [ ] **Step 1: Update the failing test first**

In `frontend/src/test/sidebarLayout.test.ts`, replace the `round-trips a custom section order` test body's array (currently includes `'repeaters', 'rooms'`) and add a migration test. Replace the whole `it('round-trips a custom section order', ...)` block with:

```ts
  it('round-trips a custom section order', () => {
    const order: SidebarSectionKey[] = ['favorites', 'tools', 'channels', 'contacts'];
    saveSectionOrder(order);
    expect(loadSectionOrder()).toEqual(order);
  });

  it('drops legacy repeaters/rooms keys from a stored order', () => {
    localStorage.setItem(
      'remoteterm-sidebar-section-order',
      JSON.stringify(['contacts', 'repeaters', 'rooms', 'channels'])
    );
    const loaded = loadSectionOrder();
    expect(loaded).not.toContain('repeaters');
    expect(loaded).not.toContain('rooms');
    expect(loaded[0]).toBe('contacts');
    expect([...loaded].sort()).toEqual([...ALL_SECTION_KEYS].sort());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/sidebarLayout.test.ts`
Expected: FAIL (`'repeaters'`/`'rooms'` still valid keys, migration test's `sort()` equality fails; and/or type error on the removed keys once Step 3 lands — run again after Step 3).

- [ ] **Step 3: Update sidebarLayout.ts**

In `frontend/src/utils/sidebarLayout.ts`, change the type and the key list to drop `repeaters` and `rooms`:

```ts
export type SidebarSectionKey = 'tools' | 'favorites' | 'channels' | 'contacts';

export const ALL_SECTION_KEYS: SidebarSectionKey[] = [
  'tools',
  'favorites',
  'channels',
  'contacts',
];
```

Leave `reconcile()`, `loadSectionOrder`, `saveSectionOrder`, and everything else unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- src/test/sidebarLayout.test.ts`
Expected: PASS. (Note: `tsc` across the app will now fail in `Sidebar.tsx` until Task 4 lands — expected; do not commit the app-wide typecheck yet.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/sidebarLayout.ts frontend/src/test/sidebarLayout.test.ts
git commit -m "feat(sidebar): drop repeaters/rooms section keys (merged into contacts)"
```

---

### Task 4: Integrate pills into the Contacts section in Sidebar.tsx

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (imports; collapse state/type; contact derivations ~515-544, 696-734, 941-959; search-expand effect 590-694; `renderSection` cases 1317-1376; `sectionLabels` 1382-1389)
- Modify: `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`
- Modify (test): `frontend/src/test/sidebar.test.tsx`

This is the core integration. The end state: one `contacts` `case` that renders the header + `SegmentedPills` + body; `repeaters`/`rooms` cases removed; their collapse states removed; a Sensors bucket split out of the current contacts bucket.

- [ ] **Step 1: Write the failing Sidebar test**

Append to `frontend/src/test/sidebar.test.tsx` a new describe block. It relies on the existing `makeContact`/`renderSidebar` helpers (extend `renderSidebar` if needed to inject a sensor + multiple types, or add a local render). Concrete test:

```tsx
import { CONTACT_TYPE_SENSOR } from '../types';

describe('Sidebar contacts pills', () => {
  beforeEach(() => localStorage.clear());

  function renderMixed() {
    const contacts: Contact[] = [
      makeContact('11'.repeat(32), 'Alice', 1),
      makeContact('44'.repeat(32), 'Sensor-1', CONTACT_TYPE_SENSOR),
      makeContact('22'.repeat(32), 'Relay', CONTACT_TYPE_REPEATER),
      makeContact('33'.repeat(32), 'Ops Board', CONTACT_TYPE_ROOM),
    ];
    return render(
      <Sidebar
        contacts={contacts}
        channels={[]}
        activeConversation={null}
        onSelectConversation={() => {}}
        onNewMessage={() => {}}
        lastMessageTimes={{}}
        unreadCounts={{}}
        mentions={{}}
        showCracker={false}
        crackerRunning={false}
        onToggleCracker={() => {}}
        onMarkAllRead={() => {}}
      />
    );
  }

  it('shows one Contacts section with a pill per non-empty type', () => {
    renderMixed();
    const group = screen.getByRole('radiogroup', { name: /contacts/i });
    expect(within(group).getByRole('radio', { name: /All/ })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /Companions/ })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /Sensors/ })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /Repeaters/ })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /Room/ })).toBeTruthy();
  });

  it('All shows every type; a type pill filters to that type', () => {
    renderMixed();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Relay')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Repeaters/ }));
    expect(screen.getByText('Relay')).toBeTruthy();
    expect(screen.queryByText('Alice')).toBeNull();
    expect(screen.queryByText('Sensor-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/test/sidebar.test.tsx`
Expected: FAIL (no `radiogroup`; both new tests fail).

- [ ] **Step 3: Add imports and pill state**

In `Sidebar.tsx` imports, add:

```tsx
import { SegmentedPills, type SegmentedOption, type SegmentedUnread } from './ui/segmented';
import {
  contactPillFor,
  loadContactPill,
  saveContactPill,
  type ContactPill,
} from '../utils/contactPillPreference';
import { CONTACT_TYPE_SENSOR } from '../types';
```

After the collapse-state hooks (near line 255), add pill state:

```tsx
  const [contactPill, setContactPill] = useState<ContactPill>(loadContactPill);
  const handleContactPill = (pill: ContactPill) => {
    setContactPill(pill);
    saveContactPill(pill);
  };
```

- [ ] **Step 4: Remove repeaters/rooms collapse state and split the sensor bucket**

Remove `rooms` and `repeaters` from the `CollapseState` type (135-146), `DEFAULT_COLLAPSE_STATE` (150-161), `loadCollapsedState` (168-179), the two `useState` lines (254-255), and every reference in the two search-expand `useEffect` blocks and the persist effect (590-694). Keep `favRooms`/`favRepeaters`. Replace `roomsCollapsed`/`repeatersCollapsed` reads with `contactsCollapsed` where the merged section needs them (only `contactsCollapsed` remains).

Split the existing non-repeater contacts into companions vs sensors. After `nonFavoriteContacts` is derived (~723), add derived buckets (place near `contactRows`, ~942):

```tsx
  const nonFavoriteCompanions = nonFavoriteContacts.filter(
    (c) => contactPillFor(c) === 'companions'
  );
  const nonFavoriteSensors = nonFavoriteContacts.filter((c) => contactPillFor(c) === 'sensors');
  const companionRows = nonFavoriteCompanions.map((c) => buildContactRow(c, 'companion'));
  const sensorRows = nonFavoriteSensors.map((c) => buildContactRow(c, 'sensor'));
```

Keep the existing `roomRows` and `repeaterRows`. The existing `contactRows` (all non-repeater, non-room) stays available for the aggregate counts.

- [ ] **Step 5: Build pill options and the merged section body**

Add helpers near the other row/count derivations:

```tsx
  const unreadState = (rows: ConversationRow[]): SegmentedUnread =>
    sectionHasMention(rows) ? 'mention' : getSectionUnreadCount(rows) > 0 ? 'unread' : 'none';

  const allContactRows = [...companionRows, ...sensorRows, ...repeaterRows, ...roomRows];

  const contactPillBuckets: { pill: Exclude<ContactPill, 'all'>; label: string; rows: ConversationRow[] }[] = [
    { pill: 'companions', label: t('nav_contacts_pill_companions'), rows: companionRows },
    { pill: 'sensors', label: t('nav_contacts_pill_sensors'), rows: sensorRows },
    { pill: 'repeaters', label: t('nav_repeaters_heading'), rows: repeaterRows },
    { pill: 'rooms', label: t('nav_room_servers_heading'), rows: roomRows },
  ].filter((b) => b.rows.length > 0);

  const contactPillOptions: SegmentedOption[] = [
    {
      value: 'all',
      label: t('nav_contacts_pill_all'),
      count: allContactRows.length,
      unread: unreadState(allContactRows),
    },
    ...contactPillBuckets.map((b) => ({
      value: b.pill,
      label: b.label,
      count: b.rows.length,
      unread: unreadState(b.rows),
    })),
  ];

  // If the stored pill has no contacts (empty bucket), fall back to All for display.
  const effectiveContactPill: ContactPill = contactPillOptions.some((o) => o.value === contactPill)
    ? contactPill
    : 'all';

  const activeContactRows =
    effectiveContactPill === 'all'
      ? allContactRows
      : (contactPillBuckets.find((b) => b.pill === effectiveContactPill)?.rows ?? []);
```

- [ ] **Step 6: Replace the three cases with one `contacts` case**

Replace `case 'contacts':` through the end of `case 'rooms':` (Sidebar.tsx 1317-1376) with a single case. When `All`, render grouped-by-type sub-lists using light labels; otherwise render `activeContactRows` flat. Show the pill row only when 2+ buckets exist.

```tsx
      case 'contacts':
        return allContactRows.length > 0 ? (
          <div key="sec-contacts">
            {renderSectionHeader(
              t('nav_contacts_heading'),
              contactsCollapsed,
              () => setContactsCollapsed((prev) => !prev),
              'contacts',
              getSectionUnreadCount(activeContactRows),
              sectionHasMention(activeContactRows),
              null,
              activeContactRows.length,
              countNew(identitiesOf(activeContactRows)),
              getSectionUnreadCount(activeContactRows) > 0 ||
                countNew(identitiesOf(activeContactRows)) > 0
                ? () => clearSection(activeContactRows)
                : null
            )}
            {(isSearching || !contactsCollapsed) && (
              <>
                {contactPillBuckets.length > 1 && (
                  <SegmentedPills
                    ariaLabel={t('a11y_contacts_filter')}
                    options={contactPillOptions}
                    value={effectiveContactPill}
                    onChange={(v) => handleContactPill(v as ContactPill)}
                  />
                )}
                {effectiveContactPill === 'all'
                  ? contactPillBuckets.map((b) => (
                      <div key={`grp-${b.pill}`}>
                        {contactPillBuckets.length > 1 && (
                          <div className="px-3 pt-2 pb-0.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground/70">
                            {b.label}
                          </div>
                        )}
                        {b.rows.map((row) => renderConversationRow(row))}
                      </div>
                    ))
                  : activeContactRows.map((row) => renderConversationRow(row))}
              </>
            )}
          </div>
        ) : null;
```

Then remove the now-dead `case 'repeaters':` and `case 'rooms':` entirely.

- [ ] **Step 7: Update sectionLabels**

In `sectionLabels` (1382-1389) remove the `repeaters` and `rooms` entries (the `Record<SidebarSectionKey, string>` type now forbids them). Result:

```tsx
  const sectionLabels: Record<SidebarSectionKey, string> = {
    tools: t('nav_tools_heading'),
    favorites: t('nav_favorites_heading'),
    channels: t('nav_channels_heading'),
    contacts: t('nav_contacts_heading'),
  };
```

- [ ] **Step 8: Add i18n keys (en, nl, de)**

Add three keys near `nav_contacts_heading` in each locale. English (`en.json`):

```json
  "nav_contacts_pill_all": "All",
  "nav_contacts_pill_companions": "Companions",
  "nav_contacts_pill_sensors": "Sensors",
  "a11y_contacts_filter": "Filter contacts by type",
```

Dutch (`nl.json`):

```json
  "nav_contacts_pill_all": "Alle",
  "nav_contacts_pill_companions": "Companions",
  "nav_contacts_pill_sensors": "Sensoren",
  "a11y_contacts_filter": "Contacten filteren op type",
```

German (`de.json`):

```json
  "nav_contacts_pill_all": "Alle",
  "nav_contacts_pill_companions": "Companions",
  "nav_contacts_pill_sensors": "Sensoren",
  "a11y_contacts_filter": "Kontakte nach Typ filtern",
```

- [ ] **Step 9: Run tests**

Run: `npm run test -- src/test/sidebar.test.tsx src/test/i18nParity.test.ts`
Expected: PASS (new pills tests pass; i18n parity intact). Fix any existing sidebar test that referenced separate `Repeaters`/`Room Servers` section headers by updating it to the pill UI.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/i18n/locales/en.json frontend/src/i18n/locales/nl.json frontend/src/i18n/locales/de.json frontend/src/test/sidebar.test.tsx
git commit -m "feat(sidebar): merge repeaters/rooms into Contacts section with type pills"
```

---

### Task 5: Full verification gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run (from `frontend/`): `npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint (includes no-literal-string)**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Prettier**

Run: `npm run format:check`
Expected: all matched files use Prettier code style. If it fails, run `npm run format` and re-commit.

- [ ] **Step 4: Targeted tests**

Run: `npm run test -- src/test/contactPillPreference.test.ts src/test/segmented.test.tsx src/test/sidebarLayout.test.ts src/test/sidebar.test.tsx src/test/i18nParity.test.ts`
Expected: all PASS. (Do not treat unrelated Windows parallel-suite timeouts as regressions; see the Windows-only-test-failures note.)

- [ ] **Step 5: Observe runtime in the running app**

Launch the app (per the `run` skill / local Docker instance), open the sidebar on desktop and in the 280px mobile drawer. Confirm: pill row wraps and stays fully visible at 280px; All shows grouped sub-lists; each pill filters; unread dots appear on the right pills; mark-read clears the active scope; selection persists across reload; a type with zero contacts has no pill; a single-type set hides the pill row. Record what was observed (not reasoned).

- [ ] **Step 6: No new em dashes**

Run: `git diff origin/main -- frontend/ | grep -n "—"` (expect no output). Confirm no em dashes were introduced.

---

## Notes for the implementer

- Do NOT touch the `favorites` section or its `favRooms`/`favRepeaters` collapse states; #3 only merges the non-favorite type sections.
- Repeaters keep their `last_advert` recency sort via the existing `sortRepeatersByOrder`; the merged section's single sort toggle uses `sectionSortOrders.contacts` for companions/sensors/rooms and the repeater list stays sorted by `sortedRepeaters`. Keep the existing `sortedRepeaters`/`sortedRooms` memos as the source of `repeaterRows`/`roomRows`.
- "Companions" is intentionally left untranslated in nl/de (it is the project's term for client contacts); confirm with maintainer during review if a localized word is preferred.
