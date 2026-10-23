import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useT, type TFn } from '../../i18n';
import { relTime } from '../meshHealthShared';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { SERIES_COLORS, Sparkline } from './PerfCharts';
import { NA, fmtCount, fmtDuration, fmtEvery, fmtMb, fmtMs } from './perfFormat';
import type {
  PerfHealthState,
  PerfLoopRow,
  PerfLoopState,
  PerfPoint,
  PerfRadioQueue,
  PerfSnapshot,
} from './perfTypes';

// ─── Building blocks ────────────────────────────────────────────────────────

export function PerfCard({
  title,
  aside,
  children,
  tone,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  tone?: 'warning';
}) {
  return (
    <section
      className={`min-w-0 rounded-lg border bg-card ${
        tone === 'warning' ? 'border-warning/50' : 'border-border'
      }`}
    >
      <div className="flex items-baseline gap-2 px-3 pt-2.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <h3>{title}</h3>
        {aside && <span className="ml-auto normal-case tracking-normal">{aside}</span>}
      </div>
      <div className="px-3 pb-3 pt-2">{children}</div>
    </section>
  );
}

function KV({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${mono ? 'font-mono text-xs' : 'text-sm font-semibold'}`}>
        {value}
      </span>
    </div>
  );
}

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
            {head}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child]:border-0 [&>tr]:border-b [&>tr]:border-border/50">
          {children}
        </tbody>
      </table>
    </div>
  );
}

const TH = 'px-2 py-1.5 text-left font-medium whitespace-nowrap';
const THR = 'px-2 py-1.5 text-right font-medium whitespace-nowrap';
const TD = 'px-2 py-1.5 whitespace-nowrap';
const TDR = 'px-2 py-1.5 text-right whitespace-nowrap';
const MONO = 'font-mono text-[11px]';

function Empty({ text }: { text: string }) {
  return <p className="py-2 text-xs text-muted-foreground">{text}</p>;
}

// ─── Health strip ───────────────────────────────────────────────────────────

const STATE_CLASS: Record<PerfHealthState, string> = {
  ok: 'bg-success/15 text-success',
  degraded: 'bg-warning/15 text-warning',
  critical: 'bg-destructive/15 text-destructive',
};

export function reasonText(t: TFn, key: string, detail: string): string {
  return t(`perf_reason_${key}`, { detail });
}

export function PerfHealthStrip({ snap }: { snap: PerfSnapshot }) {
  const t = useT();
  const { health, process } = snap;
  const first = health.reasons[0];
  const label =
    health.state === 'ok'
      ? t('perf_state_ok')
      : `${t(`perf_state_${health.state}`)}: ${first ? reasonText(t, first.key, first.detail) : ''}`;
  const more = health.reasons.length - 1;
  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <span
        className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${STATE_CLASS[health.state]}`}
        title={health.reasons.map((r) => reasonText(t, r.key, r.detail)).join('\n')}
      >
        <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
        {label}
        {more > 0 && <span className="font-normal">{t('perf_more_reasons', { count: more })}</span>}
      </span>
      <KV label={t('perf_uptime')} value={fmtDuration(process.uptime_s)} />
      <KV
        label={t('perf_started')}
        value={formatDateTime(process.started_at * 1000, {
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      />
      <KV
        label={t('perf_process')}
        mono
        value={t('perf_process_value', {
          pid: process.pid,
          threads: process.threads ?? NA,
          fds: process.fds ?? NA,
        })}
      />
      <KV
        label={t('perf_host')}
        mono
        value={t('perf_host_value', {
          cores: process.host_cores ?? NA,
          mem: fmtMb(process.host_mem_mb),
          load: process.load1 ?? NA,
        })}
      />
      <KV label={t('perf_memory_limit')} mono value={fmtMb(process.mem_limit_mb)} />
      <KV label={t('perf_python')} mono value={`${process.python} · ${process.platform}`} />
    </section>
  );
}

// ─── KPI tiles ──────────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  unit,
  foot,
  spark,
  color,
  warn,
}: {
  label: string;
  value: string;
  unit?: string;
  foot: string;
  spark: (number | null)[];
  color: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] rounded-lg border bg-card px-3 py-2 ${
        warn ? 'border-warning/50' : 'border-border'
      }`}
    >
      <span className="col-span-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={`text-xl font-semibold tabular-nums leading-snug ${warn ? 'text-warning' : ''}`}
      >
        {value}
        {unit && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{unit}</span>}
      </span>
      <span className="row-span-2 self-end">
        <Sparkline values={spark} color={color} />
      </span>
      <span className="truncate text-[10px] text-muted-foreground tabular-nums">{foot}</span>
    </div>
  );
}

function splitMs(ms: number | null | undefined): [string, string | undefined] {
  const text = fmtMs(ms);
  const [n, u] = text.split(' ');
  return [n, u];
}

export function PerfTiles({ snap, points }: { snap: PerfSnapshot; points: PerfPoint[] }) {
  const t = useT();
  const { process, loop, pipeline, database, radio, tasks } = snap;
  const series = (key: keyof PerfPoint) => points.map((p) => p[key] as number | null);
  const overdue = tasks.filter((x) => x.state === 'overdue');
  const memShare =
    process.rss_mb != null && process.mem_limit_mb
      ? t('perf_tile_mem_of_limit', {
          pct: Math.round((process.rss_mb / process.mem_limit_mb) * 100),
        })
      : t('perf_tile_mem_no_limit');
  const [lagN, lagU] = splitMs(snap.latest?.lag_p95 ?? loop.lag.p95);
  const [dbN, dbU] = splitMs(database.write.hold.p95);
  const [radioN, radioU] = splitMs(radio.hold.p95);
  const latestCpu = snap.latest?.cpu ?? process.cpu_percent;
  return (
    <div className="grid grid-cols-1 gap-2 min-[440px]:grid-cols-2 xl:grid-cols-4">
      <Tile
        label={t('perf_tile_cpu')}
        value={latestCpu == null ? NA : latestCpu.toFixed(1)}
        unit={latestCpu == null ? undefined : '%'}
        foot={t('perf_tile_cpu_foot', { seconds: Math.round(process.cpu_seconds) })}
        spark={series('cpu')}
        color={SERIES_COLORS.primary}
      />
      <Tile
        label={t('perf_tile_memory')}
        value={process.rss_mb == null ? NA : process.rss_mb.toFixed(0)}
        unit={process.rss_mb == null ? undefined : 'MB'}
        foot={memShare}
        spark={series('rss_mb')}
        color={SERIES_COLORS.info}
      />
      <Tile
        label={t('perf_tile_lag')}
        value={lagN}
        unit={lagU}
        foot={t('perf_tile_lag_foot', {
          max: fmtMs(loop.lag.max),
          count: loop.stalls_last_hour,
        })}
        spark={series('lag_p95')}
        color={SERIES_COLORS.warning}
      />
      <Tile
        label={t('perf_tile_tasks')}
        value={fmtCount(snap.latest?.tasks ?? snap.asyncio_tasks.reduce((a, x) => a + x.count, 0))}
        foot={t('perf_tile_tasks_foot', { loops: tasks.length })}
        spark={series('tasks')}
        color={SERIES_COLORS.primary}
      />
      <Tile
        label={t('perf_tile_packets')}
        value={fmtCount(pipeline.per_minute.received)}
        unit={t('perf_per_min')}
        foot={t('perf_tile_packets_foot', { ms: fmtMs(pipeline.stages.total.p95) })}
        spark={series('pkts')}
        color={SERIES_COLORS.primary}
      />
      <Tile
        label={t('perf_tile_db')}
        value={dbN}
        unit={dbU}
        foot={t('perf_tile_db_foot', {
          calls: fmtCount(database.calls_per_minute),
          busy: database.readers_busy,
          readers: database.readers,
        })}
        spark={series('db_p95')}
        color={SERIES_COLORS.primary}
      />
      <Tile
        label={t('perf_tile_radio')}
        value={radioN}
        unit={radioU}
        foot={t('perf_tile_radio_foot', {
          errors: radio.errors,
          reconnects: radio.reconnects.attempts,
        })}
        spark={series('radio_p95')}
        color={SERIES_COLORS.primary}
      />
      <Tile
        label={t('perf_tile_overdue')}
        value={String(overdue.length)}
        foot={overdue.length ? overdue.map((x) => x.name).join(', ') : t('perf_tile_overdue_none')}
        spark={series('warnings')}
        color={SERIES_COLORS.warning}
        warn={overdue.length > 0}
      />
    </div>
  );
}

// ─── Packet pipeline ────────────────────────────────────────────────────────

function Stage({
  name,
  count,
  unit,
  detail,
  note,
  hot,
}: {
  name: string;
  count: string;
  unit?: string;
  detail: string;
  note?: string;
  hot?: boolean;
}) {
  return (
    <div
      className={`flex min-w-[112px] flex-1 flex-col gap-0.5 rounded-md border bg-muted px-2.5 py-2 ${
        hot ? 'border-warning/60' : 'border-border'
      }`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {name}
      </span>
      <span className="text-base font-semibold tabular-nums">
        {count}
        {unit && <span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground">{detail}</span>
      {note && <span className="text-[10px] text-warning">{note}</span>}
    </div>
  );
}

function Arrow() {
  return (
    <ChevronRight className="h-4 w-4 flex-none self-center text-muted-foreground" aria-hidden />
  );
}

export function PerfPipeline({ snap }: { snap: PerfSnapshot }) {
  const t = useT();
  const { pipeline: p, outputs } = snap;
  const s = p.stages;
  const anyTimed = (['parse', 'store', 'process', 'broadcast'] as const).some(
    (k) => (s[k].p95 ?? 0) > 0
  );
  const best = (['parse', 'store', 'process', 'broadcast'] as const).reduce((a, b) =>
    (s[a].p95 ?? 0) >= (s[b].p95 ?? 0) ? a : b
  );
  const slowest = anyTimed ? best : null;
  const stageDetail = (key: keyof typeof s) =>
    t('perf_stage_detail', { avg: fmtMs(s[key].avg), p95: fmtMs(s[key].p95) });
  const failing = outputs.modules.filter((m) => m.status === 'error').length;
  return (
    <PerfCard
      title={t('perf_pipeline_title')}
      aside={
        p.oldest_undecrypted != null
          ? t('perf_pipeline_oldest_undecrypted', { age: relTime(p.oldest_undecrypted, t) })
          : t('perf_pipeline_hint')
      }
    >
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        <Stage
          name={t('perf_stage_rx')}
          count={fmtCount(p.per_minute.received)}
          unit={t('perf_per_min')}
          detail={t('perf_stage_duplicates', { count: p.per_minute.duplicate })}
        />
        <Arrow />
        <Stage
          name={t('perf_stage_parse')}
          count={fmtMs(s.parse.p95)}
          detail={stageDetail('parse')}
          hot={slowest === 'parse'}
        />
        <Arrow />
        <Stage
          name={t('perf_stage_store')}
          count={fmtMs(s.store.p95)}
          detail={stageDetail('store')}
          hot={slowest === 'store'}
        />
        <Arrow />
        <Stage
          name={t('perf_stage_process')}
          count={fmtMs(s.process.p95)}
          detail={stageDetail('process')}
          note={
            p.per_minute.undecrypted || p.per_minute.malformed
              ? t('perf_stage_process_note', {
                  decrypted: p.per_minute.decrypted,
                  undecrypted: p.per_minute.undecrypted,
                  malformed: p.per_minute.malformed,
                })
              : t('perf_stage_decrypted', { count: p.per_minute.decrypted })
          }
          hot={slowest === 'process'}
        />
        <Arrow />
        <Stage
          name={t('perf_stage_broadcast')}
          count={fmtMs(s.broadcast.p95)}
          detail={t('perf_stage_clients', { count: outputs.websocket_clients })}
          hot={slowest === 'broadcast'}
        />
        <Arrow />
        <Stage
          name={t('perf_stage_fanout')}
          count={String(outputs.modules.length)}
          unit={t('perf_stage_modules')}
          detail={
            failing ? t('perf_stage_fanout_failing', { count: failing }) : t('perf_stage_fanout_ok')
          }
        />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">{t('perf_pipeline_p95_note')}</p>
    </PerfCard>
  );
}

export function PerfPacketTypes({ snap }: { snap: PerfSnapshot }) {
  const t = useT();
  const rows = snap.pipeline.by_type;
  return (
    <PerfCard title={t('perf_types_title')} aside={t('perf_since_start')}>
      {rows.length === 0 ? (
        <Empty text={t('perf_none_yet')} />
      ) : (
        <Table
          head={
            <>
              <th className={TH}>{t('perf_col_type')}</th>
              <th className={THR}>{t('perf_col_packets')}</th>
              <th className={THR}>{t('perf_col_avg_process')}</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.type}>
              <td className={`${TD} ${MONO}`}>{r.type}</td>
              <td className={TDR}>{fmtCount(r.count)}</td>
              <td className={TDR}>{fmtMs(r.avg_process_ms)}</td>
            </tr>
          ))}
        </Table>
      )}
    </PerfCard>
  );
}

// ─── Background tasks ───────────────────────────────────────────────────────

const LOOP_CHIP: Record<PerfLoopState, string> = {
  ok: 'bg-success/15 text-success',
  running: 'bg-info/15 text-info',
  overdue: 'bg-warning/15 text-warning',
  idle: 'bg-accent text-muted-foreground',
  error: 'bg-destructive/15 text-destructive',
};

function HourStrip({ row }: { row: PerfLoopRow }) {
  const max = Math.max(1, ...row.hourly.map((c) => c.max_ms ?? 0));
  const w = 70;
  const cell = w / 24;
  return (
    <svg className="inline-block h-4 w-[70px] align-middle" viewBox={`0 0 ${w} 16`} aria-hidden>
      {row.hourly.map((c, i) => {
        const v = c.runs === 0 ? 0.08 : 0.25 + 0.75 * ((c.max_ms ?? 0) / max);
        const fill = c.errors
          ? 'hsl(var(--destructive))'
          : c.runs === 0
            ? 'hsl(var(--muted-foreground))'
            : 'hsl(var(--primary))';
        return (
          <rect
            key={i}
            x={i * cell}
            y={16 - v * 16}
            width={cell - 0.8}
            height={v * 16}
            fill={fill}
            fillOpacity={c.errors ? 0.9 : c.runs === 0 ? 0.3 : 0.6}
          />
        );
      })}
    </svg>
  );
}

export function PerfTasks({ snap, full }: { snap: PerfSnapshot; full?: boolean }) {
  const t = useT();
  const rows = snap.tasks;
  const overdue = rows.filter((r) => r.state === 'overdue').length;
  return (
    <PerfCard
      title={t('perf_tasks_title')}
      aside={t('perf_tasks_aside', { count: rows.length, overdue })}
      tone={overdue ? 'warning' : undefined}
    >
      {rows.length === 0 ? (
        <Empty text={t('perf_tasks_empty')} />
      ) : (
        <Table
          head={
            <>
              <th className={TH}>{t('perf_col_task')}</th>
              <th className={TH}>{t('perf_col_state')}</th>
              <th className={THR}>{t('perf_col_every')}</th>
              <th className={THR}>{t('perf_col_last_run')}</th>
              <th className={THR}>{t('perf_col_took')}</th>
              <th className={TH}>{t('perf_col_24h')}</th>
              <th className={THR}>{t('perf_col_runs')}</th>
              <th className={THR}>{t('perf_col_errors')}</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.name} title={r.last_error ?? undefined}>
              <td className={`${TD} ${MONO}`}>{r.name}</td>
              <td className={TD}>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${LOOP_CHIP[r.state]}`}>
                  {t(`perf_loop_state_${r.state}`)}
                </span>
              </td>
              <td className={`${TDR} text-muted-foreground`}>{fmtEvery(r.every_s)}</td>
              <td className={`${TDR} ${r.state === 'overdue' ? 'text-warning' : ''}`}>
                {r.running_since != null ? t('perf_running_now') : relTime(r.last_start, t)}
              </td>
              <td className={TDR}>{fmtMs(r.last_duration_ms)}</td>
              <td className={TD}>
                <HourStrip row={r} />
              </td>
              <td className={`${TDR} text-muted-foreground`}>{fmtCount(r.runs)}</td>
              <td className={`${TDR} ${r.errors ? 'text-destructive' : 'text-muted-foreground'}`}>
                {r.errors}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {full &&
        rows
          .filter((r) => r.last_error)
          .map((r) => (
            <p key={r.name} className="mt-2 break-words font-mono text-[11px] text-destructive">
              {r.name}: {r.last_error} ({relTime(r.last_error_at, t)})
            </p>
          ))}
    </PerfCard>
  );
}

