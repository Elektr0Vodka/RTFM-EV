import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';

import { api } from '../../api';
import type {
  AntennaTestNodeResult,
  AntennaTestRunDetail,
  AntennaTestRunSummary,
  Contact,
  RadioConfig,
} from '../../types';
import { useT } from '../../i18n';
import { useDistanceUnit } from '../../contexts/DistanceUnitContext';
import { formatDistance } from '../../utils/pathUtils';
import { latestAdvertHops } from '../../map/hopFilter';
import { useAdvertPathSummaries } from '../../map/useAdvertPathSummaries';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { toast } from '../ui/sonner';
import { cn } from '@/lib/utils';
import { antennaTestCandidates, defaultSelection } from './antennaTestCandidates';
import {
  runAntennaTest,
  worstCaseSeconds,
  type AntennaTestProgress,
  type AntennaTestTarget,
} from './antennaTestRunner';
import {
  AntennaTestCompareView,
  AntennaTestReportView,
  formatRate,
  formatRunDate,
  formatSnr,
} from './AntennaTestReport';

/** Mirrors the backend caps in app/antenna_test_report.py. */
const MAX_NODES = 100;
const MAX_TRACES_PER_NODE = 10;
const MAX_GAP_SECONDS = 60;
const MAX_RENDERED_CANDIDATES = 80;

type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; progress: AntennaTestProgress }
  | {
      phase: 'stopped';
      reason: 'cancelled' | 'failed';
      error: string | null;
      results: AntennaTestNodeResult[];
      startedAt: number;
      finishedAt: number;
    };

interface AntennaTestPanelProps {
  contacts: Contact[];
  config: RadioConfig | null;
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AntennaTestPanel({ contacts, config }: AntennaTestPanelProps) {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();

  const [antenna, setAntenna] = useState('');
  const [notes, setNotes] = useState('');
  const [tracesPerNode, setTracesPerNode] = useState(3);
  const [gapSeconds, setGapSeconds] = useState(2);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [runState, setRunState] = useState<RunState>({ phase: 'idle' });
  const [saving, setSaving] = useState(false);

  const [runs, setRuns] = useState<AntennaTestRunSummary[]>([]);
  const [report, setReport] = useState<AntennaTestRunDetail | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareRuns, setCompareRuns] = useState<AntennaTestRunDetail[]>([]);
  const detailCache = useRef(new Map<number, AntennaTestRunDetail>());
  const abortRef = useRef<AbortController | null>(null);

  const summaries = useAdvertPathSummaries(true);
  const latestHops = useMemo(
    () => (summaries ? latestAdvertHops(summaries) : new Map<string, number>()),
    [summaries]
  );
  const candidates = useMemo(
    () => antennaTestCandidates(contacts, config, latestHops),
    [contacts, config, latestHops]
  );

  // Pre-select the direct-heard nodes once the advert paths are in.
  useEffect(() => {
    if (selected === null && summaries !== null) {
      setSelected(new Set(defaultSelection(candidates, MAX_NODES)));
    }
  }, [selected, summaries, candidates]);

  // Leaving the page stops a running test.
  useEffect(() => () => abortRef.current?.abort(), []);

