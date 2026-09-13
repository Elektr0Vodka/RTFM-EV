/**
 * MeshHealthView.tsx
 *
 * Mesh Health page shell. Owns the page header, the Adverts/Requests pill, the
 * shared time-window selector, and the refresh control, and renders the active
 * panel:
 *  - MeshAdvertsPanel: advert-frequency health (the original page).
 *  - MeshRequestsPanel: single-node REQUEST/RESPONSE traffic view.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import type { RadioConfig } from '../types';
import { useT } from '../i18n';
import { type TimeWindow } from './meshHealthShared';
import { TimeRangeSelector } from './TimeRangeSelector';
import { BASE_TIME_RANGES, type TimeRange } from '../utils/timeRanges';
import { loadStoredTimeRange, saveStoredTimeRange } from '../utils/timeRangePreference';
import { MeshAdvertsPanel } from './MeshAdvertsPanel';
import { MeshRequestsPanel } from './MeshRequestsPanel';

type MeshHealthTab = 'adverts' | 'requests';

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
  onNavigateToMap?: (focusKey?: string) => void;
  /** Public key to scroll to and highlight when the Adverts view loads */
  focusKey?: string;
}

export function MeshHealthView({ config, onNavigateToMap, focusKey }: Props) {
  const t = useT();
  const [selectedWindowId, setSelectedWindowId] = useState<string>(
    () => loadStoredTimeRange(MESH_HEALTH_WINDOW_KEY, DEFAULT_MESH_HEALTH_ID).id
  );
  const selectedWindow = useMemo(() => windowFromId(selectedWindowId), [selectedWindowId]);
  const [activeTab, setActiveTab] = useState<MeshHealthTab>('adverts');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    saveStoredTimeRange(MESH_HEALTH_WINDOW_KEY, {
      id: selectedWindowId,
      customStart: '',
      customEnd: '',
    });
  }, [selectedWindowId]);
  const [loading, setLoading] = useState(false);

  // Panels report their own loading so the shared refresh spinner reflects it.
  const handleLoadingChange = useCallback((l: boolean) => setLoading(l), []);

  const tabs: { key: MeshHealthTab; label: string }[] = [
    { key: 'adverts', label: t('mesh_health_tab_adverts') },
    { key: 'requests', label: t('mesh_health_tab_requests') },
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

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-4 p-4">
          {/* Unified time-range selector (shared across tabs) */}
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

          {activeTab === 'adverts' ? (
            <MeshAdvertsPanel
              config={config}
              selectedWindow={selectedWindow}
              refreshKey={refreshKey}
              onNavigateToMap={onNavigateToMap}
              focusKey={focusKey}
              onLoadingChange={handleLoadingChange}
            />
          ) : (
            <MeshRequestsPanel
              selectedWindow={selectedWindow}
              refreshKey={refreshKey}
              onLoadingChange={handleLoadingChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
