# [03] Split Favorites: Contacts vs Repeaters/Room-Servers

Date: 2026-09-10 (status reconciled 2026-09-11)
Status: SHIPPED (PR #21). The verified gap (room-servers omitted from
`CommandPalette.tsx` favorite grouping) is closed; heading present at
`CommandPalette.tsx:318`. Retained as a delivery record.
Category: B (Contacts & messaging UX), see `docs/plans/README.md`
Model: Sonnet

Scope: local planning only. No code changes, no migrations, no commits, no PRs
from this document.

## 1. Summary

The old fork (`Remote-Terminal-for-MeshCore`, this repo's direct predecessor)
does not use a separate favorite flag for repeaters/room-servers. It uses the
same single `favorite` boolean RTFM-EV already has, and separates favorited
items **only in the sidebar UI**: within one "Favorites" section it renders
four independently-collapsible labeled sub-groups (Channels, Contacts, Room
Servers, Repeaters).

RTFM-EV has already ported roughly half of this. `Sidebar.tsx` has a "sort by
type" option that clusters favorites by type inside one flat list (no headers,
no independent collapse), and `CommandPalette.tsx` already has separate
"Favorite Contacts" / "Favorite Repeaters" / "Favorite Channels" groups, but
it **omits room-servers from favorite grouping entirely**: favorited rooms are
indistinguishable from non-favorited rooms in the command palette.

This plan is a **UI grouping port**, not a new data dimension. No migration,
no schema change, no new API verb. The concrete, low-risk fix is closing the
CommandPalette room-server gap (§4.2). Whether to also add old-fork-style
independent sub-section headers to the Sidebar Favorites section (on top of
the sort-order clustering already shipped) is an open product question (§6),
not resolved here.

## 2. Current state (RTFM-EV, cited)

### 2.1 Data model: one boolean, shared toggle endpoint

- `contacts.favorite` and `channels.favorite` are both plain
  `INTEGER DEFAULT 0` columns, added by
  `app/migrations/_055_favorites_to_columns.py:26` (migrating off a JSON blob
  previously stored in `app_settings.favorites`).
- `ContactRepository.get_favorites()` / `.set_favorite()`:
  `app/repository/contacts.py:476-493`.
- `ChannelRepository.set_favorite()`: `app/repository/channels.py:79-86`.
- Single toggle endpoint for both entity kinds:
  `POST /api/settings/favorites/toggle` (`app/routers/settings.py:332-355`),
  body `{type: "channel"|"contact", id}` (`FavoriteRequest`,
  `app/routers/settings.py:112-115`). No contact-type-specific branching
  beyond firing a radio-load task when a contact is newly favorited
  (`app/routers/settings.py:342-346`).
- Contact types are `0=unknown, 1=client, 2=repeater, 3=room, 4=sensor`
  (`AGENTS.md` "Contact Types"; `CONTACT_TYPE_REPEATER=2`,
  `CONTACT_TYPE_ROOM=3` in `frontend/src/types.ts:482-483`).
- Favorites also drive radio contact-reload priority (unrelated to UI
  grouping, do not touch): `app/radio_sync.py:1535` ("Favorites (up to full
  capacity)"), `:1545-1554`.

### 2.2 Sidebar: one flat "Favorites" section, optional type-sort clustering

`frontend/src/components/Sidebar.tsx`:

- `FavoriteItem` is a discriminated union of `channel` or `contact`
  (`Sidebar.tsx:46`), covering **all** contact types together. Client,
  sensor, room, and repeater are not distinguished once inside the favorites
  list.
- Favorite/non-favorite split happens once, by entity kind only (not by
  contact type) at `Sidebar.tsx:583-592`:
  ```
  const favChannels = filteredChannels.filter((c) => c.favorite);
  const favContacts = [...filteredNonRepeaterContacts, ...filteredRooms, ...filteredRepeaters].filter((c) => c.favorite);
  ```
