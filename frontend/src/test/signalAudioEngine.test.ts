import { describe, it, expect, vi } from 'vitest';
import { createSignalAudioEngine, MIN_GAP_MS, MIN_SPACING_S } from '../lib/signalAudioEngine';

// A recording fake AudioContext: every node factory returns a plain object that
// records the params/connections/scheduling the engine performs, so the synthesis
// graph can be asserted without real audio (the pattern both source repos use).
function audioParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
}

type FakeParam = ReturnType<typeof audioParam>;
interface FakeGain {
  gain: FakeParam;
  connect: ReturnType<typeof vi.fn>;
}
interface FakeOscillator {
  type: string;
  frequency: FakeParam;
  connect: ReturnType<typeof vi.fn>;
  startedAt: number | undefined;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}
interface FakeFilter {
  type: string;
  frequency: FakeParam;
  Q: FakeParam;
  connect: ReturnType<typeof vi.fn>;
}
interface FakeBufferSource {
  buffer: unknown;
  connect: ReturnType<typeof vi.fn>;
  startedAt: number | undefined;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}
interface FakeBuffer {
  getChannelData: () => Float32Array;
}

function makeFakeContext(overrides: Partial<{ state: string; sampleRate: number }> = {}) {
  const created = {
    gains: [] as FakeGain[],
    oscillators: [] as FakeOscillator[],
    filters: [] as FakeFilter[],
    bufferSources: [] as FakeBufferSource[],
    buffers: [] as FakeBuffer[],
  };
  const ctx = {
    state: overrides.state ?? 'suspended',
    sampleRate: overrides.sampleRate ?? 48000,
    currentTime: 0,
    destination: { id: 'destination' },
    resume: vi.fn(),
    close: vi.fn(),
    createGain() {
      const node = { gain: audioParam(), connect: vi.fn() };
      created.gains.push(node);
      return node;
    },
    createOscillator() {
      const node = {
        type: '',
        frequency: audioParam(),
        connect: vi.fn(),
        startedAt: undefined as number | undefined,
        start: vi.fn(function (this: void, t: number) {
          node.startedAt = t;
        }),
        stop: vi.fn(),
      };
      created.oscillators.push(node);
      return node;
    },
    createBiquadFilter() {
      const node = { type: '', frequency: audioParam(), Q: audioParam(), connect: vi.fn() };
      created.filters.push(node);
      return node;
    },
    createBufferSource() {
      const node = {
        buffer: null as unknown,
        connect: vi.fn(),
        startedAt: undefined as number | undefined,
        start: vi.fn(function (this: void, t: number) {
          node.startedAt = t;
        }),
        stop: vi.fn(),
      };
      created.bufferSources.push(node);
      return node;
    },
    createBuffer(_channels: number, length: number) {
      const node = { getChannelData: () => new Float32Array(length) };
      created.buffers.push(node);
      return node;
    },
  };
  return { ctx, created };
}

function engineWith(fake: ReturnType<typeof makeFakeContext>, now: () => number = () => 0) {
  return createSignalAudioEngine({
    makeContext: () => fake.ctx as unknown as AudioContext,
    now,
    random: () => 0.5, // fix jitter so SNR shaping is the only variable
  });
}

describe('createSignalAudioEngine lifecycle', () => {
  it('creates and resumes the context on setEnabled(true)', () => {
    const fake = makeFakeContext({ state: 'suspended' });
    const make = vi.fn(() => fake.ctx as unknown as AudioContext);
    const engine = createSignalAudioEngine({ makeContext: make, now: () => 0 });
    expect(engine.isEnabled()).toBe(false);
    engine.setEnabled(true);
    expect(engine.isEnabled()).toBe(true);
    expect(make).toHaveBeenCalledTimes(1);
    expect(fake.ctx.resume).toHaveBeenCalled();
  });

  it('closes the context on dispose and stops playing', () => {
    const fake = makeFakeContext();
    const engine = engineWith(fake);
    engine.setEnabled(true);
    engine.dispose();
    expect(fake.ctx.close).toHaveBeenCalled();
    expect(engine.onPacket({ snrDb: 5, payloadType: 'ADVERT' })).toBe(false);
  });
});

