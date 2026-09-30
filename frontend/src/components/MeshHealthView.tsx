/**
 * MeshHealthView.tsx
 *
 * Mesh Health page shell. Owns the page header, the Adverts/Requests pill, the
 * shared time-window selector, and the refresh control, and renders the active
 * panel:
 *  - MeshAdvertsPanel: advert-frequency health (the original page).
 *  - MeshRequestsPanel: single-node REQUEST/RESPONSE traffic view.
 *  - MeshPowerOutagePanel: which nodes stay online in a power outage. Also gets
 *    a floating go-to-top button over the scroll area, since its table is long.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronsUp, RefreshCw } from 'lucide-react';
import type { Contact, RadioConfig } from '../types';
import { useT } from '../i18n';
import { type TimeWindow } from './meshHealthShared';
import { TimeRangeSelector } from './TimeRangeSelector';
import { BASE_TIME_RANGES, type TimeRange } from '../utils/timeRanges';
import { loadStoredTimeRange, saveStoredTimeRange } from '../utils/timeRangePreference';
import type { AppSettingsUpdate } from '../types';
import { MeshAdvertsPanel } from './MeshAdvertsPanel';
import { MeshRequestsPanel } from './MeshRequestsPanel';
import { MeshPrefixCollisionsPanel } from './MeshPrefixCollisionsPanel';
import { MeshRelayReceptionPanel } from './MeshRelayReceptionPanel';
import { MeshPowerOutagePanel } from './MeshPowerOutagePanel';

type MeshHealthTab =
  | 'adverts'
  | 'requests'
  | 'relay-reception'
  | 'prefix-collisions'
  | 'power-outage';

// Mesh Health keeps 30m as a shorter extra and adopts the shared base set. The
// panels fetch now-relative ranges from selectedWindow.hours, so a From/To
// custom range is not offered here (showCustom disabled). 30m/1h auto-refresh.
const MESH_HEALTH_EXTRAS_BEFORE: TimeRange[] = [
  { id: '30m', labelKey: 'time_range_30m', seconds: 30 * 60 },
];
const MESH_HEALTH_RANGES: TimeRange[] = [...MESH_HEALTH_EXTRAS_BEFORE, ...BASE_TIME_RANGES];
const AUTO_REFRESH_IDS = new Set(['30m', '1h']);
const DEFAULT_MESH_HEALTH_ID = '30m';
const MESH_HEALTH_WINDOW_KEY = 'rtfm-meshhealth-window';
const MESH_HEALTH_TAB_KEY = 'rtfm-meshhealth-tab';
/** Scroll distance (px) after which the go-to-top button appears. */
const SCROLL_TOP_THRESHOLD = 300;

// Persist the Adverts/Requests sub-tab so a page refresh stays on the same panel
// instead of snapping back to Adverts.
function loadStoredTab(): MeshHealthTab {
  try {
    const v = localStorage.getItem(MESH_HEALTH_TAB_KEY);
    if (
      v === 'requests' ||
      v === 'relay-reception' ||
      v === 'prefix-collisions' ||
      v === 'power-outage'
    )
      return v;
    return 'adverts';
  } catch {
    return 'adverts';
  }
}

// Build the shared TimeWindow shape (consumed by the panels) from a range id.
function windowFromId(id: string): TimeWindow {
  const r = MESH_HEALTH_RANGES.find((x) => x.id === id) ?? MESH_HEALTH_RANGES[0];
  return {
    key: r.id,
    label: r.id,
    hours: (r.seconds ?? 0) / 3600,
    autoRefresh: AUTO_REFRESH_IDS.has(r.id),
  };
}

interface Props {
  config: RadioConfig | null;
  /** All known contacts (the Power Outage tab classifies them by name). */
  contacts?: Contact[];
  onNavigateToMap?: (focusKey?: string) => void;
  /** Opens a node's detail page (contact conversation) by public key. */
  onOpenNode?: (publicKey: string, name: string | null) => void;
  /** Public key to scroll to and highlight when the Adverts view loads */
  focusKey?: string;
  /** Server-persisted page size for the Adverts contacts table; 0 = show all. */
  pageSize?: number;
  onSaveAppSettings?: (update: AppSettingsUpdate) => Promise<void> | void;
}

