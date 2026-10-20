// Matching answers to what Auto-discover asked, and which directed ask a
// cycle carries (core-hunter tracetag.js, telemetryreq.js, anonreq.js,
// announce.js). A trace ping names its target by one byte and a response by a
// one-byte source hash, so two live asks sharing that byte are refused rather
// than guessed.

export const TRACE_TTL_MS = 30000;
export const ASK_TTL_MS = 30000;
export const ANON_MIN_GAP_MS = 60000;

const PUBKEY = /^[0-9a-f]{64}$/;

export interface Ping {
  tag: string;
  targetId: string;
  sentAt: number;
}

export interface Ask {
  pubkey: string;
  sentAt: number;
}

/** A trace tag as 8 lower-case hex digits, from the number we sent or the
 * decoder's text. */
export function normalizeTag(tag: number | string): string | null {
  if (typeof tag === 'number') {
    if (!Number.isInteger(tag) || tag < 0 || tag > 0xffffffff) return null;
    return tag.toString(16).padStart(8, '0');
  }
  if (typeof tag === 'string' && /^[0-9a-f]{1,8}$/i.test(tag.trim())) {
    return tag.trim().toLowerCase().padStart(8, '0');
  }
  return null;
}

const live = <T extends { sentAt: number }>(list: T[], now: number, ttl: number) =>
  list.filter((p) => now - p.sentAt < ttl);

export function rememberPing(
  pending: Ping[],
  tag: number,
  targetId: string,
  sentAt: number
): Ping[] {
  const t = normalizeTag(tag);
  if (!t || !targetId) return pending;
  return [
    ...live(pending, sentAt, TRACE_TTL_MS),
    { tag: t, targetId: targetId.toLowerCase(), sentAt },
  ];
}

export function matchTraceTarget(
  pending: Ping[],
  tag: string | number,
  now: number
): string | null {
  const t = normalizeTag(tag);
  if (!t) return null;
  const open = live(pending, now, TRACE_TTL_MS);
  const hit = open.find((p) => p.tag === t);
  if (!hit) return null;
  const first = hit.targetId.slice(0, 2);
  if (open.some((p) => p !== hit && p.targetId.slice(0, 2) === first)) return null;
  return hit.targetId;
}

export function pruneAsks(pending: Ask[], now: number): Ask[] {
  return live(pending, now, ASK_TTL_MS);
}

export function rememberAsk(pending: Ask[], pubkeyHex: string, sentAt: number): Ask[] {
  const pk = pubkeyHex.trim().toLowerCase();
  if (!PUBKEY.test(pk)) return pending;
  return [...pruneAsks(pending, sentAt).filter((a) => a.pubkey !== pk), { pubkey: pk, sentAt }];
}

/** The live ask a response with this 1-byte source hash answers. */
export function matchAskTarget(pending: Ask[], srcHash: string, now: number): string | null {
  const h = srcHash.trim().toLowerCase();
  if (!/^[0-9a-f]{2}$/.test(h)) return null;
  const hits = pruneAsks(pending, now).filter((a) => a.pubkey.startsWith(h));
  return hits.length === 1 ? hits[0].pubkey : null;
}

/** One telemetry ask per cycle, rotating: the companion keeps one pending. */
export function nextTelemetryTarget(
  ids: string[],
  cursor: number
): { id: string; cursor: number } | null {
  if (!ids.length) return null;
  const c = Math.max(0, cursor || 0);
  return { id: ids[c % ids.length], cursor: c + 1 };
}

export type AnonLast = Record<string, { at: number; type: 1 | 2 }>;

/** The repeater asked longest ago (never first), at most once a minute each,
 * for the kind it was not asked last. */
export function nextAnonAsk(
  ids: string[],
  last: AnonLast,
  now: number
): { id: string; type: 1 | 2 } | null {
  let best: { id: string; at: number; type: 1 | 2 } | null = null;
  for (const raw of ids) {
    const id = raw.toLowerCase();
    if (!PUBKEY.test(id)) continue;
    const l = last[id];
    if (l && now - l.at < ANON_MIN_GAP_MS) continue;
    const at = l ? l.at : -Infinity;
    if (!best || at < best.at) best = { id, at, type: l && l.type === 1 ? 2 : 1 };
  }
  return best ? { id: best.id, type: best.type } : null;
}

/** Telemetry and anonymous asks take turns when both are due. */
export function directedAskKind(o: {
  telemetryDue: boolean;
  anonDue: boolean;
  last: 'telemetry' | 'anon' | null;
}): 'telemetry' | 'anon' | null {
  if (o.telemetryDue && o.anonDue) return o.last === 'telemetry' ? 'anon' : 'telemetry';
  if (o.telemetryDue) return 'telemetry';
  if (o.anonDue) return 'anon';
  return null;
}

/** The cycle carries our advert only with the setting exactly on, a radio,
 * and a companion target that has to hear us before it answers. */
export function announceThisCycle(o: {
  introduce: boolean;
  connected: boolean;
  companionTargets: number;
}): boolean {
  return o.introduce === true && o.connected === true && (Number(o.companionTargets) || 0) > 0;
}
