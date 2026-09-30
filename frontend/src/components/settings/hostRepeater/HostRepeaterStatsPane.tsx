import { Button } from '../../ui/button';
import { useT } from '../../../i18n';
import type { HostRepeaterPercentiles, HostRepeaterStats } from '../../../types';
import { formatDateTime } from '../../../utils/dateTimeFormat';

interface Props {
  stats: HostRepeaterStats | null;
  /** `lifetime` also starts the persisted totals over. */
  onReset: (lifetime?: boolean) => void;
}

const RECENT_ROWS = 25;

function fmtMs(v: number | null | undefined): string {
  return v == null ? '-' : `${Math.round(v)} ms`;
}

function reasonKey(reason: string): string {
  // Forwards are stored as "forward:<kind>"; drops are the bare reason code.
  return reason.startsWith('forward:')
    ? `settings_host_repeater_forward_${reason.slice('forward:'.length)}`
    : `settings_host_repeater_reason_${reason}`;
}

/** Reason label; filter dry-run hits ("dryrun:<reason>") get a dry-run prefix. */
function reasonLabel(t: ReturnType<typeof useT>, reason: string): string {
  if (reason.startsWith('dryrun:')) {
    return t('settings_host_repeater_reason_dryrun', {
      reason: t(reasonKey(reason.slice('dryrun:'.length))),
    });
  }
  return t(reasonKey(reason));
}

function FilterDetail({ stats }: { stats: HostRepeaterStats }) {
  const t = useT();
  const f = stats.filter;
  if (!f || (!f.enabled && f.dryrun_hits === 0)) return null;
  const totals = Object.entries(f.totals).filter(([, n]) => n > 0);
  const malformed = Object.entries(f.malformed).filter(([, n]) => n > 0);
  return (
    <div className="grid gap-1 rounded border border-input p-2 text-sm">
      <span className="font-semibold">
        {t(
          f.dryrun
            ? 'settings_host_repeater_filter_stats_dryrun'
            : 'settings_host_repeater_filter_stats'
        )}
      </span>
      <span className="text-muted-foreground">
        {totals.length > 0
          ? totals.map(([k, n]) => `${k}: ${n}`).join(' | ')
          : t('settings_host_repeater_filter_stats_none')}
      </span>
      <span className="text-muted-foreground">
        {t('settings_host_repeater_filter_stats_air', { ms: Math.round(f.air_ms) })}
      </span>
      {malformed.length > 0 && (
        <span className="text-muted-foreground">
          {t('settings_host_repeater_filter_stats_malformed', {
            list: malformed.map(([k, n]) => `${k}: ${n}`).join(', '),
          })}
        </span>
      )}
      {f.top_sources.length > 0 && (
        <span className="text-muted-foreground">
          {t('settings_host_repeater_filter_stats_top', {
            list: f.top_sources.map((s) => `${s.hash}: ${s.drops}`).join(', '),
          })}
        </span>
      )}
      {f.advert.window_h > 0 && (
        <span className="text-muted-foreground">
          {t('settings_host_repeater_filter_stats_advert', {
            hours: f.advert.window_h,
            cache: f.advert.cache,
            size: f.advert.cache_size,
          })}
        </span>
      )}
      {f.age.max_mins > 0 && !f.age.clock_set && (
        <span className="text-warning">{t('settings_host_repeater_filter_stats_clock_unset')}</span>
      )}
    </div>
  );
}

