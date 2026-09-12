import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Layers, Info, Search, Building2, Rotate3d, CircleDot, Spline, Pin, X } from 'lucide-react';
import { useT } from '../../i18n';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet';
import { useIsCompactMap } from './breakpoints';
import { MapLegend } from './legend/MapLegend';

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
  linksOn?: boolean;
  onToggleLinks?: (on: boolean) => void;
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
    linksOn = false,
    onToggleLinks,
    onSearch,
    legendContent,
    extraFabs = [],
  } = props;

  const [searchValue, setSearchValue] = useState('');

  const legendBody = legendContent ?? <MapLegend />;

  const panels: PanelDef[] = [];
  if (fabs.layers) {
    panels.push({
      id: 'layers',
      label: t('map_layers'),
      icon: <Layers size={20} aria-hidden />,
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
    });
  }
  if (fabs.legend) {
    panels.push({
      id: 'legend',
      label: t('map_legend'),
      icon: <Info size={20} aria-hidden />,
      body: legendBody,
    });
  }
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
  if (fabs.nodeSize) {
    panels.push({
      id: 'nodeSize',
      label: t('map_node_size_label'),
      icon: <CircleDot size={20} aria-hidden />,
      body: (
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
      ),
    });
  }
  for (const ex of extraFabs) {
    panels.push({ id: ex.id, label: ex.label, icon: ex.icon, body: ex.panel });
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
  if (fabs.links) {
    toggles.push({
      id: 'links',
      label: t('map_links_label'),
      icon: <Spline size={20} aria-hidden />,
      active: linksOn,
      onClick: () => onToggleLinks?.(!linksOn),
    });
  }

  const activePanel = panels.find((p) => p.id === openPanel) ?? null;

  return (
    <>
      <div className="pointer-events-none absolute left-3 top-3 z-[1200] flex items-start gap-2">
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
          <div className="pointer-events-auto w-56 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{activePanel.label}</span>
              {activePanel.id === 'legend' && !legendPinned && (
                <button
                  type="button"
                  title={t('map_legend_pin')}
                  aria-label={t('map_legend_pin')}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  onClick={() => {
                    setLegendPinned(true);
                    setOpenPanel(null);
                  }}
                >
                  <Pin size={16} aria-hidden />
                </button>
              )}
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
            {activePanel?.id === 'legend' && !legendPinned && (
              <button
                type="button"
                className="mt-2 flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                onClick={() => {
                  setLegendPinned(true);
                  setOpenPanel(null);
                }}
              >
                <Pin size={14} aria-hidden />
                {t('map_legend_pin')}
              </button>
            )}
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
