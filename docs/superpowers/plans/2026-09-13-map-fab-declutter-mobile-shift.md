# Map FAB Declutter + Mobile Sidebar-Shift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the map's 11 left-edge FABs into 3 category groups (Display, Filters, Overlays) plus standalone Search and the two toggles, and shift the FAB column right on mobile when the sidebar drawer is open so it stays visible.

**Architecture:** All grouping lives in `MapControls.tsx`, which already owns FAB layout; MapView keeps supplying the same `fabs`/`extraFabs`. Group FABs open one panel that stacks the member controls as sections. The mobile shift threads `sidebarOpen` from `useAppShell` down to MapControls and offsets the FAB container when compact and open.

**Tech Stack:** React + TypeScript, Tailwind, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-09-13-map-fab-declutter-mobile-shift-design.md`

---

## Standing rules

- **No commits** unless the user explicitly says so (repo CLAUDE.md overrides the writing-plans commit default). Tasks end at passing tests.
- **No em dashes** anywhere.
- **i18n:** new user-facing strings need `t()` keys in `en.json`, `nl.json`, `de.json` (parity test + eslint enforce it).
- **Frontend tests:** `npm run test` in `frontend/`. `npm ci` already done in this worktree.
- Frontend only. No backend, no migration.

## File structure

- Modify: `frontend/src/components/AppShell.tsx` (inject `sidebarOpen` into the ConversationPane render).
- Modify: `frontend/src/components/ConversationPane.tsx` (accept `sidebarOpen`, pass to MapView).
- Modify: `frontend/src/components/MapView.tsx` (accept `sidebarOpen`, pass to MapSurface).
- Modify: `frontend/src/map/MapSurface.tsx` (pass `sidebarOpen` through to MapControls).
- Modify: `frontend/src/map/controls/MapControls.tsx` (group model, container shift, icon imports, legend-pin relocation).
- Modify: `frontend/src/i18n/locales/{en,nl,de}.json` (3 group-label keys).
- Modify: `frontend/src/test/map/mapControls.test.tsx` (grouping + shift tests).

---

## Task 1: Add the 3 group-label i18n keys

**Files:** `frontend/src/i18n/locales/en.json`, `nl.json`, `de.json`

- [ ] **Step 1: Add keys to en.json**

Add near the other `map_` keys (e.g. after `map_controls_title`):

```json
  "map_group_display": "Display",
  "map_group_filters": "Filters",
  "map_group_overlays": "Overlays",
```

- [ ] **Step 2: Add to nl.json**

```json
  "map_group_display": "Weergave",
  "map_group_filters": "Filters",
  "map_group_overlays": "Overlays",
```

- [ ] **Step 3: Add to de.json**

```json
  "map_group_display": "Anzeige",
  "map_group_filters": "Filter",
  "map_group_overlays": "Overlays",
```

- [ ] **Step 4: Verify i18n parity passes**

Run: `cd frontend && npm run test -- i18nParity`
Expected: PASS (all three locales have the new keys).

---

## Task 2: Thread `sidebarOpen` down to MapControls (no behavior yet)

This wires the prop end-to-end first so later tasks can use it. It changes no visible behavior.

**Files:** AppShell.tsx, ConversationPane.tsx, MapView.tsx, MapSurface.tsx, MapControls.tsx

- [ ] **Step 1: MapControls accepts the prop (unused for now)**

In `frontend/src/map/controls/MapControls.tsx`, add to `MapControlsProps` (after `onLinkConfidence`):

```typescript
  sidebarOpen?: boolean;
```

Destructure it in the component body with a default (near `linkConfidence = 2`):

```typescript
    sidebarOpen = false,
```

- [ ] **Step 2: MapSurface passes it through**

In `frontend/src/map/MapSurface.tsx`, add to the props interface (after `onLinkConfidence`):

```typescript
  sidebarOpen?: boolean;
```

And forward to `<MapControls>` (next to `linkConfidence={props.linkConfidence}`):

```tsx
        sidebarOpen={props.sidebarOpen}
```

- [ ] **Step 3: MapView accepts and forwards**

In `frontend/src/components/MapView.tsx`, add to `MapViewProps`:

```typescript
  sidebarOpen?: boolean;
```

Destructure it in the `MapView({ ... })` parameter list:

```typescript
  sidebarOpen,
```

Pass to `<MapSurface>` (next to `linkConfidence={linkConfidence}`):

```tsx
        sidebarOpen={sidebarOpen}
```

- [ ] **Step 4: ConversationPane accepts and forwards**

In `frontend/src/components/ConversationPane.tsx`, add to `ConversationPaneProps`:

```typescript
  sidebarOpen?: boolean;
