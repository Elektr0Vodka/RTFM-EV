import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SignalAudioEngine } from '../../lib/signalAudioEngine';
import type { LiveEntry } from '../../wardrive/liveLog';
import { useWardriveSound } from '../../wardrive/useWardriveSound';

const entry = (id: number, snr = 2): LiveEntry => ({
  id,
  at: id,
  rssi: -90,
  snr,
  payloadType: 4,
  typeName: 'Advert',
  direct: false,
  hops: 0,
  lat: null,
  lon: null,
  kept: false,
  packetType: 'GroupText',
  heardDirect: false,
  sender: { kind: null, id: null, label: null, role: null },
  channel: null,
  text: null,
  stored: false,
});

function fakeEngine() {
  const engine = {
    setEnabled: vi.fn(),
    isEnabled: vi.fn(() => true),
    resume: vi.fn(),
    isRunning: vi.fn(() => true),
    setTheme: vi.fn(),
    getTheme: vi.fn(() => 'geiger' as const),
    setVolume: vi.fn(),
    getVolume: vi.fn(() => 0.5),
    onPacket: vi.fn(() => true),
    onTx: vi.fn(() => true),
    dispose: vi.fn(),
  } satisfies SignalAudioEngine;
  return engine;
}

function setup(mode: 'off' | 'rx', entries: LiveEntry[]) {
  const engine = fakeEngine();
  const view = renderHook(({ m, e }) => useWardriveSound(m, e, { createEngine: () => engine }), {
    initialProps: { m: mode, e: entries },
  });
  return { engine, ...view };
}

describe('useWardriveSound', () => {
  it('plays one cue per new reception', () => {
    const { engine, rerender } = setup('rx', []);
    rerender({ m: 'rx', e: [entry(1, 3)] });
    rerender({ m: 'rx', e: [entry(3, 5), entry(2, 4), entry(1, 3)] });
    expect(engine.onPacket).toHaveBeenCalledTimes(3);
    expect(engine.onPacket).toHaveBeenNthCalledWith(1, { snrDb: 3, payloadType: 'Advert' });
    expect(engine.onPacket).toHaveBeenNthCalledWith(3, { snrDb: 5, payloadType: 'Advert' });
  });

  it('does not play the same reception twice', () => {
    const { engine, rerender } = setup('rx', []);
    rerender({ m: 'rx', e: [entry(1)] });
    rerender({ m: 'rx', e: [entry(1)] });
    expect(engine.onPacket).toHaveBeenCalledTimes(1);
  });

  it('is quiet when off', () => {
    const { engine, rerender } = setup('off', []);
    rerender({ m: 'off', e: [entry(1)] });
    expect(engine.onPacket).not.toHaveBeenCalled();
  });

  it('copes with a burst', () => {
    const { engine, rerender } = setup('rx', []);
    const burst = Array.from({ length: 300 }, (_, i) => entry(300 - i));
    expect(() => rerender({ m: 'rx', e: burst })).not.toThrow();
    expect(engine.onPacket).toHaveBeenCalledTimes(300);
  });

  it('starts sound saved as on with the first tap after a reload', () => {
    const { engine } = setup('rx', []);
    expect(engine.resume).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('pointerdown'));
    expect(engine.setEnabled).toHaveBeenCalledWith(true);
    expect(engine.resume).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('pointerdown'));
    expect(engine.resume).toHaveBeenCalledTimes(1);
  });

  it('starts the audio from the button press', () => {
    const { engine, result } = setup('off', []);
    result.current.enable();
    expect(engine.resume).toHaveBeenCalled();
  });
});
