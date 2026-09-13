# Visualize Packets: Live Map with VCR Replay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note:** This plan is authored and executed in the same session (the user is away and asked to proceed as far as possible). Git commits are NOT performed (repo rule: commit only on explicit instruction). Where the skill template shows a commit step, substitute "stage mentally / leave uncommitted and continue".

**Goal:** Replace the map's packet animation with a deck.gl arcs + pulses + glow system driven by a virtual-clock playback engine, fixing packet path accuracy (one path authority) and adding VCR-style live/replay controls.

**Architecture:** A pure `PlaybackController` owns the displayed time (live-follow or replay at rate, seekable). A pure `packetTimeline` ingests `RawPacket`s, resolves each packet's route via the canonical `packetNetworkGraph` plus the existing coordinate resolver, and exposes `stateAsOf(ms)` returning active arcs/pulses/glows. A single deck.gl `MapLibreOverlay` (reusing the lazy `loadDeck()` pattern) renders them in both 2D and 3D, replacing the 2D canvas overlay and the 3D-only arc overlay. Controls live in the existing `packets` FAB panel plus a bottom-docked `PlaybackBar`.

**Tech Stack:** React + TypeScript, MapLibre GL 4, deck.gl 9 (`ArcLayer`, `ScatterplotLayer`, `MapLibreOverlay`), Vitest + React Testing Library. i18n EN/NL/DE enforced.

---

## File Structure

Create (framework-agnostic, unit-tested):
- `frontend/src/map/packets/playbackController.ts` — virtual clock (live/replay/rate/seek).
- `frontend/src/map/packets/packetAnimMath.ts` — pure math: freshness opacity, pulse progress/position, glow intensity, SNR color.
- `frontend/src/map/packets/packetTimeline.ts` — time-indexed buffer + path/coord resolution + `stateAsOf(ms)`.
- `frontend/src/map/packets/clickAudio.ts` — optional geiger click.

Create (rendering + UI):
- `frontend/src/map/layers/packetDeckOverlay.ts` — the single deck.gl overlay rendering arcs+pulses+glow from a render model.
- `frontend/src/map/controls/PlaybackBar.tsx` — VCR bar.

Modify:
- `frontend/src/components/MapView.tsx` — swap overlays, wire timeline+controller+controls, retire `resolvePacketPath`.
- `frontend/src/map/controls/MapControls.tsx` — (no type change needed; new controls ride in the existing `packets` extraFab panel and `children`).
- `frontend/src/map/controls/legend/MapLegend.tsx` — packet-type + SNR + witnessed/inferred key.
- `frontend/src/i18n/*` — EN/NL/DE keys.
- Docs: `CHANGELOG-DMC-EV.md`, `README.md`, `frontend/AGENTS.md`.

Remove (after swap):
- `frontend/src/map/layers/particleOverlay.ts` and its test (if the deck overlay fully replaces it). Keep `tracesDeck.ts`'s `arcRows`/`loadDeck` exports if still referenced; otherwise retire.

Render-model types (shared, defined in `packetTimeline.ts`):
```ts
export interface ArcDatum {
  s: [number, number, number]; // [lon,lat,0]
  t: [number, number, number];
  color: [number, number, number];
  opacity: number;   // 0..1 freshness
  width: number;     // px
  witnessed: boolean; // solid vs inferred
}
export interface PulseDatum {
  pos: [number, number, number]; // arc-riding position
  color: [number, number, number];
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
```

Constants (in `packetAnimMath.ts`): `PULSE_MS = 1500`, `GLOW_MS = 400`, `LINK_FRESH_MS = 60_000`, `LINK_DIM_MS = 900_000`, `LINK_FLOOR = 0.15`, `SPEEDS = [0.5, 1, 2, 4, 8]`, `BUFFER_MAX_MS = 12_000`, `LOOKBACK_OPTIONS` (buffer/15m/1h/6h, default 1h).

---

## Phase 1 — Engine (live-only)

### Task 1: Pure animation math

**Files:**
- Create: `frontend/src/map/packets/packetAnimMath.ts`
- Test: `frontend/src/test/map/packetAnimMath.test.ts`

