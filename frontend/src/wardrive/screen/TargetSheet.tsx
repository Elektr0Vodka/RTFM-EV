// The target sheet: pick the senders to follow. A search over name and id,
// a short Top list by signal and age, and every sender heard, six at a time.
import { useEffect, useRef, useState, type UIEvent } from 'react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { useT } from '../../i18n';
import { Button } from '../../components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../../components/ui/sheet';
import { rssiTier, tierColor } from '../signal';
import { senderList, topSenders, type TargetRow } from '../targets';
import { formatAge } from './Hud';
import { BOTTOM_SHEET_STYLE } from './sheetStyle';

const PAGE = 6;

export interface TargetSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  rows: TargetRow[];
  selected: string[];
  nowMs: number;
  onToggle(id: string): void;
  onClear(): void;
}

function Row({
  row,
  pressed,
  nowMs,
  onToggle,
}: {
  row: TargetRow;
  pressed: boolean;
  nowMs: number;
  onToggle(id: string): void;
}) {
  const t = useT();
  const cvd = useCvdMode() !== 'off';
  const name = row.name.name
    ? `${row.name.mark}${row.name.name}`
    : t('wardrive_page_targets_unnamed', { id: row.id.slice(0, 6) });
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onToggle(row.id)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
        pressed ? 'bg-primary/15 ring-1 ring-primary' : 'hover:bg-muted'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {row.sender.kind === 'channel_name' ? row.id : row.id.slice(0, 8)}
        </span>
      </span>
      <span className="flex items-center gap-1 tabular-nums">
        <i
          className="block h-2 w-2 rounded-full"
          style={{ backgroundColor: tierColor(rssiTier(row.rssi), cvd) }}
          aria-hidden="true"
        />
        {row.rssi === null ? '-' : Math.round(row.rssi)}
      </span>
      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
        {formatAge(nowMs - row.at, t)}
      </span>
    </button>
  );
}

export function TargetSheet({
  open,
  onOpenChange,
  rows,
  selected,
  nowMs,
  onToggle,
  onClear,
}: TargetSheetProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const searchRef = useRef<HTMLInputElement>(null);

  // Empty each time it opens (and focused, below).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setLimit(PAGE);
  }, [open]);

  const picked = new Set(selected);
  const list = senderList(rows, query);
  const top = query.trim() ? [] : topSenders(rows, nowMs);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setLimit((n) => n + PAGE);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85dvh] flex-col gap-3"
        style={BOTTOM_SHEET_STYLE}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <SheetTitle>{t('wardrive_page_targets_title')}</SheetTitle>
        <SheetDescription>{t('wardrive_page_targets_desc')}</SheetDescription>
        <div className="flex items-center gap-2">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(PAGE);
            }}
            aria-label={t('wardrive_page_targets_search')}
            placeholder={t('wardrive_page_targets_search')}
            className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          />
          {selected.length > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={onClear}>
              {t('wardrive_page_targets_clear')}
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto" onScroll={onScroll}>
          {top.length > 0 && (
            <section data-testid="wardrive-target-top">
              <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                {t('wardrive_page_targets_top')}
              </h3>
              {top.map((row) => (
                <Row
                  key={row.id}
                  row={row}
                  pressed={picked.has(row.id)}
                  nowMs={nowMs}
                  onToggle={onToggle}
                />
              ))}
            </section>
          )}
          <section data-testid="wardrive-target-list">
            <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              {t('wardrive_page_targets_list')}
            </h3>
            {list.length === 0 && (
              <p className="px-2 py-1 text-sm text-muted-foreground">
                {rows.length === 0
                  ? t('wardrive_page_targets_empty')
                  : t('wardrive_page_targets_none')}
              </p>
            )}
            {list.slice(0, limit).map((row) => (
              <Row
                key={row.id}
                row={row}
                pressed={picked.has(row.id)}
                nowMs={nowMs}
                onToggle={onToggle}
              />
            ))}
            {list.length > limit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 w-full"
                onClick={() => setLimit((n) => n + PAGE)}
              >
                {t('wardrive_page_targets_more')}
              </Button>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
