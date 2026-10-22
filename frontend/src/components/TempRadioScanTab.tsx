import { useCallback, useEffect, useState } from 'react';

import { api } from '../api';
import { useT } from '../i18n';
import type { RadioScanList, RadioScanListRequest, RadioStamp, TempRadioOptIns } from '../types';
import { parseRadioFields } from '../utils/radioSf';
import { setScanState, useScanState } from '../utils/tempRadio';
import { TempRadioOptInFields } from './TempRadioModal';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface TempRadioScanTabProps {
  open: boolean;
  /** Prefill for a new entry. */
  normal: RadioStamp | null;
}

interface EntryDraft {
  freq: string;
  bw: string;
  sf: string;
  cr: string;
  region: string;
  dwell: string;
}

interface ListDraft {
  id: number | null;
  name: string;
  entries: EntryDraft[];
  rounds: string;
  normalBetween: string;
  hold: string;
  optIns: TempRadioOptIns;
}

const NO_OPT_INS: TempRadioOptIns = {
  adverts: false,
  team_beacon: false,
  telemetry: false,
  client_repeat: false,
  polls: false,
  fanout_ids: [],
};

function entryFrom(stamp: RadioStamp | null, region = '', dwell = '60'): EntryDraft {
  return {
    freq: stamp ? String(stamp.freq) : '',
    bw: stamp ? String(stamp.bw) : '',
    sf: stamp ? String(stamp.sf) : '',
    cr: stamp ? String(stamp.cr) : '',
    region,
    dwell,
  };
}

