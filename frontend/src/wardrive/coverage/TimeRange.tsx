// The coverage map's time range (map.mesh-hunter.eu's range picker): quick
// ranges that keep following now, an absolute From/To, and a link with the
// range frozen to fixed times.
import { Clock } from 'lucide-react';
import { useState } from 'react';

import { useT } from '../../i18n';
import { BAR_BUTTON, Dropdown } from './Dropdown';
import { QUICK_RANGES, resolveTime } from './state';

const pad = (n: number) => String(n).padStart(2, '0');

/** A datetime-local value (local time, minutes) of unix seconds. */
export function toLocalInput(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const shortTime = (value: string, nowMs: number) => {
  const sec = resolveTime(value, nowMs);
  return sec === null ? value : toLocalInput(sec).replace('T', ' ');
};

export function TimeRange({
  from,
  to,
  nowMs,
  onChange,
  onCopy,
}: {
  from: string;
  to: string;
  nowMs: number;
  onChange(from: string, to: string): void;
  /** Copy a link with these absolute bounds. */
  onCopy(from: string, to: string): Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const quick = QUICK_RANGES.find((r) => r.from === from && r.to === to);
  const fromSec = resolveTime(from, nowMs);
  const toSec = resolveTime(to, nowMs);
  const [fromInput, setFromInput] = useState(fromSec === null ? '' : toLocalInput(fromSec));
  const [toInput, setToInput] = useState(toSec === null ? '' : toLocalInput(toSec));
  const label = quick
    ? t(`wardrive_cov_range_${quick.id}`)
    : t('wardrive_cov_range_custom', { from: shortTime(from, nowMs), to: shortTime(to, nowMs) });

  const openPanel = () => {
    // The fields show what the range means now, so editing from there makes it absolute.
    if (fromSec !== null) setFromInput(toLocalInput(fromSec));
    if (toSec !== null) setToInput(toLocalInput(toSec));
    setCopied(false);
    setOpen((v) => !v);
  };
  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      button={
        <button
          type="button"
          className={BAR_BUTTON}
          aria-expanded={open}
          title={t('wardrive_cov_time_title')}
          onClick={openPanel}
        >
          <Clock className="h-3.5 w-3.5" aria-hidden />
          <span className="max-w-[12rem] truncate">{label}</span>
        </button>
      }
    >
      <p className="mb-1 text-xs font-semibold text-muted-foreground">
        {t('wardrive_cov_time_quick')}
      </p>
      <div className="mb-2 grid grid-cols-2 gap-1">
        {QUICK_RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={quick?.id === r.id}
            className={`rounded px-2 py-1 text-left text-xs ${
              quick?.id === r.id ? 'bg-primary/15 ring-1 ring-primary' : 'hover:bg-muted'
            }`}
            onClick={() => {
              onChange(r.from, r.to);
              setOpen(false);
            }}
          >
            {t(`wardrive_cov_range_${r.id}`)}
          </button>
        ))}
      </div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">
        {t('wardrive_cov_time_absolute')}
      </p>
      <label className="mb-1 block text-xs">
        {t('wardrive_cov_time_from')}
        <input
          type="datetime-local"
          value={fromInput}
          onChange={(e) => setFromInput(e.target.value)}
          className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <label className="mb-2 block text-xs">
        {t('wardrive_cov_time_to')}
        <input
          type="datetime-local"
          value={toInput}
          onChange={(e) => setToInput(e.target.value)}
          className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
          disabled={!fromInput || !toInput}
          onClick={() => {
            onChange(fromInput, toInput);
            setOpen(false);
          }}
        >
          {t('wardrive_cov_time_apply')}
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          title={t('wardrive_cov_time_copy_hint')}
          disabled={fromSec === null || toSec === null}
          onClick={() => {
            if (fromSec === null || toSec === null) return;
            void onCopy(toLocalInput(fromSec), toLocalInput(toSec)).then(() => setCopied(true));
          }}
        >
          {t('wardrive_cov_time_copy')}
        </button>
        {copied && (
          <span className="self-center text-xs text-muted-foreground" aria-live="polite">
            {t('wardrive_cov_time_copied')}
          </span>
        )}
      </div>
    </Dropdown>
  );
}
