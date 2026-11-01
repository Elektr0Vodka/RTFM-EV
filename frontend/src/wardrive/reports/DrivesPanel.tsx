// The list of stored drives: pick drives for a report, and (own drives, or
// every drive for the owner) rename, annotate, split, merge or delete them.
// Shared by the wardrive page and the main app's Tools page; `api` says which
// RTFM-EV endpoints it talks to.
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useLocale, useT } from '../../i18n';
import { driveLabel, formatDuration } from './format';
import type { DriveFilter, DrivesApi, WardriveDrive } from './types';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const pad = (n: number) => String(n).padStart(2, '0');

/** Unix seconds as a datetime-local value (local time, minutes). */
function toLocalInput(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

/** Merge is offered for 2+ picked drives the viewer may change, all of one radio. */
export function canMerge(picked: WardriveDrive[]): boolean {
  if (picked.length < 2 || picked.some((d) => !d.can_edit)) return false;
  const first = picked[0];
  return picked.every((d) => d.radio_key === first.radio_key && d.user_id === first.user_id);
}

function DriveRow({
  drive,
  picked,
  onPick,
  onChanged,
  onDelete,
  api,
  setError,
  showDriver,
}: {
  drive: WardriveDrive;
  picked: boolean;
  onPick: (on: boolean) => void;
  onChanged: () => void;
  onDelete: () => void;
  api: DrivesApi;
  setError: (msg: string | null) => void;
  showDriver: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [mode, setMode] = useState<'view' | 'edit' | 'split'>('view');
  const [name, setName] = useState(drive.name ?? '');
  const [notes, setNotes] = useState(drive.notes ?? '');
  // The middle: the start minute itself is always refused (nothing before it).
  const [splitAt, setSplitAt] = useState(
    toLocalInput(Math.floor((drive.start_ts + drive.end_ts) / 2))
  );
  const [busy, setBusy] = useState(false);
  const label = driveLabel(drive, locale);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setMode('view');
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="space-y-1 rounded-md border border-border p-2 text-sm">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1"
          aria-label={t('wardrive_report_pick', { label })}
          checked={picked}
          onChange={(e) => onPick(e.target.checked)}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">{label}</div>
          <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>{formatDuration(drive.end_ts - drive.start_ts, t)}</span>
            <span>{t('wardrive_report_receptions_n', { count: drive.obs })}</span>
            <span>{drive.radio_name || drive.radio_key.slice(0, 8)}</span>
            {(showDriver || !drive.can_edit) && <span>{drive.username}</span>}
          </div>
          {drive.notes && mode === 'view' && (
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{drive.notes}</p>
          )}
        </div>
      </div>
      {drive.can_edit && mode === 'view' && (
        <div className="flex flex-wrap gap-1 pl-6">
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode('edit')}>
            {t('wardrive_report_edit')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMode('split')}>
            {t('wardrive_report_split')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDelete}>
            {t('wardrive_report_delete')}
          </Button>
        </div>
      )}
      {mode === 'edit' && (
        <form
          className="space-y-2 pl-6"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.update(drive.id, { name: name.trim() || null, notes }));
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('wardrive_report_name')}</span>
            <input
              className="h-8 w-full rounded-md border border-input bg-background px-2"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('wardrive_report_notes')}</span>
            <textarea
              className="w-full rounded-md border border-input bg-background px-2 py-1"
              rows={3}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {t('wardrive_report_save')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setMode('view')}>
              {t('wardrive_report_cancel')}
            </Button>
          </div>
        </form>
      )}
      {mode === 'split' && (
        <form
          className="space-y-2 pl-6"
          onSubmit={(e) => {
            e.preventDefault();
            const at = fromLocalInput(splitAt);
            if (at !== null) void run(() => api.split(drive.id, at));
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">{t('wardrive_report_split_at')}</span>
            <input
              type="datetime-local"
              className="h-8 w-full rounded-md border border-input bg-background px-2"
              value={splitAt}
              min={toLocalInput(drive.start_ts)}
              max={toLocalInput(drive.end_ts)}
              onChange={(e) => setSplitAt(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {t('wardrive_report_split_here')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setMode('view')}>
              {t('wardrive_report_cancel')}
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

export function DrivesPanel({
  api,
  filter,
  reloadKey = '',
  selected,
  onSelectedChange,
  showDriver = false,
}: {
  api: DrivesApi;
  filter: DriveFilter;
  /** Changes when the filter changes, to load again. */
  reloadKey?: string;
  selected: number[];
  onSelectedChange: (ids: number[]) => void;
  /** Show every drive's driver (the owner's view). */
  showDriver?: boolean;
}) {
  const t = useT();
  const [drives, setDrives] = useState<WardriveDrive[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const [deleting, setDeleting] = useState<WardriveDrive | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.drives(filter).then(
      (res) => {
        if (cancelled) return;
        setDrives(res.drives);
        setTruncated(res.truncated);
      },
      (e) => {
        if (!cancelled) setError(errorText(e));
      }
    );
    return () => {
      cancelled = true;
    };
    // `api` and `filter` are fresh objects per render; reloadKey and loads decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, loads]);

  const reload = () => setLoads((n) => n + 1);
  const picked = (drives ?? []).filter((d) => selected.includes(d.id));
  const pick = (id: number, on: boolean) =>
    onSelectedChange(
      on ? [...selected.filter((x) => x !== id), id] : selected.filter((x) => x !== id)
    );

  const merge = async () => {
    setError(null);
    try {
      const merged = await api.merge(picked.map((d) => d.id));
      onSelectedChange([merged.id]);
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const confirmDelete = async () => {
    const target = deleting;
    if (!target) return;
    setDeleting(null);
    setError(null);
    try {
      await api.remove(target.id);
      onSelectedChange(selected.filter((x) => x !== target.id));
      reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {drives === null && !error && (
        <p className="text-sm text-muted-foreground">{t('wardrive_report_loading')}</p>
      )}
      {drives !== null && drives.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('wardrive_report_no_drives')}</p>
      )}
      {drives !== null && drives.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canMerge(picked)}
              onClick={() => void merge()}
            >
              {t('wardrive_report_merge')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={selected.length === 0}
              onClick={() => onSelectedChange([])}
            >
              {t('wardrive_report_clear')}
            </Button>
          </div>
          {picked.length >= 2 && !canMerge(picked) && (
            <p className="text-xs text-muted-foreground">{t('wardrive_report_merge_hint')}</p>
          )}
          <ul className="space-y-2">
            {drives.map((d) => (
              <DriveRow
                key={`${d.id}:${d.name ?? ''}:${d.notes ?? ''}:${d.end_ts}`}
                drive={d}
                picked={selected.includes(d.id)}
                onPick={(on) => pick(d.id, on)}
                onChanged={reload}
                onDelete={() => setDeleting(d)}
                api={api}
                setError={setError}
                showDriver={showDriver}
              />
            ))}
          </ul>
          {truncated && (
            <p className="text-xs text-muted-foreground">{t('wardrive_report_truncated_list')}</p>
          )}
        </>
      )}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('wardrive_report_delete_title')}</DialogTitle>
            <DialogDescription>{t('wardrive_report_delete_body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>
              {t('wardrive_report_cancel')}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()}>
              {t('wardrive_report_delete_confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
