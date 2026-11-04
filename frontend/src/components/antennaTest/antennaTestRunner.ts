/**
 * Antenna test runner: sends direct (zero-hop) traces to a set of nodes, one
 * at a time, and collects how well each node heard us (remote SNR) and how
 * well we heard it back (local SNR).
 *
 * Rounds go node by node: every node gets its first trace before any node gets
 * its second. A short-lived dip in conditions then hits all nodes a little
 * rather than one node a lot.
 *
 * A trace that comes back 422 ("No trace response heard") counts as a missed
 * reply. Any other error (radio disconnected, contact gone, network) stops the
 * run, because carrying on would record a radio problem as a bad antenna.
 */

import { ApiError } from '../../api';
import type { AntennaTestNodeResult, TraceResponse } from '../../types';

export interface AntennaTestTarget {
  publicKey: string;
  name: string | null;
  distanceKm: number | null;
}

export interface AntennaTestProgress {
  done: number;
  total: number;
  current: AntennaTestTarget | null;
  results: AntennaTestNodeResult[];
}

export type AntennaTestOutcome =
  | { status: 'finished'; results: AntennaTestNodeResult[] }
  | { status: 'cancelled'; results: AntennaTestNodeResult[] }
  | { status: 'failed'; results: AntennaTestNodeResult[]; error: unknown };

export interface RunAntennaTestOptions {
  targets: AntennaTestTarget[];
  tracesPerNode: number;
  /** Pause between two traces, so the test does not hog airtime. */
  gapMs: number;
  trace: (publicKey: string) => Promise<TraceResponse>;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onProgress?: (progress: AntennaTestProgress) => void;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** True when an error from the trace endpoint means "the node did not answer". */
export function isNoReplyError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 422;
}

function snapshot(results: AntennaTestNodeResult[]): AntennaTestNodeResult[] {
  return results.map((result) => ({ ...result, attempts: [...result.attempts] }));
}

/** Drop nodes that never got a trace (a run cancelled before reaching them). */
function attempted(results: AntennaTestNodeResult[]): AntennaTestNodeResult[] {
  return snapshot(results).filter((result) => result.attempts.length > 0);
}

export async function runAntennaTest({
  targets,
  tracesPerNode,
  gapMs,
  trace,
  signal,
  sleep = defaultSleep,
  onProgress,
}: RunAntennaTestOptions): Promise<AntennaTestOutcome> {
  const results: AntennaTestNodeResult[] = targets.map((target) => ({
    public_key: target.publicKey,
    name: target.name,
    distance_km: target.distanceKm,
    attempts: [],
  }));
  const total = targets.length * tracesPerNode;
  let done = 0;

  for (let round = 0; round < tracesPerNode; round += 1) {
    for (let index = 0; index < targets.length; index += 1) {
      if (signal?.aborted) return { status: 'cancelled', results: attempted(results) };
      if (done > 0) {
        await sleep(gapMs, signal);
        if (signal?.aborted) return { status: 'cancelled', results: attempted(results) };
      }

      const target = targets[index];
      onProgress?.({ done, total, current: target, results: snapshot(results) });
      try {
        const response = await trace(target.publicKey);
        results[index].attempts.push({
          replied: true,
          remote_snr: typeof response.remote_snr === 'number' ? response.remote_snr : null,
          local_snr: typeof response.local_snr === 'number' ? response.local_snr : null,
        });
      } catch (err) {
        if (!isNoReplyError(err)) {
          return { status: 'failed', results: attempted(results), error: err };
        }
        results[index].attempts.push({ replied: false, remote_snr: null, local_snr: null });
      }
      done += 1;
    }
  }

  onProgress?.({ done, total, current: null, results: snapshot(results) });
  return { status: 'finished', results: snapshot(results) };
}

/** Worst-case run time in seconds: every trace waits the full timeout. */
export function worstCaseSeconds(
  targetCount: number,
  tracesPerNode: number,
  gapSeconds: number,
  traceTimeoutSeconds = 15
): number {
  const traces = targetCount * tracesPerNode;
  if (traces === 0) return 0;
  return traces * traceTimeoutSeconds + (traces - 1) * gapSeconds;
}
