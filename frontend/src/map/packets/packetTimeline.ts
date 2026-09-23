// Time-indexed packet buffer for the live map. Ingests RawPackets, resolves
// each packet's route through the canonical packetNetworkGraph (the single path
// authority) plus a coordinate resolver, caches the resolved hop segments, and
// derives the on-screen render model as a pure function of a display time.

import type { RawPacket } from '../../types';
import { getRawPacketObservationKey } from '../../utils/rawPacketIdentity';
import { PARTICLE_COLOR_MAP } from '../../utils/visualizerUtils';
import {
  ensureSelfNode,
  ingestPacketIntoPacketNetwork,
  prunePacketNetworkState,
  type PacketNetworkContext,
  type PacketNetworkState,
} from '../../networkGraph/packetNetworkGraph';
import {
  arcFreshMs,
  glowIntensity,
  hexToRgb,
  livenessOpacity,
  pulsePosition,
  pulseProgress,
  snrColor,
  GLOW_MS,
  DEFAULT_ARC_FADE_MS,
} from './packetAnimMath';

export interface ArcDatum {
  s: [number, number, number]; // [lon, lat, height m]
  t: [number, number, number];
  color: [number, number, number]; // SNR colour
  opacity: number; // 0..1 freshness
  width: number; // px
  witnessed: boolean; // solid (witnessed final hop) vs faint/inferred
}

export interface PulseDatum {
  pos: [number, number, number]; // arc-riding head position
  color: [number, number, number]; // packet-type colour
  k: number; // 0..1 swell/fade envelope
}

export interface GlowDatum {
  pos: [number, number, number];
  color: [number, number, number];
  intensity: number; // 0..1
}

export interface PacketRenderModel {
  arcs: ArcDatum[];
  pulses: PulseDatum[];
  glows: GlowDatum[];
}

export type CoordResolver = (nodeId: string) => { lat: number; lon: number } | undefined;

export interface TimelineDeps {
  resolveCoord: CoordResolver;
  /** Read the current network context each ingest, so the engine picks up newly
   *  resolved contacts without being rebuilt (past entries keep their geometry). */
  getContext: () => PacketNetworkContext;
  state: PacketNetworkState;
  selfName?: string;
  maxEntries?: number;
}

export interface StateAsOfOptions {
  pulses?: boolean;
  glows?: boolean;
  /** Arc lifetime in ms (full, fade to floor, then dropped). */
  fadeMs?: number;
  /** Height in metres at a node position (e.g. a roof under 3D buildings).
   *  Arc ends, pulses and glows are lifted to it; default is ground level. */
  heightAt?: (lon: number, lat: number) => number;
}

export interface PacketTimeline {
  /** Ingest packets (deduped). Returns the number of newly added entries. */
  ingest(packets: RawPacket[]): number;
  range(): { minMs: number; maxMs: number };
  stateAsOf(currentMs: number, opts?: StateAsOfOptions): PacketRenderModel;
  prune(lookbackMs: number): void;
  reset(): void;
}

interface Segment {
  a: [number, number]; // [lon, lat]
  b: [number, number];
  aId: string;
  bId: string;
  witnessed: boolean;
}

interface Entry {
  heardMs: number;
  snrCol: [number, number, number];
  typeCol: [number, number, number];
  segments: Segment[];
  glowPos: [number, number] | null;
}

const DEFAULT_MAX_ENTRIES = 4000;