- `favoriteTypeRank()` (`Sidebar.tsx:50-60`) assigns a sort rank
  (channel=0, contact=1, room=2, repeater=3) used only when the section's
  sort order is `type-recent` or `type-alpha` (`Sidebar.tsx:392-420`,
  `FAVORITES_SORT_CYCLE` in `frontend/src/utils/conversationState.ts:24`).
  This is a **display-order tiebreaker inside one flat list**; it does not
  add headers, counts, or independent collapse per type.
- Rendering is a single "Favorites" header
  (`Sidebar.tsx:994-1008`: `renderSectionHeader('Favorites', favoritesCollapsed, ...)`)
  followed by `favoriteRows` with no further subdivision. Contrast with the
  **non-favorite** side of the same file, which already has fully separate
  top-level sections: Channels (`:1011`), Contacts (`:1040`), Repeaters
  (`:1056`), each independently collapsible with its own unread badge.
- `sidebar.test.tsx` already exercises the type-sort cycle (for example
  `'cycles favorites through the four sort orders, grouping by type'`,
  `frontend/src/test/sidebar.test.tsx:717-769`). This is prior, already-shipped
  work; do not re-plan it.

### 2.3 CommandPalette: contacts/repeaters split, rooms are not

`frontend/src/components/CommandPalette.tsx:146-195`:

```
if (c.type === CONTACT_TYPE_REPEATER) {
  (c.favorite ? fr : rp).push(entry);
} else if (c.type === CONTACT_TYPE_ROOM) {
  rm.push(entry);                         // rooms: no favorite/non-favorite split at all
} else {
  (c.favorite ? fc : rc).push(entry);
}
```

Rendered groups (`CommandPalette.tsx:269-338`): "Favorite Contacts"
(`fFavContacts`), "Favorite Repeaters" (`fFavRepeaters`), "Favorite Channels"
(`fFavChannels`), then plain "Contacts", "Repeaters", and **"Rooms"**
(`fRooms`, one bucket, `CommandPalette.tsx:330-338`, no star icon, no
favorite filtering). A favorited room-server is not surfaced in any
"Favorite ..." group and shows no star, unlike a favorited contact or
repeater in the same palette. There is no existing test file for
`CommandPalette.tsx` (`frontend/src/test/` has none matching
`*ommandPalette*` or `*alette*` as of this writing), so any change here
currently ships with zero regression coverage either way.

### 2.4 ChatHeader / ContactInfoPane: no gap found

`ChatHeader.tsx:125-138` and `ContactInfoPane.tsx:438-456` both use one
generic favorite toggle/button regardless of contact type (message text only
varies by `contact` vs `channel`, not by contact type 1-4). This matches the
old fork's `ChatHeader.tsx` byte-for-byte in the favorite-related lines
checked; no porting gap identified here. Not part of this plan's scope.

## 3. Reference research (old fork, cited)

Old fork: local `G:\Github\repositories\Elektr0Vodka\Remote-Terminal-for-MeshCore`
(`Remote-Terminal-for-MeshCore-EV` on GitHub, per `docs/sources-of-truth.md`).

### 3.1 Same data model, not a new dimension

- Old-fork `app/migrations/_080_favorites_to_columns.py` is **byte-for-byte
  identical** to RTFM-EV's `_055_favorites_to_columns.py` (diffed directly).
  Same single `favorite INTEGER DEFAULT 0` column on `contacts` and
  `channels` (`app/database.py:36,47` in the old fork), same JSON-blob
  backfill, same column drop. The migration is numbered differently only
  because the old fork's history has more migrations ahead of it (`_055`
  there is a different, unrelated migration): confirmed via
  `git log --oneline --all -i --grep=favorite`, commit
  `6e9b4a5 Fix favorites migration number collision (055 -> 080)`.
- `app/models.py:114,371` in the old fork: `favorite: bool = False` on both
  the contact and channel models. No `favorite_repeater`, `favorite_room`,
  or per-type column anywhere in `app/models.py` or `app/database.py`.
  **The old fork never introduced a distinct favorite dimension per contact
  type.**

### 3.2 The actual "separation": Sidebar sub-section headers

