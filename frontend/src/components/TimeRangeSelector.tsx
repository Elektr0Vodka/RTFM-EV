import { useT } from '../i18n';
import { BASE_TIME_RANGES, CUSTOM_RANGE_ID, type TimeRange } from '../utils/timeRanges';

interface TimeRangeSelectorProps {
  value: string;
  onChange: (id: string) => void;
  extrasBefore?: TimeRange[];
  extrasAfter?: TimeRange[];
  extrasSpecial?: TimeRange[];
  showCustom?: boolean;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  onApplyCustom: (startSec: number, endSec: number) => void;
  className?: string;
}

export function TimeRangeSelector({
  value,
  onChange,
  extrasBefore = [],
  extrasAfter = [],
  extrasSpecial = [],
  showCustom = true,
  customStart,
  customEnd,
  onCustomStartChange,
  onCustomEndChange,
  onApplyCustom,
  className,
}: TimeRangeSelectorProps) {
  const t = useT();
  const mainRanges = [...extrasBefore, ...BASE_TIME_RANGES, ...extrasAfter];

  function btnClass(active: boolean): string {
    return `rounded px-2 py-0.5 text-xs transition ${
      active
        ? 'bg-primary text-primary-foreground font-medium'
        : 'border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
    }`;
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1">
        {mainRanges.map((r) => (
          <button key={r.id} onClick={() => onChange(r.id)} className={btnClass(value === r.id)}>
            {t(r.labelKey)}
          </button>
        ))}
        {(extrasSpecial.length > 0 || showCustom) && (
          <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        )}
        {extrasSpecial.map((r) => (
          <button key={r.id} onClick={() => onChange(r.id)} className={btnClass(value === r.id)}>
            {t(r.labelKey)}
          </button>
        ))}
        {showCustom && (
          <button
            onClick={() => onChange(CUSTOM_RANGE_ID)}
            className={btnClass(value === CUSTOM_RANGE_ID)}
          >
            {t('time_range_custom')}
          </button>
        )}
      </div>
      {showCustom && value === CUSTOM_RANGE_ID && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">{t('time_range_from')}</span>
          <input
            type="datetime-local"
            value={customStart}
            onChange={(e) => onCustomStartChange(e.target.value)}
            className="rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground"
          />
          <span className="text-xs text-muted-foreground">{t('time_range_to')}</span>
          <input
            type="datetime-local"
            value={customEnd}
            onChange={(e) => onCustomEndChange(e.target.value)}
            className="rounded border border-input bg-background px-2 py-0.5 text-xs text-foreground"
          />
          {customStart && customEnd && (
            <button
              onClick={() => {
                const s = Math.floor(new Date(customStart).getTime() / 1000);
                const e = Math.floor(new Date(customEnd).getTime() / 1000);
                if (e > s) onApplyCustom(s, e);
              }}
              className="rounded border border-border bg-background px-2 py-0.5 text-xs text-foreground hover:bg-accent transition"
            >
              {t('time_range_apply')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