function draftFromList(list: RadioScanList): ListDraft {
  return {
    id: list.id,
    name: list.name,
    entries: list.entries.map((e) =>
      entryFrom(e.radio, e.region ? e.region.replace(/^#/, '') : '', String(e.dwell_secs))
    ),
    rounds: String(list.rounds),
    normalBetween: String(list.normal_between_secs),
    hold: String(list.hold_on_activity_secs),
    optIns: list.opt_ins,
  };
}

function wholeNumber(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Scan lists (spec 4.7): create, edit, delete, run, stop. */
export function TempRadioScanTab({ open, normal }: TempRadioScanTabProps) {
  const t = useT();
  const scan = useScanState();
  const [lists, setLists] = useState<RadioScanList[]>([]);
  const [draft, setDraft] = useState<ListDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setLists(await api.getScanLists());
    } catch {
      setLists([]);
    }
  }, []);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const fail = (err: unknown) =>
    setError(
      t('temp_radio_scan_failed', { error: err instanceof Error ? err.message : String(err) })
    );

  const run = async (list: RadioScanList) => {
    setBusy(true);
    setError(null);
    try {
      setScanState(await api.runScanList(list.id));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      setScanState(await api.stopScan());
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (list: RadioScanList) => {
    setBusy(true);
    try {
      await api.deleteScanList(list.id);
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const updateEntry = (index: number, patch: Partial<EntryDraft>) =>
    setDraft((d) =>
      d ? { ...d, entries: d.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)) } : d
    );

  const save = async () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError(t('temp_radio_scan_error_name'));
      return;
    }
    const entries: RadioScanListRequest['entries'] = [];
    for (const [i, e] of draft.entries.entries()) {
      const parsed = parseRadioFields(e);
      if (parsed.error) {
        setError(t('temp_radio_scan_error_entry', { n: i + 1, error: t(parsed.error) }));
        return;
      }
      const dwell = wholeNumber(e.dwell);
      if (dwell === null || dwell <= 0) {
        setError(t('temp_radio_scan_error_dwell', { n: i + 1 }));
        return;
      }
      const region = e.region.trim();
      entries.push({ radio: parsed.stamp, region: region || null, dwell_secs: dwell });
    }
    const rounds = wholeNumber(draft.rounds);
    const normalBetween = wholeNumber(draft.normalBetween);
    const hold = wholeNumber(draft.hold);
    if (rounds === null || normalBetween === null || hold === null) {
      setError(t('temp_radio_scan_error_number'));
      return;
    }
    const request: RadioScanListRequest = {
      name: draft.name.trim(),
      entries,
      rounds,
      normal_between_secs: normalBetween,
      hold_on_activity_secs: hold,
      opt_ins: draft.optIns,
    };
    setBusy(true);
    setError(null);
    try {
      if (draft.id === null) await api.createScanList(request);
      else await api.updateScanList(draft.id, request);
      setDraft(null);
      await reload();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  if (draft) {
    return (
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="scan-list-name">{t('temp_radio_scan_name_label')}</Label>
          <Input
            id="scan-list-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>

        {draft.entries.map((entry, i) => {
          const n = i + 1;
          const field = (key: keyof EntryDraft, labelKey: string) => (
            <Input
              aria-label={t(labelKey, { n })}
              placeholder={t(labelKey, { n })}
              value={entry[key]}
              onChange={(e) => updateEntry(i, { [key]: e.target.value })}
            />
          );
          return (
            <fieldset key={i} className="space-y-1.5 rounded-md border border-border p-2">
              <legend className="px-1 text-xs font-medium">
                {t('temp_radio_scan_entry_heading', { n })}
              </legend>
              <div className="grid grid-cols-3 gap-1.5">
                {field('freq', 'temp_radio_scan_entry_freq')}
                {field('bw', 'temp_radio_scan_entry_bw')}
                {field('sf', 'temp_radio_scan_entry_sf')}
                {field('cr', 'temp_radio_scan_entry_cr')}
                {field('region', 'temp_radio_scan_entry_region')}
                {field('dwell', 'temp_radio_scan_entry_dwell')}
              </div>
              {draft.entries.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() =>
                    setDraft({ ...draft, entries: draft.entries.filter((_, j) => j !== i) })
                  }
                >
                  {t('temp_radio_scan_entry_remove', { n })}
                </Button>
              )}
            </fieldset>
          );
        })}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const last = draft.entries[draft.entries.length - 1];
            setDraft({
              ...draft,
              entries: [...draft.entries, last ? { ...last } : entryFrom(normal)],
            });
          }}
        >
          {t('temp_radio_scan_add_entry')}
        </Button>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="scan-rounds">{t('temp_radio_scan_rounds')}</Label>
            <Input
              id="scan-rounds"
              value={draft.rounds}
              onChange={(e) => setDraft({ ...draft, rounds: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scan-normal-between">{t('temp_radio_scan_normal_between')}</Label>
            <Input
              id="scan-normal-between"
              value={draft.normalBetween}
              onChange={(e) => setDraft({ ...draft, normalBetween: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="scan-hold">{t('temp_radio_scan_hold')}</Label>
            <Input
              id="scan-hold"
              value={draft.hold}
              onChange={(e) => setDraft({ ...draft, hold: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('temp_radio_scan_hold_hint')}</p>

        <TempRadioOptInFields
          value={draft.optIns}
          onChange={(optIns) => setDraft({ ...draft, optIns })}
          idPrefix="scan-optin"
          open={open}
        />

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setDraft(null)}>
            {t('temp_radio_cancel')}
          </Button>
          <Button type="button" disabled={busy} onClick={save}>
            {t('temp_radio_scan_save')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('temp_radio_scan_intro')}</p>
      {scan.running && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
          <span>{t('temp_radio_scan_running', { name: scan.list_name ?? '' })}</span>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={stop}>
            {t('temp_radio_scan_stop')}
          </Button>
        </div>
      )}
      {lists.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('temp_radio_scan_none')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {lists.map((list) => (
            <li key={list.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{list.name}</span>
              <span className="text-xs text-muted-foreground">
                {t('temp_radio_scan_entries_count', { count: list.entries.length })}
              </span>
              <Button
                type="button"
                size="sm"
                className="h-7"
                disabled={busy}
                aria-label={t('temp_radio_scan_run', { name: list.name })}
                onClick={() => run(list)}
              >
                {t('temp_radio_scan_run_short')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                aria-label={t('temp_radio_scan_edit', { name: list.name })}
                onClick={() => {
                  setError(null);
                  setDraft(draftFromList(list));
                }}
              >
                {t('temp_radio_scan_edit_short')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                disabled={busy}
                aria-label={t('temp_radio_scan_delete', { name: list.name })}
                onClick={() => remove(list)}
              >
                {t('temp_radio_scan_delete_short')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setError(null);
          setDraft({
            id: null,
            name: '',
            entries: [entryFrom(normal)],
            rounds: '0',
            normalBetween: '0',
            hold: '0',
            optIns: NO_OPT_INS,
          });
        }}
      >
        {t('temp_radio_scan_new')}
      </Button>
    </div>
  );
}
