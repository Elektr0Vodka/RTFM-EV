# [17] Sidebar customisation (old-fork port)

Date: 2026-09-11
Status: draft for review
Category: B (Contacts and messaging UX) / layout, see `docs/plans/README.md`
Model: Sonnet (layout customisations); Opus/backend for the "Owned" grouping
State: Partial (extends the current `Sidebar.tsx`; ports from the old fork)

Scope: local planning only. No code changes, no migrations, no commits/PRs/issues
from this document.

Product framing: port the old fork's richer sidebar customisation into RTFM-EV,
respecting the current app's mobile/tablet/desktop layout model and its enforced
i18n. The old fork is `Elektr0Vodka/Remote-Terminal-for-MeshCore` (version
`3.14.0-EV`, `frontend/src/components/Sidebar.tsx`, 1822 lines). The user decided
(2026-09-11) to port **all five** customisation capabilities, including "Owned"
grouping.

---

## 1. Summary

The old fork's sidebar offers five customisation capabilities the current app
lacks, all persisted to `localStorage` (no backend, no context):

1. Drag-and-drop **section** reordering (top-level groups).
2. Drag-and-drop **tool** reordering (within Tools).
3. An in-sidebar **"Customize sidebar" settings panel** (gear toggle) with a
   **Reset to defaults**.
4. **Rail (icon-only) collapse** of the whole sidebar, animated width.
5. **Two-level collapse** (favourites-by-type sub-sections) plus an **"Owned"**
   grouping (nodes with `owner_id`) and per-section sort.

Capabilities 1-4 are pure frontend + localStorage and portable directly.
Capability 5's "Owned" grouping has a **backend dependency**: it needs
`contacts.owner_id` and a sensor contact type that do not exist in the current
data model, so it is gated as a separate phase. Two-level collapse and
per-section sort within capability 5 are frontend-only.

Persist all new layout preferences in `localStorage`, matching the current app's
established precedent (migration `_051_drop_sidebar_sort_order.py` deliberately
moved sidebar sort order out of the backend into localStorage). New user-facing
strings need EN/NL/DE `t()` keys per the enforced i18n policy (the current sidebar
is fully i18n'd; the old fork's is hardcoded English, so labels cannot be copied
verbatim).

This plan is UI-layout work with no migration for Phases 1-2; Phase 3 ("Owned")
adds one backend migration.

## 2. Current state (cited)

### 2a. Old fork: the five customisations (source of the port)

Local checkout `G:\Github\repositories\Elektr0Vodka\Remote-Terminal-for-MeshCore`,
`frontend/src/components/Sidebar.tsx`:

1. **Section reorder.** Sections `'tools' | 'favorites' | 'owned' | 'the-mesh'`
   (`:96-105`); `sectionOrder` from `loadSectionOrder()` (`:523`), persisted to
   `remoteterm-sidebar-section-order` (`:107,109-141`) with legacy-key migration
   (`:115-127`); a custom `DragList` using native HTML5 drag events +
   `GripVertical` handle (`:257-320`), rendered in the settings panel
   (`:1689-1697`); sections rendered in user order via
   `sectionOrder.map(renderSection)` (`:1790`).
2. **Tool reorder.** 11 tools (`:145-184`); `toolOrder` from `loadToolOrder()`
   (`:524`), persisted to `remoteterm-sidebar-tool-order` (`:186-203`) with
   append-new-keys reset logic (`:193-198`); same `DragList` in settings
   (`:1703-1710`); consumed as `toolOrder.map(k => toolRowMap[k])` (`:1329`).
3. **Settings panel + reset.** Gear button toggles `showSettings`
   (`:522,1664-1678`), panel shows Section Order + Tool Order DragLists and a
   "Reset to defaults" clearing both keys (`:1681-1724`).
4. **Rail collapse.** `railCollapsed` persisted to
   `remoteterm-sidebar-rail-collapsed` (`:208,525-538`); width animates `w-12`
   (rail) <-> `w-60` (full) with `transition-[width] duration-200`
   (`:1637-1640`); rail hides search/scroll/sections and renders icon-only tool
   rows (`:1730,1785-1787`) with centered rows + title tooltips
   (`:1124,1131-1136`); a bottom chevron flips the rail (`:1802-1818`).
5. **Two-level collapse + Owned + sort.** A 15-key `CollapseState`
   (`:76-92`) persisted to `remoteterm-sidebar-collapse-state` (`:207,833-853`);
   favourites split into per-type sub-sections each independently collapsible
   (`:1426-1461`); an "Owned" section groups `owner_id` nodes into
   Repeaters/Room Servers/Sensors (`:967-1018,1467-1512`), depending on
   `contact.owner_id` (`types.ts:155`) and `CONTACT_TYPE_SENSOR = 4`
   (`Sidebar.tsx:58`); per-section A-Z/recent sort via `handleSortToggle` +
   `saveLocalStorageSidebarSectionSortOrders` (`:589-596`), key
   `remoteterm-sidebar-section-sort-orders`.

