// Optional geiger-style click feedback: a short synthesized blip per newly
// shown packet. Off by default. Guards for environments without Web Audio.

export interface ClickAudio {
  play(): void;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
  isEnabled(): boolean;
  destroy(): void;
}

type AudioCtor = typeof AudioContext;

export function createClickAudio(): ClickAudio {
  let enabled = false;
  let volume = 0.3;
  let ctx: AudioContext | null = null;

  const ensureCtx = (): AudioContext | null => {
    if (ctx) return ctx;
    const AC: AudioCtor | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
        : undefined;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  };

  return {
    play(): void {
      if (!enabled) return;
      const c = ensureCtx();
      if (!c) return;
      if (c.state === 'suspended') void c.resume();
      const now = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.frequency.value = 880;
      const level = Math.max(0, Math.min(1, volume)) * 0.3;
      gain.gain.setValueAtTime(level, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.06);
    },
    setEnabled(on: boolean): void {
      enabled = on;
    },
    setVolume(v: number): void {
      volume = v;
    },
    isEnabled(): boolean {
      return enabled;
    },
    destroy(): void {
      try {
        void ctx?.close();
      } catch {
        /* context may already be closed */
      }
      ctx = null;
    },
  };
}
