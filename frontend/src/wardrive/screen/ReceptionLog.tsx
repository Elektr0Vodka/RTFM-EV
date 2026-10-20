// The live log (ticker) under the top bar: the newest receptions with their
// age, signal, sender and what they carried (channel text, channel or packet
// type). Tapping a row selects it: the HUD and the map follow the selection
// until Back to live. It folds to three lanes, one lane, or away. Rows are
// memoised: a flush or a clock tick re-renders only rows that changed.
import { memo, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Radio, X } from 'lucide-react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { useT, type TFn } from '../../i18n';
import { packetTypeLabel } from '../filters';
import { shownId } from '../names';
import { rssiTier, tierColor } from '../signal';
import type { ViewEntry } from '../useReceptionView';
import { formatAge } from './Hud';

export type LogSize = 'full' | 'three' | 'one' | 'hidden';
/** Rows the full log renders; the store holds more (the count says how many). */
export const LOG_RENDER_MAX = 200;
export const LOG_SIZE_KEY = 'rtfm-wardrive-log-size';

const ROWS: Record<Exclude<LogSize, 'hidden'>, number> = { full: 10, three: 3, one: 1 };
const NEXT: Record<Exclude<LogSize, 'hidden'>, LogSize> = {
  full: 'three',
  three: 'one',
  one: 'full',
};

export interface ReceptionLogProps {
  entries: ViewEntry[];
  selectedId: number | null;
  onSelect(id: number): void;
  onClearSelection(): void;
  size: LogSize;
  onSize(s: LogSize): void;
  nowMs: number;
  /** dB added to RSSI for the tier dot (calibration, attenuator). */
  rssiOffset?: number;
}

function meta(e: ViewEntry, t: TFn): string {
  if (e.channel && e.text) return `${e.channel}: ${e.text}`;
  if (e.channel) return e.channel;
  return packetTypeLabel(e.packetType, t);
}

const LogRow = memo(function LogRow({
  entry: e,
  selected,
  age,
  rssiOffset,
  onSelect,
}: {
  entry: ViewEntry;
  selected: boolean;
  age: string;
  onSelect(id: number): void;
  rssiOffset: number;
}) {
  const t = useT();
  const cvd = useCvdMode() !== 'off';
  const name = e.name.name ? `${e.name.mark}${e.name.name}` : shownId(e.sender) || '-';
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onSelect(e.id);
    }
  };
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-current={selected ? 'true' : undefined}
        title={e.inFilter ? undefined : t('wardrive_page_log_outside')}
        className={`flex cursor-pointer items-center gap-2 px-3 py-1 tabular-nums ${
          selected ? 'bg-primary/15' : 'hover:bg-muted'
        } ${e.inFilter ? '' : 'opacity-60'}`}
        onClick={() => onSelect(e.id)}
        onKeyDown={onKeyDown}
      >
        <span className="w-12 shrink-0 text-muted-foreground">{age}</span>
        <span className="flex w-11 shrink-0 items-center justify-end gap-1.5">
          <i
            className="block h-2 w-2 rounded-full"
            data-testid="wardrive-log-tier"
            style={{ backgroundColor: tierColor(rssiTier(e.rssi, rssiOffset), cvd) }}
            aria-hidden="true"
          />
          <span className="font-semibold" data-testid="wardrive-log-rssi">
            {e.rssi === null ? '-' : Math.round(e.rssi)}
          </span>
        </span>
        <span className="w-24 shrink-0 truncate font-medium">{name}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{meta(e, t)}</span>
        <span
          className={e.kept ? 'text-foreground' : 'text-muted-foreground'}
          title={e.kept ? t('wardrive_page_log_kept') : t('wardrive_page_log_heard_only')}
        >
          {e.kept ? '●' : '○'}
        </span>
      </div>
    </li>
  );
});

export function ReceptionLog({
  entries,
  selectedId,
  onSelect,
  onClearSelection,
  size,
  onSize,
  nowMs,
  rssiOffset = 0,
}: ReceptionLogProps) {
  const t = useT();
  if (size === 'hidden') return null;
  const shown = entries.slice(0, size === 'full' ? LOG_RENDER_MAX : ROWS[size]);

  return (
    <section
      className="w-full max-w-md rounded-xl border border-border bg-card/90 text-xs shadow-md backdrop-blur"
      aria-label={t('wardrive_page_log_aria')}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-1">
        <span className="font-semibold tabular-nums">
          {t('wardrive_page_log_count', { count: entries.length })}
        </span>
        {selectedId !== null && (
          <button
            type="button"
            className="flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-primary-foreground"
            onClick={onClearSelection}
          >
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            {t('wardrive_page_log_back')}
          </button>
        )}
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
        {shown.map((e) => (
          <LogRow
            rssiOffset={rssiOffset}
            key={e.id}
            entry={e}
            selected={e.id === selectedId}
            age={formatAge(nowMs - e.at, t)}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}