Commit history (`git log --oneline --all -i --grep=...` in the old fork):

- `cfa7f53 Add favorites`, `45ed430 Allow favorites to be sorted`,
  `9e86d26 Optimistic sort reordering and favorite addition`: baseline
  favorites feature (single flat list).
- `84e6c34 Allow favorites to be sorted by type. Closes #314.`: added the
  `favoriteTypeRank()` plus `type-recent`/`type-alpha` sort-order clustering.
  **This is the part RTFM-EV already ported** (§2.2 above uses the same
  function name and same rank order: channel=0, contact=1, room=2,
  repeater=3).
- `558b870 Add Owned sidebar section, collapsible favourites, map popup
  improvements, and fix map focus navigation`: introduced
  `favChannelsCollapsed` / `favContactsCollapsed` / `favRoomsCollapsed` /
  `favRepeatersCollapsed` state (confirmed via
  `git log -S favChannelsCollapsed`). **This is the commit that actually
  split favorites into independently-collapsible per-type sub-groups**, not
  the type-sort commit.
- `e57b9ec Rework sidebar: collapsible rail, slim header, The Mesh section,
  hover menus`: later restructuring that preserved the same sub-group split
  in the current form read below.

Current old-fork `Sidebar.tsx` (verified by direct read,
`frontend/src/components/Sidebar.tsx:1145-1465` in the old fork checkout):

- `favChannelRows`, `favContactRows`, `favRoomRows`, `favRepeaterRows` are
  computed as four separate filtered/mapped arrays from the same
  `favoriteItems` list used for the flat `favoriteRows` (lines 1145-1176).
  `favContactRows` explicitly excludes room and repeater types
  (`item.contact.type !== CONTACT_TYPE_REPEATER && item.contact.type !== CONTACT_TYPE_ROOM`,
  line 1159-1160), so contacts, rooms, and repeaters are three disjoint
  favorite buckets, with sensors/unknown landing in "Contacts".
