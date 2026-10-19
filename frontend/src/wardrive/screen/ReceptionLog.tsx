// The live log (ticker) under the top bar: the newest receptions with their
// age, signal and type. Tapping a row selects it: the HUD and the map follow
// the selection. It folds to three lanes, one lane, or away.
import { ChevronDown, ChevronUp, X } from 'lucide-react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { useT } from '../../i18n';
import type { LiveEntry } from '../liveLog';
import { rssiTier, tierColor } from '../signal';
import { formatAge } from './Hud';

export type LogSize = 'full' | 'three' | 'one' | 'hidden';
export const LOG_SIZE_KEY = 'rtfm-wardrive-log-size';

const ROWS: Record<Exclude<LogSize, 'hidden'>, number> = { full: 10, three: 3, one: 1 };
const NEXT: Record<Exclude<LogSize, 'hidden'>, LogSize> = {
  full: 'three',
  three: 'one',
  one: 'full',
};

export interface ReceptionLogProps {
  entries: LiveEntry[];
  selectedId: number | null;
  onSelect(id: number): void;
  size: LogSize;
  onSize(s: LogSize): void;
  nowMs: number;
}

export function ReceptionLog({
  entries,
  selectedId,
  onSelect,
  size,
  onSize,
  nowMs,
}: ReceptionLogProps) {
  const t = useT();
  const cvd = useCvdMode() !== 'off';
  if (size === 'hidden') return null;
  const shown = size === 'full' ? entries : entries.slice(0, ROWS[size]);

  return (
    <section
      className="w-full max-w-md rounded-xl border border-border bg-card/90 text-xs shadow-md backdrop-blur"
      aria-label={t('wardrive_page_log_aria')}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-1">
        <span className="font-semibold tabular-nums">
          {t('wardrive_page_log_count', { count: entries.length })}
        </span>
        <button
          type="button"
          className="ml-auto rounded px-2 py-0.5 hover:bg-muted"
          aria-label={t('wardrive_page_log_size')}
          onClick={() => onSize(NEXT[size])}
        >
          {size === 'full' ? (
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-muted"
          aria-label={t('wardrive_page_log_hide')}
          onClick={() => onSize('hidden')}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <ul
        className="overflow-y-auto"
        style={{ maxHeight: size === 'full' ? `${ROWS.full * 1.75}rem` : undefined }}
      >
        {shown.map((e) => {
          const selected = e.id === selectedId;
          return (
            <li
              key={e.id}
              tabIndex={0}
              aria-current={selected ? 'true' : undefined}
              className={`flex cursor-pointer items-center gap-3 px-3 py-1 tabular-nums ${
                selected ? 'bg-primary/15' : 'hover:bg-muted'
              }`}
              onClick={() => onSelect(e.id)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') onSelect(e.id);
              }}
            >
              <span className="w-12 text-muted-foreground">{formatAge(nowMs - e.at, t)}</span>
              <span className="flex w-12 items-center justify-end gap-1.5">
                <i
                  className="block h-2 w-2 rounded-full"
                  data-testid="wardrive-log-tier"
                  style={{ backgroundColor: tierColor(rssiTier(e.rssi), cvd) }}
                  aria-hidden="true"
                />
                <span className="font-semibold" data-testid="wardrive-log-rssi">
                  {e.rssi === null ? '-' : Math.round(e.rssi)}
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate">{e.typeName}</span>
              <span
                className={e.kept ? 'text-foreground' : 'text-muted-foreground'}
                title={e.kept ? t('wardrive_page_log_kept') : t('wardrive_page_log_heard_only')}
              >
                {e.kept ? '●' : '○'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
