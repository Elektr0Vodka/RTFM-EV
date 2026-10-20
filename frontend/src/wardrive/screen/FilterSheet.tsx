// The filter sheet: time window, packet types, sender id classes, "No path",
// the ignore list and the channels the page decodes with.
import { useState } from 'react';

import { useT, type TFn } from '../../i18n';
import { Button } from '../../components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../../components/ui/sheet';
import { normalizeHashtag } from '../decode/channels';
import {
  ALL_TIME,
  DEFAULT_FILTER,
  ID_CLASSES,
  PACKET_TYPES,
  TIME_WINDOWS,
  activeFilterCount,
  windowMs,
  type Filter,
  type IdClass,
} from '../filters';
import { BOTTOM_SHEET_STYLE } from './sheetStyle';

export interface FilterSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  filter: Filter;
  onChange(f: Filter): void;
  ignore: string[];
  /** Names to show for ignored ids, where known. */
  ignoreNames: Record<string, string>;
  onUnignore(id: string): void;
  /** Hashtag channels RTFM-EV serves (read only here). */
  channels: string[];
  /** Hashtag channels the driver added in this browser. */
  driverChannels: string[];
  onDriverChannels(names: string[]): void;
}

function windowLabel(token: string, t: TFn): string {
  const count = parseInt(token, 10);
  if (token.endsWith('m')) return t('wardrive_page_window_min', { count });
  if (token.endsWith('h')) return t('wardrive_page_window_h', { count });
  return t('wardrive_page_window_d', { count });
}

function Chip({ label, pressed, onClick }: { label: string; pressed: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs ${
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

export function FilterSheet({
  open,
  onOpenChange,
  filter,
  onChange,
  ignore,
  ignoreNames,
  onUnignore,
  channels,
  driverChannels,
  onDriverChannels,
}: FilterSheetProps) {
  const t = useT();
  const [channelName, setChannelName] = useState('');
  const active = activeFilterCount(filter);

  const addChannel = () => {
    const name = normalizeHashtag(channelName);
    if (!name) return;
    setChannelName('');
    if (!driverChannels.includes(name)) onDriverChannels([...driverChannels, name]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] space-y-4 overflow-y-auto"
        style={BOTTOM_SHEET_STYLE}
      >
        <SheetTitle>{t('wardrive_page_filters_title')}</SheetTitle>
        <SheetDescription>{t('wardrive_page_filters_desc')}</SheetDescription>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span>{t('wardrive_page_filters_window')}</span>
            <select
              aria-label={t('wardrive_page_filters_window')}
              value={String(filter.windowMs)}
              onChange={(e) => onChange({ ...filter, windowMs: Number(e.target.value) })}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              {TIME_WINDOWS.map((token) => (
                <option key={token} value={String(windowMs(token))}>
                  {windowLabel(token, t)}
                </option>
              ))}
              <option value={String(ALL_TIME)}>{t('wardrive_page_window_all')}</option>
            </select>
          </label>
          {active > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => onChange({ ...DEFAULT_FILTER, targets: filter.targets })}
            >
              {t('wardrive_page_filters_clear', { count: active })}
            </Button>
          )}
        </div>

        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            {t('wardrive_page_filters_types')}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {PACKET_TYPES.map((p) => (
              <Chip
                key={p.value}
                label={t(p.labelKey)}
                pressed={filter.types.includes(p.value)}
                onClick={() => onChange({ ...filter, types: toggle(filter.types, p.value) })}
              />
            ))}
          </div>
        </section>

        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            {t('wardrive_page_filters_ids')}
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {ID_CLASSES.map((c: IdClass) => (
              <Chip
                key={c}
                label={t(`wardrive_page_idclass_${c}`)}
                pressed={filter.idClasses.includes(c)}
                onClick={() => onChange({ ...filter, idClasses: toggle(filter.idClasses, c) })}
              />
            ))}
          </div>
        </section>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={filter.directOnly}
            onChange={(e) => onChange({ ...filter, directOnly: e.target.checked })}
          />
          {t('wardrive_page_filters_direct')}
        </label>

        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            {t('wardrive_page_filters_ignored')}
          </h3>
          {ignore.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('wardrive_page_filters_ignored_none')}
            </p>
          )}
          <ul className="flex flex-wrap gap-1.5">
            {ignore.map((id) => {
              const name = ignoreNames[id] || id;
              return (
                <li
                  key={id}
                  className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
                >
                  <span>{name}</span>
                  <button
                    type="button"
                    className="rounded px-1 hover:bg-muted"
                    aria-label={t('wardrive_page_filters_unignore', { name })}
                    onClick={() => onUnignore(id)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            {t('wardrive_page_filters_channels')}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t('wardrive_page_filters_channels_desc')}
          </p>
          <div className="text-xs text-muted-foreground">
            {t('wardrive_page_filters_channels_served')}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {channels.length === 0 && (
              <li className="text-sm text-muted-foreground">
                {t('wardrive_page_filters_channels_none')}
              </li>
            )}
            {channels.map((c) => (
              <li key={c} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {c}
              </li>
            ))}
          </ul>
          <div className="text-xs text-muted-foreground">
            {t('wardrive_page_filters_channels_own')}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {driverChannels.map((c) => (
              <li
                key={c}
                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
              >
                <span>{c}</span>
                <button
                  type="button"
                  className="rounded px-1 hover:bg-muted"
                  aria-label={t('wardrive_page_filters_channel_remove', { name: c })}
                  onClick={() => onDriverChannels(driverChannels.filter((x) => x !== c))}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <input
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addChannel();
              }}
              aria-label={t('wardrive_page_filters_channel_name')}
              placeholder="#zwolle"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button
              type="button"
              size="sm"
              onClick={addChannel}
              disabled={!normalizeHashtag(channelName)}
            >
              {t('wardrive_page_filters_channel_add')}
            </Button>
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
