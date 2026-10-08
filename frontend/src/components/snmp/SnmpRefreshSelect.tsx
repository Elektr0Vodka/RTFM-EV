import { useState } from 'react';
import { useT } from '../../i18n';

const REFRESH_STORAGE_KEY = 'rtfm-snmp-refresh-seconds';
/** Auto refresh choices in seconds; 0 is off. */
const REFRESH_CHOICES = [0, 10, 30, 60];
const DEFAULT_REFRESH_SECONDS = 30;

function loadRefreshSeconds(): number {
  try {
    const stored = Number(localStorage.getItem(REFRESH_STORAGE_KEY) ?? NaN);
    return REFRESH_CHOICES.includes(stored) ? stored : DEFAULT_REFRESH_SECONDS;
  } catch {
    return DEFAULT_REFRESH_SECONDS;
  }
}

function saveRefreshSeconds(seconds: number): void {
  try {
    localStorage.setItem(REFRESH_STORAGE_KEY, String(seconds));
  } catch {
    // Ignore storage write failures (private mode, disabled storage).
  }
}

/**
 * How often the SNMP pages re-read stored data, remembered per browser and
 * shared by the overview and the node page. Refreshing never polls a node.
 */
export function useSnmpRefreshSeconds(): [number, (seconds: number) => void] {
  const [seconds, setSeconds] = useState(loadRefreshSeconds);
  const change = (next: number) => {
    setSeconds(next);
    saveRefreshSeconds(next);
  };
  return [seconds, change];
}

export function SnmpRefreshSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (seconds: number) => void;
}) {
  const t = useT();
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {t('snmp_page_auto_refresh')}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      >
        {REFRESH_CHOICES.map((seconds) => (
          <option key={seconds} value={seconds}>
            {seconds === 0
              ? t('snmp_page_auto_refresh_off')
              : t('snmp_page_auto_refresh_seconds', { seconds })}
          </option>
        ))}
      </select>
    </label>
  );
}
