# Sidebar section counters and new/unread pills

Date: 2026-09-11
Status: Approved design, ready for planning
Area: frontend (`frontend/src/components/Sidebar.tsx` and supporting hooks/styles)

## Goal

Add, to each collapsible sidebar section header (Channels, Contacts, Repeaters,
Room Servers, and Favorites):

1. A total item counter for the section.
2. A pill for newly discovered items not yet opened.
3. The existing unread message pill, kept and shown alongside the new pill.

Plus a per-section control to clear a section's new and unread state, and a
per-row marker on newly discovered rows.

This is a frontend-only change. No backend or API change is required.

## Non-goals

- No change to how unread messages are counted or stored (`useUnreadCounts`).
- No new server fields. "Newly discovered" is derived client side.
- No change to the sort controls already in the headers.
- No redesign of conversation rows beyond adding one marker dot.

## Current state (verified)

- `Sidebar` is a pure props component. Category lists are derived inside it by
  splitting `contacts`/`channels` into `channelRows`, `contactRows`, `roomRows`,
  `repeaterRows` (Sidebar.tsx:758-761). A section total is the `.length` of the
  corresponding row array.
- `renderSectionHeader` (Sidebar.tsx:890-963) already renders one pill: the
  section unread count (`unreadCount > 0`), grey `bg-secondary` normally and
  `bg-badge-mention` when the section has a mention.
- Rows are built by `buildChannelRow` / `buildContactRow` (Sidebar.tsx:621-642).
  Each row carries `type` ('channel' | 'contact'), `id` (channel key or
  `public_key`), and `unreadCount`. The canonical conversation key is
  `getStateKey(row.type, row.id)`.
- Contacts carry `first_seen: number | null` and a stable `public_key`
  (types.ts:175-200). Channels carry a stable `key`.
- Per-client UI state is persisted directly in `localStorage` with a module
  constant key, wrapped in try/catch. The sidebar already does this for collapse
  state via `SIDEBAR_COLLAPSE_STATE_KEY` (Sidebar.tsx:139, 567).
- A global "Mark all read" row already exists near the top of the list
  (Sidebar.tsx:1020-1032), shown when any unread exists.
- Theming: Tailwind utilities backed by HSL CSS custom properties. Badge tokens
  `--badge-unread` and `--badge-mention` are defined in `index.css` `:root`
  (index.css:88-92) and mapped in `tailwind.config.js` (66-73). Alternate themes
  override tokens per `:root[data-theme='...']` block in `themes.css` (13 theme
  blocks). Tokens not overridden by a theme fall back to the base `:root` value.
- Responsive: the same sidebar content renders in the desktop sidebar (`w-60`,
  240px) and inside a mobile `Sheet` (280px) driven by `sidebarOpen`
  (AppShell.tsx:266-285). There is no dedicated media-query hook and none is
  needed here.

## Design

### Header layout

Extend `renderSectionHeader` to accept a total count and a new count in addition
to the existing unread count.

- Total counter: rendered inline immediately after the section label, muted
  (`text-muted-foreground` weight/size matching the label scale), always shown
  when the section renders. Value = the section's row array length.
- New pill: green (`bg-badge-new` token, see Theming), right aligned, shown only
  when the new count is greater than 0.
- Unread pill: unchanged existing pill, right aligned after the new pill.
- Per-section clear button: a small double check icon, right aligned, shown only
  when the section has new or unread items. See Clear controls.

Right side element order: `[clear button] [green new pill] [unread pill]`. On the
Channels header the existing import/export icon remains and sits leftmost of the
right side group. At 240px and 280px the group fits; verify both widths.

### New item tracking

A new hook (working name `useSeenItems`) owns the seen set and persistence.

- Identity of an item = `getStateKey(row.type, row.id)`. This is stable and
  already used across the app, and unifies channels and contacts.
- Persistence: an array of identity strings in `localStorage` under a new module
  constant key (for example `SIDEBAR_SEEN_ITEMS_KEY`), read on init and written
  on change, all guarded by try/catch (match existing pattern).
- Baseline seeding: on first run, when no stored seen set exists, seed the set
  with every item currently present so nothing is flagged new on first load. Only
  items that appear after the baseline can be new. Persist the baseline
  immediately so a reload does not re-baseline.