export function PerfAsyncioTasks({ snap }: { snap: PerfSnapshot }) {
  const t = useT();
  const total = snap.asyncio_tasks.reduce((a, x) => a + x.count, 0);
  return (
    <PerfCard title={t('perf_asyncio_title')} aside={t('perf_asyncio_aside', { count: total })}>
      <Table
        head={
          <>
            <th className={TH}>{t('perf_col_coroutine')}</th>
            <th className={THR}>{t('perf_col_count')}</th>
          </>
        }
      >
        {snap.asyncio_tasks.map((x) => (
          <tr key={x.name}>
            <td className={`${TD} ${MONO}`}>{x.name}</td>
            <td className={TDR}>{x.count}</td>
          </tr>
        ))}
      </Table>
    </PerfCard>
  );
}

// ─── Event loop stalls ──────────────────────────────────────────────────────

export function PerfStalls({ snap, limit }: { snap: PerfSnapshot; limit?: number }) {
  const t = useT();
  const stalls = limit ? snap.loop.stalls.slice(0, limit) : snap.loop.stalls;
  return (
    <PerfCard title={t('perf_stalls_title')} aside={t('perf_stalls_aside')}>
      {stalls.length === 0 ? (
        <Empty text={t('perf_stalls_empty')} />
      ) : (
        <ul className="space-y-2">
          {stalls.map((s, i) => (
            <li
              key={`${s.at}-${i}`}
              className="rounded-md border border-border bg-muted px-2.5 py-2"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 text-xs">
                <span className="font-semibold tabular-nums text-warning">
                  {fmtMs(s.duration_ms)}
                </span>
                <span className="text-muted-foreground">{relTime(s.at, t)}</span>
                {s.task && <span className={`${MONO} text-muted-foreground`}>{s.task}</span>}
              </div>
              {s.stack.length > 0 ? (
                <ol className={`mt-1 space-y-0.5 ${MONO} text-muted-foreground`}>
                  {s.stack.map((line, j) => (
                    <li key={j} className={`break-all ${j === 0 ? 'text-foreground' : ''}`}>
                      {line}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">{t('perf_stall_no_stack')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </PerfCard>
  );
}

// ─── Database ───────────────────────────────────────────────────────────────

export function PerfDatabase({ snap, limit }: { snap: PerfSnapshot; limit?: number }) {
  const t = useT();
  const d = snap.database;
  const rows = limit ? d.slowest.slice(0, limit) : d.slowest;
  return (
    <PerfCard title={t('perf_db_title')} aside={t('perf_db_aside')}>
      <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <KV label={t('perf_db_file')} value={fmtMb(d.file_mb)} />
        <KV label={t('perf_db_wal')} value={fmtMb(d.wal_mb)} />
        <KV
          label={t('perf_db_readers_busy')}
          value={d.readers ? `${d.readers_busy} / ${d.readers}` : NA}
        />
        <KV label={t('perf_db_write_wait')} value={fmtMs(d.write.wait.p95)} />
      </div>
      <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('perf_db_slowest')}
      </h4>
      {rows.length === 0 ? (
        <Empty text={t('perf_none_yet')} />
      ) : (
        <Table
          head={
            <>
              <th className={TH}>{t('perf_col_caller')}</th>
              <th className={THR}>{t('perf_col_p95')}</th>
              <th className={THR}>{t('perf_col_max')}</th>
              <th className={THR}>{t('perf_col_wait')}</th>
              <th className={THR}>{t('perf_col_calls')}</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.caller}>
              <td className={`${TD} ${MONO}`}>
                {r.caller}
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {t(`perf_db_kind_${r.kind}`)}
                </span>
              </td>
              <td className={TDR}>{fmtMs(r.p95_ms)}</td>
              <td className={`${TDR} text-muted-foreground`}>{fmtMs(r.max_ms)}</td>
              <td className={`${TDR} text-muted-foreground`}>{fmtMs(r.wait_p95_ms)}</td>
              <td className={`${TDR} text-muted-foreground`}>{fmtCount(r.calls_last_hour)}</td>
            </tr>
          ))}
        </Table>
      )}
    </PerfCard>
  );
}

// ─── Outputs ────────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'error'
      ? 'bg-destructive/15 text-destructive'
      : status === 'connected'
        ? 'bg-success/15 text-success'
        : 'bg-accent text-muted-foreground';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] ${cls}`}>{status}</span>;
}

export function PerfOutputs({ snap }: { snap: PerfSnapshot }) {
  const t = useT();
  const o = snap.outputs;
  const errors = o.modules.filter((m) => m.last_error);
  return (
    <PerfCard title={t('perf_outputs_title')}>
      <Table
        head={
          <>
            <th className={TH}>{t('perf_col_output')}</th>
            <th className={TH}>{t('perf_col_state')}</th>
            <th className={THR}>{t('perf_col_sent_hour')}</th>
            <th className={THR}>{t('perf_col_p95')}</th>
            <th className={THR}>{t('perf_col_failed')}</th>
          </>
        }
      >
        {o.modules.map((m) => (
          <tr key={m.id}>
            <td className={TD}>
              {m.name}
              <span className="ml-1.5 text-[10px] text-muted-foreground">{m.type}</span>
            </td>
            <td className={TD}>
              <StatusChip status={m.status} />
            </td>
            <td className={TDR}>{fmtCount(m.sent_last_hour ?? 0)}</td>
            <td className={`${TDR} text-muted-foreground`}>{fmtMs(m.p95_ms)}</td>
            <td
              className={`${TDR} ${(m.timeouts ?? 0) + (m.errors ?? 0) ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {(m.timeouts ?? 0) + (m.errors ?? 0)}
            </td>
          </tr>
        ))}
        <tr>
          <td className={TD}>{t('perf_output_websocket')}</td>
          <td className={TD}>
            <StatusChip status={t('perf_clients', { count: o.websocket_clients })} />
          </td>
          <td className={TDR} colSpan={3} />
        </tr>
        <tr>
          <td className={TD}>{t('perf_output_tak')}</td>
          <td className={TD}>
            <StatusChip
              status={
                o.tak_stream.enabled
                  ? t('perf_clients', { count: o.tak_stream.clients })
                  : t('perf_off')
              }
            />
          </td>
          <td className={TDR} colSpan={3} />
        </tr>
        <tr>
          <td className={TD}>{t('perf_output_push')}</td>
          <td className={TD}>
            <StatusChip status={t('perf_devices', { count: o.push_subscriptions ?? 0 })} />
          </td>
          <td className={TDR} colSpan={3} />
        </tr>
      </Table>
      {errors.map((m) => (
        <p key={m.id} className="mt-2 break-words font-mono text-[11px] text-destructive">
          {m.name}: {m.last_error}
        </p>
      ))}
    </PerfCard>
  );
}

// ─── API routes ─────────────────────────────────────────────────────────────

export function PerfRoutes({ snap, limit }: { snap: PerfSnapshot; limit?: number }) {
  const t = useT();
  const rows = limit ? snap.routes.routes.slice(0, limit) : snap.routes.routes;
  return (
    <PerfCard title={t('perf_routes_title')} aside={t('perf_last_hour')}>
      {rows.length === 0 ? (
        <Empty text={t('perf_none_yet')} />
      ) : (
        <Table
          head={
            <>
              <th className={TH}>{t('perf_col_route')}</th>
              <th className={THR}>{t('perf_col_calls')}</th>
              <th className={THR}>{t('perf_col_p50')}</th>
              <th className={THR}>{t('perf_col_p95')}</th>
              <th className={THR}>{t('perf_col_5xx')}</th>
            </>
          }
        >
          {rows.map((r) => (
            <tr key={r.route}>
              <td className={`${TD} ${MONO}`}>{r.route}</td>
              <td className={TDR}>{fmtCount(r.calls)}</td>
              <td className={`${TDR} text-muted-foreground`}>{fmtMs(r.p50_ms)}</td>
              <td className={TDR}>{fmtMs(r.p95_ms)}</td>
              <td
                className={`${TDR} ${r.errors_5xx ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {r.errors_5xx}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </PerfCard>
  );
}

// ─── Radio link ─────────────────────────────────────────────────────────────

export function PerfRadio({ snap, limit }: { snap: PerfSnapshot; limit?: number }) {
  const t = useT();
  const r = snap.radio;
  const ops = limit ? r.ops.slice(0, limit) : r.ops;
  return (
    <PerfCard
      title={t('perf_radio_title')}
      aside={
        r.connected
          ? (r.connection_info ?? t('perf_radio_connected'))
          : r.desired
            ? t('perf_radio_disconnected')
            : t('perf_radio_paused')
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
        <KV label={t('perf_radio_hold_p95')} value={fmtMs(r.hold.p95)} />
        <KV label={t('perf_radio_errors')} value={fmtCount(r.errors)} />
        <KV
          label={t('perf_radio_reconnects')}
          value={`${r.reconnects.ok} / ${r.reconnects.attempts}`}
        />
        <KV
          label={t('perf_radio_last_reconnect')}
          value={r.last_reconnect_at ? relTime(r.last_reconnect_at, t) : NA}
        />
      </div>
      <PerfRadioQueueNow queue={r.queue} />
      <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('perf_radio_slowest')}
      </h4>
      {ops.length === 0 ? (
        <Empty text={t('perf_none_yet')} />
      ) : (
        <Table
          head={
            <>
              <th className={TH}>{t('perf_col_operation')}</th>
              <th className={THR}>{t('perf_col_p95')}</th>
              <th className={THR}>{t('perf_col_wait')}</th>
              <th className={THR}>{t('perf_col_calls')}</th>
              <th className={THR}>{t('perf_col_errors')}</th>
            </>
          }
        >
          {ops.map((op) => (
            <tr key={op.name} title={op.last_error ?? undefined}>
              <td className={`${TD} ${MONO}`}>{op.name}</td>
              <td className={TDR}>{fmtMs(op.p95_ms)}</td>
              <td className={`${TDR} text-muted-foreground`}>{fmtMs(op.wait_p95_ms)}</td>
              <td className={`${TDR} text-muted-foreground`}>{fmtCount(op.calls_last_hour)}</td>
              <td className={`${TDR} ${op.errors ? 'text-destructive' : 'text-muted-foreground'}`}>
                {op.errors}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </PerfCard>
  );
}

/** What holds the radio right now and what waits for it (read-only). */
function PerfRadioQueueNow({ queue }: { queue?: PerfRadioQueue }) {
  const t = useT();
  if (!queue) return null;
  return (
    <div className="mb-3">
      <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('perf_radio_queue_title')}
      </h4>
      {queue.holder === null && queue.waiting.length === 0 ? (
        <Empty text={t('perf_radio_queue_idle')} />
      ) : (
        <ul className={`${MONO} space-y-0.5`}>
          {queue.holder && (
            <li className="flex justify-between gap-2">
              <span>
                <span className="text-muted-foreground">{t('perf_radio_queue_running')} </span>
                {queue.holder.name}
              </span>
              <span className="text-muted-foreground">{fmtMs(queue.holder.held_ms)}</span>
            </li>
          )}
          {queue.waiting.map((w, i) => (
            <li key={`${w.name}-${i}`} className="flex justify-between gap-2">
              <span>
                <span className="text-muted-foreground">
                  {t('perf_radio_queue_waiting', { n: i + 1 })}{' '}
                </span>
                {w.name}
              </span>
              <span className="text-muted-foreground">{fmtMs(w.waited_ms)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Logs ───────────────────────────────────────────────────────────────────

const LEVEL_CLASS: Record<string, string> = {
  WARNING: 'text-warning',
  ERROR: 'text-destructive',
  CRITICAL: 'text-destructive',
};

export function PerfLogs({ snap, limit }: { snap: PerfSnapshot; limit?: number }) {
  const t = useT();
  const rows = limit ? snap.logs.slice(0, limit) : snap.logs;
  return (
    <PerfCard title={t('perf_logs_title')} aside={t('perf_logs_aside')}>
      {rows.length === 0 ? (
        <Empty text={t('perf_logs_empty')} />
      ) : (
        <ul className={`${MONO} divide-y divide-border/50`}>
          {rows.map((r, i) => (
            <li
              key={`${r.ts}-${i}`}
              className="grid grid-cols-[64px_64px_minmax(0,1fr)] gap-2 py-1 sm:grid-cols-[64px_64px_180px_minmax(0,1fr)]"
            >
              <span className="text-muted-foreground">
                {formatDateTime(r.ts * 1000, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
              <span className={LEVEL_CLASS[r.level] ?? 'text-info'}>{r.level}</span>
              <span className="hidden truncate text-muted-foreground sm:block">{r.logger}</span>
              <span className="break-words">{r.message}</span>
            </li>
          ))}
        </ul>
      )}
    </PerfCard>
  );
}
