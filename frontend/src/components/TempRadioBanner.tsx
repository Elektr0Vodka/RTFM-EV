import { useEffect, useState } from 'react';
import { Antenna } from 'lucide-react';

import { api } from '../api';
import { useT } from '../i18n';
import { cn } from '../lib/utils';
import { formatRadioStamp } from '../utils/radioSf';
import {
  setTempRadioState,
  subscribeTempRadioDropped,
  useScanState,
  useTempRadioState,
} from '../utils/tempRadio';
import { Button } from './ui/button';
import { toast } from './ui/sonner';

/** "1:05:09" / "4:09" from seconds. */
export function formatTimeLeft(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now() / 1000);
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * App-wide strip while the companion is on temporary settings: what it is on,
 * time left and Restore now. Overdue restores show as a warning, so a
 * companion is never silently left on another mesh's settings.
 */
export function TempRadioBanner({ className }: { className?: string }) {
  const t = useT();
  const session = useTempRadioState();
  const scan = useScanState();
  const now = useNow(session.active || scan.running);
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      subscribeTempRadioDropped((reason) => {
        const key = `temp_radio_dropped_${reason}`;
        const text = t(key);
        toast.info(text === key ? t('temp_radio_dropped_changed_elsewhere') : text);
      }),
    [t]
  );

  if (!session.active && !scan.running) return null;

  const restore = async () => {
    setBusy(true);
    try {
      if (scan.running) {
        await api.stopScan();
      } else {
        setTempRadioState(await api.restoreTempRadio());
      }
    } catch (err) {
      toast.error(
        t('temp_radio_restore_failed', { error: err instanceof Error ? err.message : String(err) })
      );
    } finally {
      setBusy(false);
    }
  };

  const overdue = session.restore_pending;
  const endsAt = scan.running ? scan.entry_ends_at : session.expires_at;
  const parts: string[] = [];
  if (session.active && session.temp && !(scan.running && scan.on_normal)) {
    parts.push(formatRadioStamp(session.temp));
  }
  if (session.active && session.region && !(scan.running && scan.on_normal)) {
    parts.push(
      t('temp_radio_banner_region', {
        region: session.region === '*' ? '*' : session.region.replace(/^#/, ''),
      })
    );
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-sm',
        overdue
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-primary/30 bg-primary/10 text-foreground',
        className
      )}
      data-testid="temp-radio-banner"
    >
      <Antenna className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 font-medium">
        {scan.running ? (
          <TempRadioScanBannerText />
        ) : (
          t('temp_radio_banner_active', { settings: parts.join(', ') })
        )}
      </span>
      {scan.running && parts.length > 0 && (
        <span className="text-muted-foreground">{parts.join(', ')}</span>
      )}
      {endsAt !== null && !overdue && (
        <span className="text-muted-foreground tabular-nums">
          {t('temp_radio_banner_time_left', { time: formatTimeLeft(endsAt - now) })}
        </span>
      )}
      {overdue && (
        <span role="alert" className="font-medium">
          {t('temp_radio_banner_overdue')}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="ml-auto h-7"
        disabled={busy}
        onClick={restore}
      >
        {scan.running ? t('temp_radio_scan_stop') : t('temp_radio_restore_now')}
      </Button>
    </div>
  );
}

/** "Scan Border: entry 2 of 3, round 1". */
function TempRadioScanBannerText() {
  const t = useT();
  const scan = useScanState();
  const name = scan.list_name ?? '';
  if (scan.on_normal) return <>{t('temp_radio_scan_banner_normal', { name })}</>;
  const text = t('temp_radio_scan_banner', {
    name,
    entry: (scan.entry_index ?? 0) + 1,
    count: scan.entry_count ?? 0,
  });
  return (
    <>
      {text}
      {scan.round ? `, ${t('temp_radio_scan_round', { round: scan.round })}` : ''}
    </>
  );
}