```

Destructure `sidebarOpen` in the component's props destructuring (alongside `activeConversation`, `contacts`, etc.).

Pass to `<MapView>` (add an attribute in the JSX at the MapView render):

```tsx
              sidebarOpen={sidebarOpen}
```

- [ ] **Step 5: AppShell injects sidebarOpen**

In `frontend/src/components/AppShell.tsx`, `sidebarOpen` is already destructured in the component. Change the ConversationPane render from:

```tsx
            <ConversationPane {...conversationPaneProps} />
```

to:

```tsx
            <ConversationPane {...conversationPaneProps} sidebarOpen={sidebarOpen} />
```

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npm run build`
Expected: build succeeds (prop threaded, no type errors). No visible change yet.

---

## Task 3: Restructure MapControls into category groups

Replace the flat `panels[]` (built-in) + `extraFabs` FABs with 3 group FABs (Display, Filters, Overlays) + a standalone Search FAB. Toggles unchanged. Legend folds into Display with its pin control moved into the legend section.

**Files:** `frontend/src/map/controls/MapControls.tsx`, `frontend/src/test/map/mapControls.test.tsx`

- [ ] **Step 1: Write the failing grouping tests**

In `frontend/src/test/map/mapControls.test.tsx`, replace the two link-panel tests added in Spec 2 is NOT required; instead ADD these tests inside the `describe('MapControls', ...)` block:

```tsx
  it('renders category group FABs instead of individual panel FABs', () => {
    renderControls({
      fabs: { layers: true, legend: true, search: true, nodeSize: true, links: true },
    });
    // Group FABs present.
    expect(screen.getByRole('button', { name: 'Display' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overlays' })).toBeInTheDocument();
    // Search stays standalone.
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    // The old standalone Legend/Node size FABs are gone (folded into Display).
    expect(screen.queryByRole('button', { name: 'Legend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Node size' })).not.toBeInTheDocument();
  });

  it('opening Display shows basemap, node size and legend sections', () => {
    renderControls({
      fabs: { layers: true, legend: true, nodeSize: true },
      basemaps: [
        { id: 'nova', label: 'map_layer_nova' },
        { id: 'ofm-positron', label: 'map_layer_ofm_positron' },
      ],
      selectedBasemapId: 'nova',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    // Basemap option from the layers section.
    expect(screen.getByText('OpenFreeMap Positron')).toBeInTheDocument();
    // Legend section heading present (its section title).
    expect(screen.getByText('Legend')).toBeInTheDocument();
  });

  it('does not render a group whose members are all disabled', () => {
    renderControls({ fabs: { search: true } });
    expect(screen.queryByRole('button', { name: 'Display' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Overlays' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });
```

