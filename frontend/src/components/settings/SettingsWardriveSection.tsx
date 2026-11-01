import { useEffect, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { WardriveAdminStatus } from '../../types';
import { WardriveBrokersCard } from './WardriveBrokersCard';
import { WardriveCalibrationCard } from './WardriveCalibrationCard';
import { WardriveChannelsCard } from './WardriveChannelsCard';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wardrive plugin settings (shown only when MESHCORE_WARDRIVE is on): the page
 * address, a warning when the main login is off, and the module's
 * configuration (channels, brokers, calibration). Drivers, radios and groups
 * are managed in Tools > Wardrive, Drivers tab (WardriveDriversPanel); the
 * coverage map is its Map tab.
 */
export function SettingsWardriveSection({ className }: { className?: string }) {
  const t = useT();
  const [status, setStatus] = useState<WardriveAdminStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getWardriveAdminStatus().then(
      (next) => {
        if (!cancelled) setStatus(next);
      },
      (err) => {
        if (!cancelled) setError(errorMessage(err));
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const pageUrl = status ? `${window.location.origin}${status.page_path}` : null;

  return (
    <div className={className}>
      <div className="space-y-3" data-testid="wardrive-settings">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_wardrive_heading')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_wardrive_desc')}</p>

        {status?.unprotected && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          >
            {t('settings_wardrive_unprotected')}
          </div>
        )}

        {pageUrl && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
            <div className="text-sm font-medium">{t('settings_wardrive_page_label')}</div>
            <code className="block break-all text-xs">{pageUrl}</code>
            <p className="text-xs text-muted-foreground">{t('settings_wardrive_https_note')}</p>
          </div>
        )}

        {error && (
          <p className="text-xs text-destructive" role="status">
            {error}
          </p>
        )}

        <p className="text-xs text-muted-foreground">{t('settings_wardrive_drivers_moved')}</p>
        <p className="text-xs text-muted-foreground">{t('settings_wardrive_map_moved')}</p>

        <WardriveChannelsCard />
        <WardriveBrokersCard />
        <WardriveCalibrationCard />
      </div>
    </div>
  );
}
