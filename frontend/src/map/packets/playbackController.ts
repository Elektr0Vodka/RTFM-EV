// Virtual-clock playback engine for the live packet map. Owns the displayed
// time only; everything on screen is rendered as a pure function of it. Live
// mode pins the clock to the newest packet (minus a smoothing buffer); replay
// advances at `rate` and is seekable anywhere in range. Framework-agnostic.

import { BUFFER_MAX_MS } from './packetAnimMath';

export type PlaybackMode = 'live' | 'replay';

export interface PlaybackSnapshot {
  mode: PlaybackMode;
  currentMs: number;
  rate: number;
  playing: boolean;
}

export interface PlaybackController {
  snapshot(): PlaybackSnapshot;
  /** Advance the clock for one animation frame, given the current wall time
   *  (epoch ms). In live mode the clock is wallMs - buffer, so pulses keep
   *  animating between packet arrivals. */
  tick(wallMs: number): void;
  /** Record the newest data time as the replay upper bound. */
  setNewest(newestMs: number): void;
  /** Smoothing delay applied in live mode (0..BUFFER_MAX_MS). */
  setBufferMs(ms: number): void;
  /** Re-pin to live and resume following. */
  goLive(): void;
  pause(): void;
  play(): void;
  setRate(rate: number): void;
  /** Seek to a time (enters replay). */
  seek(ms: number): void;
  /** Timeline bounds used to clamp currentMs and detect end-of-buffer. */
  setRange(minMs: number, maxMs: number): void;
  subscribe(fn: (s: PlaybackSnapshot) => void): () => void;
}

const clamp = (x: number, lo: number, hi: number): number =>
  hi < lo ? lo : x < lo ? lo : x > hi ? hi : x;

export function createPlaybackController(init?: Partial<PlaybackSnapshot>): PlaybackController {
  let mode: PlaybackMode = init?.mode ?? 'live';
  let currentMs = init?.currentMs ?? 0;
  let rate = init?.rate ?? 1;
  let playing = init?.playing ?? true;
  let bufferMs = 0;
  let minMs = Number.NEGATIVE_INFINITY;
  let maxMs = Number.POSITIVE_INFINITY;
  let lastWallMs: number | null = null;

  const subs = new Set<(s: PlaybackSnapshot) => void>();
  let emitted: PlaybackSnapshot = { mode, currentMs, rate, playing };

  const snapshot = (): PlaybackSnapshot => ({ mode, currentMs, rate, playing });

  const notify = (): void => {
    const next = snapshot();
    if (
      next.mode === emitted.mode &&
      next.currentMs === emitted.currentMs &&
      next.rate === emitted.rate &&
      next.playing === emitted.playing
    ) {
      return;
    }
    emitted = next;
    for (const fn of subs) fn(next);
  };

  return {
    snapshot,

    tick(wallMs: number): void {
      if (mode === 'live') {
        lastWallMs = wallMs;
        const next = wallMs - bufferMs;
        if (next !== currentMs) {
          currentMs = next;
          notify();
        }
        return;
      }
      // replay
      if (!playing) {
        lastWallMs = wallMs;
        return;
      }
      if (lastWallMs == null) {
        lastWallMs = wallMs;
        return;
      }
      const elapsed = wallMs - lastWallMs;
      lastWallMs = wallMs;
      let next = currentMs + elapsed * rate;
      if (next >= maxMs) {
        next = maxMs;
        playing = false;
      }
      currentMs = clamp(next, minMs, maxMs);
      notify();
    },

    setNewest(next: number): void {
      if (maxMs === Number.POSITIVE_INFINITY || next > maxMs) maxMs = next;
    },

    setBufferMs(ms: number): void {
      bufferMs = clamp(ms, 0, BUFFER_MAX_MS);
    },

    goLive(): void {
      mode = 'live';
      playing = true;
      lastWallMs = null;
      notify();
    },

    pause(): void {
      if (mode === 'live') {
        // Freeze where we are and switch to replay so the clock stops following.
        mode = 'replay';
      }
      playing = false;
      notify();
    },

    play(): void {
      playing = true;
      lastWallMs = null;
      notify();
    },

    setRate(next: number): void {
      rate = next;
      notify();
    },

    seek(ms: number): void {
      mode = 'replay';
      lastWallMs = null;
      currentMs = clamp(ms, minMs, maxMs);
      notify();
    },

    setRange(nextMin: number, nextMax: number): void {
      minMs = nextMin;
      maxMs = nextMax;
      if (mode === 'replay') currentMs = clamp(currentMs, minMs, maxMs);
      notify();
    },

    subscribe(fn: (s: PlaybackSnapshot) => void): () => void {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
