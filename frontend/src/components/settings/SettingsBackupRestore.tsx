import { useCallback, useEffect, useState } from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';
import { toast } from '../ui/sonner';
import { api } from '../../api';
import { formatTime } from '../../utils/messageParser';
import { useT } from '../../i18n';
import type {
  AppSettings,
  AppSettingsUpdate,
  BackupFile,
  BackupFileKind,
  RestoreStatus,
} from '../../types';

/**
 * Scheduled backups + restore, rendered inside the Settings > Database backup block.
 *
 * Restore is two-phase: the chosen backup is validated and staged by the server,
 * then swapped in when the server restarts (the current database is snapshotted
 * first). This panel shows the staged restore (with cancel) and the outcome of the
 * last applied restore.
 */
export function SettingsBackupRestore({
  appSettings,
  persist,
  refreshToken = 0,
}: {
  appSettings: AppSettings;
  persist: (update: AppSettingsUpdate, revert: () => void) => Promise<void>;
  /** Bump to reload the server file list (e.g. after a manual "back up now"). */
  refreshToken?: number;
}) {
  const t = useT();
  const serverEnabled = appSettings.backup_to_path_enabled ?? false;
  const [status, setStatus] = useState<RestoreStatus>({ pending: null, last_result: null });
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [intervalHours, setIntervalHours] = useState('24');
  const [keepCount, setKeepCount] = useState('7');

  useEffect(() => {
    setScheduleEnabled(appSettings.backup_schedule_enabled ?? false);
    setIntervalHours(String(appSettings.backup_schedule_interval_hours ?? 24));
    setKeepCount(String(appSettings.backup_schedule_keep ?? 7));
  }, [appSettings]);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api.getRestoreStatus());
    } catch (err) {
      console.error('Failed to load restore status:', err);
    }
  }, []);

  const refreshFiles = useCallback(async () => {
    try {
      const result = await api.listBackupFiles();
      setFiles(result.files);
      setFilesError(result.error);
    } catch (err) {
      setFiles([]);
      setFilesError(err instanceof Error ? err.message : t('error_unknown'));
    }
  }, [t]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (serverEnabled) void refreshFiles();
  }, [serverEnabled, appSettings.backup_destination_path, refreshToken, refreshFiles]);

  const stage = async (name: string, action: () => Promise<RestoreStatus>) => {
    if (!window.confirm(t('settings_db_restore_confirm', { name }))) return;
    setBusy(true);
    try {
      setStatus(await action());
      toast.success(t('settings_db_restore_staged_title'), {
        description: t('settings_db_restore_staged_desc', { name }),
      });
    } catch (err) {
      console.error('Failed to stage restore:', err);
      toast.error(t('settings_db_restore_failed_title'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await stage(file.name, () => api.restoreFromUpload(file));
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      setStatus(await api.cancelRestore());
      toast.success(t('settings_db_restore_cancelled'));
    } catch (err) {
      toast.error(t('settings_db_restore_failed_title'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async () => {
    try {
      setStatus(await api.dismissRestoreResult());
    } catch (err) {
      console.error('Failed to dismiss restore result:', err);
    }
  };

  const persistNumber = (
    raw: string,
    field: 'backup_schedule_interval_hours' | 'backup_schedule_keep',
    min: number,
    max: number,
    setValue: (v: string) => void
  ) => {
    const current = appSettings[field] ?? (field === 'backup_schedule_keep' ? 7 : 24);
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) {
      setValue(String(current));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setValue(String(clamped));
    if (clamped !== current) {
      void persist({ [field]: clamped }, () => setValue(String(current)));
    }
  };

  const sizeMb = (bytes: number) =>
    t('settings_db_restore_size_mb', { size: (bytes / 1048576).toFixed(1) });

  const kindLabel = (kind: BackupFileKind) => {
    switch (kind) {
      case 'auto':
        return t('settings_db_restore_kind_auto');
      case 'manual':
        return t('settings_db_restore_kind_manual');
      case 'pre-restore':
        return t('settings_db_restore_kind_pre_restore');
      default:
        return t('settings_db_restore_kind_other');
    }
  };

  const { pending, last_result: last } = status;

  return (
    <div className="space-y-4">
      {serverEnabled && (
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={scheduleEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                const prev = scheduleEnabled;
                setScheduleEnabled(next);
                void persist({ backup_schedule_enabled: next }, () => setScheduleEnabled(prev));
              }}
              className="w-4 h-4 rounded border-input accent-primary"
            />
            <span className="text-sm">{t('settings_db_schedule_toggle')}</span>
          </label>
          {scheduleEnabled && (
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="backup-schedule-interval" className="text-sm font-medium">
                  {t('settings_db_schedule_interval_label')}
                </Label>
                <Input
                  id="backup-schedule-interval"
                  type="number"
                  min={1}
                  max={720}
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(e.target.value)}
                  onBlur={() =>
                    persistNumber(
                      intervalHours,
                      'backup_schedule_interval_hours',
                      1,
                      720,
                      setIntervalHours
                    )
                  }
                  className="w-28"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="backup-schedule-keep" className="text-sm font-medium">
                  {t('settings_db_schedule_keep_label')}
                </Label>
                <Input
                  id="backup-schedule-keep"
                  type="number"
                  min={1}
                  max={365}
                  value={keepCount}
                  onChange={(e) => setKeepCount(e.target.value)}
                  onBlur={() =>
                    persistNumber(keepCount, 'backup_schedule_keep', 1, 365, setKeepCount)
                  }
                  className="w-28"
                />
              </div>
            </div>
          )}
          <p className="text-[0.8125rem] text-muted-foreground">{t('settings_db_schedule_desc')}</p>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{t('settings_db_restore_heading')}</h4>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_db_restore_desc')}</p>

        {pending && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3 space-y-2">
            <p className="text-sm">
              {t('settings_db_restore_pending', {
                name: pending.original_name,
                size: sizeMb(pending.size_bytes),
                time: formatTime(pending.staged_at),
              })}
            </p>
            <Button type="button" variant="secondary" disabled={busy} onClick={handleCancel}>
              {t('settings_db_restore_cancel')}
            </Button>
          </div>
        )}

        {last && (
          <div
            className={`rounded-md border p-3 space-y-2 ${
              last.ok ? 'border-border bg-muted/40' : 'border-destructive/50 bg-destructive/10'
            }`}
          >
            <p className="text-sm break-words">
              {last.ok
                ? last.pre_restore_snapshot
                  ? t('settings_db_restore_result_ok', {
                      name: last.original_name,
                      time: formatTime(last.applied_at),
                      path: last.pre_restore_snapshot,
                    })
                  : t('settings_db_restore_result_ok_no_snapshot', {
                      name: last.original_name,
                      time: formatTime(last.applied_at),
                    })
                : t('settings_db_restore_result_failed', {
                    name: last.original_name,
                    time: formatTime(last.applied_at),
                    error: last.error ?? t('error_unknown'),
                  })}
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={handleDismiss}>
              {t('settings_db_restore_dismiss')}
            </Button>
          </div>
        )}

        <div>
          <Label
            htmlFor="backup-restore-file"
            className={`inline-flex items-center rounded-md border border-input px-3 py-2 text-sm font-medium ${
              busy ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:bg-accent'
            }`}
          >
            {t('settings_db_restore_upload')}
          </Label>
          <input
            id="backup-restore-file"
            type="file"
            accept=".db,application/octet-stream,application/x-sqlite3"
            className="sr-only"
            disabled={busy}
            onChange={handleFile}
          />
        </div>

        {serverEnabled && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between gap-2">
              <h5 className="text-sm font-medium">{t('settings_db_restore_server_heading')}</h5>
              <Button type="button" variant="ghost" size="sm" onClick={() => void refreshFiles()}>
                {t('settings_db_restore_server_refresh')}
              </Button>
            </div>
            {filesError ? (
              <p className="text-[0.8125rem] text-destructive">{filesError}</p>
            ) : files.length === 0 ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                {t('settings_db_restore_server_empty')}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs truncate">{f.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('settings_db_restore_file_meta', {
                          kind: kindLabel(f.kind),
                          size: sizeMb(f.size_bytes),
                          time: formatTime(f.modified_at),
                        })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void stage(f.name, () => api.restoreFromServer(f.name))}
                    >
                      {t('settings_db_restore_server_restore')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
