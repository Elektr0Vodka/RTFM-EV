import { useT } from '../i18n';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { WardriveMapPage } from './WardriveMapPage';
import { WardriveReportsPage } from './WardriveReportsPage';

export type WardriveTab = 'map' | 'reports';

/**
 * Tools > Wardrive (shown only when MESHCORE_WARDRIVE is on): the owner's map
 * of everything the drivers stored and the drives and reports, as two tabs.
 * The tab is the conversation id, so it is in the address (#wardrive,
 * #wardrive/reports). Only the open tab is mounted.
 */
export function WardrivePage({ tab, onTab }: { tab: string; onTab: (tab: WardriveTab) => void }) {
  const t = useT();
  const current: WardriveTab = tab === 'reports' ? 'reports' : 'map';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-base font-semibold text-foreground">{t('nav_wardrive')}</h2>
        <Tabs value={current} onValueChange={(v) => onTab(v === 'reports' ? 'reports' : 'map')}>
          <TabsList>
            <TabsTrigger value="map">{t('wardrive_tab_map')}</TabsTrigger>
            <TabsTrigger value="reports">{t('wardrive_tab_reports')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1">
        {current === 'map' ? <WardriveMapPage /> : <WardriveReportsPage />}
      </div>
    </div>
  );
}
