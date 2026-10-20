import { useCallback, useEffect, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const MAX_DB = 30;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** dB the wardrive page adds to every RSSI it colours, for a known offset of
 * the drivers' radios. The numbers shown, stored and forwarded stay measured. */
export function WardriveCalibrationCard() {
  const t = useT();
  const [saved, setSaved] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await api.getWardriveConfig();
      setSaved(c.rssi_calibration_db);
      setValue(String(c.rssi_calibration_db));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const n = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(n) && Math.abs(n) <= MAX_DB;

  const save = async () => {
    try {
      const c = await api.putWardriveConfig({ rssi_calibration_db: n });
      setSaved(c.rssi_calibration_db);
      setValue(String(c.rssi_calibration_db));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div
      className="space-y-2 rounded-md border border-border p-3"
      data-testid="wardrive-calibration"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="wardrive-calibration">{t('settings_wardrive_calibration_label')}</Label>
          <Input
            id="wardrive-calibration"
            type="number"
            min={-MAX_DB}
            max={MAX_DB}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!valid || n === saved}
          onClick={() => void save()}
        >
          {t('settings_wardrive_calibration_save')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('settings_wardrive_calibration_desc')}</p>
      {error && (
        <p className="text-xs text-destructive" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
