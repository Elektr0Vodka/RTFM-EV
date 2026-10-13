import { useEffect, useRef } from 'react';

import { toast } from '../components/ui/sonner';
import { useT } from '../i18n';
import type { AppInfo } from '../types';
import { appReload } from '../utils/appReload';

function buildOf(appInfo: AppInfo): string {
  return `${appInfo.version}|${appInfo.commit_hash ?? ''}`;
}

/**
 * Offer a reload when the server turns out to run another build than the one
 * this page was loaded from. An installed app can stay open for days, on a
 * phone it has no reload button, and until it is loaded again it keeps running
 * the old frontend against the new backend.
 *
 * The build the page came from is taken to be the first one the server
 * reports; the offer is made once.
 */
export function useReloadAfterUpdate(appInfo: AppInfo | null | undefined): void {
  const t = useT();
  const loadedBuildRef = useRef<string | null>(null);
  const offeredRef = useRef(false);

  useEffect(() => {
    if (!appInfo) return;
    const build = buildOf(appInfo);
    if (loadedBuildRef.current === null) {
      loadedBuildRef.current = build;
      return;
    }
    if (build === loadedBuildRef.current || offeredRef.current) return;
    offeredRef.current = true;
    toast.info(t('toast_app_updated_title'), {
      description: t('toast_app_updated_body'),
      duration: Infinity,
      action: { label: t('toast_app_updated_reload'), onClick: () => appReload.now() },
    });
  }, [appInfo, t]);
}
