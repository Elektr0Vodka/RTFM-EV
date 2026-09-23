import { useCallback, useEffect, useState } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { toast } from '../ui/sonner';
import { api } from '../../api';
import { formatTime } from '../../utils/messageParser';
import { useT } from '../../i18n';
import type { AppSettings, AppSettingsUpdate, RetentionStats } from '../../types';

type RetentionField =
  | 'raw_packet_retention_days'
  | 'message_retention_days'
  | 'advert_retention_days'
  | 'telemetry_retention_days'
  | 'telemetry_max_rows_per_node'
  | 'link_signal_retention_days'
  | 'noise_floor_retention_days'
  | 'battery_retention_days'
  | 'airtime_retention_days'
  | 'advert_paths_per_contact'
  | 'retention_prune_interval_hours';

type Unit = 'hours' | 'days' | 'rows' | 'paths';

interface FieldDef {
  field: RetentionField;
  unit: Unit;
  min: number;
  max: number;
}

interface RowDef {
  id: string;
  /** Keys in RetentionStats.classes whose rows are summed for this row. */
  statKeys: string[];
  fields: FieldDef[];
}

const DAYS = (field: RetentionField): FieldDef => ({ field, unit: 'days', min: 0, max: 3650 });

const ROWS: RowDef[] = [
  { id: 'raw_packets', statKeys: ['raw_packets'], fields: [DAYS('raw_packet_retention_days')] },
  { id: 'messages', statKeys: ['messages'], fields: [DAYS('message_retention_days')] },
  { id: 'advert_events', statKeys: ['advert_events'], fields: [DAYS('advert_retention_days')] },
  {
    id: 'telemetry',
    statKeys: ['repeater_telemetry', 'contact_telemetry'],
    fields: [
      DAYS('telemetry_retention_days'),
      { field: 'telemetry_max_rows_per_node', unit: 'rows', min: 0, max: 100000 },
    ],
  },
  { id: 'link_signal', statKeys: ['link_signal'], fields: [DAYS('link_signal_retention_days')] },
  { id: 'noise_floor', statKeys: ['noise_floor'], fields: [DAYS('noise_floor_retention_days')] },
  { id: 'battery', statKeys: ['battery'], fields: [DAYS('battery_retention_days')] },
  { id: 'airtime', statKeys: ['airtime'], fields: [DAYS('airtime_retention_days')] },
  {
    id: 'advert_paths',
    statKeys: ['advert_paths'],
    fields: [{ field: 'advert_paths_per_contact', unit: 'paths', min: 1, max: 100 }],
  },
];

const INTERVAL: FieldDef = {
  field: 'retention_prune_interval_hours',
  unit: 'hours',
  min: 1,
  max: 168,
};

const ALL_FIELDS: FieldDef[] = [INTERVAL, ...ROWS.flatMap((r) => r.fields)];

/** Defaults from the backend (models.py RETENTION_DEFAULTS + the two older settings). */
export const RETENTION_DEFAULT_VALUES: Record<RetentionField, number> = {
  retention_prune_interval_hours: 24,
  raw_packet_retention_days: 0,
  message_retention_days: 0,
  advert_retention_days: 30,
  telemetry_retention_days: 30,
  telemetry_max_rows_per_node: 1000,
  link_signal_retention_days: 30,
  noise_floor_retention_days: 0,
  battery_retention_days: 0,
  airtime_retention_days: 0,
  advert_paths_per_contact: 10,
};

/** "Keep everything": every age limit and row cap off; interval and path count untouched. */
export const RETENTION_ANALYZER_VALUES: AppSettingsUpdate = {
  raw_packet_retention_days: 0,
  message_retention_days: 0,
  advert_retention_days: 0,
  telemetry_retention_days: 0,
  telemetry_max_rows_per_node: 0,
  link_signal_retention_days: 0,
  noise_floor_retention_days: 0,
  battery_retention_days: 0,
  airtime_retention_days: 0,
};

function currentValue(settings: AppSettings, field: RetentionField): number {
  const value = settings[field];
  return typeof value === 'number' ? value : RETENTION_DEFAULT_VALUES[field];
}

function draftsFrom(settings: AppSettings): Record<RetentionField, string> {
  const drafts = {} as Record<RetentionField, string>;
  for (const def of ALL_FIELDS) drafts[def.field] = String(currentValue(settings, def.field));
  return drafts;
}

