import { useEffect, useState } from 'react';

import { api } from '../../api';
import { toast } from '../ui/sonner';
import { useT } from '../../i18n';

/**
 * Opt a tracked repeater into clock sync. With it on, a telemetry cycle that
 * reaches the repeater also sets its clock, but only when its adverts show the
 * clock running behind (the firmware cannot be set back).
 *
 * Rendered only for a tracked repeater. Reads and writes its own setting, so
 * the list does not have to be passed down through the dashboard.
 */
export function RepeaterClockSyncToggle({ publicKey }: { publicKey: string }) {
  const t = useT();
  // null = not loaded yet; the checkbox stays hidden rather than show a guess.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const key = publicKey.toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setEnabled(null);
    api
      .getSettings()
      .then((settings) => {
        if (!cancelled) setEnabled((settings.clock_sync_repeaters ?? []).includes(key));
      })
      .catch(() => {
        if (!cancelled) setEnabled(null);
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (enabled === null) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const result = await api.toggleClockSyncRepeater(key);
      setEnabled(result.clock_sync_repeaters.includes(key));
    } catch (err) {
      toast.error(t('repeater_clock_sync_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="flex items-start gap-2 text-xs cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5 rounded"
        checked={enabled}
        disabled={busy}
        onChange={() => void toggle()}
      />
      <span>
        <span className="font-medium text-foreground">{t('repeater_clock_sync_label')}</span>
        <span className="block text-muted-foreground leading-relaxed">
          {t('repeater_clock_sync_hint')}
        </span>
      </span>
    </label>
  );
}