- [ ] **Step 1: Failing tests**
```ts
import { describe, it, expect } from 'vitest';
import {
  livenessOpacity, pulseProgress, pulsePosition, glowIntensity, snrColor,
  LINK_FRESH_MS, LINK_DIM_MS, LINK_FLOOR, PULSE_MS, GLOW_MS,
} from '../../map/packets/packetAnimMath';

describe('livenessOpacity', () => {
  it('is full within the fresh window', () => {
    expect(livenessOpacity(0)).toBe(1);
    expect(livenessOpacity(LINK_FRESH_MS - 1)).toBe(1);
  });
  it('fades to the floor by the dim window and never below', () => {
    expect(livenessOpacity(LINK_DIM_MS)).toBeCloseTo(LINK_FLOOR, 5);
    expect(livenessOpacity(LINK_DIM_MS * 10)).toBe(LINK_FLOOR);
  });
  it('is negative-age safe', () => { expect(livenessOpacity(-500)).toBe(1); });
});

describe('pulseProgress', () => {
  it('maps elapsed to 0..1 clamped', () => {
    expect(pulseProgress(1000, 1000)).toBe(0);
    expect(pulseProgress(1000, 1000 + PULSE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(pulseProgress(1000, 1000 + PULSE_MS * 2)).toBe(1);
  });
});

describe('pulsePosition', () => {
  it('is the source at t=0 and target at t=1 in lon/lat', () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [10, 10];
    expect(pulsePosition(a, b, 0)).toEqual([0, 0, 0]);
    const end = pulsePosition(a, b, 1);
    expect([end[0], end[1]]).toEqual([10, 10]);
  });
  it('bows upward at the midpoint (height > 0)', () => {
    expect(pulsePosition([0, 0], [10, 0], 0.5)[2]).toBeGreaterThan(0);
  });
});

describe('glowIntensity', () => {
  it('is 1 at receive and 0 after GLOW_MS', () => {
    expect(glowIntensity(0)).toBeCloseTo(1, 5);
    expect(glowIntensity(GLOW_MS)).toBe(0);
    expect(glowIntensity(GLOW_MS + 100)).toBe(0);
  });
});

describe('snrColor', () => {
  it('returns an rgb triple and shifts with snr', () => {
    const lo = snrColor(-20); const hi = snrColor(12);
    expect(lo).toHaveLength(3); expect(hi).toHaveLength(3);
    expect(lo).not.toEqual(hi);
  });
  it('handles null snr with a neutral color', () => {
    expect(snrColor(null)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run, expect fail** — `npm -C frontend run test:run -- packetAnimMath`

- [ ] **Step 3: Implement**
```ts
export const PULSE_MS = 1500;
export const GLOW_MS = 400;
export const LINK_FRESH_MS = 60_000;
export const LINK_DIM_MS = 900_000;
export const LINK_FLOOR = 0.15;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Opacity cue: full until fresh, linear fade to a floor by dim, never below. */
export function livenessOpacity(
  ageMs: number, freshMs = LINK_FRESH_MS, dimMs = LINK_DIM_MS, floor = LINK_FLOOR,
): number {
  if (ageMs <= freshMs) return 1;
  if (ageMs >= dimMs) return floor;
  const f = (ageMs - freshMs) / (dimMs - freshMs);
  return 1 - f * (1 - floor);
}

export function pulseProgress(startMs: number, nowMs: number, durMs = PULSE_MS): number {
  return clamp01((nowMs - startMs) / durMs);
}

/** Interpolate lon/lat linearly; bow the height on the same semicircle deck.gl's
 *  ArcLayer uses, so the dot rides the arc rather than cutting the chord. */
export function pulsePosition(
  a: [number, number], b: [number, number], t: number, bow = 0,
): [number, number, number] {
  const lon = a[0] + (b[0] - a[0]) * t;
  const lat = a[1] + (b[1] - a[1]) * t;
  const h = 2 * Math.sqrt(Math.max(0, t * (1 - t)));
  const chord = bow || haversineMeters(a, b) * 0.15;
  return [lon, lat, h * chord];
}

