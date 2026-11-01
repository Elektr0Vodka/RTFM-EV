import { useState } from 'react';

import { useT } from '../i18n';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { WardriveDriversPanel, type ViewAsChoice } from './WardriveDriversPanel';
import { WardriveMapPage } from './WardriveMapPage';
import { WardriveReportsPage } from './WardriveReportsPage';

export type WardriveTab = 'map' | 'reports' | 'drivers';

const parseTab = (tab: string): WardriveTab =>
  tab === 'reports' || tab === 'drivers' ? tab : 'map';

/**
 * Tools > Wardrive (shown only when MESHCORE_WARDRIVE is on): the owner's
 * coverage map, the drives and reports, and the drivers (management, audit
 * log, view as), as three tabs. The tab is the conversation id, so it is in
 * the address (#wardrive, #wardrive/reports, #wardrive/drivers). Only the
 * open tab is mounted; "view as" outlives a tab switch.
 */
export function WardrivePage({ tab, onTab }: { tab: string; onTab: (tab: WardriveTab) => void }) {
  const t = useT();
  const current = parseTab(tab);
  const [viewAs, setViewAs] = useState<ViewAsChoice | null>(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-base font-semibold text-foreground">{t('nav_wardrive')}</h2>
        <Tabs value={current} onValueChange={(v) => onTab(parseTab(v))}>
          <TabsList>
            <TabsTrigger value="map">{t('wardrive_tab_map')}</TabsTrigger>
            <TabsTrigger value="reports">{t('wardrive_tab_reports')}</TabsTrigger>
            <TabsTrigger value="drivers">{t('wardrive_tab_drivers')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1">
        {current === 'map' && <WardriveMapPage viewAs={viewAs} onViewAs={setViewAs} />}
        {current === 'reports' && <WardriveReportsPage />}
        {current === 'drivers' && (
          <div className="h-full overflow-y-auto">
            <WardriveDriversPanel
              onViewAs={(v) => {
                setViewAs(v);
                onTab('map');
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
