import { useState } from 'react';

import type { Contact } from '../types';
import { cn } from '@/lib/utils';
import { useT } from '../i18n';
import { PacketFeedStatsPanel } from './PacketFeedStatsPanel';
import { MeshTrendsHistoricalPanel } from './MeshTrendsHistoricalPanel';

type MeshTrendsTab = 'live' | 'historical';

const TAB_STORAGE_KEY = 'rtfm-mesh-trends-tab';

function loadStoredTab(): MeshTrendsTab {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === 'live' ? 'live' : 'historical';
  } catch {
    return 'historical';
  }
}

function saveStoredTab(tab: MeshTrendsTab): void {
  try {
    localStorage.setItem(TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore storage write failures (private mode, disabled storage).
  }
}

export function MeshTrendsView({ contacts }: { contacts: Contact[] }) {
  const t = useT();
  const [tab, setTab] = useState<MeshTrendsTab>(loadStoredTab);

  const selectTab = (next: MeshTrendsTab) => {
    setTab(next);
    saveStoredTab(next);
  };

  const tabButtonClass = (active: boolean) =>
    cn(
      'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
      active
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground'
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 pt-2.5">
        <h2 className="font-semibold text-base text-foreground">{t('nav_mesh_trends')}</h2>
        <div className="mt-1.5 flex gap-1" role="tablist" aria-label={t('nav_mesh_trends')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'live'}
            className={tabButtonClass(tab === 'live')}
            onClick={() => selectTab('live')}
          >
            {t('mesh_trends_tab_live')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'historical'}
            className={tabButtonClass(tab === 'historical')}
            onClick={() => selectTab('historical')}
          >
            {t('mesh_trends_tab_historical')}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'live' ? (
          <PacketFeedStatsPanel contacts={contacts} />
        ) : (
          <MeshTrendsHistoricalPanel className="h-full overflow-y-auto p-4" />
        )}
      </div>
    </div>
  );
}