export function glowIntensity(ageMs: number, durMs = GLOW_MS): number {
  if (ageMs < 0) return 1;
  if (ageMs >= durMs) return 0;
  return 1 - ageMs / durMs;
}

/** SNR amber(low) -> blue(mid) -> green(high). Null -> neutral grey. */
export function snrColor(snr: number | null | undefined): [number, number, number] {
  if (snr == null || Number.isNaN(snr)) return [150, 150, 150];
  const stops: Array<[number, [number, number, number]]> = [
    [-20, [245, 158, 11]], [0, [59, 130, 246]], [10, [34, 197, 94]],
  ];
  if (snr <= stops[0][0]) return stops[0][1];
  if (snr >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i + 1 < stops.length; i++) {
    const [x0, c0] = stops[i]; const [x1, c1] = stops[i + 1];
    if (snr >= x0 && snr <= x1) {
      const f = (snr - x0) / (x1 - x0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * f)) as [number, number, number];
    }
  }
  return [150, 150, 150];
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
  const la1 = a[1] * toRad, la2 = b[1] * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
```

- [ ] **Step 4: Run, expect pass.**

### Task 2: PlaybackController

**Files:**
- Create: `frontend/src/map/packets/playbackController.ts`
- Test: `frontend/src/test/map/playbackController.test.ts`

Interface:
```ts
export type PlaybackMode = 'live' | 'replay';
export interface PlaybackSnapshot { mode: PlaybackMode; currentMs: number; rate: number; playing: boolean; }
export interface PlaybackController {
  snapshot(): PlaybackSnapshot;
  tick(wallMs: number): void;       // advance per frame; called by the RAF loop
  setNewest(wallMs: number): void;  // feed the latest packet time (live follows it)
  setBufferMs(ms: number): void;    // smoothing delay applied in live mode
  goLive(): void;                   // re-pin to newest
  pause(): void; play(): void;
  setRate(rate: number): void;
  seek(ms: number): void;           // enters replay
  setRange(minMs: number, maxMs: number): void; // timeline bounds for clamping
  subscribe(fn: (s: PlaybackSnapshot) => void): () => void;
}
export function createPlaybackController(init?: Partial<PlaybackSnapshot>): PlaybackController;
```

Tests (behaviors):
- live mode: `currentMs === newest - bufferMs` after `setNewest`.
- `seek(x)` switches to replay, `currentMs === x` (clamped to range).
- replay + playing: `tick` advances `currentMs` by `elapsed * rate`.
- replay reaching `maxMs`: clamps and pauses.
- `goLive()` returns to live and re-pins to newest.
- `subscribe` fires on state change; unsubscribe stops it.

Implement a plain object with closures; `tick(wallMs)` computes `elapsed` from the previous wall time. Notify subscribers only when the snapshot actually changes.

### Task 3: packetTimeline

**Files:**
- Create: `frontend/src/map/packets/packetTimeline.ts`
- Test: `frontend/src/test/map/packetTimeline.test.ts`

Interface:
```ts
import type { RawPacket } from '../../types';
export interface TimelineDeps {
  resolveCoord: (nodeId: string) => { lat: number; lon: number } | undefined;
  context: PacketNetworkContext;       // buildPacketNetworkContext(...)
  state: PacketNetworkState;           // createPacketNetworkState(...)
}
export interface PacketTimeline {
  ingest(packets: RawPacket[]): void;  // dedupe by observation key; resolve+cache path
  range(): { minMs: number; maxMs: number };
  stateAsOf(currentMs: number): PacketRenderModel;
  prune(lookbackMs: number): void;
  reset(): void;
}
export function createPacketTimeline(deps: TimelineDeps): PacketTimeline;
```

Logic:
- On ingest, for each new packet (observation key not seen): parse via `parsePacket(pkt.data)`; build canonical path with `buildCanonicalPathForPacket(state, context, parsed, pkt, heardMs)`; project with `projectCanonicalPath(state, canonicalPath, visibility)`; resolve each node id to `[lon,lat]` with `resolveCoord`; build ordered hop segments, marking the final witnessed segment (`dashedLinkDetails`/`hasDirectObservation`) solid and others inferred; skip hops with no coord by bridging to the next resolvable node; store `{ heardMs, snr, type, segments }`.
- `stateAsOf(ms)`: arcs = segments of entries with `heardMs <= ms` and `ms - heardMs < LINK_DIM_MS` (opacity via `livenessOpacity`, color via `snrColor`, width by witnessed); pulses = entries with `ms - heardMs` in `[0, PULSE_MS)` (position via `pulsePosition` along the witnessed segment, envelope `sin(pi*progress)`); glows = the witnessed node of entries with `ms - heardMs` in `[0, GLOW_MS)`.

Tests: ingest dedupe; `stateAsOf` picks correct arcs/pulses/glows at boundary times; no-GPS bridging never yields `[0,0]`; prune drops stale entries; `range()` spans first..last heardMs.

Note: use a small synthetic `RawPacket` fixture and a stub `resolveCoord`. Do not require a real map.

### Task 4: packetDeckOverlay

**Files:**
- Create: `frontend/src/map/layers/packetDeckOverlay.ts`
- Test: `frontend/src/test/map/packetDeckOverlay.test.ts` (pure row-builders only; overlay wiring is runtime-verified)

Mirror `tracesDeck.ts`: lazy `loadDeck()`, create one `deck.MapLibreOverlay({ interleaved: true, layers: [] })`, `addControl`. Expose:
```ts
export interface PacketDeckOverlay { setModel(m: PacketRenderModel): void; clear(): void; destroy(): void; }
export function createPacketDeckOverlay(map: MlMap): PacketDeckOverlay;
export function buildPacketLayers(deck: typeof import('deck.gl'), m: PacketRenderModel): unknown[]; // testable
```
`buildPacketLayers` returns `[ArcLayer(arcs), ScatterplotLayer(pulse-halo), ScatterplotLayer(pulse-core), ScatterplotLayer(glow)]` with getters reading `ArcDatum`/`PulseDatum`/`GlowDatum`. Arc `getColor` uses `[...color, round(255*opacity)]`, `getWidth` uses `witnessed ? width : max(1, width*0.5)`, `getHeight: 0.3`. Pulses/glow use `parameters:{depthTest:false, depthMask:false}`. Test `buildPacketLayers` with a fake `deck` whose `ArcLayer`/`ScatterplotLayer` are spies capturing props, asserting layer count and that getters produce expected arrays for sample data.

### Task 5: Wire engine into MapView (live-only), retire ad-hoc resolver

**Files:** Modify `frontend/src/components/MapView.tsx`

- Replace `createParticleOverlay`/`createDeckTraces`/`arcRows` imports and refs with `createPacketTimeline` + `createPlaybackController` + `createPacketDeckOverlay`.
- In `handleReady`, create the deck overlay once; it persists across basemap `setStyle` (it is a control, not a style layer) so no reattach needed.
- Build the timeline with deps: `resolveCoord: resolveLinkCoord`, `context: linkContext`, `state: a dedicated packet-viz network state` (separate from the liveness-links `linkStateRef` to avoid cross-talk, or reuse if identical visibility; default: dedicated).
- One effect: when `showPackets`, ingest `rawPackets` into the timeline, `controller.setNewest(latestHeardMs)`, and ensure the RAF loop runs; the loop calls `controller.tick(performance.now-based wall)` then `overlay.setModel(timeline.stateAsOf(controller.snapshot().currentMs))`. When `!showPackets`, stop loop + `overlay.clear()`.
- Delete `resolvePacketPath`, `resolvePacketContacts` usage for particles, `particles` state, `MapParticle`, `PARTICLE_LIFETIME_MS` interval, and the 2D/3D swap effect (lines ~911-937). Discovery mode keeps working off the timeline's resolved packets (expose discovered keys from `ingest`, or keep a parallel light pass).
- RAF loop self-cancels when live and idle (no pulses/glows and no replay playing) to avoid idle CPU; a new packet or a replay restarts it.

Verification after Phase 1: `npm -C frontend run test:run`, `lint`, `format:check`, `build`; then runtime on `rtfm-ev-local` — packets animate as arcs+pulses+glow in 2D and 3D.

---

## Phase 2 — VCR controls

### Task 6: PlaybackBar component

**Files:**
- Create: `frontend/src/map/controls/PlaybackBar.tsx`
- Test: `frontend/src/test/map/playbackBar.test.tsx`

Props: `{ snapshot, range, onPlay, onPause, onSeek, onRate, onLive, lookbackMs, onLookback, packetTimes?: number[] }`. Renders play/pause, speed selector (`SPEEDS`), a timeline track (click/drag to `onSeek`, playhead from `snapshot.currentMs` within `range`), a Live button (aria-pressed when `mode==='live'`), and a look-back selector. Keyboard: space/left/right/L. All labels via i18n.
Tests (RTL): clicking play calls `onPlay`; clicking the track calls `onSeek` with an ms inside range; Live button calls `onLive`; speed buttons call `onRate`.

### Task 7: Wire PlaybackBar + look-back backfill + toggles

**Files:** Modify `frontend/src/components/MapView.tsx`, add to the `packets` extraFab panel.

- Add state: `pulsesOn` (default true), `glowOn` (default true), `bufferMs` (default 0), `soundOn` (default false), `lookbackMs` (default 1h), plus controller snapshot mirrored via `subscribe`.
- Render `PlaybackBar` as a child of `MapSurface` (bottom-docked) when `showPackets`.
- Add Pulses/Glow/Buffer/Sound controls into the existing `packetsPanel` JSX.
- Look-back backfill: when `lookbackMs` increases beyond the in-memory buffer span, one `api.getRecentPackets({ before_ts, limit })` fetch, merged into the timeline (dedupe handles overlap). Failure is non-blocking.
- `buildPacketLayers`/overlay already honor pulses/glow by the model; gate pulses/glows arrays in `stateAsOf` OR filter in MapView before `setModel` (default: pass flags into `stateAsOf` options).

Verification: tests green; runtime exercise play/pause/speed/scrub/click/live and look-back.

---

## Phase 3 — Legend, audio, i18n, docs

### Task 8: clickAudio

**Files:** Create `frontend/src/map/packets/clickAudio.ts`; Test `frontend/src/test/map/clickAudio.test.ts` (dedupe + enable/disable logic with a stubbed AudioContext).

### Task 9: Legend extension

**Files:** Modify `frontend/src/map/controls/legend/MapLegend.tsx`. Add packet-type swatches (`PARTICLE_COLOR_MAP`), an SNR gradient bar with low/high labels, and a solid/dashed (witnessed/inferred) key. Existing legend test updated.

### Task 10: i18n + docs

- Add EN/NL/DE keys for every new string (PlaybackBar, toggles, legend). Run the i18n parity test.
- `CHANGELOG-DMC-EV.md` entry under map/frontend.
- `README.md` map feature description.
- `frontend/AGENTS.md`: document `map/packets/` engine, deck overlay, and that `packetNetworkGraph` is the single path authority.

Final verification: `lint`, `format:check`, `test:run`, `build` all green; runtime check recorded.

---

## Self-Review

- Spec coverage: link semantics (Task 3/5), deck 2D+3D (Task 4/5), witnessed/inferred (Task 3/4/9), VCR (Task 6/7), pulses/glow/buffer/sound toggles (Task 7/8), legend (Task 9), docs/i18n (Task 10), deferred items excluded. Covered.
- Type consistency: `PacketRenderModel`/`ArcDatum`/`PulseDatum`/`GlowDatum` defined in `packetTimeline.ts` and consumed by `packetDeckOverlay.ts` and `stateAsOf`. `resolveCoord` matches the existing `ResolveCoord`/`resolveLinkCoord` shape `{lat,lon}`. `PlaybackSnapshot` shared by controller + PlaybackBar.
- Placeholders: none; pure-module code is concrete, glue tasks specify exact files/edits.
