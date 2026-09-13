/**
 * MeshHealthView.tsx
 *
 * Mesh Health page shell. Owns the page header, the Adverts/Requests pill, the
 * shared time-window selector, and the refresh control, and renders the active
 * panel:
 *  - MeshAdvertsPanel: advert-frequency health (the original page).
 *  - MeshRequestsPanel: single-node REQUEST/RESPONSE traffic view.
 */

import { useCallback, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import type { RadioConfig } from '../types';
import { useT } from '../i18n';
import { TIME_WINDOWS, DEFAULT_WINDOW, type TimeWindow } from './meshHealthShared';
import { MeshAdvertsPanel } from './MeshAdvertsPanel';
import { MeshRequestsPanel } from './MeshRequestsPanel';

type MeshHealthTab = 'adverts' | 'requests';

interface Props {
  config: RadioConfig | null;
  onNavigateToMap?: (focusKey?: string) => void;
  /** Public key to scroll to and highlight when the Adverts view loads */
  focusKey?: string;
}

export function MeshHealthView({ config, onNavigateToMap, focusKey }: Props) {
  const t = useT();
  const [selectedWindow, setSelectedWindow] = useState<TimeWindow>(DEFAULT_WINDOW);
  const [activeTab, setActiveTab] = useState<MeshHealthTab>('adverts');
  const [refreshKey, setRefreshKey] = useState(0);
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
          {/* Time window selector (shared across tabs) */}
          <div className="flex gap-1">
            {TIME_WINDOWS.map((w) => (
              <button
                key={w.key}
                onClick={() => setSelectedWindow(w)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  selectedWindow.key === w.key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>

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
