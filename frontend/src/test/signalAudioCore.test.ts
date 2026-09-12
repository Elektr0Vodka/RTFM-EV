import { describe, it, expect } from 'vitest';
import {
  snrToPitch,
  snrPitchFactor,
  geigerToneFor,
  shouldPlay,
  txToneFor,
  jitterParams,
} from '../utils/signalAudioCore';

describe('snrToPitch', () => {
  it('maps the low SNR bound to the minimum pitch', () => {
    expect(snrToPitch(-20)).toBeCloseTo(300);
  });

  it('maps the high SNR bound to the maximum pitch', () => {
    expect(snrToPitch(10)).toBeCloseTo(1200);
  });

  it('maps the midpoint SNR to the midpoint pitch', () => {
    // midpoint of [-20, 10] is -5
    expect(snrToPitch(-5)).toBeCloseTo(750);
  });

  it('treats a null SNR as the low bound', () => {
    expect(snrToPitch(null)).toBeCloseTo(300);
  });

  it('clamps SNR below the low bound', () => {
    expect(snrToPitch(-100)).toBeCloseTo(300);
  });

  it('clamps SNR above the high bound', () => {
    expect(snrToPitch(100)).toBeCloseTo(1200);
  });
});

describe('snrPitchFactor', () => {
  it('is 0.85 at the low SNR bound', () => {
    expect(snrPitchFactor(-20)).toBeCloseTo(0.85);
  });

  it('is 1.15 at the high SNR bound', () => {
    expect(snrPitchFactor(10)).toBeCloseTo(1.15);
  });

  it('is 1.0 at the midpoint SNR', () => {
    expect(snrPitchFactor(-5)).toBeCloseTo(1.0);
  });

  it('treats a null SNR as the low bound', () => {
    expect(snrPitchFactor(null)).toBeCloseTo(0.85);
  });
});

describe('geigerToneFor', () => {
  it('returns the mapped frequency for a known payload type', () => {
    expect(geigerToneFor('ADVERT').freq).toBe(880);
    expect(geigerToneFor('ACK').freq).toBe(1600);
    expect(geigerToneFor('TRACE').freq).toBe(660);
    expect(geigerToneFor('TEXT_MESSAGE').freq).toBe(1200);
  });

  it('falls back to the default frequency for an unknown or Unknown type', () => {
    expect(geigerToneFor('Unknown').freq).toBe(500);
    expect(geigerToneFor('SOMETHING_ELSE').freq).toBe(500);
  });
});

describe('shouldPlay', () => {
  it('is true once the minimum gap has elapsed', () => {
    expect(shouldPlay(1000, 900, 50)).toBe(true);
  });

  it('is false inside the minimum gap', () => {
    expect(shouldPlay(920, 900, 50)).toBe(false);
  });

  it('is true exactly at the gap boundary', () => {
    expect(shouldPlay(950, 900, 50)).toBe(true);
  });

  it('is true for an initial -Infinity lastMs', () => {
    expect(shouldPlay(0, -Infinity, 50)).toBe(true);
  });
});

describe('txToneFor', () => {
  it('returns the mapped two-tone chirp for a known kind', () => {
    expect(txToneFor('advert-direct')).toEqual({ f1: 520, f2: 900 });
    expect(txToneFor('trace')).toEqual({ f1: 620, f2: 1040 });
  });

  it('falls back to the default chirp for an unknown kind', () => {
    expect(txToneFor('nope')).toEqual({ f1: 500, f2: 860 });
  });
});

describe('jitterParams', () => {
  it('returns the low bounds when random is 0', () => {
    const { pitch, level } = jitterParams(() => 0);
    expect(pitch).toBeCloseTo(0.94);
    expect(level).toBeCloseTo(0.78);
  });

  it('returns the high bounds when random is 1', () => {
    const { pitch, level } = jitterParams(() => 1);
    expect(pitch).toBeCloseTo(1.07);
    expect(level).toBeCloseTo(1.0);
  });

  it('returns the midpoints when random is 0.5', () => {
    const { pitch, level } = jitterParams(() => 0.5);
    expect(pitch).toBeCloseTo(1.005);
    expect(level).toBeCloseTo(0.89);
  });

  it('defaults to Math.random and stays within bounds', () => {
    const { pitch, level } = jitterParams();
    expect(pitch).toBeGreaterThanOrEqual(0.94);
    expect(pitch).toBeLessThanOrEqual(1.07);
    expect(level).toBeGreaterThanOrEqual(0.78);
    expect(level).toBeLessThanOrEqual(1.0);
  });
});