  const loadRuns = useCallback(async () => {
    try {
      setRuns(await api.listAntennaTests());
    } catch (err) {
      toast.error(t('antenna_test_load_failed', { error: errorText(err) }));
    }
  }, [t]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const getDetail = useCallback(async (runId: number) => {
    const cached = detailCache.current.get(runId);
    if (cached) return cached;
    const detail = await api.getAntennaTest(runId);
    detailCache.current.set(runId, detail);
    return detail;
  }, []);

  useEffect(() => {
    if (compareIds.length < 2) {
      setCompareRuns([]);
      return;
    }
    let cancelled = false;
    Promise.all(compareIds.map(getDetail))
      .then((details) => {
        if (!cancelled) setCompareRuns(details);
      })
      .catch((err) => {
        if (!cancelled) toast.error(t('antenna_test_load_failed', { error: errorText(err) }));
      });
    return () => {
      cancelled = true;
    };
  }, [compareIds, getDetail, t]);

  const selectedKeys = selected ?? new Set<string>();
  const selectedCandidates = candidates.filter((c) => selectedKeys.has(c.publicKey));

  const filteredCandidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return candidates;
    return candidates.filter(
      (c) => c.name.toLowerCase().includes(query) || c.publicKey.startsWith(query)
    );
  }, [candidates, search]);

  const toggleNode = (publicKey: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (checked) {
        if (next.size >= MAX_NODES) return next;
        next.add(publicKey);
      } else {
        next.delete(publicKey);
      }
      return next;
    });
  };

  const running = runState.phase === 'running';
  const traceCount = selectedCandidates.length * tracesPerNode;
  const estimateMinutes = Math.max(
    1,
    Math.ceil(worstCaseSeconds(selectedCandidates.length, tracesPerNode, gapSeconds) / 60)
  );

  const openReport = async (runId: number) => {
    try {
      setReport(await getDetail(runId));
    } catch (err) {
      toast.error(t('antenna_test_load_failed', { error: errorText(err) }));
    }
  };

  const saveRun = async (
    results: AntennaTestNodeResult[],
    startedAt: number,
    finishedAt: number
  ) => {
    setSaving(true);
    try {
      const saved = await api.saveAntennaTest({
        antenna: antenna.trim(),
        notes: notes.trim(),
        radio_public_key: config?.public_key ?? null,
        radio_name: config?.name ?? null,
        traces_per_node: tracesPerNode,
        started_at: startedAt,
        finished_at: finishedAt,
        results,
      });
      detailCache.current.set(saved.id, saved);
      setReport(saved);
      setRunState({ phase: 'idle' });
      toast.success(t('antenna_test_saved_toast'));
      await loadRuns();
      return true;
    } catch (err) {
      toast.error(t('antenna_test_save_failed', { error: errorText(err) }));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startRun = async () => {
    if (!antenna.trim()) {
      toast.error(t('antenna_test_need_antenna'));
      return;
    }
    if (selectedCandidates.length === 0) {
      toast.error(t('antenna_test_need_nodes'));
      return;
    }
    const targets: AntennaTestTarget[] = selectedCandidates.map((c) => ({
      publicKey: c.publicKey,
      name: c.name,
      distanceKm: c.distanceKm === null ? null : Math.round(c.distanceKm * 100) / 100,
    }));
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Math.floor(Date.now() / 1000);
    setRunState({
      phase: 'running',
      progress: { done: 0, total: targets.length * tracesPerNode, current: null, results: [] },
    });

    const outcome = await runAntennaTest({
      targets,
      tracesPerNode,
      gapMs: gapSeconds * 1000,
      trace: (publicKey) => api.requestTrace(publicKey),
      signal: controller.signal,
      onProgress: (progress) => {
        if (!controller.signal.aborted) setRunState({ phase: 'running', progress });
      },
    });
    abortRef.current = null;
    const finishedAt = Math.max(startedAt, Math.floor(Date.now() / 1000));

    if (outcome.status === 'finished') {
      const ok = await saveRun(outcome.results, startedAt, finishedAt);
      if (!ok) {
        setRunState({
          phase: 'stopped',
          reason: 'failed',
          error: null,
          results: outcome.results,
          startedAt,
          finishedAt,
        });
      }
      return;
    }
    setRunState({
      phase: 'stopped',
      reason: outcome.status,
      error: outcome.status === 'failed' ? errorText(outcome.error) : null,
      results: outcome.results,
      startedAt,
      finishedAt,
    });
  };

  const deleteRun = async (run: AntennaTestRunSummary) => {
    if (!window.confirm(t('antenna_test_delete_confirm', { antenna: run.antenna }))) return;
    try {
      await api.deleteAntennaTest(run.id);
      detailCache.current.delete(run.id);
      setCompareIds((prev) => prev.filter((id) => id !== run.id));
      if (report?.id === run.id) setReport(null);
      await loadRuns();
    } catch (err) {
      toast.error(t('antenna_test_delete_failed', { error: errorText(err) }));
    }
  };

  const stoppedTraces =
    runState.phase === 'stopped'
      ? runState.results.reduce((sum, result) => sum + result.attempts.length, 0)
      : 0;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:min-h-0 lg:flex-row lg:overflow-hidden">
      <section className="flex w-full flex-col rounded-lg border border-border bg-card lg:min-h-0 lg:max-w-[26rem] lg:overflow-y-auto">
        <div className="shrink-0 space-y-3 border-b border-border p-4">
          <h3 className="text-sm font-semibold">{t('antenna_test_setup_heading')}</h3>
          <label className="block text-xs font-medium">
            {t('antenna_test_antenna_label')}
            <Input
              value={antenna}
              onChange={(e) => setAntenna(e.target.value)}
              placeholder={t('antenna_test_antenna_placeholder')}
              maxLength={80}
              disabled={running}
              className="mt-1"
            />
          </label>
          <label className="block text-xs font-medium">
            {t('antenna_test_notes_label')}
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              disabled={running}
              className="mt-1"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium">
              {t('antenna_test_traces_label')}
              <Input
                type="number"
                min={1}
                max={MAX_TRACES_PER_NODE}
                value={tracesPerNode}
                onChange={(e) =>
                  setTracesPerNode(clampInt(e.target.value, 1, MAX_TRACES_PER_NODE, 3))
                }
                disabled={running}
                className="mt-1"
              />
            </label>
            <label className="block text-xs font-medium">
              {t('antenna_test_gap_label')}
              <Input
                type="number"
                min={0}
                max={MAX_GAP_SECONDS}
                value={gapSeconds}
                onChange={(e) => setGapSeconds(clampInt(e.target.value, 0, MAX_GAP_SECONDS, 2))}
                disabled={running}
                className="mt-1"
              />
            </label>
          </div>
        </div>

        <div className="shrink-0 border-b border-border p-4">
          <h4 className="text-sm font-semibold">
            {t('antenna_test_nodes_heading', { selected: selectedCandidates.length })}
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('antenna_test_nodes_description')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={running}
              onClick={() => setSelected(new Set(defaultSelection(candidates, MAX_NODES)))}
            >
              {t('antenna_test_select_direct')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={running}
              onClick={() => setSelected(new Set())}
            >
              {t('antenna_test_select_none')}
            </Button>
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('antenna_test_search_placeholder')}
            aria-label={t('antenna_test_search_aria')}
            className="mt-2"
          />
        </div>

        <ul className="max-h-80 overflow-y-auto p-2 lg:max-h-none lg:min-h-40 lg:flex-1">
          {candidates.length === 0 ? (
            <li className="p-2 text-xs text-muted-foreground">{t('antenna_test_no_candidates')}</li>
          ) : filteredCandidates.length === 0 ? (
            <li className="p-2 text-xs text-muted-foreground">{t('antenna_test_no_match')}</li>
          ) : null}
          {filteredCandidates.slice(0, MAX_RENDERED_CANDIDATES).map((candidate) => {
            const id = `antenna-test-node-${candidate.publicKey}`;
            return (
              <li key={candidate.publicKey}>
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    id={id}
                    checked={selectedKeys.has(candidate.publicKey)}
                    disabled={running}
                    onCheckedChange={(checked) => toggleNode(candidate.publicKey, checked === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{candidate.name}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">
                      {candidate.publicKey.slice(0, 12)}
                      {candidate.distanceKm !== null
                        ? ` · ${formatDistance(candidate.distanceKm, distanceUnit)}`
                        : ''}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[11px]',
                      candidate.hops === 0
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {candidate.hops === undefined
                      ? t('antenna_test_hops_unknown')
                      : candidate.hops === 0
                        ? t('antenna_test_hops_direct')
                        : t('antenna_test_hops_count', { count: candidate.hops })}
                  </span>
                </label>
              </li>
            );
          })}
          {filteredCandidates.length > MAX_RENDERED_CANDIDATES ? (
            <li className="p-2 text-xs text-muted-foreground">
              {t('antenna_test_more_hidden', {
                count: filteredCandidates.length - MAX_RENDERED_CANDIDATES,
              })}
            </li>
          ) : null}
        </ul>

        <div className="shrink-0 space-y-2 border-t border-border p-4">
          {runState.phase === 'running' ? (
            <>
              <div
                className="h-2 w-full overflow-hidden rounded bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={runState.progress.total}
                aria-valuenow={runState.progress.done}
              >
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${
                      runState.progress.total
                        ? (runState.progress.done / runState.progress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {t('antenna_test_running', {
                  name: runState.progress.current?.name ?? '-',
                  done: runState.progress.done + (runState.progress.current ? 1 : 0),
                  total: runState.progress.total,
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => abortRef.current?.abort()}
              >
                {t('antenna_test_cancel')}
              </Button>
            </>
          ) : runState.phase === 'stopped' ? (
            <>
              <p
                className={cn(
                  'text-xs',
                  runState.reason === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {runState.reason === 'failed' && runState.error
                  ? t('antenna_test_failed', { error: runState.error })
                  : t('antenna_test_cancelled', { done: stoppedTraces })}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="flex-1"
                  disabled={saving || stoppedTraces === 0}
                  onClick={() =>
                    void saveRun(runState.results, runState.startedAt, runState.finishedAt)
                  }
                >
                  {t('antenna_test_save_partial')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setRunState({ phase: 'idle' })}
                >
                  {t('antenna_test_discard')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t('antenna_test_estimate', { traces: traceCount, minutes: estimateMinutes })}
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 cvd:text-warning">
                {t('antenna_test_rf_warning')}
              </p>
              {!config ? (
                <p className="text-xs text-destructive">{t('antenna_test_not_connected')}</p>
              ) : null}
              <Button
                type="button"
                className="w-full"
                disabled={!config || saving || selectedCandidates.length === 0}
                onClick={() => void startRun()}
              >
                {t('antenna_test_start')}
              </Button>
            </>
          )}
        </div>
      </section>

      <div className="flex min-w-0 flex-1 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto">
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-4">
            <h3 className="text-sm font-semibold">{t('antenna_test_history_heading')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('antenna_test_compare_hint')}</p>
          </div>
          {runs.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{t('antenna_test_history_empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((run) => {
                const checkboxId = `antenna-test-compare-${run.id}`;
                return (
                  <li key={run.id} className="flex items-center gap-3 px-4 py-2">
                    <Checkbox
                      id={checkboxId}
                      aria-label={t('antenna_test_compare_aria', { antenna: run.antenna })}
                      checked={compareIds.includes(run.id)}
                      onCheckedChange={(checked) =>
                        setCompareIds((prev) =>
                          checked === true
                            ? [...prev.filter((id) => id !== run.id), run.id]
                            : prev.filter((id) => id !== run.id)
                        )
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{run.antenna}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatRunDate(run.started_at)}
                        {run.radio_name ? ` · ${run.radio_name}` : ''}
                      </div>
                      <div className="text-[11px] tabular-nums">
                        {run.summary.nodes_replied}/{run.summary.nodes} ·{' '}
                        {formatRate(run.summary.reply_rate)} ·{' '}
                        {t('antenna_test_history_snr', {
                          tx: formatSnr(run.summary.remote_snr_avg),
                          rx: formatSnr(run.summary.local_snr_avg),
                        })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('antenna_test_open_report_aria', { antenna: run.antenna })}
                      onClick={() => void openReport(run.id)}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t('antenna_test_delete_aria', { antenna: run.antenna })}
                      onClick={() => void deleteRun(run)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {compareRuns.length >= 2 ? <AntennaTestCompareView runs={compareRuns} /> : null}
        {report ? <AntennaTestReportView run={report} onClose={() => setReport(null)} /> : null}
      </div>
    </div>
  );
}
