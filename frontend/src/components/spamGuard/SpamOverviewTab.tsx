import type { SpamGuardController } from '../../hooks/useSpamGuard';
import { useT } from '../../i18n';
import { cn } from '../../lib/utils';
import type { SpamGuardSensitivity, SpamGuardState, SpamPoint, SpamTotals } from '../../types';
import { Button } from '../ui/button';
import { formatAirtime, formatDuration } from './spamGuardText';

const SENSITIVITIES: SpamGuardSensitivity[] = ['relaxed', 'balanced', 'strict'];

const HEALTH_CLASS: Record<SpamGuardState['health']['state'], string> = {
  off: 'bg-muted text-muted-foreground',
  ok: 'bg-status-connected/15 text-status-connected',
  warn: 'bg-warning/15 text-warning',
  bad: 'bg-destructive/15 text-destructive',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border/60 p-3" title={hint}>
      <div className="text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

/** Stacked bars: spam stopped over spam let through, one bar per point. */
function StackedBars({
  points,
  labelFor,
  ariaLabel,
  single = false,
}: {
  points: { stopped: number; let_through: number; key: string }[];
  labelFor: (index: number) => string;
  ariaLabel: string;
  /** One series only (all spam): the tooltip gives a single count. */
  single?: boolean;
}) {
  const t = useT();
  const max = Math.max(1, ...points.map((p) => p.stopped + p.let_through));
  return (
    <div role="img" aria-label={ariaLabel} className="flex h-24 items-end gap-px">
      {points.map((point, index) => {
        const total = point.stopped + point.let_through;
        return (
          <div
            key={point.key}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={
              single
                ? t('spam_chart_single_title', { label: labelFor(index), count: total })
                : t('spam_chart_bar_title', {
                    label: labelFor(index),
                    stopped: point.stopped,
                    through: point.let_through,
                  })
            }
          >
            {total === 0 ? (
              <div className="h-px bg-border" />
            ) : (
              <>
                <div
                  className="bg-warning/70"
                  style={{ height: `${(point.let_through / max) * 100}%` }}
                />
                <div
                  className="bg-status-connected/80"
                  style={{ height: `${(point.stopped / max) * 100}%` }}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function percent(value: number | null): string {
  return value === null ? '-' : `${value}%`;
}

function Totals({ title, totals }: { title: string; totals: SpamTotals }) {
  const t = useT();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat label={t('spam_stat_stopped')} value={String(totals.stopped)} />
        <Stat label={t('spam_stat_let_through')} value={String(totals.let_through)} />
        <Stat
          label={t('spam_stat_spam_share')}
          value={percent(totals.spam_share)}
          hint={t('spam_stat_spam_share_hint', { messages: totals.messages })}
        />
        <Stat label={t('spam_stat_stop_rate')} value={percent(totals.stop_rate)} />
        <Stat label={t('spam_stat_airtime')} value={formatAirtime(totals.airtime_ms, t)} />
        <Stat
          label={t('spam_stat_held_genuine')}
          value={String(totals.held_genuine)}
          hint={t('spam_stat_held_genuine_hint')}
        />
      </div>
    </section>
  );
}

export function SpamOverviewTab({
  state,
  guard,
}: {
  state: SpamGuardState;
  guard: SpamGuardController;
}) {
  const t = useT();
  const { settings, health, metrics } = state;
  const disabled = guard.busy || !state.enabled;
  const update = (patch: Partial<typeof settings>) => void guard.save({ ...settings, ...patch });
  const hourKey = (point: SpamPoint) => String(point.t);
  const hourLabel = (ts: number) =>
    new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric' });
  const nowSeconds = Date.now() / 1000;
  // The server counts hour of day in UTC; show it in the viewer's time.
  const utcOffsetHours = Math.round(-new Date().getTimezoneOffset() / 60);
  const byLocalHour = metrics.by_hour.map(
    (_, hour) => metrics.by_hour[(((hour - utcOffsetHours) % 24) + 24) % 24]
  );

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-md border border-border/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{t('spam_mode_label')}</span>
          {(['monitor', 'protect'] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={settings.mode === mode ? 'default' : 'outline'}
              aria-pressed={settings.mode === mode}
              disabled={disabled}
              onClick={() => update({ mode })}
            >
              {t(mode === 'monitor' ? 'spam_mode_monitor' : 'spam_mode_protect')}
            </Button>
          ))}
          <Button
            size="sm"
            variant={settings.paused ? 'default' : 'outline'}
            aria-pressed={settings.paused}
            disabled={disabled}
            onClick={() => update({ paused: !settings.paused })}
          >
            {t(settings.paused ? 'spam_resume' : 'spam_pause')}
          </Button>
        </div>
        <p className="text-[0.8125rem] text-muted-foreground">
          {settings.paused
            ? t('spam_mode_paused_desc')
            : t(settings.mode === 'monitor' ? 'spam_mode_monitor_desc' : 'spam_mode_protect_desc')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="spam-sensitivity" className="text-sm font-medium text-foreground">
            {t('spam_sensitivity_label')}
          </label>
          <select
            id="spam-sensitivity"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={settings.sensitivity}
            disabled={disabled}
            onChange={(e) => update({ sensitivity: e.target.value as SpamGuardSensitivity })}
          >
            {SENSITIVITIES.map((name) => (
              <option key={name} value={name}>
                {t(`spam_sensitivity_${name}`)}
              </option>
            ))}
          </select>
          <span className="text-[0.8125rem] text-muted-foreground">
            {t(`spam_sensitivity_${settings.sensitivity}_desc`)}
          </span>
        </div>
      </section>

      <section className="space-y-2 rounded-md border border-border/60 p-3" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{t('spam_health_title')}</h3>
          <span
            className={cn('rounded px-2 py-0.5 text-xs font-semibold', HEALTH_CLASS[health.state])}
          >
            {t(`spam_health_${health.state}`)}
          </span>
        </div>
        <ul className="space-y-1 text-[0.8125rem] text-muted-foreground">
          <li>
            {state.backend === 'openhop'
              ? t('spam_backend_openhop')
              : t('spam_backend_host', {
                  state: t(`spam_host_state_${state.backend_state ?? 'off'}`),
                })}
          </li>
          <li>
            {t('spam_health_rules', {
              present: health.rules_present,
              expected: health.rules_expected,
            })}
          </li>
          <li>
            {health.last_message_at
              ? t('spam_health_last_message', {
                  time: formatDuration(nowSeconds - health.last_message_at, t),
                })
              : t('spam_health_no_message')}
          </li>
          <li>{t('spam_health_known', { count: state.known_names.length })}</li>
          {[...health.problems, ...health.warnings].map((code) => (
            <li
              key={code}
              className={health.problems.includes(code) ? 'text-destructive' : 'text-warning'}
            >
              {t(`spam_health_issue_${code}`)}
            </li>
          ))}
        </ul>
      </section>

      <Totals title={t('spam_last_24h')} totals={metrics.d1} />
      <Totals title={t('spam_last_7d')} totals={metrics.d7} />

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-[0.75rem] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 bg-status-connected/80" aria-hidden="true" />
            {t('spam_stat_stopped')}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 bg-warning/70" aria-hidden="true" />
            {t('spam_stat_let_through')}
          </span>
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">{t('spam_chart_hourly')}</h3>
          <StackedBars
            ariaLabel={t('spam_chart_hourly')}
            points={metrics.hourly.map((p) => ({ ...p, key: hourKey(p) }))}
            labelFor={(i) => hourLabel(metrics.hourly[i].t)}
          />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">{t('spam_chart_daily')}</h3>
          <StackedBars
            ariaLabel={t('spam_chart_daily')}
            points={metrics.daily.map((p) => ({ ...p, key: hourKey(p) }))}
            labelFor={(i) => dayLabel(metrics.daily[i].t)}
          />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-foreground">{t('spam_chart_by_hour')}</h3>
          <StackedBars
            ariaLabel={t('spam_chart_by_hour')}
            single
            points={byLocalHour.map((count, hour) => ({
              stopped: count,
              let_through: 0,
              key: String(hour),
            }))}
            labelFor={(i) => `${String(i).padStart(2, '0')}:00`}
          />
        </div>
      </section>
    </div>
  );
}
