import { useEffect, useState } from 'react';

import { useT } from '../../i18n';
import type { AppSettings, AppSettingsUpdate } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from '../ui/sonner';

/** Server default and upper bound (`app/malformed.py`). */
export const DEFAULT_CLOCK_AHEAD_MINUTES = 60;
export const MAX_CLOCK_AHEAD_MINUTES = 10080;

interface MalformedClockSettingsProps {
  appSettings: Pick<AppSettings, 'malformed_clock_ahead_minutes'>;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
}

/** A whole number of minutes within range, or null. */
export function parseClockAheadMinutes(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const minutes = Number(value.trim());
  return minutes <= MAX_CLOCK_AHEAD_MINUTES ? minutes : null;
}

/**
 * How far a sender's stamp may run ahead of the receive time before the
 * message is flagged malformed (`app_settings.malformed_clock_ahead_minutes`).
 * The server re-checks stored messages on save.
 */
export function MalformedClockSettings({
  appSettings,
  onSaveAppSettings,
}: MalformedClockSettingsProps) {
  const t = useT();
  const saved = String(appSettings.malformed_clock_ahead_minutes ?? DEFAULT_CLOCK_AHEAD_MINUTES);
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const parsed = parseClockAheadMinutes(draft);

  const save = async () => {
    if (parsed === null) return;
    setSaving(true);
    try {
      await onSaveAppSettings({ malformed_clock_ahead_minutes: parsed });
      toast.success(t('settings_malformed_clock_saved'));
    } catch (err) {
      toast.error(t('settings_malformed_clock_save_failed'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">{t('settings_malformed_clock_heading')}</h4>
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_malformed_clock_desc')}</p>
      <div className="space-y-2">
        <Label htmlFor="malformed-clock-ahead">{t('settings_malformed_clock_label')}</Label>
        <Input
          id="malformed-clock-ahead"
          type="number"
          inputMode="numeric"
          min={0}
          max={MAX_CLOCK_AHEAD_MINUTES}
          step={1}
          value={draft}
          aria-invalid={parsed === null}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('settings_malformed_clock_hint')}</p>
      </div>
      <Button
        variant="outline"
        className="w-full"
        disabled={saving || parsed === null || String(parsed) === saved}
        onClick={() => void save()}
      >
        {t('settings_malformed_clock_save')}
      </Button>
    </div>
  );
}
