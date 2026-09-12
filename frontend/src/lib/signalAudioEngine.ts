// Web Audio engine for the signal-audio feature. Each received packet becomes either a
// crisp filtered noise-burst click ("geiger", the fixed-click synthesis from
// DutchMeshCore-Observers) or a sine ping ("sonar", from EU-Meshcore-Analyzer), with
// pitch shaped by SNR. Our own transmissions get a distinct two-tone up-chirp so they
// are audibly not receptions. The AudioContext factory is injected (makeContext) so the
// engine unit-tests against a recording fake context. Audio is OFF until
// setEnabled(true), which must run from a user gesture (browser autoplay policy) so the
// context can resume. No audio assets.
//
// Clicks are laid down on the AudioContext timeline, not gated on wall-clock time, so a
// burst is spaced out rather than dropped. Callers dedupe multi-observer copies upstream
// (RTFM stores one row per payload), so onPacket fires once per physical transmission.

import {
  snrToPitch,
  snrPitchFactor,
  shouldPlay,
  txToneFor,
  jitterParams,
} from '../utils/signalAudioCore';

export const MIN_GAP_MS = 45; // wall-clock coalesce window for the Tx chirp
export const MIN_SPACING_S = 0.02; // >= 20 ms between clicks so near-simultaneous ticks stay distinct
export const MAX_LEAD_S = 0.25; // never schedule a click more than this far ahead of now

const BP_FREQ = 1800; // geiger bandpass centre (Hz), before SNR + jitter shaping
const BP_Q = 1.6;
const DECAY_S = 0.011; // geiger exponential decay to near-silence (~11 ms)
const PEAK = 0.9; // geiger envelope peak before level jitter

export type SignalAudioTheme = 'geiger' | 'sonar';

export interface PacketCue {
  snrDb: number | null;
  payloadType: string;
}

export interface TxCue {
  kind: string;
}

export interface SignalAudioEngineDeps {
  makeContext?: () => AudioContext;
  now?: () => number;
  random?: () => number;
}

export interface SignalAudioEngine {
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  setTheme(theme: SignalAudioTheme): void;
  getTheme(): SignalAudioTheme;
  setVolume(v: number): void;
  getVolume(): number;
  onPacket(cue: PacketCue): boolean;
  onTx(cue: TxCue): boolean;
  dispose(): void;
}

function defaultContext(): AudioContext {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API is not available');
  return new Ctor();
}

export function createSignalAudioEngine(deps: SignalAudioEngineDeps = {}): SignalAudioEngine {
  const clock = deps.now ?? (() => Date.now());
  const rng = deps.random ?? Math.random;
  const make = deps.makeContext ?? defaultContext;

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let enabled = false;
  let theme: SignalAudioTheme = 'geiger';
  let volume = 0.5;
  let lastTxMs = -Infinity;
  let nextAt = 0;

  const ensure = (): AudioContext => {
    if (!ctx) {
      ctx = make();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      // 50 ms of white noise, reused for every click.
      const n = Math.max(1, Math.floor(ctx.sampleRate * 0.05));
      noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') void ctx.resume();
    return ctx;
  };

  const playGeiger = (cue: PacketCue, at: number): void => {
    if (!ctx || !master || !noiseBuf) return;
    const { pitch, level } = jitterParams(rng);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = BP_FREQ * snrPitchFactor(cue.snrDb) * pitch;
    bp.Q.value = BP_Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(PEAK * level, at + 0.0005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + DECAY_S);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(at);
    src.stop(at + 0.04);
  };

  const playSonar = (cue: PacketCue, at: number): void => {
    if (!ctx || !master) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    osc.frequency.value = snrToPitch(cue.snrDb);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.9, at + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    osc.connect(g);
    g.connect(lp);
    lp.connect(master);
    osc.start(at);
    osc.stop(at + 0.36);
  };

  const playChirp = (cue: TxCue): void => {
    if (!ctx || !master) return;
    const { f1, f2 } = txToneFor(cue.kind);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(f1, t0);
    osc.frequency.linearRampToValueAtTime(f2, t0 + 0.06);
    g.gain.setValueAtTime(0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.09);
  };

  return {
    setEnabled(on: boolean): void {
      enabled = !!on;
      if (enabled) ensure();
    },
    isEnabled(): boolean {
      return enabled;
    },
    setTheme(t: SignalAudioTheme): void {
      if (t === 'geiger' || t === 'sonar') theme = t;
    },
    getTheme(): SignalAudioTheme {
      return theme;
    },
    setVolume(v: number): void {
      volume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = volume;
    },
    getVolume(): number {
      return volume;
    },
    onPacket(cue: PacketCue): boolean {
      if (!enabled || !ctx) return false;
      const now = ctx.currentTime;
      // Space distinct ticks apart, but never queue more than MAX_LEAD ahead: an extreme
      // burst overlaps into a roar instead of lagging, and nothing is dropped.
      const at = Math.min(Math.max(now, nextAt), now + MAX_LEAD_S);
      if (theme === 'sonar') playSonar(cue, at);
      else playGeiger(cue, at);
      nextAt = at + MIN_SPACING_S;
      return true;
    },
    onTx(cue: TxCue): boolean {
      if (!enabled || !ctx) return false;
      const t = clock();
      if (!shouldPlay(t, lastTxMs, MIN_GAP_MS)) return false;
      lastTxMs = t;
      playChirp(cue);
      return true;
    },
    dispose(): void {
      if (ctx && typeof ctx.close === 'function') void ctx.close();
      ctx = null;
      master = null;
      noiseBuf = null;
      enabled = false;
      nextAt = 0;
    },
  };
}
