import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { toast } from '../ui/sonner';
import { useT } from '../../i18n';
import { api } from '../../api';
import { formatDateTime } from '../../utils/dateTimeFormat';
import type { AntennaRegisterStatus } from '../../types';

const POLL_MS = 2000;

/**
 * Manual sync for the map's antenna layer (Dutch Antenneregister). The backend
 * runs the sync in the background (a minute or two); this card polls the
 * status while it runs and reports the outcome.
 */
export function AntennaRegisterSyncCard() {
  const t = useT();
  const [status, setStatus] = useState<AntennaRegisterStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const timerRef = useRef<number | null>(null);
  const wasRunningRef = useRef(false);

  const poll = useCallback(() => {
    api
      .getAntennaRegisterStatus()
      .then((s) => {
        setStatus(s);
        if (s.running) {
          wasRunningRef.current = true;
          timerRef.current = window.setTimeout(poll, POLL_MS);
          return;
        }
        if (wasRunningRef.current) {
          wasRunningRef.current = false;
          if (s.error) toast.error(t('settings_antennas_sync_failed', { error: s.error }));
          else toast.success(t('settings_antennas_synced', { count: s.count }));
        }
      })
      .catch(() => {
        // Best effort: a failure here must never break the settings panel.
      });
  }, [t]);

  useEffect(() => {
    poll();
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [poll]);

  const handleSync = async () => {
    setStarting(true);
    try {
      const s = await api.syncAntennaRegister();
      setStatus(s);
      wasRunningRef.current = s.running;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(poll, POLL_MS);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings_antennas_sync_failed_generic'));
    } finally {
      setStarting(false);
    }
  };

  const running = status?.running ?? false;
  let statusText: string;
  if (running) {
    statusText = t(
      status?.phase === 'sites'
        ? 'settings_antennas_progress_sites'
        : 'settings_antennas_progress_antennas',
      { count: status?.fetched ?? 0 }
    );
  } else if (status?.last_synced_at) {
    statusText = t('settings_antennas_status', {
      count: status.count,
      when: formatDateTime(new Date(status.last_synced_at * 1000), {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    });
  } else {
    statusText = t('settings_antennas_never_synced');
  }

  return (
    <div className="space-y-2 rounded-md border border-input bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
          {t('settings_antennas_label')}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={starting || running}
        >
          {starting || running
            ? t('settings_antennas_sync_button_loading')
            : t('settings_antennas_sync_button')}
        </Button>
      </div>
      <p className="text-[0.8125rem] text-muted-foreground" aria-live="polite">
        {statusText}
      </p>
      {!running && status?.error && (
        <p className="text-[0.8125rem] text-destructive">
          {t('settings_antennas_last_error', { error: status.error })}
        </p>
      )}
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_antennas_desc')}</p>
    </div>
  );
}
