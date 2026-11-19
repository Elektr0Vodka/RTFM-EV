import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { api } from '../../api';
import { formatTime } from '../../utils/messageParser';
import { useT } from '../../i18n';
import type { HaImportStatus } from '../../types';

/** Epoch seconds from an ISO date, or null when it does not parse. */
function isoSeconds(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Home Assistant add-on only: bring the database over from the RemoteTerm
 * add-on. The import goes through the normal restore staging and is applied
 * when the add-on restarts.
 */
export function HaImportSection({ onStaged }: { onStaged?: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<HaImportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getHaImportStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error_unknown'));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error_unknown'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const importBackup = async (backupSlug: string, addonSlug: string, name: string) => {
    if (!window.confirm(t('settings_ha_import_confirm', { name }))) return;
    if (await run(() => api.haImportFromBackup(backupSlug, addonSlug))) {
      setStaged(true);
      onStaged?.();
    }
  };

  const makeBackup = async (addonSlug: string) => {
    if (await run(() => api.haMakeBackup(addonSlug))) await refresh();
  };

  const installed = status?.installed ?? [];
  const backups = status?.backups ?? [];

  return (
    <div className="space-y-3" data-testid="ha-import">
      <div>
        <h4 className="text-sm font-semibold">{t('settings_ha_import_heading')}</h4>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_ha_import_desc')}</p>
      </div>

      {error && (
        <p className="text-sm text-destructive wrap-break-word" role="alert">
          {error}
        </p>
      )}

      {staged && (
        <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2">
          <p className="text-sm">{t('settings_ha_import_staged')}</p>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => api.haRestart())}
          >
            {t('settings_ha_import_restart')}
          </Button>
        </div>
      )}

      {installed.map((addon) => (
        <div key={addon.slug} className="flex items-center justify-between gap-3">
          <span className="text-sm min-w-0 truncate">
            {t('settings_ha_import_installed', { name: addon.name })}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void makeBackup(addon.slug)}
          >
            {t('settings_ha_import_make_backup')}
          </Button>
        </div>
      ))}

      {status && backups.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_ha_import_none')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {backups.map((b) => {
            const when = isoSeconds(b.created);
            return (
              <li
                key={`${b.backup_slug}-${b.addon_slug}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm truncate">{b.backup_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {b.addon_name}
                    {when !== null ? ` · ${formatTime(when)}` : ''}
                  </div>
                  {b.protected && (
                    <div className="text-xs text-warning">{t('settings_ha_import_encrypted')}</div>
                  )}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy || b.protected}
                  onClick={() => void importBackup(b.backup_slug, b.addon_slug, b.backup_name)}
                >
                  {t('settings_ha_import_import')}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
