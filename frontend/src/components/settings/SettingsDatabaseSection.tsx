import { useState, useEffect, useRef } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';
import { api } from '../../api';
import { formatTime } from '../../utils/messageParser';
import { useT } from '../../i18n';
import type { AppSettings, AppSettingsUpdate, HealthStatus } from '../../types';

export function SettingsDatabaseSection({
  appSettings,
  health,
  onSaveAppSettings,
  onHealthRefresh,
  className,
}: {
  appSettings: AppSettings;
  health: HealthStatus | null;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  onHealthRefresh: () => Promise<void>;
  className?: string;
}) {
  const t = useT();
  const [retentionDays, setRetentionDays] = useState('14');
  const [cleaning, setCleaning] = useState(false);
  const [purgingDecryptedRaw, setPurgingDecryptedRaw] = useState(false);
  const [autoDecryptOnAdvert, setAutoDecryptOnAdvert] = useState(false);
  const [syncUrl, setSyncUrl] = useState('');

  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setAutoDecryptOnAdvert(appSettings.auto_decrypt_dm_on_advert);
    setSyncUrl(appSettings.registry_sync_url ?? '');
  }, [appSettings]);

  const handleCleanup = async () => {
    const days = parseInt(retentionDays, 10);
    if (isNaN(days) || days < 1) {
      toast.error(t('settings_db_toast_invalid_retention_title'), {
        description: t('settings_db_toast_invalid_retention_desc'),
      });
      return;
    }

    setCleaning(true);

    try {
      const result = await api.runMaintenance({ pruneUndecryptedDays: days });
      toast.success(t('settings_db_toast_cleanup_complete_title'), {
        description: t('settings_db_toast_cleanup_complete_desc', { count: result.packets_deleted }),
      });
      await onHealthRefresh();
    } catch (err) {
      console.error('Failed to run maintenance:', err);
      toast.error(t('settings_db_toast_cleanup_failed_title'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    } finally {
      setCleaning(false);
    }
  };

  const handlePurgeDecryptedRawPackets = async () => {
    setPurgingDecryptedRaw(true);

    try {
      const result = await api.runMaintenance({ purgeLinkedRawPackets: true });
      toast.success(t('settings_db_toast_purge_complete_title'), {
        description: t('settings_db_toast_purge_complete_desc', { count: result.packets_deleted }),
      });
      await onHealthRefresh();
    } catch (err) {
      console.error('Failed to purge decrypted raw packets:', err);
      toast.error(t('settings_db_toast_purge_failed_title'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    } finally {
      setPurgingDecryptedRaw(false);
    }
  };

  const persistAppSettings = (update: AppSettingsUpdate, revert: () => void): Promise<void> => {
    const chained = saveChainRef.current.then(async () => {
      try {
        await onSaveAppSettings(update);
      } catch (err) {
        console.error('Failed to save database settings:', err);
        revert();
        toast.error(t('settings_db_toast_save_failed_title'), {
          description: err instanceof Error ? err.message : t('error_unknown'),
        });
      }
    });
    saveChainRef.current = chained;
    return chained;
  };

  return (
    <div className={className}>
      {/* ── Database Overview ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_db_overview_heading')}</h3>
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm">{t('settings_db_size_label')}</span>
            <span className="text-sm font-semibold">{health?.database_size_mb ?? '?'} MB</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm">{t('settings_db_oldest_undecrypted_label')}</span>
            {health?.oldest_undecrypted_timestamp ? (
              <span className="text-sm font-semibold">
                {formatTime(health.oldest_undecrypted_timestamp)}
                <span className="font-normal text-muted-foreground ml-1">
                  {t('settings_db_days_ago', {
                    count: Math.floor(
                      (Date.now() / 1000 - health.oldest_undecrypted_timestamp) / 86400
                    ),
                  })}
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">{t('settings_db_none')}</span>
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* ── Storage Cleanup ── */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_db_cleanup_heading')}</h3>

        <div className="rounded-md border border-border p-3 space-y-2">
          <h3 className="text-sm font-semibold">{t('settings_db_delete_undecrypted_heading')}</h3>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_db_delete_undecrypted_desc')}
          </p>
          <div className="flex gap-2 items-end">
            <div className="space-y-1">
              <Label htmlFor="retention-days" className="text-xs text-muted-foreground">
                {t('settings_db_older_than_days_label')}
              </Label>
              <Input
                id="retention-days"
                type="number"
                min="1"
                max="365"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                className="w-24"
              />
            </div>
            <Button
              variant="outline"
              onClick={handleCleanup}
              disabled={cleaning}
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              {cleaning ? t('settings_db_deleting') : t('common_delete')}
            </Button>
          </div>
        </div>

        <div className="rounded-md border border-border p-3 space-y-2">
          <h3 className="text-sm font-semibold">{t('settings_db_purge_archival_heading')}</h3>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_db_purge_archival_desc')}
          </p>
          <Button
            variant="outline"
            onClick={handlePurgeDecryptedRawPackets}
            disabled={purgingDecryptedRaw}
            className="w-full border-warning/50 text-warning hover:bg-warning/10"
          >
            {purgingDecryptedRaw ? t('settings_db_purging') : t('settings_db_purge_archival_button')}
          </Button>
        </div>
      </div>

      <Separator />

      {/* ── DM Decryption ── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">{t('settings_db_dm_decryption_heading')}</h3>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoDecryptOnAdvert}
            onChange={(e) => {
              const next = e.target.checked;
              const prev = autoDecryptOnAdvert;
              setAutoDecryptOnAdvert(next);
              void persistAppSettings({ auto_decrypt_dm_on_advert: next }, () =>
                setAutoDecryptOnAdvert(prev)
              );
            }}
            className="w-4 h-4 rounded border-input accent-primary"
          />
          <span className="text-sm">{t('settings_db_auto_decrypt_label')}</span>
        </label>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_db_auto_decrypt_desc')}
        </p>
      </div>

      <Separator />

      {/* Channel Registry */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold tracking-tight">Channel Registry</h3>
        <div className="space-y-1.5">
          <Label htmlFor="registry-sync-url" className="text-sm font-medium">
            Channel list sync URL
          </Label>
          <Input
            id="registry-sync-url"
            type="url"
            value={syncUrl}
            placeholder="https://example.com/channels.json"
            onChange={(e) => setSyncUrl(e.target.value)}
            onBlur={() => {
              const trimmed = syncUrl.trim();
              setSyncUrl(trimmed);
              void persistAppSettings({ registry_sync_url: trimmed }, () =>
                setSyncUrl(appSettings.registry_sync_url ?? '')
              );
            }}
            className="font-mono text-xs"
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            URL of a remote JSON channel list (<code className="text-xs">{`{"#name": "key"}`}</code>{' '}
            format). The server fetches this when you click Sync in the Channel Registry.
          </p>
        </div>
      </div>
    </div>
  );
}
