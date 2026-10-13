/**
 * Fleet asset page > Log: what happened to the device, newest first, and a
 * form to add an entry. Status changes and changes of holder are written by
 * the server when the asset is saved; they show their old and new value.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { TFn } from '../../i18n';
import type { FleetAssetEvent, FleetAssetStatus, FleetEventManualKind } from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { FLEET_STATUSES, fleetStatusLabelKey } from './fleetShared';

const MANUAL_KINDS: FleetEventManualKind[] = [
  'maintenance',
  'failure',
  'placement',
  'custody',
  'firmware',
  'note',
];
const NO_VALUE = '-';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `YYYY-MM-DDTHH:MM` in local time, the value format of a datetime-local input. */
function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function changeValue(event: FleetAssetEvent, value: string | null, t: TFn): string {
  if (value === null) return NO_VALUE;
  if (event.kind === 'status' && (FLEET_STATUSES as string[]).includes(value)) {
    return t(fleetStatusLabelKey(value as FleetAssetStatus));
  }
  return value;
}

export function FleetAssetTimeline({
  assetId,
  version,
  onChanged,
}: {
  assetId: number;
  /** Bumped by the page after a save, so entries the server wrote show up. */
  version: number;
  /** Called after an entry was added or removed (the asset's last-maintenance date may move). */
  onChanged?: () => void;
}) {
  const t = useT();
  const [events, setEvents] = useState<FleetAssetEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<FleetEventManualKind>('maintenance');
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [summary, setSummary] = useState('');
  const [detail, setDetail] = useState('');
  const [actor, setActor] = useState('');
  const [saving, setSaving] = useState(false);
  const [armedDelete, setArmedDelete] = useState<number | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setEvents(await api.fleetAssetEvents(assetId, signal));
        setError(null);
      } catch (err) {
        if (!isAbortError(err)) setError(errorMessage(err));
      }
    },
    [assetId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, version]);

  const add = async () => {
    setSaving(true);
    setError(null);
    try {
      const at = new Date(when).getTime();
      await api.addFleetAssetEvent(assetId, {
        kind,
        summary: summary.trim(),
        detail: detail.trim() || null,
        actor: actor.trim() || null,
        ...(Number.isFinite(at) ? { occurred_at: Math.floor(at / 1000) } : {}),
      });
      setSummary('');
      setDetail('');
      await load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  // Two clicks: a removed entry does not come back.
  const remove = async (eventId: number) => {
    if (armedDelete !== eventId) {
      setArmedDelete(eventId);
      return;
    }
    setArmedDelete(null);
    try {
      await api.deleteFleetAssetEvent(assetId, eventId);
      await load();
      onChanged?.();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="fleet-log">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('fleet_log_title')}
      </p>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_auto_1fr]">
        <select
          data-testid="fleet-log-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as FleetEventManualKind)}
          aria-label={t('fleet_log_kind')}
          className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground"
        >
          {MANUAL_KINDS.map((option) => (
            <option key={option} value={option}>
              {t(`fleet_log_kind_${option}`)}
            </option>
          ))}
        </select>
        <Input
          type="datetime-local"
          data-testid="fleet-log-when"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label={t('fleet_log_when')}
          className="h-9 w-auto text-xs"
        />
        <Input
          data-testid="fleet-log-summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_log_summary')}
          aria-label={t('fleet_log_summary')}
          className="h-9 text-xs"
        />
        <Input
          data-testid="fleet-log-actor"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          maxLength={200}
          placeholder={t('fleet_log_actor')}
          aria-label={t('fleet_log_actor')}
          className="h-9 text-xs sm:col-span-2"
        />
        <Input
          data-testid="fleet-log-detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={4000}
          placeholder={t('fleet_log_detail')}
          aria-label={t('fleet_log_detail')}
          className="h-9 text-xs"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="fleet-log-add"
        disabled={saving || summary.trim() === ''}
        onClick={() => void add()}
      >
        {t('fleet_log_add')}
      </Button>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {events !== null && events.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('fleet_log_empty')}</p>
      )}

      {events !== null && events.length > 0 && (
        <ul className="divide-y divide-border text-xs">
          {events.map((event) => (
            <li
              key={event.id}
              data-testid={`fleet-log-entry-${event.id}`}
              className="flex items-start gap-3 py-2"
            >
              <div className="w-36 shrink-0 text-muted-foreground">
                {formatDateTime(event.occurred_at * 1000, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </div>
              <div className="min-w-0 flex-1">
                <span className="mr-2 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t(`fleet_log_kind_${event.kind}`)}
                </span>
                <span className="text-foreground">
                  {event.summary ??
                    t('fleet_log_change', {
                      from: changeValue(event, event.from_value, t),
                      to: changeValue(event, event.to_value, t),
                    })}
                </span>
                {event.actor && (
                  <span className="ml-2 text-muted-foreground">
                    {t('fleet_log_by', { actor: event.actor })}
                  </span>
                )}
                {event.detail && (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{event.detail}</p>
                )}
              </div>
              <button
                type="button"
                data-testid={`fleet-log-delete-${event.id}`}
                onClick={() => void remove(event.id)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                {armedDelete === event.id ? t('fleet_delete_confirm') : t('common_delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
