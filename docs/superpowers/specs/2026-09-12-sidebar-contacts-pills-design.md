# Sidebar Contacts section with type-filter pills

Date: 2026-09-12
Branch: `feat/sidebar-contacts-pills` (off `origin/main`)
Status: design approved, pending spec review

## Goal

Merge the three separate sidebar list sections `contacts`, `repeaters`, and
`rooms` into one `contacts` section, with a pill (segmented) filter to switch
between contact types. Works unchanged in the 280px mobile drawer, tablet, and
desktop (same `Sidebar` instance, reused via `forceExpanded`). This is item #3
of the UI/map enhancements batch and extends `docs/plans/17-sidebar-customisation.md`
(the pill approach is new; plans 03 and 17 keep the sections separate).

## Current state (facts verified on `origin/main` @ b1e9bb3)

- `frontend/src/types.ts` defines `CONTACT_TYPE_CLIENT=1`, `_REPEATER=2`,
  `_ROOM=3`, `_SENSOR=4` (all four already exist).
- `frontend/src/utils/sidebarLayout.ts`: `SidebarSectionKey` =
  `tools | favorites | channels | contacts | repeaters | rooms`; `ALL_SECTION_KEYS`
  lists them in that order. `reconcile()` keeps valid stored keys in order, drops
  unknown ones, appends newly-added ones. Section order persists in localStorage
  (`remoteterm-sidebar-section-order`, PR-#72).
- `frontend/src/components/Sidebar.tsx` (1558 lines): `renderSectionHeader(...)`
  renders a header with collapse chevron, total count, sort toggle, mark-read
  (CheckCheck), a `new` badge (PR-#71), and an `unread` badge (mention-highlighted).
  `renderSection(key)` has separate `case`s for `contacts` (clients + sensors +
  unknown), `repeaters` (type 2), `rooms` (type 3). Each has its own collapse
  state, sort order, and derived `nonFavorite*` / `*Rows` / `*UnreadCount` /
  `*NewCount` memos.
- `favorites` is a separate section that optionally groups by type
  (channels / contacts / rooms / repeaters). Favorited items are excluded from the
  non-favorite section lists via the `nonFavorite*` memos.
- Sort orders persist per section (`SidebarSortableSection`); repeaters use a
  `last_advert` recency fallback in `getContactRecentTime`.
- No segmented-control component exists; `frontend/src/components/ui/tabs.tsx`
  (Radix, 55 lines) is the basis.

## Design decisions (all approved)

1. **Layout:** pills sit inside one `contacts` section (not replacing headers).
   One header (collapse, single sort toggle, mark-read, aggregate unread badge),
   reorderable as one unit.
2. **Pill row** below the header: `All · Companions · Sensors · Repeaters · Rooms`.
3. **All view:** grouped by type with light type sub-labels (preserves today's
   separation and per-type sort). A specific type pill filters to a flat list of
   just that type, using that type's sort.
4. **Type mapping:** Repeaters = type 2, Rooms = 3, Sensors = 4,
   **Companions = type 1 plus any unknown/other type** (catch-all, matching
   today's `contacts` grouping minus sensors).
5. **Counters / unread:** each pill keeps its total count; a small dot appears
   when that type has unread (red = mention, accent = plain unread). The section
   header shows the section-total unread badge and mark-read.
6. **Mark-read scope = active pill:** `All` clears all non-favorite contacts; a
   type pill clears just that type.
7. **Favorites: unchanged.** Stays its own separate section with its existing
   by-type grouping; favorited contacts of any type still appear there and are
   still excluded from the Contacts pills.
8. **Sort:** single toggle in the Contacts header (recent/alpha). Repeaters keep
   their `last_advert` recency fallback. Stored under the merged `contacts`
   section sort key; the now-unused `repeaters`/`rooms` sort and collapse keys are
   dropped.
9. **Section order (PR-#72):** remove `repeaters` and `rooms` from
   `ALL_SECTION_KEYS` (and `SidebarSectionKey`). `reconcile()` drops them from any
   stored order automatically, so existing layouts migrate cleanly (they lose the
   separate repeaters/rooms positions, which no longer exist).
10. **Active pill persistence:** persisted in localStorage (new key), default
    `all`; matches how collapse/sort/order already persist.
11. **Edge cases:** hide a type's pill when it has zero non-favorite contacts;
    hide the whole pill row when only one type is present (show the flat list
    directly); `All` is present whenever 2+ types exist.
12. **Mobile (280px):** pills `flex-wrap` to up to two rows (no horizontal scroll,
    so no pill is hidden).

## Component and data changes

### `frontend/src/utils/sidebarLayout.ts`
- Remove `'repeaters'` and `'rooms'` from `SidebarSectionKey` and `ALL_SECTION_KEYS`.
- No change to `reconcile()` (already drops stale keys).

### New: `frontend/src/components/ui/segmented.tsx`
- A lightweight custom segmented / pill-group primitive (not Radix Tabs: Tabs
  imply a `tabpanel` per tab, whereas this filter swaps one shared list, and a
  button group handles `flex-wrap` + persistence more simply). Reuse `tabs.tsx`
  styling tokens for visual consistency. Renders a wrapping row of toggle pills,
  one active. Each pill: label, count, optional unread dot (mention vs plain).
  Accessible as a radio group: container `role="radiogroup"` with an aria-label,
  each pill `role="radio"` + `aria-checked`, arrow-key roving focus. 280px-friendly
  (`flex-wrap`). Kept focused and independently testable.

### New: `frontend/src/utils/contactPillPreference.ts`
- `loadContactTypePill()` / `saveContactTypePill(pill)` with a typed pill value
  (`'all' | 'companions' | 'sensors' | 'repeaters' | 'rooms'`), localStorage key
  `remoteterm-sidebar-contacts-pill`, try/catch guarded like `sidebarLayout.ts`.
- A helper to classify a `Contact` into a pill bucket by `contact.type`.

### `frontend/src/components/Sidebar.tsx`
- Replace the three `case 'contacts' | 'repeaters' | 'rooms'` with a single
  `case 'contacts'` that renders: the header, the pill row, and either the
  grouped-by-type list (All) or the single-type list (type pill).
- Derive per-type non-favorite lists, counts, unread counts, new counts, and
  mention flags from the existing contact memos. Companions bucket = type 1 +
  unknown/other; sensors = type 4; repeaters = 2; rooms = 3.
- Collapse: one `contactsCollapsed` state for the whole section. Remove
  `repeatersCollapsed` / `roomsCollapsed` (and their persisted entries; keep the
  favorites-by-type collapse states, which are separate).
- Sort: one `contacts` sort order applied to the shown scope; repeaters recency
  still uses `last_advert`.
- Active pill state wired to `contactPillPreference`.
- Mark-read (`clearSection`) called with the active scope's rows.

## i18n

New user-facing strings need `t()` keys in `en.json`, `nl.json`, `de.json`
(eslint `no-literal-string` + i18n parity test enforce this):
- Pill labels: All, Companions, Sensors, Repeaters, Rooms (reuse existing
  `nav_*` heading keys where wording matches; add pill-specific keys otherwise).
- aria-labels for the pill group and each pill (including unread state).
No em dashes anywhere.

## Testing (test-first)

Vitest, targeted. Cover:
- Pill classification: each `CONTACT_TYPE_*` maps to the right bucket; unknown
  type falls into Companions.
- `contactPillPreference`: load default `all`, round-trip save/load, corrupt/empty
  localStorage falls back to `all` without throwing.
- `sidebarLayout`: `reconcile()` drops legacy `repeaters`/`rooms` from a stored
  order and preserves the rest in order.
- Sidebar render (jsdom): with mixed contacts, `All` shows grouped sub-lists;
  clicking a type pill filters to that type; a type with zero contacts shows no
  pill; single-type set hides the pill row; unread dot appears on the right pill;
  mark-read on a type pill clears only that type; active pill persists.
- Segmented control: renders pills, active state, keyboard navigation, counts and
  dots.

Verification gate before "done": `tsc`, `eslint`, `prettier --check`, the i18n
parity test, and the targeted vitest files all green. Runtime behaviour observed
in the running app (not only reasoned about), per project rules.

## Out of scope

- No backend changes (sensor type 4 already exists in the schema).
- No change to `favorites`, `channels`, or `tools` sections.
- No new dependency.
- Sidebar customisation panel (plan 17) beyond removing the two dropped section
  keys from its reorderable list.