Additional old-fork chrome (optional, not core to the port): scroll-to-top/bottom
buttons (`:1756-1782`); a live Mesh Health status dot polled every 5 min
(`:572-587,1252-1276`); a `forceExpanded` prop so the mobile mount keeps the rail
open (`:479-481,512,529-530`); extra tools MC-KMS and Bot Detector
(`:1296-1326`).

### 2b. Current app: what exists and what is missing

Worktree `frontend/src/components/Sidebar.tsx` (1141 lines):

- Single-level, fixed-order sections: Tools -> Mark-All-Read -> Favorites ->
  Channels -> Contacts -> Repeaters -> Room Servers (`:1010-1136`); 9 tool rows
  (`:770-888`); Add button (`:971-983`); search (`:987-1008`).
- **Exists:** collapsible sections (6 booleans, `remoteterm-sidebar-collapse-state`,
  `:117-135,137-153,554-579`); per-section sort (favorites 4-way, others
  recent<->alpha, `:223-230`; key `remoteterm-sidebar-section-sort-orders` in
  `utils/conversationState.ts:13,137`); auto-expand-on-search then restore
  (`:503-552`).
- **Missing:** section reorder, tool reorder, settings/gear panel, rail collapse,
  "Owned" grouping, favourites-by-type sub-sections, scroll buttons,
  `forceExpanded`. Width is a hardcoded `w-60` on the root `<nav>` (`:967`), not
  stateful.

### 2c. Responsive model (in `AppShell.tsx`, not the sidebar)

- Desktop (>=768px): the sidebar is wrapped `hidden md:block min-h-0
  overflow-hidden` (`AppShell.tsx:266`).
- Mobile/tablet (<768px): a left `Sheet` drawer, `w-[280px] p-0`, opened via
  `sidebarOpen` (`AppShell.tsx:268-285`). The **same** `activeSidebarContent`
  instance renders in both mounts (`AppShell.tsx:229-232,266,282`).
- Drawer opened by the StatusBar menu button (`onMenuClick`, `AppShell.tsx:261`)
  and a right-swipe when `window.innerWidth < 768` (`:128-129`); closed by
  left-swipe (`:138`).
- **No dedicated tablet breakpoint**; the single `md` (768px) split is the entire
  responsive model. No `useMediaQuery`/`matchMedia` anywhere in the frontend.

### 2d. Preference persistence precedent

Sidebar/sort/collapse prefs already live in `localStorage`
(`remoteterm-sidebar-collapse-state`, `remoteterm-sidebar-section-sort-orders`;
`conversationState.ts:12-13`). App-wide settings live in the backend
`app_settings` table (`_009`), but migration `_051_drop_sidebar_sort_order.py`
deliberately moved sidebar sort order **out** of the backend into localStorage,
establishing that sidebar-layout prefs are client-local. New prefs follow suit
and reuse the old fork's key names for a clean migration.

## 3. Design

### 3a. Phase 1 - layout customisations (frontend only, no backend)

Port capabilities 1-4 plus favourites-by-type (the frontend part of 5), reusing
the old fork's localStorage keys and `DragList`:

