import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { Button } from './ui/button';

export const HA_IMPORT_BANNER_KEY = 'rtfm.haImportBannerDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(HA_IMPORT_BANNER_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(HA_IMPORT_BANNER_KEY, '1');
  } catch {
    /* storage blocked: the banner comes back next time */
  }
}

/**
 * First start of the Home Assistant add-on: when our database is still empty
 * and RemoteTerm (installed or in a backup) is found, offer the import once.
 */
export function HaImportBanner({ haAddon, onOpen }: { haAddon: boolean; onOpen: () => void }) {
  const t = useT();
  const [dismissed, setDismissed] = useState(readDismissed);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!haAddon || dismissed) return;
    let cancelled = false;
    api.getHaImportStatus().then(
      (s) => {
        if (!cancelled)
          setShow(s.database_empty && (s.installed.length > 0 || s.backups.length > 0));
      },
      () => {
        /* no banner when the status cannot be read */
      }
    );
    return () => {
      cancelled = true;
    };
  }, [haAddon, dismissed]);

  if (!haAddon || dismissed || !show) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">{t('ha_import_banner_text')}</span>
      <Button type="button" size="sm" variant="secondary" onClick={onOpen}>
        {t('ha_import_banner_open')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          writeDismissed();
          setDismissed(true);
        }}
      >
        {t('ha_import_banner_dismiss')}
      </Button>
    </div>
  );
}