- Rendering (lines 1409-1465): one "Favorites" `SectionHeader` (with the same
  sort-cycle toggle from §3.2's `84e6c34`), and *inside* it, up to four
  `renderSubSectionHeader(...)` blocks: "Channels", "Contacts",
  "Room Servers", "Repeaters", each with its **own** collapse state
  (`favChannelsCollapsed`, etc.) and its own row list. A sub-group is
  omitted entirely when empty (for example no favorite rooms means no
  "Room Servers" sub-header at all).
- `renderSubSectionHeader()` (lines 1333-1390) is a smaller version of the
  top-level `SectionHeader`: chevron, label, optional per-sub-section sort
  toggle, optional unread badge. It is also reused by an unrelated "Owned"
  section (`app/models.py` `contact_owner_id`, old-fork migration `_069`).
  **That "Owned" feature is not part of this plan, and RTFM-EV has no
  `contact_owner_id` column; do not port it here.**

### 3.3 What "separation" meant there, precisely

Old-fork favorites separation equals **one flat favorite flag** (identical to
RTFM-EV today) rendered as **up to four independently-labeled, independently
collapsible sidebar sub-sections grouped by entity/contact type**, layered
on top of (not instead of) the type-aware sort order. It is a presentation
feature, not a schema or API feature. There is no old-fork evidence of a
distinct "favorite repeater" concept separate from "favorite contact" at the
data or endpoint level.

## 4. Design

### 4.1 Data / migration / backend: no changes

No new migration needed. The next free migration number, confirmed via
`git ls-tree -r --name-only origin/main app/migrations`, is `_069` (current
max on `origin/main` and on this branch is `_068_add_registry_sync_url.py`;
identical listing on both). This plan does not consume it; flag `_069` as
still free if a later, unrelated plan needs it first.

`POST /api/settings/favorites/toggle`, `ContactRepository`/`ChannelRepository`
favorite methods, and the radio-reload favorite-priority logic in
`app/radio_sync.py` are unchanged. This is a frontend-only presentation
change.

### 4.2 CommandPalette: close the room-server gap (concrete, low-risk)

`frontend/src/components/CommandPalette.tsx:154-195`: split the single `rm`
bucket into `favRooms` / `regularRooms`, mirroring the existing
repeater/contact split:

```
if (c.type === CONTACT_TYPE_REPEATER) {
  (c.favorite ? fr : rp).push(entry);
} else if (c.type === CONTACT_TYPE_ROOM) {
  (c.favorite ? frm : rm).push(entry);   // new
} else {
  (c.favorite ? fc : rc).push(entry);
}
```

Add a rendered "Favorite Room Servers" group (reuse `ContactGroup` with
`showStar`, matching the "Favorite Contacts" pattern at
`CommandPalette.tsx:269-278`; or use `RepeaterGroup`-style rendering if
room-servers should also get an inline login/action affordance, see the
**open question in §6**) between "Favorite Repeaters" and "Favorite
Channels", and keep the existing "Rooms" heading for `regularRooms` only.
Update `totalResults` accordingly.

### 4.3 Sidebar: open design question, not resolved here

See §6. Two non-exclusive options, either buildable independently of §4.2:

- **Option A (smallest, consistent with current architecture)**: leave the
  existing type-sort clustering (`type-recent`/`type-alpha`) as the only
  grouping mechanism; do nothing further to `Sidebar.tsx`. Rationale: the
  Code Ethos in `AGENTS.md`/`frontend/AGENTS.md` explicitly prefers fewer,
  stronger modules over added indirection, and the type-sort already
  satisfies the original upstream request (issue #314) that motivated the
  old fork's sub-section split.
- **Option B (full old-fork port)**: add independently-collapsible
  "Channels" / "Contacts" / "Room Servers" / "Repeaters" sub-headers inside
  the single "Favorites" section, following `renderSubSectionHeader()` from
  the old fork (§3.2). Requires: four new collapse-state booleans (naming
  should follow the existing `favoritesCollapsed`/`channelsCollapsed`
  pattern, for example `favChannelsCollapsed`), a smaller sub-header
  renderer alongside the existing `renderSectionHeader`, and splitting
  `favoriteRows` into four arrays the same way `favContactRows`/
  `favRoomRows`/`favRepeaterRows`/`favChannelRows` are split in the old fork
  (§3.2). Persisted collapse state (`loadCollapsedState`/
  `CollapseState` type, `Sidebar.tsx:114-144`) would need four more keys.

This plan does not pick between A and B; that is a product call for the repo
owner (§6, Q1).

### 4.4 Typed contracts

No new types needed for §4.2 beyond what `SearchableContact` already
provides (`contact.type`, `contact.favorite` are already read). If Option B
is chosen, `SidebarSortableSection`/`SidebarSectionSortOrders`
(`frontend/src/utils/conversationState.ts:20-21`) do not need new members.
Sub-section collapse state is local component state in the old fork, not
persisted sort preference, and should follow the same pattern here (plain
`useState` plus the existing `CollapseState` localStorage blob, not the sort
preference plumbing).

## 5. Phasing (first shippable slice)

1. **Phase 1: CommandPalette room-server parity** (§4.2). Self-contained,
   no migration, no backend change, closes a real code-verified
   inconsistency (rooms are the only contact type without favorite/star
   treatment in the palette). Ship this regardless of the §6 sidebar
   decision.
2. **Phase 2: Sidebar sub-sections** (§4.3 Option B), only if the repo
   owner picks Option B in §6. Independent of Phase 1.

## 6. Risks / open questions

- **Q1 (blocking §4.3)**: Does the type-sort clustering already shipped in
  `Sidebar.tsx` (§2.2) satisfy the intent behind "split favorited contacts
  from favorited repeaters/room-servers", or is the fuller old-fork-style
  independently-collapsible sub-section UI (§3.2, Option B) also wanted?
  Not inferable from the braindump wording alone; needs an explicit answer
  before Phase 2 is scoped further.
- **Q2**: If Option B is chosen, should "Favorite Room Servers" in the
  Sidebar reuse plain rows (like `ContactGroup` in CommandPalette) or carry
  any room-specific affordance (for example a login-state indicator), given
  `RoomServerPanel` gates room chat behind login (`frontend/AGENTS.md` §
  "Room Server Panel")? UNVERIFIED whether the old fork's `favRoomRows`
  sidebar entries show any login-state glyph; not inspected beyond the row
  builder call (`buildContactRow(item.contact, 'fav-room')`, the same
  builder used for all contact-type favorite rows, old fork line 1169).
- **Q3**: Should Phase 2 (if approved) also add a "Favorite Room Servers"
  RepeaterGroup-equivalent in CommandPalette with inline actions, or is the
  plain star-only `ContactGroup` treatment in §4.2 sufficient parity?
  Recommendation in §4.2 is the plain form: repeaters get the ACL/login
  quick-action in the palette because `onRepeaterAutoLogin` already exists
  for them, and there is no equivalent room-login quick-action prop on
  `CommandPaletteProps` today (confirmed by reading
  `CommandPalette.tsx:120-126`; only `onRepeaterAutoLogin` exists).
- **Risk**: none of this touches migrations, so there is no schema-rollback
  risk. The main risk is scope creep into the unrelated old-fork "Owned"
  feature (`contact_owner_id`), which uses the same
  `renderSubSectionHeader()` helper. Keep that firmly out of scope per §3.2.

## 7. Verification plan

Per repo rule ("never claim it works without proof"), any implementation of
this plan must show at least:

1. **Frontend unit tests** (Vitest):
   - New/updated `CommandPalette` test file (none exists today, confirmed
     absent from `frontend/src/test/`) covering: a favorited room appears
     under "Favorite Room Servers" with a star, a non-favorited room appears
     under "Rooms" without a star, and toggling `contact.favorite` moves it
     between groups.
   - If Option B is implemented: extend `frontend/src/test/sidebar.test.tsx`
     with cases for each new sub-header's independent collapse (expand one
     sub-group, confirm siblings retain their own collapsed state), mirroring
     the existing pattern for the four already-independent non-favorite
     sections (`Channels`/`Contacts`/`Repeaters` collapse independently today
     per `Sidebar.tsx:114-144`).
   - Run `cd frontend && npm run test:run` and capture pass/fail output.
     Do not report success without this output.
2. **Runtime observation** (not just type-check/build): per repo rule,
   compiling is not evidence of a rendering UI. After implementation, open
   the app in a browser (or the project's own browser-preview tooling),
   favorite a room-server contact, open the command palette (`Cmd/Ctrl+K`),
   and visually confirm the new group renders with the room's name and a
   star. If Option B is built, also visually confirm the sidebar sub-headers
   collapse independently (click one chevron, confirm siblings are
   unaffected). This cannot be inferred from a snapshot test alone since
   collapse-state interaction is stateful DOM behavior.
3. **Backend**: no backend changes in this plan; `PYTHONPATH=. uv run pytest
   tests/ -v` should be unaffected, but re-run
   `tests/test_settings_router.py` (favorites toggle coverage) as a
   regression guard since it is the shared endpoint both UIs call.
4. Confirm the branch/build under test actually contains the change (repo
   rule: right branch, right build, right URL) before reporting results.

## 8. Effort (S/M/L)

- Phase 1 (CommandPalette room-server split plus new test file): **S**.
  Self-contained ~20-30 line change in one component, plus a new test file
  covering a component with zero existing coverage.
- Phase 2 (Sidebar sub-section headers, Option B only, if approved): **M**.
  Touches collapse-state plumbing (`CollapseState` type, localStorage
  load/save, search-mode expand/collapse-all logic at
  `Sidebar.tsx:499-573`), a new sub-header renderer, and four new row-array
  computations, plus test coverage for four independent collapse toggles.
- **Total**: **S** if only Phase 1 ships (recommended default pending Q1);
  **S+M** if Phase 2 is also approved. No backend/migration effort in either
  case.
