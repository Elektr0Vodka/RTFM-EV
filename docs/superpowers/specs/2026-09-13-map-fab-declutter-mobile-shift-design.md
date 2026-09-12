# Map FAB declutter + grouping, with mobile sidebar-shift fix

Date: 2026-09-13
Status: Design approved (brainstorming), pending plan
Branch: continues on `feat/map-advert-truth-links` (same branch as Spec 2).

## Problem

`frontend/src/map/controls/MapControls.tsx` renders a vertical column of 11
floating action buttons at the map's top-left (`absolute left-3 top-3
z-[1200]`):

- 9 panel FABs: layers (basemap), legend, search, nodeSize (size + role
  colors), links (Spec 2: mode + confidence), and 4 from MapView `extraFabs`:
  since (time range), packets (packet visualization), heard (heard filter),
  external (analyzer nodes).
- 2 toggle FABs: tilt (2D/3D), buildings (3D buildings).

Two issues:

1. The 11-FAB column is cluttered and tall.
2. On mobile the FAB column is covered by the sidebar/hamburger drawer when it
   is open. The drawer is a 280px left-side Radix `Sheet` overlay
   (`AppShell.tsx`), and the FABs sit under it at `left-3`.

## Goals

- Declutter the column by grouping the panel FABs into a few category FABs.
- On mobile, shift the FAB column right so it stays visible beside the open
  drawer.

## Non-goals

- No control is removed or changed in behavior. This is regrouping and
  repositioning only.
- No change to the compact bottom-sheet presentation logic (`useIsCompactMap`)
  beyond the shift.
- No change to desktop sidebar layout.

## Design

### Grouping scheme (11 FABs to 6)

Three category group FABs, each opening one panel whose body stacks the member
controls under small section headings. Search and the two toggles stay
standalone.

- **Display** (Layers icon): sections *Basemap* (layers), *Node size & colors*
  (nodeSize), *Legend*.
- **Filters** (Funnel icon): sections *Time range* (since), *Heard* (heard),
  *External nodes* (external).
- **Overlays** (Activity icon): sections *Packets* (packets), *Links* (links
  mode + confidence).
- **Search**: standalone panel FAB (a single search box; a distinct action, not
  a category).
- **Toggles**: tilt (2D/3D) and buildings, standalone one-tap toggles.

Column result: 3 group FABs + Search + 2 toggles = 6 (down from 11).

Rationale: Legend folds into Display (it is a reference panel and stays pinnable
from that section). Search stays standalone because it is a quick action, not a
category of settings. Toggles stay standalone because they are frequent on/off
actions (confirmed in brainstorming).

### MapControls restructure

Today MapControls builds a flat `panels[]` from the `fabs` booleans (layers,
legend, search, nodeSize, links) plus `extraFabs[]` (since, packets, heard,
external, supplied by MapView as `{id, label, icon, panel}`).

Introduce a group model assembled inside MapControls:

- A group is `{ id, label, icon, sections: { title: string; body: ReactNode }[] }`.
- Each section's `body` is an existing panel body: the built-in bodies (basemap
  radios, legend, nodeSize controls, links panel) and the `extraFabs` bodies
  (matched by `extraFab.id`).
- One FAB is rendered per group; opening it shows a sheet/anchored panel that
  stacks its sections, each under a small heading (the section `title`).
- Search remains a single-section panel FAB. The two toggles remain in the
  existing `toggles[]` path unchanged.

Membership is defined by a static map in MapControls from control id to group
id. Controls that are not enabled (their `fabs` flag is false or the extraFab is
absent) simply do not contribute a section, and a group with zero sections is
not rendered. This keeps MapControls the single owner of layout while MapView
keeps supplying the same `fabs` and `extraFabs` it does today (no MapView change
required for grouping).

The existing sheet, anchored-panel, pinning, and compact bottom-sheet
infrastructure is reused as-is; only the set of FABs and each panel's body
(now multi-section) change.

### Mobile sidebar-shift fix

- Thread `sidebarOpen` (owned by `useAppShell`, held in `AppShell`) down to
  MapControls: AppShell -> ConversationPane -> MapView -> MapSurface ->
  MapControls, as an optional boolean prop (default false).
- The FAB container className becomes conditional: when **mobile AND
  `sidebarOpen`**, use a left offset of `left-[288px]` (just past the 280px
  drawer) instead of `left-3`, with a `transition-[left]` so it slides.
- Gate on `useIsMobile()` (max-width 768px), NOT `useIsCompactMap()`. The
  overlay drawer only exists below the Tailwind `md` breakpoint (the persistent
  sidebar is `md:block`). `useIsCompactMap` is `max-width:1024px OR pointer:coarse`,
  which also covers tablets and touch laptops where the sidebar is still the
  persistent column and no drawer overlays the FABs. Tablet and desktop must
  never shift; only mobile does.
- Additionally, because grouped panels are taller (up to 3 sections), the
  desktop anchored panel gets `max-h-[70vh] overflow-y-auto` (matching the
  compact bottom sheet) so tall groups like Display scroll instead of clipping.

## Assumptions and open items (resolve in planning)

- ASSUMPTION: `sidebarOpen` is reachable in `ConversationPane` props or can be
  added there without disturbing other consumers. To confirm the exact prop
  wiring in planning (ConversationPane -> MapView).
- ASSUMPTION: The 280px drawer width in `AppShell.tsx`
  (`SheetContent className="w-[280px]"`) is the value to clear; `left-[288px]`
  gives an 8px gap. Confirm the width has not changed at plan time.
- OPEN: Group icons (Layers, Funnel, Activity) are proposals; final lucide-react
  icon names chosen at plan time from what is already imported or available.

## i18n

New user-facing strings for the group labels and section headings need `t()`
keys in EN, NL, DE (parity test + eslint enforce it). Existing control labels
are reused where possible.

## Verification (before claiming done, per CLAUDE.md)

1. Frontend suite (`npm run test`) including updated `mapControls.test.tsx`:
   - Opening a group FAB shows its member sections.
   - A group with no enabled members is not rendered.
   - The FAB container shifts (uses the offset class) when compact and
     `sidebarOpen`, and does not when not compact or not open.
2. `prettier format:check` on changed files; i18n parity test for new keys.
3. Frontend build (typecheck).
4. Runtime observation in the browser (observed, not reasoned about):
   - Desktop: 6 FABs; each group opens the correct sections; toggles and search
     still work.
   - Mobile viewport: opening the sidebar drawer shifts the FAB stack right so
     it stays visible beside the drawer; closing restores it.

## Branch / logistics

- Continues on `feat/map-advert-truth-links` (Spec 2 committed as `1ff2566`).
- No migration, no backend change. Frontend only.
- Target `origin` (the fork). No commit / push / PR without explicit
  instruction.
