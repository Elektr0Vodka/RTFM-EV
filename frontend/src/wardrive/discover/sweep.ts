// Whom to trace-ping when no target is picked (core-hunter sweep.js): a
// rotation over the repeaters heard, four per cycle, skipping a node inside
// its backoff after asks it did not answer. A node heard since it was asked
// is in range again and starts over.

export const RETRY_BACKOFF_MS = [0, 30000, 120000, 600000];
export const SWEEP_BATCH = 4;

export interface SweepState {
  attempts: Map<string, number>;
  lastAskedAt: Map<string, number>;
  cursor: number;
}

export interface SweepCtx extends SweepState {
  heardAt: Map<string, number>;
  now: number;
}

export function retryBackoffFor(attempts: number): number {
  if (attempts <= 0) return 0;
  return RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)];
}

function heardSinceAsk(id: string, ctx: Pick<SweepCtx, 'heardAt' | 'lastAskedAt'>): boolean {
  const asked = ctx.lastAskedAt.get(id);
  if (asked === undefined) return false;
  return (ctx.heardAt.get(id) ?? 0) > asked;
}

function isDue(id: string, ctx: SweepCtx): boolean {
  const asked = ctx.lastAskedAt.get(id);
  if (asked === undefined) return true;
  if (heardSinceAsk(id, ctx)) return true;
  return ctx.now - asked >= retryBackoffFor(ctx.attempts.get(id) ?? 0);
}

/** This cycle's nodes, in rotation order, answering ones first; never the
 * same node twice. */
export function nextSweepBatch(candidates: string[], ctx: SweepCtx, size = SWEEP_BATCH): string[] {
  const due = candidates.filter((id) => isDue(id, ctx));
  if (!due.length) return [];
  const answering = due.filter((id) => (ctx.attempts.get(id) ?? 0) <= 1);
  const pool = answering.length ? answering : due;
  const out: string[] = [];
  for (let i = 0; i < Math.min(size, pool.length); i++)
    out.push(pool[(ctx.cursor + i) % pool.length]);
  return out;
}

/** A ping to `id` went out. */
export function noteAsk(
  id: string,
  ctx: Pick<SweepCtx, 'attempts' | 'lastAskedAt' | 'heardAt'>,
  now: number
): Pick<SweepState, 'attempts' | 'lastAskedAt'> {
  const attempts = new Map(ctx.attempts);
  const lastAskedAt = new Map(ctx.lastAskedAt);
  attempts.set(id, heardSinceAsk(id, ctx) ? 1 : (attempts.get(id) ?? 0) + 1);
  lastAskedAt.set(id, now);
  return { attempts, lastAskedAt };
}
