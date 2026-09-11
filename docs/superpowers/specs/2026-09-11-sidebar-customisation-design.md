# Sidebar customisation (plan 17) — design spec

Date: 2026-09-11
Status: approved (brainstorming)
Source plan: `docs/plans/17-sidebar-customisation.md`
Scope of this spec: **Phases 1-2 only** (frontend + localStorage). Phase 3 ("Owned"
grouping) is explicitly deferred (see Decisions).

## Goal

Port the old fork's (`Elektr0Vodka/Remote-Terminal-for-MeshCore`) richer sidebar
customisation into RTFM-EV, respecting the current app's mobile/tablet/desktop
layout model (single 768px split) and its enforced EN/NL/DE i18n.

## Decisions (locked in brainstorming, 2026-09-11)

1. **Reordering UX: DnD on desktop + move buttons everywhere.** Native HTML5 drag
   for pointer/mouse, plus up/down "move" buttons on each row so touch and keyboard
   users reorder identically. Reordering lives in the settings panel only. Reason:
   HTML5 `draggable` does not fire on touch and competes with the drawer swipe
   gestures (`AppShell.tsx:128-129,138`); move buttons are the platform-agnostic,
   accessible fallback. No new dependency (`@dnd-kit` etc. rejected).

2. **Phase 3 "Owned" deferred to plan 18 (multi-radio identity).** Rationale from
   research: `owner_id` is not on `origin/main`, but two unmerged on-disk worktrees
   (`competent-antonelli`, `ecstatic-euler`) already implement it as "companion
   radio public key" (which radio owns a contact) — plan 18's territory — and both
   collide on migration 51 (main's `_051` is `_051_drop_sidebar_sort_order`). The
   old fork's own semantic is a manual per-contact tag (`MapView.tsx:558` PATCHes
   `{owner_id}`). To avoid creating a third competing `owner_id` column, "Owned" is
   built on top of plan 18's radio-identity model later, not here. This spec adds no
   migration.

