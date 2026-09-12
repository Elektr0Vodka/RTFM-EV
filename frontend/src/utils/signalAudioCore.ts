// Pure synthesis parameters for the signal-audio engine. No Web Audio, no DOM: just
// the maths that turn a received packet into a pitch/tone plus the rate-limit and the
// per-click jitter, so it can be unit-tested without an AudioContext.
//
// Ported from two in-house sources: the SNR/payload-type/Tx shaping comes from
// EU-Meshcore-Analyzer (web/js/lib/signal-audio-core.js); the organic-train jitter for
// the Geiger click comes from DutchMeshCore-Observers (web/js/lib/clickaudio-core.js).

const SNR_LO = -20; // LoRa SNR span (dB) lower bound
const SNR_HI = 10; // LoRa SNR span (dB) upper bound
const PITCH_MIN = 300; // sonar ping frequency range (Hz)
const PITCH_MAX = 1200;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function snrNorm(snr: number | null): number {
  const value = snr == null ? SNR_LO : snr;
  return clamp01((value - SNR_LO) / (SNR_HI - SNR_LO));
}

// snrToPitch maps SNR (dB) to the sonar ping frequency (higher SNR = higher pitch).
export function snrToPitch(snr: number | null): number {
  return PITCH_MIN + snrNorm(snr) * (PITCH_MAX - PITCH_MIN);
}

// snrPitchFactor is a small multiplier (~0.85..1.15) so a Geiger tick's pitch still
// tracks SNR within its packet-type tone.
export function snrPitchFactor(snr: number | null): number {
  return 0.85 + snrNorm(snr) * 0.3;
}

// GEIGER_TONES maps a backend payload_type string (PayloadType.name, e.g. "ADVERT")
// to a base click frequency (Hz). `default` covers "Unknown" and any unmapped type.
export const GEIGER_TONES: Readonly<Record<string, number>> = Object.freeze({
  ADVERT: 880,
  TEXT_MESSAGE: 1200,
  GROUP_TEXT: 1050,
  GROUP_DATA: 1050,
  ACK: 1600,
  TRACE: 660,
  RESPONSE: 990,
  REQUEST: 920,
  ANON_REQUEST: 920,
  PATH: 720,
  CONTROL: 1400,
  MULTIPART: 840,
  RAW_CUSTOM: 500,
  default: 500,
});

export function geigerToneFor(payloadType: string): { freq: number } {
  const freq = GEIGER_TONES[payloadType] != null ? GEIGER_TONES[payloadType] : GEIGER_TONES.default;
  return { freq };
}

// shouldPlay rate-limits so a burst of packets does not machine-gun the output.
export function shouldPlay(nowMs: number, lastMs: number, minGapMs: number): boolean {
  return nowMs - lastMs >= minGapMs;
}

// TX_TONES: a distinct two-tone up-chirp per Tx kind, so a transmission is audibly OUR
// radio, not a reception. `default` covers any unlisted kind.
export const TX_TONES: Readonly<Record<string, { f1: number; f2: number }>> = Object.freeze({
  'advert-direct': { f1: 520, f2: 900 },
  'advert-flood': { f1: 440, f2: 780 },
  trace: { f1: 620, f2: 1040 },
  message: { f1: 700, f2: 1180 },
  default: { f1: 500, f2: 860 },
});

export function txToneFor(kind: string): { f1: number; f2: number } {
  return TX_TONES[kind] != null ? TX_TONES[kind] : TX_TONES.default;
}

// Organic-train jitter bounds. A packet burst sounds mechanical if every click is
// identical; a small random spread in pitch and level fixes that.
const PITCH_LO = 0.94;
const PITCH_HI = 1.07;
const LEVEL_LO = 0.78;
const LEVEL_HI = 1.0;

// jitterParams returns { pitch, level } multipliers for one Geiger click. `random`
// defaults to Math.random; tests inject a stub for deterministic output.
export function jitterParams(random: () => number = Math.random): {
  pitch: number;
  level: number;
} {
  const pitch = PITCH_LO + random() * (PITCH_HI - PITCH_LO);
  const level = LEVEL_LO + random() * (LEVEL_HI - LEVEL_LO);
  return { pitch, level };
}