function NeighbourDetail({ stats }: { stats: HostRepeaterStats }) {
  const t = useT();
  const nb = stats.neighbors;
  if (!nb || (nb.count === 0 && nb.poll.last_finished == null && nb.poll.next_due == null)) {
    return null;
  }
  const when = (ts: number | null) =>
    ts == null
      ? '-'
      : formatDateTime(new Date(ts * 1000), {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  return (
    <div className="grid gap-1 rounded border border-input p-2 text-sm">
      <span className="font-semibold">
        {t('settings_host_repeater_neighbors_stats', { count: nb.count })}
      </span>
      <span className="text-muted-foreground">
        {nb.poll.running
          ? t('settings_host_repeater_neighbors_polling')
          : t('settings_host_repeater_neighbors_poll_summary', {
              last: when(nb.poll.last_finished),
              next: when(nb.poll.next_due),
              discovered: nb.poll.discovered,
              responded: nb.poll.responded,
              queried: nb.poll.queried,
            })}
      </span>
      {nb.poll.last_error && (
        <span className="text-warning">
          {t('settings_host_repeater_tx_last_error', { error: nb.poll.last_error })}
        </span>
      )}
      {nb.neighbors.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-3">{t('settings_host_repeater_neighbors_col_key')}</th>
                <th className="pr-3">{t('settings_host_repeater_neighbors_col_snr')}</th>
                <th className="pr-3">{t('settings_host_repeater_neighbors_col_heard')}</th>
                <th className="pr-3">{t('settings_host_repeater_neighbors_col_scopes')}</th>
                <th className="pr-3">{t('settings_host_repeater_neighbors_col_status')}</th>
              </tr>
            </thead>
            <tbody>
              {nb.neighbors.map((n) => (
                <tr key={n.pubkey}>
                  <td className="pr-3 font-mono">{n.pubkey.slice(0, 12)}</td>
                  <td className="pr-3 tabular-nums">{n.snr ?? '-'}</td>
                  <td className="pr-3 tabular-nums">
                    {t('settings_host_repeater_neighbors_ago', {
                      minutes: Math.round(n.heard_secs_ago / 60),
                    })}
                  </td>
                  <td className="pr-3 font-mono">{n.scopes || '-'}</td>
                  <td className="pr-3">
                    {t(`settings_host_repeater_neighbors_status_${n.status}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Percentiles({ label, p }: { label: string; p: HostRepeaterPercentiles }) {
  const t = useT();
  return (
    <div className="text-sm">
      <span className="font-medium">{label}</span>{' '}
      <span className="text-muted-foreground">
        {t('settings_host_repeater_percentiles', {
          p50: fmtMs(p.p50),
          p95: fmtMs(p.p95),
          p99: fmtMs(p.p99),
          count: p.count,
        })}
      </span>
    </div>
  );
}

/** Shadow-mode statistics: what RTFM-EV would have forwarded, how fast, at what airtime. */
export function HostRepeaterStatsPane({ stats, onReset }: Props) {
  const t = useT();
  if (!stats) {
    return (
      <p className="text-sm text-muted-foreground">{t('settings_host_repeater_stats_loading')}</p>
    );
  }
  const reasons = Object.entries(stats.by_reason).sort((a, b) => b[1] - a[1]);
  const a = stats.airtime;
  const gate = stats.region_gate;
  const tx = stats.tx;
  const rxDelay = stats.rx_delay;
  const advert = stats.advert_limiter;
  const life = stats.lifetime;
  const gatedList = gate ? [...(gate.wildcard_gated ? ['*'] : []), ...gate.gated_regions] : [];
  const since = formatDateTime(new Date(stats.since * 1000), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="space-y-3 rounded border border-input p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold">{t('settings_host_repeater_stats_heading')}</h4>
        <span className="text-xs text-muted-foreground">
          {t('settings_host_repeater_stats_since', { since })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => onReset(false)}
        >
          {t('settings_host_repeater_stats_reset')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('settings_host_repeater_stats_desc')}</p>

      <div className="flex flex-wrap gap-4 text-sm">
        <span>{t('settings_host_repeater_stats_observed', { count: stats.observed })}</span>
        <span>
          {t('settings_host_repeater_stats_would_forward', { count: stats.would_forward })}
        </span>
        <span>{t('settings_host_repeater_stats_would_drop', { count: stats.would_drop })}</span>
        <span>{t('settings_host_repeater_stats_lock_busy', { count: stats.lock_busy })}</span>
      </div>

      <Percentiles label={t('settings_host_repeater_stats_latency')} p={stats.latency_ms} />
      <Percentiles label={t('settings_host_repeater_stats_delay')} p={stats.delay_ms} />
      <Percentiles label={t('settings_host_repeater_stats_echo_gap')} p={stats.echo.gap_ms} />
      {rxDelay && (rxDelay.enabled || rxDelay.held > 0) && (
        <div>
          <Percentiles label={t('settings_host_repeater_stats_rx_delay')} p={rxDelay.delay_ms} />
          <div className="text-sm text-muted-foreground">
            {t('settings_host_repeater_stats_rx_delay_summary', {
              held: rxDelay.held,
              yielded: rxDelay.yielded,
              pending: rxDelay.pending,
            })}
          </div>
        </div>
      )}
      <div className="text-sm text-muted-foreground">
        {t('settings_host_repeater_stats_echo_order', {
          before: stats.echo.neighbour_before_our_tx,
          after: stats.echo.neighbour_after_our_tx,
        })}
      </div>

      <div className="grid gap-1 text-sm">
        <span>
          {t('settings_host_repeater_stats_airtime', {
            minute: fmtMs(a.would_forward_last_minute_ms),
            budget: fmtMs(a.budget_per_minute_ms),
            hour: fmtMs(a.would_forward_last_hour_ms),
            percent: a.would_forward_percent_last_hour.toFixed(2),
          })}
        </span>
        <span>
          {t('settings_host_repeater_stats_saved', { total: fmtMs(a.saved_total_ms ?? 0) })}
        </span>
        <span className="text-muted-foreground">
          {t('settings_host_repeater_stats_own_tx', {
            hour: fmtMs(a.own_tx_last_hour_ms),
            limit:
              a.sub_band_limit_percent != null
                ? `${a.sub_band_limit_percent}%`
                : t('settings_host_repeater_unknown'),
          })}
        </span>
        <span className="text-muted-foreground">
          {stats.invisible_rx.estimate != null
            ? t('settings_host_repeater_stats_invisible', {
                estimate: stats.invisible_rx.estimate,
                recv: stats.invisible_rx.radio_recv,
                pushes: stats.invisible_rx.pushes,
              })
            : t('settings_host_repeater_stats_invisible_pending')}
        </span>
        <span className="text-muted-foreground">
          {stats.rx_airtime_calibration.ratio != null
            ? t('settings_host_repeater_stats_calibration', {
                ratio: stats.rx_airtime_calibration.ratio.toFixed(2),
              })
            : t('settings_host_repeater_stats_calibration_pending')}
        </span>
        {advert && (advert.enabled || advert.dropped > 0) && (
          <span className="text-muted-foreground">
            {t('settings_host_repeater_stats_advert_limiter', {
              allowed: advert.allowed,
              dropped: advert.dropped,
              tracked: advert.tracked,
            })}
          </span>
        )}
        {gate && !gate.enabled && <span>{t('settings_host_repeater_stats_gate_off')}</span>}
        {gate?.enabled && (
          <span>
            {t('settings_host_repeater_stats_gate', {
              level: gate.level,
              max: gate.max_level,
              percent:
                gate.budget_used_percent != null
                  ? `${gate.budget_used_percent}%`
                  : t('settings_host_repeater_stats_gate_unknown'),
            })}
            {gatedList.length > 0 &&
              ` ${t('settings_host_repeater_stats_gate_closed', { list: gatedList.join(', ') })}`}
          </span>
        )}
      </div>

      <FilterDetail stats={stats} />
      <NeighbourDetail stats={stats} />

      {tx && (tx.armed || tx.sent > 0 || tx.send_errors > 0) && (
        <div
          className={
            tx.armed
              ? 'grid gap-1 rounded border border-destructive/40 p-2 text-sm'
              : 'grid gap-1 rounded border border-input p-2 text-sm'
          }
          role="status"
        >
          <span className={tx.armed ? 'font-semibold text-destructive' : 'font-semibold'}>
            {t(tx.armed ? 'settings_host_repeater_tx_live' : 'settings_host_repeater_tx_heading')}
          </span>
          <span>
            {t('settings_host_repeater_tx_sent', {
              sent: tx.sent,
              airtime: fmtMs(tx.sent_airtime_ms),
              errors: tx.send_errors,
              tableFull: tx.table_full,
            })}
          </span>
          <span className="text-muted-foreground">
            {t('settings_host_repeater_tx_queue', {
              queued: tx.queued,
              inFlight: tx.in_flight,
              lockRetries: tx.lock_retries,
            })}
          </span>
          <span className="text-muted-foreground">
            {t('settings_host_repeater_tx_dropped', {
              queueFull: tx.dropped_queue_full,
              tooLate: tx.dropped_too_late,
              lockBusy: tx.dropped_lock_busy,
              disarmed: tx.dropped_disarmed,
            })}
          </span>
          {tx.last_error && (
            <span className="text-warning">
              {t('settings_host_repeater_tx_last_error', { error: tx.last_error })}
            </span>
          )}
        </div>
      )}

      {life && (
        <div className="grid gap-1 rounded border border-input p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {t('settings_host_repeater_stats_lifetime_heading')}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('settings_host_repeater_stats_lifetime_since', {
                since: formatDateTime(new Date(life.since * 1000), {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
                runs: life.runs,
              })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => onReset(true)}
            >
              {t('settings_host_repeater_stats_reset_lifetime')}
            </Button>
          </div>
          <span>
            {t('settings_host_repeater_stats_lifetime_totals', {
              observed: life.observed,
              forward: life.would_forward,
              drop: life.would_drop,
              airtime: fmtMs(life.forward_airtime_total_ms),
            })}
          </span>
          <span>
            {t('settings_host_repeater_stats_saved', {
              total: fmtMs(life.saved_airtime_total_ms ?? 0),
            })}
          </span>
          <span className="text-xs text-muted-foreground">
            {life.persisted
              ? t('settings_host_repeater_stats_lifetime_desc')
              : t('settings_host_repeater_stats_lifetime_unsaved')}
          </span>
        </div>
      )}

      {reasons.length > 0 && (
        <div>
          <p className="text-sm font-medium">{t('settings_host_repeater_stats_reasons')}</p>
          <ul className="grid gap-x-4 text-sm sm:grid-cols-2">
            {reasons.map(([reason, count]) => (
              <li key={reason} className="flex justify-between gap-2">
                <span className={reason.startsWith('forward:') ? 'text-primary' : ''}>
                  {reasonLabel(t, reason)}
                </span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.recent.length > 0 && (
        <div className="overflow-x-auto">
          <p className="text-sm font-medium">{t('settings_host_repeater_stats_recent')}</p>
          <table className="text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-3">{t('settings_host_repeater_col_time')}</th>
                <th className="pr-3">{t('settings_host_repeater_col_type')}</th>
                <th className="pr-3">{t('settings_host_repeater_col_hops')}</th>
                <th className="pr-3">{t('settings_host_repeater_col_decision')}</th>
                <th className="pr-3">{t('settings_host_repeater_col_delay')}</th>
                <th className="pr-3">{t('settings_host_repeater_col_latency')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent.slice(0, RECENT_ROWS).map((d) => (
                <tr key={`${d.ts}-${d.packet_hash}`}>
                  <td className="pr-3 tabular-nums">
                    {formatDateTime(new Date(d.ts * 1000), {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </td>
                  <td className="pr-3 font-mono">{d.payload_type}</td>
                  <td className="pr-3 tabular-nums">{d.hop_count ?? '-'}</td>
                  <td className={d.forward ? 'pr-3 text-primary' : 'pr-3'}>
                    {t(reasonKey(d.forward ? `forward:${d.reason}` : d.reason))}
                  </td>
                  <td className="pr-3 tabular-nums">{fmtMs(d.delay_ms)}</td>
                  <td className="pr-3 tabular-nums">{fmtMs(d.latency_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
