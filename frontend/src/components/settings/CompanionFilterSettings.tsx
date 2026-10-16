import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../../api';
import { BUDDY_ANCHORS } from '../../buddy/buddyAnchors';
import type {
  CompanionFilterCounterKey,
  CompanionFilterHistory,
  CompanionFilterHistoryBin,
  CompanionFilterRuleKind,
  CompanionFilterRuleStats,
  CompanionFilterState,
  HealthStatus,
} from '../../types';
import { useT } from '../../i18n';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { fmtBucketTime } from '../meshHealthShared';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { toast } from '../ui/sonner';

// meshcomod companion receive filter. Every read and change runs `filter ...` on
// the radio's own command line, which never transmits.

const COUNTERS: { key: CompanionFilterCounterKey; color: string; labelKey: string }[] = [
  { key: 'malformed', color: 'hsl(var(--warning))', labelKey: 'cfilter_counter_malformed' },
  { key: 'age', color: 'hsl(var(--info))', labelKey: 'cfilter_counter_age' },
  { key: 'path', color: 'hsl(var(--destructive))', labelKey: 'cfilter_counter_path' },
  { key: 'sender', color: 'hsl(var(--primary))', labelKey: 'cfilter_counter_sender' },
  { key: 'text', color: 'hsl(var(--success))', labelKey: 'cfilter_counter_text' },
];

const RANGES = [
  { id: '1h', seconds: 3600, labelKey: 'time_range_1h' },
  { id: '24h', seconds: 86400, labelKey: 'time_range_24h' },
  { id: '7d', seconds: 7 * 86400, labelKey: 'time_range_7d' },
  { id: '30d', seconds: 30 * 86400, labelKey: 'time_range_30d' },
] as const;

