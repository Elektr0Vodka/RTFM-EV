import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import type { DeviceConfigHistoryEntry, DeviceConfigKind, PaneState } from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import {
  buildConfigHistory,
  formatConfigValue,
  type ConfigSnapshotView,
} from '../../utils/deviceConfigHistory';
import { RepeaterPane } from './repeaterPaneShared';

const KIND_TITLE_KEYS: Record<DeviceConfigKind, string> = {
  node_info: 'repeater_node_info_title',
  radio_settings: 'repeater_radio_settings_title',
  advert_intervals: 'repeater_advert_intervals_title',
  owner_info: 'repeater_owner_info_title',
  regions: 'repeater_regions_title',
};

/** Snapshots shown per kind before "Show all". */
const COLLAPSED_COUNT = 5;

function snapshotTime(timestamp: number): string {
  return formatDateTime(new Date(timestamp * 1000), {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SnapshotRow({ snapshot }: { snapshot: ConfigSnapshotView }) {
  const t = useT();
  const firstFields = Object.entries(snapshot.data);
  return (
    <li className="py-1.5 border-t border-border/60 first:border-t-0">
      <div className="text-xs text-muted-foreground">
        {snapshotTime(snapshot.timestamp)}
        {snapshot.changes === null && ` · ${t('repeater_config_history_first')}`}
      </div>
      <div className="mt-0.5 space-y-0.5 text-xs font-mono break-all">
        {snapshot.changes === null ? (
          firstFields.map(([field, value]) => (
            <div key={field}>
              <span className="text-muted-foreground">{field}:</span> {formatConfigValue(value)}
            </div>
          ))
        ) : snapshot.changes.length === 0 ? (
          <div className="text-muted-foreground font-sans">
            {t('repeater_config_history_no_changes')}
          </div>
        ) : (
          snapshot.changes.map((c) => (
            <div key={c.field}>
              <span className="text-muted-foreground">{c.field}:</span>{' '}
              <span className="text-destructive line-through">{formatConfigValue(c.before)}</span>
              {' → '}
              <span className="text-success">{formatConfigValue(c.after)}</span>
            </div>
          ))
        )}
      </div>
    </li>
  );
}

/**
 * Read-only history of the repeater dashboard panes (plan 14): stored snapshots
 * per pane, each diffed against the previous one. Reads
 * `GET /contacts/{key}/repeater/config-history` only; never touches the radio.
 * `reloadKey` changes when a pane fetch completes, so a new snapshot shows up.
 */
export function RepeaterConfigHistoryPane({
  publicKey,
  reloadKey,
}: {
  publicKey: string;
  reloadKey?: string;
}) {
  const t = useT();
  const [entries, setEntries] = useState<DeviceConfigHistoryEntry[] | null>(null);
  const [state, setState] = useState<PaneState>({ loading: false, attempt: 0, error: null });
  const [expanded, setExpanded] = useState<Set<DeviceConfigKind>>(new Set());

  const load = useCallback(async () => {
    setState({ loading: true, attempt: 1, error: null });
    try {
      const rows = await api.repeaterConfigHistory(publicKey);
      setEntries(rows);
      setState({ loading: false, attempt: 0, error: null, fetched_at: Date.now() });
    } catch (err) {
      setState({
        loading: false,
        attempt: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [publicKey]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const history = useMemo(() => buildConfigHistory(entries ?? []), [entries]);

  const toggle = (kind: DeviceConfigKind) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  return (
    <RepeaterPane
      title={t('repeater_config_history_title')}
      headerNote={t('repeater_config_history_note')}
      state={state}
      onRefresh={() => void load()}
    >
      {entries !== null && history.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">{t('repeater_config_history_empty')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {history.map(({ kind, snapshots }) => {
            const open = expanded.has(kind);
            const shown = open ? snapshots : snapshots.slice(0, COLLAPSED_COUNT);
            return (
              <div key={kind} data-testid={`config-history-${kind}`}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(KIND_TITLE_KEYS[kind])}
                </h4>
                <ul>
                  {shown.map((s, i) => (
                    <SnapshotRow key={`${s.timestamp}-${i}`} snapshot={s} />
                  ))}
                </ul>
                {snapshots.length > COLLAPSED_COUNT && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-primary hover:underline"
                    onClick={() => toggle(kind)}
                  >
                    {open
                      ? t('repeater_config_history_show_less')
                      : t('repeater_config_history_show_all', { count: snapshots.length })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </RepeaterPane>
  );
}
