import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Layers, Search, Building2, Rotate3d, Filter, Activity, Pin, X } from 'lucide-react';
import { useT } from '../../i18n';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet';
import { useIsCompactMap, useIsMobile } from './breakpoints';
import { MapLegend } from './legend/MapLegend';
import { NODE_ROLE_TYPES, DEFAULT_NODE_ROLE_COLORS } from '../layers/nodeRoleColors';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../../types';

export interface FabConfig {
  layers?: boolean;
  legend?: boolean;
  search?: boolean;
  tilt?: boolean;
  buildings?: boolean;
  nodeSize?: boolean;
  links?: boolean;
}

export interface BasemapOption {
  id: string;
  label: string; // i18n key or literal
}

export interface ExtraFab {
  id: string;
  label: string; // already-resolved label
  icon: ReactNode;
  panel: ReactNode;
}

export interface MapControlsProps {
  fabs: FabConfig;
  basemaps?: BasemapOption[];
  selectedBasemapId?: string;
  onSelectBasemap?: (id: string) => void;
  tilt3D?: boolean;
  onToggleTilt?: (on: boolean) => void;
  buildings?: boolean;
  onToggleBuildings?: (on: boolean) => void;
  nodeScale?: number;
  onNodeScale?: (v: number) => void;
  roleColors?: Record<number, string>;
  onRoleColorChange?: (type: number, color: string) => void;
  onResetRoleColors?: () => void;
  linksOn?: boolean;
  onToggleLinks?: (on: boolean) => void;
  linkMode?: 'liveness' | 'advert';
  onLinkMode?: (mode: 'liveness' | 'advert') => void;
  linkConfidence?: 1 | 2 | 3;
  onLinkConfidence?: (level: 1 | 2 | 3) => void;
  sidebarOpen?: boolean;
  onSearch?: (query: string) => void;
  legendContent?: ReactNode;
  extraFabs?: ExtraFab[];
}

const FAB_CLASS =
  'relative flex h-11 w-11 items-center justify-center rounded-full border border-border ' +
  'bg-card text-card-foreground shadow-lg transition-colors hover:border-foreground/40 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

interface PanelDef {
  id: string;
  label: string;
  icon: ReactNode;
  body: ReactNode;
}

/** A floating, draggable copy of a panel body that stays on screen until
 *  closed. Dragged by its header; clamped to the map (its offset parent). */
function PinnedPanel({
  title,
  dragHint,
  closeLabel,
  initial,
  onClose,
  children,
}: {
  title: string;
  dragHint: string;
  closeLabel: string;
  initial: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState(initial);

  const onPointerDown = (e: ReactPointerEvent) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    grab.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const card = cardRef.current;
    const parent = card?.offsetParent as HTMLElement | null;
    if (!grab.current || !card || !parent) return;
    const pr = parent.getBoundingClientRect();
    const x = Math.max(
      0,
      Math.min(e.clientX - pr.left - grab.current.dx, pr.width - card.offsetWidth)
    );
    const y = Math.max(
      0,
      Math.min(e.clientY - pr.top - grab.current.dy, pr.height - card.offsetHeight)
    );
    setPos({ x, y });
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    grab.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      ref={cardRef}
      className="pointer-events-auto absolute z-[1300] w-56 rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex cursor-move touch-none select-none items-center justify-between gap-2 border-b border-border px-3 py-2"
        title={dragHint}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="text-sm font-semibold">{title}</span>
        <button
          type="button"
          aria-label={closeLabel}
          title={closeLabel}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="max-h-[50vh] overflow-y-auto p-3">{children}</div>
    </div>
  );
}