- **Section reorder** (`remoteterm-sidebar-section-order`) and **tool reorder**
  (`remoteterm-sidebar-tool-order`), each rendered through a ported `DragList`.
  Current tools are hardcoded (`Sidebar.tsx:770-888`); refactor them into a keyed
  map (like the old fork's `toolRowMap`) so order is data-driven.
- **Settings panel + Reset** (gear toggle, `showSettings`), containing the two
  DragLists and a Reset-to-defaults that clears the layout keys.
- **Rail collapse** (`remoteterm-sidebar-rail-collapsed`), width `w-12 <-> w-60`
  animated, icon-only rows with tooltips, chevron toggle.
- **Two-level collapse**: favourites split into per-type sub-sections, extending
  the current 6-boolean `CollapseState` toward the old fork's richer key set.

i18n: every ported label needs EN/NL/DE `t()` keys; do not copy the old fork's
hardcoded English.

### 3b. Responsive rules the port must respect

1. **Rail collapse must be disabled inside the mobile drawer.** The old fork uses
   a `forceExpanded` prop that pins `isRailCollapsed = false` and hides the rail
   toggle (`Sidebar.tsx:512,529-530,1803`). The current `AppShell` reuses one
   sidebar instance for both mounts (`AppShell.tsx:229-232`), so the port must
   either add a `forceExpanded` prop and pass it true in the drawer mount, or
   split into separate desktop/mobile instances the way the old fork does
   (`AppShell.tsx:238-252`). Recommend the `forceExpanded` prop (smaller change).
2. **The drawer is fixed `w-[280px]`** (`AppShell.tsx:269-271`); a rail width
   toggle inside it is meaningless. Respect the fixed drawer width on mobile.
3. **Drag-and-drop on touch conflicts with the swipe gestures.** Right-swipe
   opens / left-swipe closes the drawer below 768px (`AppShell.tsx:128-129,138`),
   and HTML5 `draggable` reordering competes with touch-scroll and those swipe
   handlers. **Gate reordering to the settings panel and verify touch behavior;**
   if touch DnD proves unreliable, restrict reordering to the desktop mount (the
   order still applies everywhere once set). This is a real risk to validate in
   the running app, not to reason about.
4. **Tablet.** There is no tablet tier today (single 768px split). OPEN QUESTION:
   whether to add one. **Recommendation:** do **not** invent a tablet layout; keep
   the 768px split and simply tune the rail default by width (e.g. default the
   rail collapsed on narrower desktop widths), which needs a `matchMedia` helper
   the app does not yet have. Adding a full tablet tier is out of scope unless the
   user asks.
5. **Persist in localStorage** (3c precedent), not the backend.

### 3c. Phase 2 - persistence and reset polish

Ship the Reset-to-defaults and ensure all three new keys
(`section-order`, `tool-order`, `rail-collapsed`) round-trip and degrade
gracefully when absent (first run, cleared storage), matching the current app's
existing try/catch-guarded localStorage reads.

### 3d. Phase 3 - "Owned" grouping (backend dependency)

The "Owned" section groups nodes the operator owns (`owner_id` set) into
Repeaters / Room Servers / Sensors. The current frontend data model has **no**
`owner_id` and **no** sensor contact type (`types.ts` lacks both; grep found no
`owner_id`, no `CONTACT_TYPE_SENSOR`). Porting it requires, first:

- A backend migration adding `contacts.owner_id` (and populating it: from where?
  self-owned repeaters/room-servers the operator manages, or a manual flag) and a
  sensor contact type constant.
- Frontend `types.ts` additions mirroring the backend.
- Only then the "Owned" section + its per-type sub-sections and collapse keys.

OPEN QUESTION: how `owner_id` is determined. The old fork's data model has it
(`types.ts:155`) but the source of truth (manual tag vs derived from
admin/ownership of a repeater) must be decided before the migration. Treat Phase 3
as gated on that decision; it is materially more than a layout port.

## 4. Phasing

1. **Phase 1** - section/tool reorder + DragList + settings panel + rail collapse
   + favourites-by-type, all localStorage, with `forceExpanded` for the drawer and
   full EN/NL/DE i18n. No backend.
2. **Phase 2** - Reset-to-defaults + persistence hardening + touch-DnD validation
   (or desktop-only reordering fallback).
3. **Phase 3** - "Owned" grouping: backend `owner_id` + sensor type migration and
   population, then the frontend section. Gated on the `owner_id` source decision.

Optional add-ons (only if wanted): scroll-to-top/bottom buttons; the Mesh Health
status dot (the current app already has a Mesh Health view, so a live dot is a
small addition); MC-KMS / Bot Detector tools (separate features, not layout).

## 5. Risks and open questions

- **Touch DnD vs swipe gestures (3b.3).** Must be validated in the running app;
  reordering may need to be desktop-only.
- **Single sidebar instance reused for both mounts (3b.1).** Rail collapse needs
  `forceExpanded` or an AppShell split; do not let a rail state from desktop leak
  into the drawer.
- **Tablet tier (3b.4).** Open; recommend not adding one.
- **"Owned" `owner_id` source (3d).** Undecided; blocks Phase 3's migration.
- **i18n parity.** New strings must land in EN/NL/DE or the parity test/eslint
  guard fails (enforced policy).
- **Key migration.** Reusing the old fork's localStorage key names eases user
  migration but confirm no current key collides with a different shape.
- **Scope creep.** The old fork's sidebar is 1822 lines vs the current 1141;
  porting everything risks importing complexity the current app deliberately
  simplified. Keep Phases 1-2 to layout; treat chrome add-ons as opt-in.

## 6. De-confliction

- **Plan [03] (split favorites).** Already shipped; favourites grouping exists.
  This plan's favourites-by-type sub-sections extend that display, not replace it.
- **Plan [18] (multi-radio identity).** The "Owned" grouping's `owner_id` is
  unrelated to [18]'s self-radio registry, but if [18] adds any "my devices"
  concept, Phase 3 should reconcile `owner_id` with it rather than inventing a
  parallel ownership notion. Flag at Phase 3 build time.
- **Plan [13] (map overhaul).** [13] added responsive map controls on the same
  768px model; this plan reuses that model. No conflict.

## 7. Verification plan

- Frontend unit tests extend `frontend/src/test/sidebar.test.tsx`: reorder
  persists and renders in order; rail collapse toggles width and hides sections;
  settings panel opens; Reset clears keys and restores defaults; `forceExpanded`
  forces the rail open.
- i18n parity test passes with the new EN/NL/DE keys.
- `npm run build` (repo gate).
- **Runtime verification is mandatory** (repo rule: UI behavior must be observed):
  in the running app at desktop, in the mobile drawer, and at a tablet width,
  confirm reorder/rail/collapse behave and that touch DnD either works or is
  correctly disabled; confirm the drawer ignores rail state.
- `./scripts/quality/all_quality.sh` (and frontend quality) before done.

## 8. Effort

Phase 1-2: Sonnet, medium frontend-only (DragList + keyed tool map + rail state +
settings panel + i18n + tests), with a required runtime pass for the touch/drawer
responsive behavior. Phase 3 ("Owned"): larger and cross-cutting (backend
migration + population logic + frontend types), gated on the `owner_id` source
decision; scope it separately once that decision is made.
