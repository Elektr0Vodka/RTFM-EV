import { useState, type ReactNode } from 'react';
import { Layers, Info, Search, Building2, Rotate3d, CircleDot, Spline } from 'lucide-react';
import { useT } from '../../i18n';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../../components/ui/sheet';
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

export function MapControls(props: MapControlsProps) {
  const t = useT();
  const compact = useIsCompactMap();
  const [openPanel, setOpenPanel] = useState<string | null>(null);

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
      body: legendContent ?? <MapLegend />,
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
  const toggles: { id: string; label: string; icon: ReactNode; active: boolean; onClick: () => void }[] = [];
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
    <div className="pointer-events-none absolute left-3 top-3 z-[1200] flex items-start gap-2">
      <div className="pointer-events-auto flex flex-col gap-2.5">
        {panels.map((p) => (
          <button
            key={p.id}
            type="button"
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
          <div className="mb-2 text-sm font-semibold">{activePanel.label}</div>
          {activePanel.body}
        </div>
      )}

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
    </div>
  );
}