export function MapControls(props: MapControlsProps) {
  const t = useT();
  const compact = useIsCompactMap();
  // The sidebar overlays the FABs only below md (768px), where the persistent
  // sidebar is hidden and a drawer is used. Tablets/touch laptops keep the
  // persistent sidebar, so the shift is gated on mobile, not the compact map.
  const isMobile = useIsMobile();
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [legendPinned, setLegendPinned] = useState(false);

  const {
    fabs,
    basemaps = [],
    selectedBasemapId,
    onSelectBasemap,
    tilt3D = false,
    onToggleTilt,
    buildings = false,
    onToggleBuildings,
    nodeScale = 1,
    onNodeScale,
    roleColors = DEFAULT_NODE_ROLE_COLORS,
    onRoleColorChange,
    onResetRoleColors,
    linksOn = false,
    onToggleLinks,
    linkMode = 'liveness',
    onLinkMode,
    linkConfidence = 2,
    onLinkConfidence,
    sidebarOpen = false,
    onSearch,
    legendContent,
    extraFabs = [],
  } = props;

  const [searchValue, setSearchValue] = useState('');

  const roleLabel: Record<number, string> = {
    [CONTACT_TYPE_CLIENT]: t('map_type_client'),
    [CONTACT_TYPE_REPEATER]: t('map_type_repeater'),
    [CONTACT_TYPE_ROOM]: t('map_type_room'),
    [CONTACT_TYPE_SENSOR]: t('map_type_sensor'),
  };

  const legendBody = legendContent ?? <MapLegend roleColors={roleColors} />;

  // Each control's panel body, keyed by control id. Built-in bodies are defined
  // here; the MapView-supplied extra panels are folded in by id below. Group FABs
  // then stack their member sections into one panel.
  type Section = { id: string; title: string; body: ReactNode };
  const sectionById: Record<string, Section> = {};

  if (fabs.layers) {
    sectionById.layers = {
      id: 'layers',
      title: t('map_basemap_label'),
      body: (
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
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('map_node_size_label')}
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.1}
              value={nodeScale}
              aria-label={t('map_node_size_label')}
              onChange={(e) => onNodeScale?.(Number(e.target.value))}
            />
          </label>
          {onRoleColorChange && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('map_node_colors_label')}
                </span>
                {onResetRoleColors && (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={onResetRoleColors}
                  >
                    {t('map_node_colors_reset')}
                  </button>
                )}
              </div>
              {NODE_ROLE_TYPES.map((type) => (
                <label
                  key={type}
                  className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                >
                  <span>{roleLabel[type]}</span>
                  <input
                    type="color"
                    className="h-6 w-9 cursor-pointer rounded border border-border bg-transparent p-0"
                    value={roleColors[type] ?? DEFAULT_NODE_ROLE_COLORS[type]}
                    aria-label={t('map_node_color_for', { role: roleLabel[type] })}
                    onChange={(e) => onRoleColorChange(type, e.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
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
    const confidenceOptions: { level: 1 | 2 | 3; label: string }[] = [
      { level: 1, label: t('map_links_confidence_low') },
      { level: 2, label: t('map_links_confidence_medium') },
      { level: 3, label: t('map_links_confidence_high') },
    ];
    sectionById.links = {
      id: 'links',
      title: t('map_links_label'),
      body: (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={linksOn}
              onChange={(e) => onToggleLinks?.(e.target.checked)}
            />
            {t('map_links_enable')}
          </label>
          <div
            role="radiogroup"
            aria-label={t('map_links_mode_label')}
            className="flex flex-col gap-1"
          >
            <span className="text-xs font-medium text-muted-foreground">
              {t('map_links_mode_label')}
            </span>
            {(['liveness', 'advert'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={linkMode === mode}
                className={
                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ' +
                  (linkMode === mode ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')
                }
                onClick={() => onLinkMode?.(mode)}
              >
                {mode === 'liveness' ? t('map_links_mode_liveness') : t('map_links_mode_advert')}
              </button>
            ))}
          </div>
          {linkMode === 'advert' && (
            <div
              role="radiogroup"
              aria-label={t('map_links_confidence_label')}
              className="flex flex-col gap-1"
            >
              <span className="text-xs font-medium text-muted-foreground">
                {t('map_links_confidence_label')}
              </span>
              {confidenceOptions.map((opt) => (
                <button
                  key={opt.level}
                  type="button"
                  role="radio"
                  aria-checked={linkConfidence === opt.level}
                  className={
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ' +
                    (linkConfidence === opt.level
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50')
                  }
                  onClick={() => onLinkConfidence?.(opt.level)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ),
    };
  }

  // Fold the MapView-supplied extra panels (since, packets, heard, external) in by id.
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

  // Direct-toggle FABs (no panel).
  const toggles: {
    id: string;
    label: string;
    icon: ReactNode;
    active: boolean;
    onClick: () => void;
  }[] = [];
  if (fabs.tilt) {
    toggles.push({
      id: 'tilt',
      label: tilt3D ? t('map_3d') : t('map_2d'),
      icon: <Rotate3d size={20} aria-hidden />,
      active: tilt3D,
      onClick: () => onToggleTilt?.(!tilt3D),
    });
  }
  if (fabs.buildings) {
    toggles.push({
      id: 'buildings',
      label: t('map_buildings_label'),
      icon: <Building2 size={20} aria-hidden />,
      active: buildings,
      onClick: () => onToggleBuildings?.(!buildings),
    });
  }

  const activePanel = panels.find((p) => p.id === openPanel) ?? null;

  return (
    <>
      <div
        data-testid="map-fab-stack"
        className={
          'pointer-events-none absolute top-3 z-[1200] flex items-start gap-2 transition-[left] duration-200 ' +
          (isMobile && sidebarOpen ? 'left-[288px]' : 'left-3')
        }
      >
        <div className="pointer-events-auto flex flex-col gap-2.5">
          {panels.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.label}
              aria-label={p.label}
              aria-pressed={openPanel === p.id}
              className={FAB_CLASS + (openPanel === p.id ? ' border-primary' : '')}
              onClick={() => setOpenPanel((cur) => (cur === p.id ? null : p.id))}
            >
              {p.icon}
            </button>
          ))}
          {toggles.map((tg) => (
            <button
              key={tg.id}
              type="button"
              title={tg.label}
              aria-label={tg.label}
              aria-pressed={tg.active}
              className={FAB_CLASS + (tg.active ? ' border-primary text-primary' : '')}
              onClick={tg.onClick}
            >
              {tg.icon}
            </button>
          ))}
        </div>

        {/* Desktop: anchored panel beside the stack. */}
        {!compact && activePanel && (
          <div className="pointer-events-auto max-h-[70vh] w-56 overflow-y-auto rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{activePanel.label}</span>
            </div>
            {activePanel.body}
          </div>
        )}
      </div>

      {/* Compact: bottom sheet host. */}
      {compact && (
        <Sheet open={activePanel != null} onOpenChange={(o) => !o && setOpenPanel(null)}>
          <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>{activePanel?.label ?? t('map_controls_title')}</SheetTitle>
              <SheetDescription className="sr-only">{t('map_controls_title')}</SheetDescription>
            </SheetHeader>
            <div className="pt-2">{activePanel?.body}</div>
          </SheetContent>
        </Sheet>
      )}

      {/* Legend pinned to the map, draggable, until dismissed. */}
      {legendPinned && (
        <PinnedPanel
          title={t('map_legend')}
          dragHint={t('map_legend_drag_hint')}
          closeLabel={t('map_legend_unpin')}
          initial={{ x: 64, y: 8 }}
          onClose={() => setLegendPinned(false)}
        >
          {legendBody}
        </PinnedPanel>
      )}
    </>
  );
}
