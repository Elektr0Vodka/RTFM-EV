import { describe, expect, it } from 'vitest';

import { Capture, TrackWindow, isUsableFix } from '../../wardrive/capture';
import type { Fix } from '../../wardrive/messages';

const T0 = Date.parse('2026-10-19T10:00:00.000Z');
const fix = (over: Partial<Fix> = {}): Fix => ({ lat: 52.1, lon: 5.1, accM: 5, at: T0, ...over });
const radio = { snr: 6, rssi: -90, raw: new Uint8Array([0x15, 0x00, 0x01]) };

describe('usable fix', () => {
  it('accepts a fix within 100 m and 10 s', () => {
    expect(isUsableFix(fix({ accM: 100 }), T0 + 10000)).toBe(true);
  });

  it('accepts a fix without an accuracy figure', () => {
    expect(isUsableFix(fix({ accM: null }), T0)).toBe(true);
  });

  it('refuses a worse, older, missing or impossible fix', () => {
    expect(isUsableFix(fix({ accM: 101 }), T0)).toBe(false);
    expect(isUsableFix(fix(), T0 + 10001)).toBe(false);
    expect(isUsableFix(null, T0)).toBe(false);
    expect(isUsableFix(fix({ lat: 91 }), T0)).toBe(false);
    expect(isUsableFix(fix({ accM: -1 }), T0)).toBe(false);
  });
});

describe('capture', () => {
  it('turns a reception with a usable fix into a stored reception', () => {
    const c = new Capture();
    const rec = c.onReception(radio, fix(), T0 + 500);
    expect(rec).toEqual({
      rxAt: '2026-10-19T10:00:00.500Z',
      raw: radio.raw,
      snr: 6,
      rssi: -90,
      fix: fix(),
    });
    expect(c.counts).toEqual({ heard: 1, stored: 1, noPosition: 0 });
  });

  it('counts a reception without a usable fix as no position and stores nothing', () => {
    const c = new Capture();
    expect(c.onReception(radio, null, T0)).toBeNull();
    expect(c.onReception(radio, fix({ accM: 500 }), T0)).toBeNull();
    expect(c.counts).toEqual({ heard: 2, stored: 0, noPosition: 2 });
  });
});

describe('track window', () => {
  it('cuts a track after 10 s, counting what was heard', () => {
    const w = new TrackWindow();
    expect(w.tick(T0, fix())).toBeNull();
    w.heard();
    w.heard();
    expect(w.tick(T0 + 9999, fix({ at: T0 + 9999 }))).toBeNull();
    const row = w.tick(T0 + 10000, fix({ at: T0 + 10000 }));
    expect(row).toEqual({
      t0: '2026-10-19T10:00:00.000Z',
      t1: '2026-10-19T10:00:10.000Z',
      lat: 52.1,
      lon: 5.1,
      accM: 5,
      rxCount: 2,
      listening: true,
    });
  });

  it('cuts a track after 25 m', () => {
    const w = new TrackWindow();
    w.tick(T0, fix());
    expect(w.tick(T0 + 1000, fix({ lat: 52.1002, at: T0 + 1000 }))).toBeNull();
    const row = w.tick(T0 + 2000, fix({ lat: 52.1003, at: T0 + 2000 }));
    expect(row?.rxCount).toBe(0);
    expect(row?.t1).toBe('2026-10-19T10:00:02.000Z');
  });

  it('does not cut without a usable fix and keeps counting', () => {
    const w = new TrackWindow();
    w.tick(T0, fix());
    w.heard();
    expect(w.tick(T0 + 20000, null)).toBeNull();
    w.heard();
    const row = w.tick(T0 + 21000, fix({ at: T0 + 21000 }));
    expect(row?.rxCount).toBe(2);
  });

  it('closes with listening false and starts over', () => {
    const w = new TrackWindow();
    w.tick(T0, fix());
    w.heard();
    const row = w.close(T0 + 4000, fix({ at: T0 + 4000 }));
    expect(row).toEqual(expect.objectContaining({ rxCount: 1, listening: false }));
    expect(w.close(T0 + 5000, fix())).toBeNull();
  });

  it('closes nothing without a fix', () => {
    const w = new TrackWindow();
    w.tick(T0, fix());
    expect(w.close(T0 + 4000, null)).toBeNull();
  });
});