export function SettingsRetentionSection({
  appSettings,
  persist,
  onAfterPrune,
}: {
  appSettings: AppSettings;
  /** Save an update; ``revert`` runs if the save fails. */
  persist: (update: AppSettingsUpdate, revert: () => void) => Promise<void>;
  onAfterPrune?: () => Promise<void>;
}) {
  const t = useT();
  const [drafts, setDrafts] = useState<Record<RetentionField, string>>(() =>
    draftsFrom(appSettings)
  );
  const [stats, setStats] = useState<RetentionStats | null>(null);
  const [pruning, setPruning] = useState(false);

  useEffect(() => {
    setDrafts(draftsFrom(appSettings));
  }, [appSettings]);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api.getRetentionStats());
    } catch (err) {
      console.error('Failed to load retention stats:', err);
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const setDraft = (field: RetentionField, value: string) =>
    setDrafts((prev) => ({ ...prev, [field]: value }));

  const revertField = (field: RetentionField) =>
    setDraft(field, String(currentValue(appSettings, field)));

  const commitField = async (def: FieldDef) => {
    const { field } = def;
    const raw = drafts[field];
    const next = Number(raw);
    const prev = currentValue(appSettings, field);
    if (raw.trim() === '' || !Number.isInteger(next) || next < def.min || next > def.max) {
      revertField(field);
      return;
    }
    if (next === prev) return;

    // Messages are user-visible and deletion is permanent: confirm when the
    // new value would delete anything (enabling pruning, or tightening it).
    if (field === 'message_retention_days' && next > 0 && (prev === 0 || next < prev)) {
      let count = 0;
      try {
        count = (await api.getRetentionStats(next)).messages_would_delete ?? 0;
      } catch (err) {
        console.error('Failed to preview message retention:', err);
      }
      if (!window.confirm(t('settings_retention_messages_confirm', { count, days: next }))) {
        revertField(field);
        return;
      }
    }

    await persist({ [field]: next }, () => revertField(field));
    void refreshStats();
  };

  const applyPreset = async (values: AppSettingsUpdate, confirmKey: string) => {
    if (!window.confirm(t(confirmKey))) return;
    await persist(values, () => setDrafts(draftsFrom(appSettings)));
    void refreshStats();
  };

  const handlePruneNow = async () => {
    setPruning(true);
    try {
      const result = await api.runRetentionPrune();
      const count = Object.values(result.deleted).reduce((sum, n) => sum + n, 0);
      toast.success(t('settings_retention_toast_pruned_title'), {
        description: t('settings_retention_toast_pruned_desc', { count }),
      });
      await refreshStats();
      if (onAfterPrune) await onAfterPrune();
    } catch (err) {
      console.error('Failed to run retention prune:', err);
      toast.error(t('settings_retention_toast_failed_title'), {
        description: err instanceof Error ? err.message : t('error_unknown'),
      });
    } finally {
      setPruning(false);
    }
  };

  const statFor = (row: RowDef) => {
    if (!stats) return { rows: null as number | null, oldest: null as number | null };
    const matches = stats.classes.filter((c) => row.statKeys.includes(c.key));
    const rows = matches.reduce((sum, c) => sum + c.rows, 0);
    const oldestValues = matches
      .map((c) => c.oldest_ts)
      .filter((v): v is number => typeof v === 'number');
    return { rows, oldest: oldestValues.length ? Math.min(...oldestValues) : null };
  };

  const unitLabel = (unit: Unit) => {
    switch (unit) {
      case 'hours':
        return t('settings_retention_unit_hours');
      case 'days':
        return t('settings_retention_unit_days');
      case 'rows':
        return t('settings_retention_unit_rows');
      case 'paths':
        return t('settings_retention_unit_paths');
    }
  };

  const renderInput = (def: FieldDef, name: string) => (
    <div key={def.field} className="flex items-center gap-1.5">
      <Input
        id={`retention-${def.field}`}
        type="number"
        min={def.min}
        max={def.max}
        value={drafts[def.field]}
        aria-label={t('settings_retention_input_label', { name, unit: unitLabel(def.unit) })}
        onChange={(e) => setDraft(def.field, e.target.value)}
        onBlur={() => void commitField(def)}
        className="w-24"
      />
      <span className="text-xs text-muted-foreground">
        {unitLabel(def.unit)}
        {drafts[def.field] === '0' && def.min === 0 && (
          <span className="ml-1">({t('settings_retention_no_limit')})</span>
        )}
      </span>
    </div>
  );

  const now = Date.now() / 1000;

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold tracking-tight">{t('settings_retention_heading')}</h3>
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_retention_desc')}</p>

      <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="retention-retention_prune_interval_hours" className="text-sm">
            {t('settings_retention_interval_label')}
          </label>
          <Input
            id="retention-retention_prune_interval_hours"
            type="number"
            min={INTERVAL.min}
            max={INTERVAL.max}
            value={drafts.retention_prune_interval_hours}
            onChange={(e) => setDraft('retention_prune_interval_hours', e.target.value)}
            onBlur={() => void commitField(INTERVAL)}
            className="w-20"
          />
          <span className="text-xs text-muted-foreground">{unitLabel('hours')}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handlePruneNow()}
            disabled={pruning}
            className="ml-auto"
          >
            {pruning ? t('settings_retention_pruning') : t('settings_retention_prune_now')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {stats?.last_run_at
            ? t('settings_retention_last_run', { time: formatTime(stats.last_run_at) })
            : t('settings_retention_never_run')}
          {stats?.next_run_at
            ? ` · ${t('settings_retention_next_run', { time: formatTime(stats.next_run_at) })}`
            : ''}
        </p>
      </div>

      <div className="space-y-2">
        {ROWS.map((row) => {
          const name = t(`settings_retention_class_${row.id}`);
          const { rows, oldest } = statFor(row);
          return (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border p-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{name}</div>
                <div className="text-xs text-muted-foreground">
                  {t('settings_retention_row_stats', {
                    rows: rows ?? '?',
                    oldest:
                      oldest !== null
                        ? t('settings_retention_days_ago', {
                            count: Math.max(0, Math.floor((now - oldest) / 86400)),
                          })
                        : t('settings_db_none'),
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {row.fields.map((def) => renderInput(def, name))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void applyPreset(RETENTION_ANALYZER_VALUES, 'settings_retention_analyzer_confirm')
          }
        >
          {t('settings_retention_analyzer_button')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void applyPreset(RETENTION_DEFAULT_VALUES, 'settings_retention_defaults_confirm')
          }
        >
          {t('settings_retention_defaults_button')}
        </Button>
      </div>
    </div>
  );
}