3. **Rail default: manual toggle, keep the 768px split.** No tablet tier, no
   `matchMedia`. Grounded by inspecting the live EU analyzer (meshcore-analyzer.eu):
   it has no contact-list sidebar (top-tab nav + floating dockable map panels on
   desktop; bottom tab bar + floating icon buttons on mobile), so there is no rail
   pattern to mirror; its only transferable idea ("collapse to icons on small
   screens") is already what the old fork's desktop icon-rail does. Adopting the EU
   analyzer's mobile model (bottom tabs) would be a large AppShell change, out of
   scope. Rail is forced open inside the mobile drawer via a new `forceExpanded`
   prop, mirroring EU avoiding a rail on mobile.

## Current state (verified against this worktree)

- `frontend/src/components/Sidebar.tsx` (1138 lines): single-level fixed-order
  sections; 9 hardcoded tool rows (`:770-888`); root `<nav>` has a hardcoded
  `w-60` (`:966-967`), not stateful. Exists already: collapsible sections
  (6-boolean `CollapseState`, key `remoteterm-sidebar-collapse-state`), per-section
  sort (`remoteterm-sidebar-section-sort-orders`, `utils/conversationState.ts`),
  auto-expand-on-search.
- `frontend/src/components/AppShell.tsx`: one `activeSidebarContent` instance
  reused in both the desktop mount (`hidden md:block`, `:266`) and the mobile
  `Sheet` drawer (`w-[280px] p-0`, `:268-285`). Swipe open/close below 768px
  (`:128-129,138`). No `forceExpanded`, no tablet tier, no `matchMedia`.
- No DnD/sortable dependency in `frontend/package.json`.
- `CONTACT_TYPE_SENSOR` (value 4) already exists as a backend `Contact.type` value
  (`app/models.py:100`); frontend `types.ts` has `CONTACT_TYPE_REPEATER=2` and
  `CONTACT_TYPE_ROOM=3` but is missing the `CONTACT_TYPE_SENSOR=4` constant. (Only
  relevant if Phase 3 is later un-deferred; not built here.)
- Persistence precedent: sidebar layout prefs are client-local (migration
  `_051_drop_sidebar_sort_order.py` moved sort order out of the backend into
  localStorage). New keys follow suit and reuse the old fork's key names.

## Design (Phases 1-2)

### 1. Data-driven rows
Refactor the hardcoded tool rows into a keyed `toolRowMap` (mirroring the old
fork), rendered as `toolOrder.map(k => toolRowMap[k])`. Sections rendered via
`sectionOrder.map(renderSection)`. New-key reset logic: when the stored order is
missing a newly-added tool/section key, append it (do not drop unknown keys
silently; drop only keys no longer in the map).

### 2. Reordering (DnD desktop + move buttons everywhere)
Ported `DragList` component:
- Native HTML5 drag events + `GripVertical` handle for pointer devices.
- Up/down move buttons on each row (always visible) for touch/keyboard.
- Rendered only inside the settings panel.
- Persist `remoteterm-sidebar-section-order` and `remoteterm-sidebar-tool-order`
  (try/catch-guarded reads, degrade to defaults when absent/corrupt).

### 3. Settings panel + Reset
Gear button toggles `showSettings`; panel contains the two reorder lists and a
Reset-to-defaults that clears the three new layout keys and restores defaults.

### 4. Rail collapse
- `remoteterm-sidebar-rail-collapsed` boolean.
- Root `<nav>` width animates `w-60 <-> w-12` (`transition-[width] duration-200`).
- Rail mode: hide search/sections, render icon-only tool rows (centered) with
  `title` tooltips; a chevron toggles the rail.
- New `forceExpanded?: boolean` prop on `Sidebar`; `AppShell` passes it `true` in
  the mobile drawer mount. When true: `isRailCollapsed` is pinned false and the
  rail toggle is hidden. Drawer stays fixed `w-[280px]`.

### 5. Favourites-by-type sub-sections
Extend the current 6-boolean `CollapseState` to add independently-collapsible
favourite sub-sections by type (contacts / repeaters / rooms), persisted in the
existing `remoteterm-sidebar-collapse-state` key (additive keys, defaulting to the
current single-favourites behaviour when absent). Does not replace plan 03's
favourites grouping; extends its display.

### 6. i18n
Every new user-facing label gets EN/NL/DE `t()` keys. Do not copy the old fork's
hardcoded English. The parity test / eslint guard must pass.

## Out of scope
- Phase 3 "Owned" grouping and any `owner_id` / sensor-type backend work.
- Tablet tier, `matchMedia`, auto-collapse-by-width.
- Optional old-fork chrome: scroll-to-top/bottom buttons, Mesh Health status dot,
  MC-KMS / Bot Detector tools.
- Adopting the EU analyzer's bottom-tab-bar mobile navigation.

## Risks / coordination
- **`feat/sidebar-section-counters` is a live parallel worktree** editing
  `Sidebar.tsx`, `sidebar.test.tsx`, `types.ts`, and i18n locales. Rebase on
  `origin/main` at build time; expect merge coordination on `Sidebar.tsx`. Flag,
  do not fight.
- **Migration numbering:** not applicable to this spec (no migration). If Phase 3
  is later un-deferred, next free was `_076` as of 2026-09-11 — re-verify then.
- **localStorage key reuse:** reusing the old fork's key names eases migration;
  confirm no current key of a different shape collides (current app already uses
  `remoteterm-sidebar-collapse-state` and `remoteterm-sidebar-section-sort-orders`
  — extend their shapes additively).

## Verification plan
- Extend `frontend/src/test/sidebar.test.tsx`: reorder persists and renders in
  order (via both DnD and move buttons); rail collapse toggles width and hides
  sections; settings panel opens; Reset clears keys and restores defaults;
  `forceExpanded` pins the rail open and hides the toggle.
- i18n parity test passes with the new EN/NL/DE keys.
- `npm run build`.
- **Runtime pass (mandatory, repo rule):** in the running app confirm at desktop
  that DnD reorders and move buttons reorder; in the mobile drawer confirm the rail
  is force-expanded and the toggle is absent; confirm the drawer ignores desktop
  rail state.
- `./scripts/quality/all_quality.sh` (and frontend quality) before done.