Note: the earlier Spec 2 link-panel tests ("shows link mode radios...", "renders the confidence radios...") open the panel via the `Links` FAB, which no longer exists (Links is now an Overlays section). Update those two tests to open via the `Overlays` group FAB instead of `Links` (change `getByRole('button', { name: 'Links' })` to `{ name: 'Overlays' }`). The link mode/confidence controls still render inside the Overlays panel.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test -- mapControls`
Expected: FAIL (group FABs do not exist yet; Links FAB still present).

- [ ] **Step 3: Restructure the panel assembly**

In `frontend/src/map/controls/MapControls.tsx`:

(a) Update the lucide-react import: remove now-unused `Info`, `CircleDot`, `Spline`; add `Filter`, `Activity`. The line becomes:

```tsx
import { Layers, Search, Building2, Rotate3d, Filter, Activity, Pin, X } from 'lucide-react';
```

(b) Replace the current panel-building region (everything from `const legendBody = ...` down to the end of the `for (const ex of extraFabs) { ... }` loop, i.e. the block that builds `panels[]`) with the following. Keep the existing body JSX for each control by moving it into the corresponding `sectionById` entry (basemap radios -> `layers`, nodeSize controls -> `nodeSize`, links panel -> `links`, search form -> `search`). The exact body JSX is unchanged; only where it is assigned changes.

```tsx
  const legendBody = legendContent ?? <MapLegend roleColors={roleColors} />;

  // Each control's panel body, keyed by control id. Built-in bodies are defined
  // here; the 4 MapView-supplied extra panels are folded in by id below.
  type Section = { id: string; title: string; body: ReactNode };
  const sectionById: Record<string, Section> = {};

  if (fabs.layers) {
    sectionById.layers = {
      id: 'layers',
      title: t('map_basemap_label'),
      body: (
        /* EXISTING basemap radiogroup body, unchanged */
        <div role="radiogroup" aria-label={t('map_basemap_label')} className="space-y-1">
          {basemaps.map((b) => {
            const selected = b.id === selectedBasemapId;
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ' +
                  (selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')
                }
                onClick={() => {
                  onSelectBasemap?.(b.id);
                  setOpenPanel(null);
                }}
              >
                <span
                  aria-hidden
                  className={
                    'inline-block h-2.5 w-2.5 rounded-full border ' +
                    (selected ? 'border-primary bg-primary' : 'border-muted-foreground')
                  }
                />
                {t(b.label)}
              </button>
            );
          })}
        </div>
      ),
    };
  }

  if (fabs.nodeSize) {
    sectionById.nodeSize = {
      id: 'nodeSize',
      title: t('map_node_size_label'),
      body: (
        /* EXISTING nodeSize body (range + role colors), unchanged */
        <div className="flex flex-col gap-3">
          {/* ...existing nodeSize contents... */}
        </div>
      ),
    };
  }

  if (fabs.legend) {
    sectionById.legend = {
      id: 'legend',
      title: t('map_legend'),
      body: (
        <div className="flex flex-col gap-2">
          {!legendPinned && (
            <button
              type="button"
              className="flex items-center gap-1.5 self-start rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              onClick={() => {
                setLegendPinned(true);
                setOpenPanel(null);
              }}
            >
              <Pin size={14} aria-hidden />
              {t('map_legend_pin')}
            </button>
          )}
          {legendBody}
        </div>
      ),
    };
  }

  if (fabs.links) {
    sectionById.links = {
      id: 'links',
      title: t('map_links_label'),
      body: (
        /* EXISTING links panel body (enable + mode + confidence), unchanged */
        <div className="flex flex-col gap-3">{/* ...existing links contents... */}</div>
      ),
    };
  }

  // Fold the 4 MapView-supplied extra panels in by id.
  for (const ex of extraFabs) {
    sectionById[ex.id] = { id: ex.id, title: ex.label, body: ex.panel };
  }

  const GROUPS: { id: string; label: string; icon: ReactNode; memberIds: string[] }[] = [
    {
      id: 'display',
      label: t('map_group_display'),
      icon: <Layers size={20} aria-hidden />,
      memberIds: ['layers', 'nodeSize', 'legend'],
    },
    {
      id: 'filters',
      label: t('map_group_filters'),
      icon: <Filter size={20} aria-hidden />,
      memberIds: ['since', 'heard', 'external'],
    },
    {
      id: 'overlays',
      label: t('map_group_overlays'),
      icon: <Activity size={20} aria-hidden />,
      memberIds: ['packets', 'links'],
    },
  ];

  const panels: PanelDef[] = [];
  for (const g of GROUPS) {
    const sections = g.memberIds.map((id) => sectionById[id]).filter(Boolean) as Section[];
    if (sections.length === 0) continue;
    panels.push({
      id: g.id,
      label: g.label,
      icon: g.icon,
      body: (
        <div className="flex flex-col gap-4">
          {sections.map((s) => (
            <div key={s.id} className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {s.title}
              </span>
              {s.body}
            </div>
          ))}
        </div>
      ),
    });
  }

  // Search stays standalone (a distinct quick action, not a category).
  if (fabs.search) {
    panels.push({
      id: 'search',
      label: t('map_search'),
      icon: <Search size={20} aria-hidden />,
      body: (
        /* EXISTING search form body, unchanged */
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch?.(searchValue);
          }}
        >
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            aria-label={t('map_search')}
            placeholder={t('map_search')}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
          />
        </form>
      ),
    });
  }
```

(c) Remove the now-dead legend-pin special-casing in the render. In the desktop anchored panel block, delete the `{activePanel.id === 'legend' && !legendPinned && ( ...Pin button... )}` block (the pin now lives in the legend section body). In the compact bottom-sheet block, delete the `{activePanel?.id === 'legend' && !legendPinned && ( ...Pin button... )}` block for the same reason. Leave the rest of both render blocks (title, `activePanel.body`) unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test -- mapControls`
Expected: PASS (group FABs render; sections show; empty groups skipped; updated Spec 2 tests open via Overlays).

- [ ] **Step 5: Typecheck + lint (no unused icon imports)**

Run:
```bash
cd frontend && npm run build
cd frontend && npx eslint src/map/controls/MapControls.tsx
```
Expected: build passes; eslint clean (Info/CircleDot/Spline removed, Filter/Activity used).

---

## Task 4: Mobile sidebar-shift on the FAB container