export function MeshHealthView({
  config,
  contacts = [],
  onNavigateToMap,
  onOpenNode,
  focusKey,
  pageSize = 50,
  onSaveAppSettings,
}: Props) {
  const t = useT();
  const [selectedWindowId, setSelectedWindowId] = useState<string>(
    () => loadStoredTimeRange(MESH_HEALTH_WINDOW_KEY, DEFAULT_MESH_HEALTH_ID).id
  );
  const selectedWindow = useMemo(() => windowFromId(selectedWindowId), [selectedWindowId]);
  // A focus target always belongs to the Adverts panel, so honor it over the
  // stored tab; otherwise restore the last-used tab.
  const [activeTab, setActiveTab] = useState<MeshHealthTab>(() =>
    focusKey ? 'adverts' : loadStoredTab()
  );
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    saveStoredTimeRange(MESH_HEALTH_WINDOW_KEY, {
      id: selectedWindowId,
      customStart: '',
      customEnd: '',
    });
  }, [selectedWindowId]);

  useEffect(() => {
    try {
      localStorage.setItem(MESH_HEALTH_TAB_KEY, activeTab);
    } catch {
      /* ignore unavailable storage */
    }
  }, [activeTab]);
  const [loading, setLoading] = useState(false);

  // Panels report their own loading so the shared refresh spinner reflects it.
  const handleLoadingChange = useCallback((l: boolean) => setLoading(l), []);

  // Go-to-top button for the Power Outage tab: shown once the scroll area has
  // moved past the threshold.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledDown, setScrolledDown] = useState(false);
  const showScrollTop = activeTab === 'power-outage' && scrolledDown;
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScrolledDown(el.scrollTop > SCROLL_TOP_THRESHOLD);
  }, []);

  const tabs: { key: MeshHealthTab; label: string }[] = [
    { key: 'adverts', label: t('mesh_health_tab_adverts') },
    { key: 'requests', label: t('mesh_health_tab_requests') },
    { key: 'relay-reception', label: t('mesh_health_tab_relay_reception') },
    { key: 'prefix-collisions', label: t('mesh_health_tab_prefix_collisions') },
    { key: 'power-outage', label: t('mesh_health_tab_power_outage') },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden mesh-health">
      {/* Page header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold text-base">{t('mesh_health_page_title')}</h2>
          </div>
          {/* Adverts / Requests pill */}
          <div className="flex gap-1 rounded-md bg-muted p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedWindow.autoRefresh ? (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              {t('mesh_health_auto_refresh_label')}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              {t('mesh_health_manual_refresh_label')}
            </span>
          )}
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('repeater_refresh')}
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-4 p-4">
            {/* Unified time-range selector (shared by the window-scoped tabs). The
              prefix-collisions tab is point-in-time and power-outage has its
              own heard-within selector, so it is hidden there. */}
            {activeTab !== 'prefix-collisions' && activeTab !== 'power-outage' && (
              <TimeRangeSelector
                value={selectedWindowId}
                onChange={setSelectedWindowId}
                extrasBefore={MESH_HEALTH_EXTRAS_BEFORE}
                showCustom={false}
                customStart=""
                customEnd=""
                onCustomStartChange={() => {}}
                onCustomEndChange={() => {}}
                onApplyCustom={() => {}}
              />
            )}

            {activeTab === 'adverts' && (
              <MeshAdvertsPanel
                config={config}
                selectedWindow={selectedWindow}
                refreshKey={refreshKey}
                onNavigateToMap={onNavigateToMap}
                onOpenNode={onOpenNode}
                focusKey={focusKey}
                onLoadingChange={handleLoadingChange}
                pageSize={pageSize}
                onSaveAppSettings={onSaveAppSettings}
              />
            )}
            {activeTab === 'requests' && (
              <MeshRequestsPanel
                selectedWindow={selectedWindow}
                refreshKey={refreshKey}
                onLoadingChange={handleLoadingChange}
              />
            )}
            {activeTab === 'relay-reception' && (
              <MeshRelayReceptionPanel
                selectedWindow={selectedWindow}
                refreshKey={refreshKey}
                onLoadingChange={handleLoadingChange}
                onOpenNode={onOpenNode}
              />
            )}
            {activeTab === 'prefix-collisions' && (
              <MeshPrefixCollisionsPanel
                refreshKey={refreshKey}
                onLoadingChange={handleLoadingChange}
                onOpenNode={onOpenNode}
              />
            )}
            {activeTab === 'power-outage' && (
              <MeshPowerOutagePanel
                contacts={contacts}
                refreshKey={refreshKey}
                onLoadingChange={handleLoadingChange}
                onOpenNode={onOpenNode}
                onNavigateToMap={onNavigateToMap}
                pageSize={pageSize}
                onSaveAppSettings={onSaveAppSettings}
              />
            )}
          </div>
        </div>
        {showScrollTop && (
          <button
            type="button"
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
            title={t('mesh_health_scroll_top')}
            aria-label={t('mesh_health_scroll_top')}
            className="absolute bottom-4 right-4 rounded-full border border-border bg-card/90 p-2 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronsUp className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