function segKey(a: [number, number], b: [number, number]): string {
  const ka = `${a[0].toFixed(5)},${a[1].toFixed(5)}`;
  const kb = `${b[0].toFixed(5)},${b[1].toFixed(5)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

const GROUND = (): number => 0;

/** Position of the pulse head along a multi-segment path, equal time per
 *  segment, riding each segment's bow via pulsePosition. The bow sits on the
 *  straight line between the two end heights, as deck.gl's ArcLayer draws it. */
function headPos(
  segments: Segment[],
  t: number,
  heightAt: (lon: number, lat: number) => number
): [number, number, number] {
  const n = segments.length;
  const scaled = Math.min(Math.max(t, 0), 0.999999) * n;
  const idx = Math.min(Math.floor(scaled), n - 1);
  const local = scaled - idx;
  const seg = segments[idx];
  const pos = pulsePosition(seg.a, seg.b, local);
  const ha = heightAt(seg.a[0], seg.a[1]);
  const hb = heightAt(seg.b[0], seg.b[1]);
  pos[2] += ha + (hb - ha) * local;
  return pos;
}

export function createPacketTimeline(deps: TimelineDeps): PacketTimeline {
  const { resolveCoord, getContext, state } = deps;
  const selfName = deps.selfName ?? 'Me';
  const maxEntries = deps.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const seen = new Set<string>();
  let entries: Entry[] = [];

  function buildSegments(canonicalPath: string[]): {
    segments: Segment[];
    glowPos: [number, number] | null;
  } {
    const pts: Array<{ id: string; lonlat: [number, number] }> = [];
    for (const id of canonicalPath) {
      const c = resolveCoord(id);
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
        pts.push({ id, lonlat: [c.lon, c.lat] });
      }
    }
    const segments: Segment[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const witnessed = pts[i].id === 'self' || pts[i + 1].id === 'self';
      segments.push({
        a: pts[i].lonlat,
        b: pts[i + 1].lonlat,
        aId: pts[i].id,
        bId: pts[i + 1].id,
        witnessed,
      });
    }
    let glowPos: [number, number] | null = null;
    const wseg = segments.find((s) => s.witnessed);
    if (wseg) glowPos = wseg.aId === 'self' ? wseg.b : wseg.a;
    else if (pts.length > 0) glowPos = pts[pts.length - 1].lonlat;
    return { segments, glowPos };
  }

  return {
    ingest(packets: RawPacket[]): number {
      if (!packets?.length) return 0;
      ensureSelfNode(state, selfName);
      const context = getContext();
      let added = 0;
      for (const pkt of packets) {
        const key = getRawPacketObservationKey(pkt);
        if (seen.has(key)) continue;
        seen.add(key);
        const result = ingestPacketIntoPacketNetwork(state, context, pkt);
        if (!result) continue;
        const { segments, glowPos } = buildSegments(result.canonicalPath);
        entries.push({
          heardMs: result.activityAtMs,
          snrCol: snrColor(pkt.snr),
          typeCol: hexToRgb(PARTICLE_COLOR_MAP[result.label] ?? '#ffffff'),
          segments,
          glowPos,
        });
        added++;
      }
      if (entries.length > maxEntries) entries = entries.slice(-maxEntries);
      if (seen.size > maxEntries * 2) {
        seen.clear();
      }
      return added;
    },

    range(): { minMs: number; maxMs: number } {
      if (entries.length === 0) return { minMs: 0, maxMs: 0 };
      let min = Infinity;
      let max = -Infinity;
      for (const e of entries) {
        if (e.heardMs < min) min = e.heardMs;
        if (e.heardMs > max) max = e.heardMs;
      }
      return { minMs: min, maxMs: max };
    },

    stateAsOf(currentMs: number, opts?: StateAsOfOptions): PacketRenderModel {
      const wantPulses = opts?.pulses ?? true;
      const wantGlows = opts?.glows ?? true;
      const fadeMs = opts?.fadeMs ?? DEFAULT_ARC_FADE_MS;
      const heightAt = opts?.heightAt ?? GROUND;
      const freshMs = arcFreshMs(fadeMs);
      const arcAcc = new Map<string, { heardMs: number; datum: ArcDatum }>();
      const pulses: PulseDatum[] = [];
      const glows: GlowDatum[] = [];

      for (const e of entries) {
        if (e.heardMs > currentMs) continue;
        const age = currentMs - e.heardMs;

        if (age < fadeMs) {
          const opacity = livenessOpacity(age, freshMs, fadeMs);
          for (const s of e.segments) {
            const key = segKey(s.a, s.b);
            const prev = arcAcc.get(key);
            if (!prev || e.heardMs > prev.heardMs) {
              arcAcc.set(key, {
                heardMs: e.heardMs,
                datum: {
                  s: [s.a[0], s.a[1], heightAt(s.a[0], s.a[1])],
                  t: [s.b[0], s.b[1], heightAt(s.b[0], s.b[1])],
                  color: e.snrCol,
                  opacity,
                  width: s.witnessed ? 3 : 1.5,
                  witnessed: s.witnessed,
                },
              });
            }
          }
        }

        if (wantPulses && e.segments.length > 0) {
          const p = pulseProgress(e.heardMs, currentMs);
          if (p > 0 && p < 1) {
            pulses.push({
              pos: headPos(e.segments, p, heightAt),
              color: e.typeCol,
              k: Math.sin(Math.PI * p),
            });
          }
        }

        if (wantGlows && e.glowPos && age >= 0 && age < GLOW_MS) {
          glows.push({
            pos: [e.glowPos[0], e.glowPos[1], heightAt(e.glowPos[0], e.glowPos[1])],
            color: e.typeCol,
            intensity: glowIntensity(age),
          });
        }
      }

      return { arcs: Array.from(arcAcc.values()).map((v) => v.datum), pulses, glows };
    },

    prune(lookbackMs: number): void {
      if (entries.length === 0) return;
      let newest = -Infinity;
      for (const e of entries) if (e.heardMs > newest) newest = e.heardMs;
      const cutoff = newest - lookbackMs;
      entries = entries.filter((e) => e.heardMs >= cutoff);
      prunePacketNetworkState(state, cutoff);
    },

    reset(): void {
      entries = [];
      seen.clear();
    },
  };
}