- New detection: an item is new when its identity is not in the seen set.
- Clearing an item's new state happens when:
  - the user opens it (its identity is added to the seen set on select), or
  - the user clears its section (see Clear controls).
- The hook exposes a helper to compute a section's new count from its row array,
  a per-row `isNew(row)` predicate, a `markSeen(identities)` action, and a
  `markSectionSeen(rows)` action.

Note: baseline seeding means an item that exists but has never been opened is not
"new" if it was present at baseline. "New" specifically means "appeared since the
last time this client took a baseline or was cleared". This matches the intent of
surfacing newly discovered nodes, not un-opened old ones.

### Per-row marker

`renderConversationRow` gains a small green dot (using the `badge-new` token)
shown when `isNew(row)` is true, placed in the existing right side icon group of
the row (near the unread pill). The dot is removed once the row is opened, since
opening marks the item seen. Additive; does not change existing unread rendering.

### Clear controls

- Per-section clear button in the header, shown when the section has any new or
  unread items. Clicking it:
  - marks the section's conversations read (reuse existing read-clearing; if a
    section scoped mark-read is not available, mark each conversation in the
    section read via the existing per-conversation path), and
  - marks the section's items seen via `markSectionSeen`.
  - Tooltip and aria-label reflect what will be cleared (read only, seen only, or
    both) based on what the section currently has.
- The existing global "Mark all read" row is preserved unchanged. It clears
  unread messages only, not the seen set.

### Theming

- Add `--badge-new` and `--badge-new-foreground` to `index.css` `:root` with a
  green value, and add a `badge-new` color mapping in `tailwind.config.js`
  mirroring the existing `badge-unread` mapping.
- Audit all 13 theme blocks in `themes.css`. Because unset tokens fall back to
  base `:root`, only override where a generic green is wrong for the theme:
  - light: darker green for contrast on a light background.
  - high-contrast: a green that meets the theme's contrast intent.
  - monochrome: a greyscale or theme-consistent treatment rather than green.
  - windows-95, darkdutch, and any other theme whose palette a generic green
    clashes with: theme-appropriate value.
- The per-row dot and the new pill both consume `badge-new`, so they track the
  active theme automatically.

### Responsive

No layout branch. The same header renders at 240px (desktop) and 280px (mobile
Sheet). Verify the right side group does not wrap or clip at both widths and on a
section that has clear button plus both pills (worst case, the Channels header
which also has the import/export icon).

### i18n

Add `t()` keys to `en.json`, `nl.json`, and `de.json` (parity is enforced):

- aria-label for the new count pill (count interpolated).
- aria-label / title for the per-section clear button (variants for read, seen,
  both, per what it clears).
- aria-label for the per-row new marker.

Reuse the existing total/label scale; the total counter does not need its own
string beyond an aria-label if the visible number needs one for accessibility.

## Separate unrelated change

Change the Dutch locale value of `bulkdelete_channels_type_hashtag` from
`Hashtag-kamers` to `# Kanaal` in `frontend/src/i18n/locales/nl.json:2147`.
English (`Hashtag rooms`) and German (`Hashtag-Räume`) are unchanged. This is a
standalone one line edit and is independent of the sidebar work.

## Verification plan

- Unit tests for `useSeenItems`: baseline seeding (nothing new on first load),
  new detection when an item appears after baseline, clear on open, clear
  section, localStorage round trip, and graceful handling when localStorage is
  unavailable.
- A Sidebar render test asserting: total counter value, green new pill visibility
  and count, existing unread pill still renders, per-row new dot appears for new
  rows and not for seen rows, and the per-section clear button appears only when
  new or unread exist.
- Run the app in the local Docker instance and observe the pills live across at
  least the default, light, and high-contrast themes, and at mobile width. Record
  observations. Compiling or type checking is not sufficient evidence for the
  visual and runtime behaviour.

## Risks and limitations

- Baseline seeding means a fresh browser (or cleared storage) re-baselines and
  will not retroactively flag items that arrived while storage was empty. This is
  acceptable and matches "new since this client started tracking".
- Adding a third badge color increases theming surface. The token audit across 13
  themes is the main correctness cost and must be checked visually, not assumed.
- Section scoped mark-read may need to fall back to per-conversation calls if no
  section scoped API exists; confirm during planning.
