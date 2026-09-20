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
  waterDripToneFor,
  jitterParams,
} from '../utils/signalAudioCore';

export const MIN_GAP_MS = 45; // wall-clock coalesce window for the Tx chirp
export const MIN_SPACING_S = 0.02; // >= 20 ms between clicks so near-simultaneous ticks stay distinct
export const MAX_LEAD_S = 0.6; // never schedule a click more than this far ahead of now
// Schedule every click well ahead of currentTime. A packet arrives over the WebSocket and is
// played from inside a React re-render of the feed; that render stalls the main thread, and
// Firefox does not commit a scheduled AudioBufferSource/AudioParam event until the JS task
// yields. If `at` has already passed by then, Firefox silently drops the click (Chrome plays
// it regardless). Measured in Firefox: with a 20 ms lead a click after a ~120 ms stall was
// silent; with a 250 ms lead it played. The lead must exceed the worst-case render stall.
// 250 ms latency is imperceptible for these ambient packet ticks. This is why the standalone
// reference app (plain JS, no heavy re-render) works with near-zero lead but this one needs it.
export const MIN_LEAD_S = 0.25;

const BP_FREQ = 1800; // geiger bandpass centre (Hz), before SNR + jitter shaping
const BP_Q = 1.6;
// Geiger exponential decay to near-silence (~11 ms): the crisp reference "tick". The gain
// ramps ARE reliable in Firefox once the click is scheduled far enough ahead (see
// MIN_LEAD_S) -- the earlier silence was the scheduling race, not the ramp, so this keeps
// the original sharp envelope.
const DECAY_S = 0.011;
const PEAK = 0.9; // geiger envelope peak before level jitter
// The bandpass (BP_Q) on unit-variance white noise attenuates the click to ~0.2 of the
// envelope target, so without makeup a PEAK-level click peaks around 0.08 at the output
// and is inaudible next to the oscillator themes (sonar/waterdrip peak near 0.5). This
// makeup gain lifts the envelope target to compensate, so the geiger tick lands at a
// comparable peak level. Verified by rendering the graph in an OfflineAudioContext.
const GEIGER_MAKEUP_GAIN = 5;

export type SignalAudioTheme = 'geiger' | 'sonar' | 'waterdrip';

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
  /**
   * Enable audio and create/resume the AudioContext. MUST be called from a user gesture
   * (Firefox only resumes within the gesture's transient activation).
   */
  resume(): void;
  /** True once the AudioContext exists and has resumed (audio can be heard). */
  isRunning(): boolean;
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
    // The crisp reference tick: near-instant exponential attack, exponential decay to
    // near-silence over DECAY_S (~11 ms). These ramps render reliably in both browsers now
    // that the click is scheduled MIN_LEAD_S ahead (the earlier Firefox silence was the
    // scheduling race under a main-thread stall, not the ramp itself).
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(PEAK * level * GEIGER_MAKEUP_GAIN, at + 0.0005);
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

  const playWaterDrip = (cue: PacketCue, at: number): void => {
    if (!ctx || !master) return;
    const { pitch, level } = jitterParams(rng);
    // Base ("resonant") frequency is chosen by packet type, so each type drips at
    // a different depth. SNR + jitter nudge it so a burst stays organic.
    const base = waterDripToneFor(cue.payloadType).freq * snrPitchFactor(cue.snrDb) * pitch;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    // The drip: a fast downward pitch bend from ~2x the base down to the base
    // (the characteristic "ploop"). A lower base (deeper type) makes a longer,
    // deeper drop. A quick attack then a short exponential tail.
    osc.frequency.setValueAtTime(base * 2, at);
    osc.frequency.exponentialRampToValueAtTime(base, at + 0.09);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.9 * level, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
    osc.connect(g);
    g.connect(lp);
    lp.connect(master);
    osc.start(at);
    osc.stop(at + 0.28);
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
      // Do NOT create or resume the AudioContext here. In Firefox a context created outside
      // a user gesture (e.g. at page load when sound was persisted on) is delivered silent
      // even after it later resumes -- only a context born inside a user gesture produces
      // audio. Context creation therefore happens exclusively in resume(), which callers
      // invoke from a real gesture (the sound toggle, or the first pointer/key event).
    },
    isEnabled(): boolean {
      return enabled;
    },
    resume(): void {
      enabled = true;
      ensure();
    },
    isRunning(): boolean {
      return ctx !== null && ctx.state === 'running';
    },
    setTheme(t: SignalAudioTheme): void {
      if (t === 'geiger' || t === 'sonar' || t === 'waterdrip') theme = t;
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
      // Only schedule into a running context. A suspended context (Firefox keeps it
      // suspended until it actually resumes, even after a toggle gesture) has a frozen
      // clock: clicks laid down now are (a) inaudible and (b) pile up against the frozen
      // currentTime, then all fire at once when it resumes -- the "machine-gun" burst. Try
      // to nudge it awake and drop this click rather than queue it into the frozen timeline.
      if (ctx.state !== 'running') {
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') void ctx.resume();
        return false;
      }
      const now = ctx.currentTime;
      // Space distinct ticks apart, but never queue more than MAX_LEAD ahead: an extreme
      // burst overlaps into a roar instead of lagging, and nothing is dropped. The MIN_LEAD
      // floor keeps even a lone click just ahead of currentTime so Firefox renders it.
      const at = Math.min(Math.max(now + MIN_LEAD_S, nextAt), now + MAX_LEAD_S);
      if (theme === 'sonar') playSonar(cue, at);
      else if (theme === 'waterdrip') playWaterDrip(cue, at);
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
