import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useT } from '../../i18n';
import type { SnmpValues } from '../../types';
import {
  COMPANION_FILTER_KEYS,
  FILTER_DROP_KEYS,
  SNMP_FIELDS,
  formatSnmpValue,
  snmpValueServed,
  type SnmpField,
} from './snmpFields';

/**
 * The SNMP values of one poll as a dashboard, for the SNMP node page on a wide
 * screen. Same fields and formats as `SnmpValueGroups`, laid out by meaning:
 * traffic as a received/sent table, filter drops as a sorted bar list, on/off
 * settings as chips. A field the node does not serve is left out, and so is a
 * card with nothing left. Each value keeps its `snmp-row-<key>` test id.
 */

const FIELD_BY_KEY = new Map(SNMP_FIELDS.map((field) => [field.key, field]));

/** The field when it is shown: always for first-release fields, else only when served. */
function shown(key: string, values: SnmpValues): SnmpField | null {
  const field = FIELD_BY_KEY.get(key);
  if (!field) return null;
  return !field.optional || snmpValueServed(field, values) ? field : null;
}

function shownAll(keys: string[], values: SnmpValues): SnmpField[] {
  return keys.flatMap((key) => shown(key, values) ?? []);
}

function Card({
  title,
  aside,
  testId,
  className,
  children,
}: {
  title: string;
  aside?: ReactNode;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card p-3', className)}
      data-testid={testId}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h4>
        {aside}
      </div>
      {children}
    </div>
  );
}