describe('onPacket', () => {
  it('does nothing and returns false when disabled', () => {
    const fake = makeFakeContext();
    const engine = engineWith(fake);
    expect(engine.onPacket({ snrDb: 5, payloadType: 'ADVERT' })).toBe(false);
    expect(fake.created.bufferSources).toHaveLength(0);
    expect(fake.created.oscillators).toHaveLength(0);
  });

  it('geiger theme synthesizes a noise-burst click (buffer source -> bandpass -> gain)', () => {
    const fake = makeFakeContext();
    const engine = engineWith(fake);
    engine.setTheme('geiger');
    engine.setEnabled(true);
    expect(engine.onPacket({ snrDb: 5, payloadType: 'ADVERT' })).toBe(true);
    expect(fake.created.bufferSources).toHaveLength(1);
    expect(fake.created.filters).toHaveLength(1);
    expect(fake.created.filters[0].type).toBe('bandpass');
    // no oscillator for the geiger click
    expect(fake.created.oscillators).toHaveLength(0);
  });

  it('geiger click centre frequency rises with SNR', () => {
    const fake = makeFakeContext();
    const engine = engineWith(fake);
    engine.setTheme('geiger');
    engine.setEnabled(true);
    engine.onPacket({ snrDb: -20, payloadType: 'ADVERT' });
    engine.onPacket({ snrDb: 10, payloadType: 'ADVERT' });
    const lowFreq = fake.created.filters[0].frequency.value;
    const highFreq = fake.created.filters[1].frequency.value;
    expect(highFreq).toBeGreaterThan(lowFreq);
  });

  it('sonar theme synthesizes a sine ping at the SNR-mapped pitch', () => {
    const fake = makeFakeContext();
    const engine = engineWith(fake);
    engine.setTheme('sonar');
    engine.setEnabled(true);
    expect(engine.onPacket({ snrDb: 10, payloadType: 'ADVERT' })).toBe(true);
    expect(fake.created.oscillators).toHaveLength(1);
    expect(fake.created.oscillators[0].type).toBe('sine');
    // snrToPitch(10) === 1200
    expect(fake.created.oscillators[0].frequency.value).toBeCloseTo(1200);
  });

  it('spaces near-simultaneous clicks apart on the audio clock', () => {
    const fake = makeFakeContext();
    const engine = engineWith(fake);
    engine.setTheme('geiger');
    engine.setEnabled(true);
    fake.ctx.currentTime = 0;
    engine.onPacket({ snrDb: 0, payloadType: 'ADVERT' });
    engine.onPacket({ snrDb: 0, payloadType: 'ADVERT' });
    const first = fake.created.bufferSources[0].startedAt as number;
    const second = fake.created.bufferSources[1].startedAt as number;
    expect(second - first).toBeGreaterThanOrEqual(MIN_SPACING_S - 1e-9);
  });
});

describe('setVolume', () => {
  it('clamps to 0..1 and writes the master gain', () => {
    const fake = makeFakeContext();
    const engine = engineWith(fake);
    engine.setEnabled(true);
    engine.setVolume(2);
    expect(engine.getVolume()).toBe(1);
    engine.setVolume(-1);
    expect(engine.getVolume()).toBe(0);
    engine.setVolume(0.3);
    expect(engine.getVolume()).toBeCloseTo(0.3);
    // master gain is the first gain node created
    expect(fake.created.gains[0].gain.value).toBeCloseTo(0.3);
  });
});

describe('onTx', () => {
  it('synthesizes a triangle chirp and rate-limits within the min gap', () => {
    const fake = makeFakeContext();
    let t = 1000;
    const engine = engineWith(fake, () => t);
    engine.setEnabled(true);
    expect(engine.onTx({ kind: 'trace' })).toBe(true);
    expect(fake.created.oscillators).toHaveLength(1);
    expect(fake.created.oscillators[0].type).toBe('triangle');
    // second call inside the gap is suppressed
    t += MIN_GAP_MS - 1;
    expect(engine.onTx({ kind: 'trace' })).toBe(false);
    // once the gap elapses it plays again
    t += 2;
    expect(engine.onTx({ kind: 'trace' })).toBe(true);
    expect(fake.created.oscillators).toHaveLength(2);
  });
});