const SENDER_MAX = 15;
const TEXT_MAX = 23;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function HistoryChart({ bins, label }: { bins: CompanionFilterHistoryBin[]; label: string }) {
  const W = 360;
  const H = 120;
  const pad = { top: 6, right: 6, bottom: 16, left: 26 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;
  const n = bins.length;
  const totalOf = (b: CompanionFilterHistoryBin) => COUNTERS.reduce((s, c) => s + b[c.key], 0);
  const maxVal = Math.max(1, ...bins.map(totalOf));
  const barW = n > 0 ? pw / n : pw;
  const yOf = (v: number) => pad.top + ph - (v / maxVal) * ph;
  const span = n > 1 ? bins[n - 1].timestamp - bins[0].timestamp : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
      {[0, maxVal].map((v) => (
        <g key={v}>
          <line
            x1={pad.left}
            x2={W - pad.right}
            y1={yOf(v)}
            y2={yOf(v)}
            stroke="hsl(var(--border))"
            strokeWidth={0.5}
          />
          <text
            x={pad.left - 3}
            y={yOf(v) + 3}
            textAnchor="end"
            fontSize={8}
            fill="hsl(var(--muted-foreground))"
          >
            {v}
          </text>
        </g>
      ))}
      {bins.map((b, i) => {
        let acc = 0;
        return (
          <g key={b.timestamp}>
            {COUNTERS.map((c) => {
              const v = b[c.key];
              if (v <= 0) return null;
              const y = yOf(acc + v);
              const h = yOf(acc) - y;
              acc += v;
              return (
                <rect
                  key={c.key}
                  x={pad.left + i * barW + barW * 0.1}
                  y={y}
                  width={Math.max(1, barW * 0.8)}
                  height={h}
                  fill={c.color}
                >
                  <title>{`${fmtBucketTime(b.timestamp * 1000, span)}: ${v}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
      {n > 0 && (
        <>
          <text x={pad.left} y={H - 4} fontSize={8} fill="hsl(var(--muted-foreground))">
            {fmtBucketTime(bins[0].timestamp * 1000, span)}
          </text>
          <text
            x={W - pad.right}
            y={H - 4}
            textAnchor="end"
            fontSize={8}
            fill="hsl(var(--muted-foreground))"
          >
            {fmtBucketTime(bins[n - 1].timestamp * 1000, span)}
          </text>
        </>
      )}
    </svg>
  );
}

function RuleList({
  kind,
  rules,
  truncated,
  busy,
  onAdd,
  onRemove,
}: {
  kind: CompanionFilterRuleKind;
  rules: CompanionFilterRuleStats[];
  truncated: boolean;
  busy: boolean;
  onAdd: (pattern: string, secs: number, prob: number) => Promise<boolean>;
  onRemove: (pattern: string) => void;
}) {
  const t = useT();
  const [pattern, setPattern] = useState('');
  const [secs, setSecs] = useState('0');
  const [prob, setProb] = useState('100');
  const max = kind === 'sender' ? SENDER_MAX : TEXT_MAX;
  const patternBytes = new TextEncoder().encode(pattern).length;
  const patternInvalid = /\s/.test(pattern) || patternBytes > max;

  const submit = async () => {
    if (!pattern || patternInvalid) return;
    const ok = await onAdd(pattern, Number(secs) || 0, Number(prob) || 100);
    if (ok) {
      setPattern('');
      setSecs('0');
      setProb('100');
    }
  };

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{t(`cfilter_${kind}_heading`)}</h4>
      <p className="text-xs text-muted-foreground">{t(`cfilter_${kind}_desc`)}</p>
      {truncated && <p className="text-xs text-warning">{t('cfilter_list_truncated')}</p>}
      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('cfilter_list_empty')}</p>
      ) : (
        <ul className="space-y-1">
          {rules.map((r) => (
            <li
              key={r.pattern}
              className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-xs"
            >
              <span className="min-w-0 truncate font-mono">{r.pattern}</span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                <span>
                  {r.secs > 0
                    ? t('cfilter_rule_throttle', { secs: r.secs })
                    : t('cfilter_rule_block')}
                  {r.prob < 100 ? ` ${r.prob}%` : ''}
                </span>
                <span className="tabular-nums">
                  {t('cfilter_rule_hidden', { count: r.hidden ?? '?' })}
                  {r.passes ? ` ${t('cfilter_rule_passes', { count: r.passes })}` : ''}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2"
                  disabled={busy}
                  aria-label={t('cfilter_remove_aria', { name: r.pattern })}
                  onClick={() => onRemove(r.pattern)}
                >
                  {t('cfilter_remove')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[8rem] flex-1">
          <Label htmlFor={`cfilter-${kind}-pattern`} className="text-xs">
            {t(`cfilter_${kind}_pattern_label`, { max })}
          </Label>
          <Input
            id={`cfilter-${kind}-pattern`}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            className="h-8 font-mono"
            aria-invalid={patternInvalid}
          />
        </div>
        <div className="w-20">
          <Label htmlFor={`cfilter-${kind}-secs`} className="text-xs">
            {t('cfilter_secs_label')}
          </Label>
          <Input
            id={`cfilter-${kind}-secs`}
            type="number"
            min={0}
            max={65535}
            value={secs}
            onChange={(e) => setSecs(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="w-20">
          <Label htmlFor={`cfilter-${kind}-prob`} className="text-xs">
            {t('cfilter_prob_label')}
          </Label>
          <Input
            id={`cfilter-${kind}-prob`}
            type="number"
            min={1}
            max={100}
            value={prob}
            onChange={(e) => setProb(e.target.value)}
            className="h-8"
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={busy || !pattern || patternInvalid || rules.length >= 8}
          onClick={() => void submit()}
        >
          {t('cfilter_add')}
        </Button>
      </div>
      {patternInvalid && (
        <p className="text-xs text-destructive">{t('cfilter_pattern_invalid', { max })}</p>
      )}
    </div>
  );
}

interface Props {
  health: HealthStatus | null;
}

export function CompanionFilterSettings({ health }: Props) {
  const t = useT();
  const supported =
    !!health?.radio_connected && health?.radio_device_info?.companion_filter_supported === true;
  const [state, setState] = useState<CompanionFilterState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [age, setAge] = useState('');
  const [newPath, setNewPath] = useState('');
  const [range, setRange] = useState<(typeof RANGES)[number]['id']>('24h');
  const [history, setHistory] = useState<CompanionFilterHistory | null>(null);

  const apply = useCallback((next: CompanionFilterState) => {
    setState(next);
    setAge(String(next.config.age_mins));
    setLoadError(null);
  }, []);

  const run = useCallback(
    async (action: () => Promise<CompanionFilterState>): Promise<boolean> => {
      setBusy(true);
      try {
        apply(await action());
        return true;
      } catch (err) {
        toast.error(t('cfilter_change_failed'), { description: errorText(err) });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apply, t]
  );

  const load = useCallback(async () => {
    setBusy(true);
    try {
      apply(await api.getCompanionFilter());
    } catch (err) {
      setLoadError(errorText(err));
    } finally {
      setBusy(false);
    }
  }, [apply]);

  useEffect(() => {
    if (supported) void load();
  }, [supported, load]);

  useEffect(() => {
    if (!supported) return;
    const seconds = RANGES.find((r) => r.id === range)?.seconds ?? 86400;
    const end = Math.floor(Date.now() / 1000);
    let cancelled = false;
    api
      .getCompanionFilterHistory(end - seconds, end)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [supported, range, state]);

  if (!supported) return null;

  const cfg = state?.config;
  const ageNum = Number(age);
  const ageInvalid = !Number.isInteger(ageNum) || ageNum < 0 || ageNum > 10080;
  const pathInvalid = newPath !== '' && !/^([0-9a-fA-F]{2}){1,4}$/.test(newPath.trim());

  const saveAge = () => {
    if (!cfg || ageInvalid || ageNum === cfg.age_mins) return;
    void run(() => api.updateCompanionFilter({ age_mins: ageNum }));
  };

  const addPath = async () => {
    if (!newPath || pathInvalid) return;
    if (await run(() => api.addCompanionFilterPath(newPath.trim()))) setNewPath('');
  };

  const restore = () => {
    if (!window.confirm(t('cfilter_restore_confirm'))) return;
    void run(() => api.restoreCompanionFilter());
  };

  return (
    <div className="space-y-4">
      <Separator />
      {/* The heading row, not the whole card: the card is taller than a screen. */}
      <div
        data-buddy-anchor={BUDDY_ANCHORS.cfilter}
        className="flex items-center justify-between gap-2"
      >
        <h3 className="text-base font-semibold tracking-tight">{t('cfilter_heading')}</h3>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={load}>
          {t('cfilter_refresh')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('cfilter_desc')}</p>

      {loadError && (
        <p className="text-sm text-destructive">{t('cfilter_load_failed', { error: loadError })}</p>
      )}

      {cfg && state && (
        <>
          <div className="flex items-start gap-2">
            <Checkbox
              id="cfilter-enabled"
              className="mt-0.5"
              disabled={busy}
              checked={cfg.enabled}
              onCheckedChange={(checked) =>
                void run(() => api.updateCompanionFilter({ enabled: checked === true }))
              }
            />
            <div>
              <Label htmlFor="cfilter-enabled">{t('cfilter_enabled_label')}</Label>
              <p className="text-xs text-muted-foreground">{t('cfilter_enabled_desc')}</p>
            </div>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="cfilter-malformed"
              className="mt-0.5"
              disabled={busy}
              checked={cfg.malformed}
              onCheckedChange={(checked) =>
                void run(() => api.updateCompanionFilter({ malformed: checked === true }))
              }
            />
            <div>
              <Label htmlFor="cfilter-malformed">{t('cfilter_malformed_label')}</Label>
              <p className="text-xs text-muted-foreground">{t('cfilter_malformed_desc')}</p>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="cfilter-age">{t('cfilter_age_label')}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="cfilter-age"
                type="number"
                min={0}
                max={10080}
                value={age}
                disabled={busy}
                onChange={(e) => setAge(e.target.value)}
                onBlur={saveAge}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveAge();
                  }
                }}
                className="h-8 w-28"
                aria-invalid={ageInvalid}
              />
              <span className="text-xs text-muted-foreground">{t('cfilter_age_hint')}</span>
            </div>
            {state.age_clock_set === false && (
              <p className="text-xs text-warning">{t('cfilter_age_clock_not_set')}</p>
            )}
          </div>

          <div data-buddy-anchor={BUDDY_ANCHORS.cfilterCounters} className="space-y-2">
            <h4 className="text-sm font-medium">{t('cfilter_counters_heading')}</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {COUNTERS.map((c) => (
                <div key={c.key} className="rounded border border-border bg-background p-2">
                  <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ backgroundColor: c.color }}
                    />
                    {t(c.labelKey)}
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums">
                    {state.counters[c.key]}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('cfilter_malformed_reasons', {
                short: state.malformed_reasons.short ?? 0,
                time: state.malformed_reasons.time ?? 0,
                empty: state.malformed_reasons.empty ?? 0,
                utf8: state.malformed_reasons.utf8 ?? 0,
              })}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium">{t('cfilter_history_heading')}</h4>
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={range === r.id}
                    onClick={() => setRange(r.id)}
                    className={`rounded px-2 py-0.5 text-xs ${
                      range === r.id
                        ? 'bg-primary font-medium text-primary-foreground'
                        : 'border border-border bg-background text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {t(r.labelKey)}
                  </button>
                ))}
              </div>
            </div>
            {history && history.bins.some((b) => COUNTERS.some((c) => b[c.key] > 0)) ? (
              <>
                <HistoryChart bins={history.bins} label={t('cfilter_history_heading')} />
                <p className="text-xs text-muted-foreground">
                  {COUNTERS.map((c) => `${t(c.labelKey)}: ${history.totals[c.key]}`).join(' · ')}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">{t('cfilter_history_empty')}</p>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium">{t('cfilter_path_heading')}</h4>
            <p className="text-xs text-muted-foreground">{t('cfilter_path_desc')}</p>
            {state.truncated.path && (
              <p className="text-xs text-warning">{t('cfilter_list_truncated')}</p>
            )}
            {state.path_hits.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('cfilter_list_empty')}</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {state.path_hits.map((p) => (
                  <span
                    key={p.prefix}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs"
                  >
                    <span className="font-mono">{p.prefix}</span>
                    <span className="text-muted-foreground">
                      {t('cfilter_rule_hidden', { count: p.hidden ?? '?' })}
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={busy}
                      aria-label={t('cfilter_remove_aria', { name: p.prefix })}
                      onClick={() => void run(() => api.removeCompanionFilterPath(p.prefix))}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="w-40">
                <Label htmlFor="cfilter-path-new" className="text-xs">
                  {t('cfilter_path_input_label')}
                </Label>
                <Input
                  id="cfilter-path-new"
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addPath();
                    }
                  }}
                  className="h-8 font-mono"
                  aria-invalid={pathInvalid}
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={busy || !newPath || pathInvalid || cfg.paths.length >= 8}
                onClick={() => void addPath()}
              >
                {t('cfilter_add')}
              </Button>
            </div>
            {pathInvalid && <p className="text-xs text-destructive">{t('cfilter_path_invalid')}</p>}
          </div>

          {(['sender', 'text'] as const).map((kind) => (
            <RuleList
              key={kind}
              kind={kind}
              rules={kind === 'sender' ? state.sender_rules : state.text_rules}
              truncated={state.truncated[kind]}
              busy={busy}
              onAdd={(pattern, secs, prob) =>
                run(() => api.addCompanionFilterRule(kind, { pattern, secs, prob }))
              }
              onRemove={(pattern) => void run(() => api.removeCompanionFilterRule(kind, pattern))}
            />
          ))}

          <div data-buddy-anchor={BUDDY_ANCHORS.cfilterBackup} className="space-y-2">
            <h4 className="text-sm font-medium">{t('cfilter_backup_heading')}</h4>
            <p className="text-xs text-muted-foreground">
              {state.backup
                ? t('cfilter_backup_saved', {
                    date: formatDateTime(state.backup.saved_at * 1000, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })
                : t('cfilter_backup_none')}
            </p>
            {state.backup?.truncated && (
              <p className="text-xs text-warning">{t('cfilter_backup_incomplete')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => api.saveCompanionFilterBackup())}
              >
                {t('cfilter_backup_save')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !state.backup}
                onClick={restore}
              >
                {t('cfilter_backup_restore')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