**Files:** `frontend/src/map/controls/MapControls.tsx`, `frontend/src/test/map/mapControls.test.tsx`

- [ ] **Step 1: Write the failing shift test**

Add to `mapControls.test.tsx` inside the describe block:

```tsx
  it('shifts the FAB stack right when compact and the sidebar is open', () => {
    mockCompact.mockReturnValue(true);
    renderControls({ fabs: { search: true }, sidebarOpen: true });
    const stack = screen.getByTestId('map-fab-stack');
    expect(stack.className).toContain('left-[288px]');
    expect(stack.className).not.toContain('left-3');
  });

  it('does not shift when not compact even if the sidebar is open', () => {
    mockCompact.mockReturnValue(false);
    renderControls({ fabs: { search: true }, sidebarOpen: true });
    const stack = screen.getByTestId('map-fab-stack');
    expect(stack.className).toContain('left-3');
    expect(stack.className).not.toContain('left-[288px]');
  });

  it('does not shift when compact but the sidebar is closed', () => {
    mockCompact.mockReturnValue(true);
    renderControls({ fabs: { search: true }, sidebarOpen: false });
    const stack = screen.getByTestId('map-fab-stack');
    expect(stack.className).toContain('left-3');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test -- mapControls`
Expected: FAIL (no `map-fab-stack` testid; no conditional class).

- [ ] **Step 3: Implement the conditional offset**

In `MapControls.tsx`, change the FAB container `<div>` (currently
`className="pointer-events-none absolute left-3 top-3 z-[1200] flex items-start gap-2"`) to:

```tsx
      <div
        data-testid="map-fab-stack"
        className={
          'pointer-events-none absolute top-3 z-[1200] flex items-start gap-2 transition-[left] duration-200 ' +
          (compact && sidebarOpen ? 'left-[288px]' : 'left-3')
        }
      >
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run test -- mapControls`
Expected: PASS.

---

## Task 5: Full verification

- [ ] **Step 1: Frontend suite**

Run: `cd frontend && npm run test`
Expected: all pass (including i18n parity and the updated mapControls tests).

- [ ] **Step 2: Prettier + eslint + build**

Run:
```bash
cd frontend && npx prettier --check "src/map/controls/MapControls.tsx" "src/map/MapSurface.tsx" "src/components/MapView.tsx" "src/components/ConversationPane.tsx" "src/components/AppShell.tsx" "src/test/map/mapControls.test.tsx" "src/i18n/locales/en.json" "src/i18n/locales/nl.json" "src/i18n/locales/de.json"
cd frontend && npx eslint src/map/controls/MapControls.tsx src/components/ConversationPane.tsx src/components/AppShell.tsx src/components/MapView.tsx src/map/MapSurface.tsx
cd frontend && npm run build
```
Expected: prettier clean (fix only these files if needed with `--write`), eslint clean, build succeeds.

- [ ] **Step 2: Runtime observation (required before claiming done)**

Rebuild the observation image and run it on a spare port against the copy DB (as in Spec 2; do NOT touch the shared instance). Then observe in the browser:

Desktop viewport:
1. The map shows 6 FABs: Display, Filters, Overlays, Search, and the two toggles (2D/3D, buildings).
2. Opening Display shows Basemap + Node size + Legend sections; the Legend section still offers Pin, and pinning works.
3. Opening Filters shows Time range + Heard + External sections; Overlays shows Packets + Links (mode + confidence still work).

Mobile viewport (resize to mobile):
4. With the sidebar drawer closed, FABs sit at the left edge.
5. Opening the sidebar drawer shifts the FAB column right so it is fully visible beside the drawer; closing restores it.

Record what was actually observed (screenshots / explicit description). Debug any failure before marking done.

---

## Self-review notes (author)

- Spec coverage: grouping into Display/Filters/Overlays + standalone Search + toggles (Task 3); legend folded with pin preserved in-section (Task 3 Step 3b/3c); empty-group suppression (Task 3 test + filter); mobile shift compact-gated at left-[288px] with transition (Task 4); sidebarOpen threaded AppShell->...->MapControls (Task 2); i18n EN/NL/DE (Task 1); verification incl. runtime (Task 5).
- Type consistency: `Section` type and `sectionById` defined and consumed in Task 3; `sidebarOpen` prop name identical across all five components (Task 2); `map-fab-stack` testid used by Task 4 tests and container.
- Risk: Task 3 moves large existing body JSX into `sectionById` entries; the bodies themselves are copied unchanged, only their assignment site moves. The Spec 2 link-panel tests must be repointed from the `Links` FAB to the `Overlays` FAB (Task 3 Step 1 note).
