// The page's Reports tab: a report over the drives picked in the Drives tab,
// or, with none picked, over the drives of a recent window (within what the
// driver's visibility shows). Share cards carry the default RTFM-EV brand:
// the page cannot read the owner's brand settings.
import { useState } from 'react';

import { useT } from '../../i18n';
import { loadCardBrand } from '../../share/brand';
import { ReportPanel } from '../reports/ReportPanel';
import { ReportShare } from '../reports/ReportShare';
import type { DrivesApi } from '../reports/types';

const WINDOW_DAYS = [7, 30, 365] as const;
const DEFAULT_DAYS = 30;
const DAY_S = 86400;

export function ReportsTab({ api, picked }: { api: DrivesApi; picked: number[] }) {
  const t = useT();
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const query = picked.length
    ? { drive: picked }
    : { since: Math.floor(Date.now() / 1000) - days * DAY_S };
  return (
    <div className="space-y-3">
      {picked.length ? (
        <p className="text-sm text-muted-foreground">
          {t('wardrive_page_report_picked', { count: picked.length })}
        </p>
      ) : (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-xs text-muted-foreground">{t('wardrive_page_report_window')}</span>
          <select
            aria-label={t('wardrive_page_report_window')}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {WINDOW_DAYS.map((d) => (
              <option key={d} value={d}>
                {t('wardrive_page_report_days', { count: d })}
              </option>
            ))}
          </select>
        </label>
      )}
      <ReportPanel
        api={api}
        query={query}
        reloadKey={picked.length ? picked.join(',') : `days:${days}`}
        cards={(report) => <ReportShare report={report} brand={() => loadCardBrand(null)} />}
      />
    </div>
  );
}
