// The driver's coverage map, full screen over the drive screen: what their
// visibility lets them see. Driving goes on underneath (capture, upload and
// forwarding do not live in the map). The map loads when opened, so a drive
// does not load the coverage data.
import { X } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo } from 'react';

import { useT } from '../../i18n';
import { driverCoverageApi } from './driverApi';
import { searchUrlState } from './urlState';

const CoverageMap = lazy(() => import('./CoverageMap').then((m) => ({ default: m.CoverageMap })));

export function CoverageScreen({
  onClose,
  exaggeration,
}: {
  onClose(): void;
  exaggeration?: number;
}) {
  const t = useT();
  const urlState = useMemo(() => searchUrlState(), []);
  useEffect(() => () => urlState.clear(), [urlState]);
  return (
    <div
      className="cov-map fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      role="region"
      aria-label={t('wardrive_cov_map_aria')}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">{t('wardrive_cov_map_aria')}</h2>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-sm hover:bg-muted"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
          {t('wardrive_cov_close_map')}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <p className="p-3 text-sm text-muted-foreground">{t('wardrive_cov_loading')}</p>
          }
        >
          <CoverageMap
            api={driverCoverageApi}
            urlState={urlState}
            storeKey="rtfm-wardrive-page-coverage"
            exaggeration={exaggeration}
          />
        </Suspense>
      </div>
    </div>
  );
}
