import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClickAudio } from '../../map/packets/clickAudio';

let oscCount = 0;

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  createOscillator() {
    oscCount++;
    return {
      frequency: { value: 0 },
      connect: () => {},
      start: () => {},
      stop: () => {},
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
      connect: () => {},
    };
  }
  resume() {}
  close() {}
}

describe('clickAudio', () => {
  beforeEach(() => {
    oscCount = 0;
    (window as unknown as { AudioContext: unknown }).AudioContext =
      FakeAudioContext as unknown as typeof AudioContext;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not play while disabled', () => {
    const ca = createClickAudio();
    ca.play();
    expect(oscCount).toBe(0);
    expect(ca.isEnabled()).toBe(false);
  });

  it('plays a blip when enabled and stops again when disabled', () => {
    const ca = createClickAudio();
    ca.setEnabled(true);
    ca.play();
    expect(oscCount).toBe(1);
    ca.setEnabled(false);
    ca.play();
    expect(oscCount).toBe(1);
  });
});
