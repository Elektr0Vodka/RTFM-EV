// The coverage map's filter panel (map.mesh-hunter.eu's Filters): packet
// types, sender id class, No path, ignored senders, the layer mode and the
// Filtered/All stand, and Clear filters.
import { SlidersHorizontal, X } from 'lucide-react';
import { useState } from 'react';

import { useT } from '../../i18n';
import { PACKET_TYPES, packetTypeLabel } from '../filters';
import { BAR_BUTTON, Dropdown } from './Dropdown';
import { ID_CLASSES, type CoverageState, type LayerMode, type Stand } from './state';

const MODES: LayerMode[] = ['points', 'hex', 'auto'];
const STANDS: Stand[] = ['filtered', 'all'];

const chip = (on: boolean) =>
  `rounded-full border px-2 py-0.5 text-xs ${
    on ? 'border-primary bg-primary/15 text-foreground' : 'border-border hover:bg-muted'
  }`;

/** How many narrowing filters are on (the pill's count). */
export function filterCount(s: CoverageState): number {
  return (
    (s.types.length ? 1 : 0) +
    (s.idclass.length ? 1 : 0) +
    (s.nopath ? 1 : 0) +
    (s.senderPrefix ? 1 : 0)
  );
}

const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

export function FilterPanel({
  state,
  ignore,
  ignoreNames,
  onChange,
  onUnignore,
  onClearIgnore,
  onClearFilters,
}: {
  state: CoverageState;
  ignore: string[];
  ignoreNames: Record<string, string | null>;
  onChange(patch: Partial<CoverageState>): void;
  onUnignore(id: string): void;
  onClearIgnore(): void;
  onClearFilters(): void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const count = filterCount(state);
  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      wide
      button={
        <button
          type="button"
          className={BAR_BUTTON}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          {t('wardrive_page_filters')}
          {count > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {count}
            </span>
          )}
        </button>
      }
    >
      <div className="space-y-3 text-sm">
        <section>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            {t('wardrive_cov_view')}
          </p>
          <div className="flex gap-1">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={state.mode === m}
                className={chip(state.mode === m)}
                onClick={() => onChange({ mode: m })}
              >
                {t(`wardrive_cov_mode_${m}`)}
              </button>
            ))}
          </div>
        </section>
        <section>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            {t('wardrive_cov_stand')}
          </p>
          <div className="flex gap-1">
            {STANDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={state.stand === s}
                className={chip(state.stand === s)}
                onClick={() => onChange({ stand: s })}
              >
                {t(`wardrive_cov_stand_${s}`)}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t('wardrive_cov_stand_hint')}</p>
        </section>
        <section>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            {t('wardrive_page_filters_types')}
          </p>
          <div className="flex flex-wrap gap-1">
            {PACKET_TYPES.map((p) => (
              <button
                key={p.value}
                type="button"
                aria-pressed={state.types.includes(p.value)}
                className={chip(state.types.includes(p.value))}
                onClick={() => onChange({ types: toggle(state.types, p.value) })}
              >
                {packetTypeLabel(p.value, t)}
              </button>
            ))}
          </div>
        </section>
        <section>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            {t('wardrive_page_filters_ids')}
          </p>
          <div className="flex flex-wrap gap-1">
            {ID_CLASSES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={state.idclass.includes(c)}
                className={chip(state.idclass.includes(c))}
                onClick={() => onChange({ idclass: toggle(state.idclass, c) })}
              >
                {t(`wardrive_page_idclass_${c}`)}
              </button>
            ))}
          </div>
        </section>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={state.nopath}
            onChange={(e) => onChange({ nopath: e.target.checked })}
          />
          {t('wardrive_page_filters_direct')}
        </label>
        <section>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            {t('wardrive_page_filters_ignored')}
          </p>
          {ignore.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('wardrive_page_filters_ignored_none')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1">
                {ignore.map((id) => {
                  const name = ignoreNames[id] ?? id;
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
                    >
                      {name}
                      <button
                        type="button"
                        aria-label={t('wardrive_page_filters_unignore', { name })}
                        onClick={() => onUnignore(id)}
                      >
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </span>
                  );
                })}
              </div>
              <button
                type="button"
                className="mt-1 rounded px-2 py-0.5 text-xs hover:bg-muted"
                onClick={onClearIgnore}
              >
                {t('wardrive_cov_ignore_clear')}
              </button>
            </>
          )}
        </section>
        <button
          type="button"
          aria-pressed={state.locate}
          className={`w-full rounded-md border px-2 py-1 text-sm ${
            state.locate ? 'border-primary bg-primary/15' : 'border-border hover:bg-muted'
          }`}
          onClick={() => onChange({ locate: !state.locate })}
        >
          {t('wardrive_cov_locate')}
        </button>
        <button
          type="button"
          className="w-full rounded-md border border-border px-2 py-1 text-sm hover:bg-muted"
          onClick={onClearFilters}
        >
          {t('wardrive_cov_clear_filters')}
        </button>
      </div>
    </Dropdown>
  );
}