function FieldList({ fields, values }: { fields: SnmpField[]; values: SnmpValues }) {
  const t = useT();
  if (fields.length === 0) return null;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs">
      {fields.map((field) => (
        <div key={field.key} className="contents" data-testid={`snmp-row-${field.key}`}>
          <dt className="text-muted-foreground">{t(field.labelKey)}</dt>
          <dd className="text-right font-mono tabular-nums">{formatSnmpValue(field, values, t)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A yes/no setting as a chip. `warnWhenOn` for a setting that weakens what it guards. */
function FlagChip({
  field,
  values,
  warnWhenOn,
}: {
  field: SnmpField;
  values: SnmpValues;
  warnWhenOn?: boolean;
}) {
  const t = useT();
  const on = Boolean(values[field.key]);
  return (
    <span
      data-testid={`snmp-row-${field.key}`}
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem]',
        on && !warnWhenOn && 'border-success/40 bg-success/10 text-success',
        on && warnWhenOn && 'border-warning/40 bg-warning/10 text-warning',
        !on && 'border-border text-muted-foreground'
      )}
    >
      {t(field.labelKey)}: {formatSnmpValue(field, values, t)}
    </span>
  );
}

function Chips({ children }: { children: ReactNode }) {
  return <div className="mb-2 flex flex-wrap gap-1.5">{children}</div>;
}

/** A big number with a small label under it. */
function Figure({ field, values, tone }: { field: SnmpField; values: SnmpValues; tone?: 'warn' }) {
  const t = useT();
  return (
    <div data-testid={`snmp-row-${field.key}`}>
      <div
        className={cn(
          'font-mono text-base font-semibold tabular-nums',
          tone === 'warn' ? 'text-warning' : 'text-foreground'
        )}
      >
        {formatSnmpValue(field, values, t)}
      </div>
      <div className="text-[0.625rem] text-muted-foreground">{t(field.labelKey)}</div>
    </div>
  );
}

function numeric(values: SnmpValues, key: string): number {
  const value = values[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * Drop counters as bars, most first. Counters at zero fold behind a toggle so
 * the rules that did something stand out.
 */
function DropBars({ keys, values }: { keys: string[]; values: SnmpValues }) {
  const t = useT();
  const [showZero, setShowZero] = useState(false);
  const fields = shownAll(keys, values);
  if (fields.length === 0) return null;
  const sorted = [...fields].sort((a, b) => numeric(values, b.key) - numeric(values, a.key));
  const nonZero = sorted.filter((field) => numeric(values, field.key) > 0);
  const zeroCount = sorted.length - nonZero.length;
  const max = Math.max(1, ...nonZero.map((field) => numeric(values, field.key)));
  const visible = showZero ? sorted : nonZero;
  return (
    <div className="text-xs">
      {visible.length > 0 && (
        <div className="grid grid-cols-[minmax(0,auto)_1fr_auto] items-center gap-x-3 gap-y-1">
          {visible.map((field) => {
            const value = numeric(values, field.key);
            return (
              <div key={field.key} className="contents" data-testid={`snmp-row-${field.key}`}>
                <span className="truncate text-muted-foreground">{t(field.labelKey)}</span>
                <div className="h-1.5 min-w-8 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(value / max) * 100}%` }}
                  />
                </div>
                <span className="text-right font-mono tabular-nums">
                  {formatSnmpValue(field, values, t)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {zeroCount > 0 && (
        <button
          type="button"
          aria-expanded={showZero}
          onClick={() => setShowZero((prev) => !prev)}
          className="mt-1.5 text-[0.6875rem] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {showZero ? t('snmp_latest_zero_hide') : t('snmp_latest_zero_show', { count: zeroCount })}
        </button>
      )}
    </div>
  );
}

function RadioTrafficCard({ values }: { values: SnmpValues }) {
  const t = useT();
  const rows: { labelKey: string; keys: [string, string, string | null] }[] = [
    { labelKey: 'snmp_latest_row_received', keys: ['recv_flood', 'recv_direct', 'packets_recv'] },
    { labelKey: 'snmp_latest_row_sent', keys: ['sent_flood', 'sent_direct', 'packets_sent'] },
    { labelKey: 'snmp_latest_row_duplicates', keys: ['flood_dups', 'direct_dups', null] },
  ];
  const visibleRows = rows.filter((row) =>
    row.keys.some((key) => key !== null && shown(key, values))
  );
  const figures = shownAll(['recv_errors', 'tx_queue_len', 'tx_duty_percent'], values);
  const errorFlags = shown('error_flags', values);
  const flagsSet = errorFlags !== null && numeric(values, 'error_flags') > 0;
  if (visibleRows.length === 0 && figures.length === 0 && !flagsSet) return null;

  const cell = (key: string | null) => {
    const field = key === null ? null : shown(key, values);
    return (
      <td
        className="border-t border-border px-2 py-1 text-right font-mono tabular-nums"
        data-testid={field ? `snmp-row-${field.key}` : undefined}
      >
        {field ? formatSnmpValue(field, values, t) : ''}
      </td>
    );
  };

  return (
    <Card title={t('snmp_latest_radio_traffic')} testId="snmp-group-radio">
      {visibleRows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[0.6875rem] text-muted-foreground">
              <th className="py-1 text-left font-normal" />
              <th className="px-2 py-1 text-right font-normal">{t('snmp_latest_col_flood')}</th>
              <th className="px-2 py-1 text-right font-normal">{t('snmp_latest_col_direct')}</th>
              <th className="px-2 py-1 text-right font-normal">{t('snmp_latest_col_total')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.labelKey}>
                <th
                  scope="row"
                  className="border-t border-border py-1 text-left font-normal text-muted-foreground"
                >
                  {t(row.labelKey)}
                </th>
                {cell(row.keys[0])}
                {cell(row.keys[1])}
                {cell(row.keys[2])}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {figures.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {figures.map((field) => (
            <Figure
              key={field.key}
              field={field}
              values={values}
              tone={
                field.key === 'recv_errors' && numeric(values, field.key) > 0 ? 'warn' : undefined
              }
            />
          ))}
        </div>
      )}
      {flagsSet && errorFlags && (
        <div className="mt-3" data-testid="snmp-row-error_flags">
          <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[0.6875rem] text-warning">
            {formatSnmpValue(errorFlags, values, t)}
          </span>
        </div>
      )}
    </Card>
  );
}

function SignalCard({ values }: { values: SnmpValues }) {
  const t = useT();
  const signal = shownAll(['last_rssi', 'last_snr', 'noise_floor', 'wifi_rssi'], values);
  const txAir = shown('total_air_time_secs', values);
  const rxAir = shown('rx_air_time_secs', values);
  const neighbours = shown('neighbour_count', values);
  if (signal.length === 0 && !txAir && !rxAir && !neighbours) return null;
  return (
    <Card title={t('snmp_latest_signal')} testId="snmp-latest-signal">
      <FieldList fields={signal} values={values} />
      {(txAir || rxAir) && (
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-t border-border pt-2 text-xs">
          {txAir && (
            <div className="contents" data-testid="snmp-row-total_air_time_secs">
              <dt className="text-muted-foreground">{t('snmp_latest_tx_air_time')}</dt>
              <dd className="text-right font-mono tabular-nums">
                {formatSnmpValue(txAir, values, t)}
              </dd>
            </div>
          )}
          {rxAir && (
            <div className="contents" data-testid="snmp-row-rx_air_time_secs">
              <dt className="text-muted-foreground">{t(rxAir.labelKey)}</dt>
              <dd className="text-right font-mono tabular-nums">
                {formatSnmpValue(rxAir, values, t)}
              </dd>
            </div>
          )}
        </dl>
      )}
      {neighbours && (
        <div
          className="mt-2 flex items-baseline justify-between border-t border-border pt-2 text-xs"
          data-testid="snmp-group-neighbours"
        >
          <span className="text-muted-foreground">{t(neighbours.labelKey)}</span>
          <span
            className="font-mono text-base font-semibold tabular-nums"
            data-testid="snmp-row-neighbour_count"
          >
            {formatSnmpValue(neighbours, values, t)}
          </span>
        </div>
      )}
    </Card>
  );
}

function SystemCard({ values }: { values: SnmpValues }) {
  const t = useT();
  // One reset line: the code reads as "Software reset (3)", the text is the fallback.
  const resetKey = shown('reset_reason_code', values) ? 'reset_reason_code' : 'reset_reason';
  const fields = shownAll(
    ['node_name', 'firmware_version', 'uptime_secs', 'battery_mv', 'mcu_temp_c', resetKey],
    values
  );
  if (fields.length === 0) return null;
  return (
    <Card title={t('snmp_group_system')} testId="snmp-group-system">
      <FieldList fields={fields} values={values} />
    </Card>
  );
}

function FilterCard({ values }: { values: SnmpValues }) {
  const t = useT();
  const enabled = shown('filter_enabled', values);
  const dryRun = shown('filter_dry_run', values);
  const drops = shownAll(FILTER_DROP_KEYS, values);
  const saved = shownAll(['filter_air_saved_ms'], values);
  if (!enabled && !dryRun && drops.length === 0 && saved.length === 0) return null;
  return (
    <Card title={t('snmp_group_filter')} testId="snmp-group-filter">
      {(enabled || dryRun) && (
        <Chips>
          {enabled && <FlagChip field={enabled} values={values} />}
          {dryRun && <FlagChip field={dryRun} values={values} warnWhenOn />}
        </Chips>
      )}
      <DropBars keys={FILTER_DROP_KEYS} values={values} />
      {saved.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <FieldList fields={saved} values={values} />
        </div>
      )}
    </Card>
  );
}

function CompanionFilterCard({ values }: { values: SnmpValues }) {
  const t = useT();
  const enabled = shown('cfilter_enabled', values);
  const drops = shownAll(COMPANION_FILTER_KEYS, values);
  if (!enabled && drops.length === 0) return null;
  return (
    <Card title={t('snmp_group_companion_filter')} testId="snmp-group-companion_filter">
      {enabled && (
        <Chips>
          <FlagChip field={enabled} values={values} />
        </Chips>
      )}
      <DropBars keys={COMPANION_FILTER_KEYS} values={values} />
    </Card>
  );
}

/** A plain card: an optional on/off chip, then the other fields as a list. */
function ListCard({
  group,
  titleKey,
  flagKey,
  keys,
  values,
}: {
  group: string;
  titleKey: string;
  flagKey?: string;
  keys: string[];
  values: SnmpValues;
}) {
  const t = useT();
  const flag = flagKey ? shown(flagKey, values) : null;
  const fields = shownAll(keys, values);
  if (!flag && fields.length === 0) return null;
  return (
    <Card title={t(titleKey)} testId={`snmp-group-${group}`}>
      {flag && (
        <Chips>
          <FlagChip field={flag} values={values} />
        </Chips>
      )}
      <FieldList fields={fields} values={values} />
    </Card>
  );
}

export function SnmpLatestDashboard({ values }: { values: SnmpValues }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="snmp-values">
      <RadioTrafficCard values={values} />
      <SignalCard values={values} />
      <SystemCard values={values} />
      <FilterCard values={values} />
      <ListCard
        group="companion"
        titleKey="snmp_group_companion"
        keys={[
          'companion_tcp_clients',
          'companion_ws_clients',
          'companion_contacts',
          'companion_channels',
        ]}
        values={values}
      />
      <CompanionFilterCard values={values} />
      <ListCard
        group="memory"
        titleKey="snmp_group_memory"
        keys={['free_heap', 'min_free_heap', 'max_alloc', 'internal_free', 'psram_free']}
        values={values}
      />
      <ListCard
        group="mqtt"
        titleKey="snmp_group_mqtt"
        flagKey="ntp_synced"
        keys={['mqtt_connected_slots', 'mqtt_queue_depth', 'mqtt_skipped_publishes']}
        values={values}
      />
      <ListCard
        group="duty_gate"
        titleKey="snmp_group_duty_gate"
        flagKey="dc_gate_enabled"
        keys={['dc_gate_level', 'dc_gate_max_level', 'dc_gate_threshold', 'dc_gate_hysteresis']}
        values={values}
      />
    </div>
  );
}
