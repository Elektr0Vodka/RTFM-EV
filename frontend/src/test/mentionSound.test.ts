import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMentionSoundPlayer } from '../lib/mentionSound';

class FakeAudio {
  src = '';
  volume = 1;
  currentTime = 0;
  muted = false;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
}

describe('mentionSound player', () => {
  let fake: FakeAudio;
  let now: number;
  beforeEach(() => {
    fake = new FakeAudio();
    now = 1000;
  });

  const make = () =>
    createMentionSoundPlayer({
      makeAudio: () => fake as unknown as HTMLAudioElement,
      now: () => now,
    });

  it('sets src and clamps volume 0..1 from 0..100', () => {
    const p = make();
    p.setSource('./sounds/beep.mp3');
    p.setVolume(150);
    expect(fake.src).toBe('./sounds/beep.mp3');
    expect(fake.volume).toBe(1);
    p.setVolume(-5);
    expect(fake.volume).toBe(0);
    p.setVolume(50);
    expect(fake.volume).toBe(0.5);
  });

  it('plays by resetting currentTime and calling play()', () => {
    const p = make();
    p.setSource('./sounds/beep.mp3');
    fake.currentTime = 3;
    p.play();
    expect(fake.currentTime).toBe(0);
    expect(fake.play).toHaveBeenCalledTimes(1);
  });

  it('coalesces repeated plays within the window', () => {
    const p = make();
    p.setSource('./sounds/beep.mp3');
    p.play();
    now += 100; // within 300ms window
    p.play();
    expect(fake.play).toHaveBeenCalledTimes(1);
    now += 400; // past the window
    p.play();
    expect(fake.play).toHaveBeenCalledTimes(2);
  });

  it('swallows a rejected play() promise', () => {
    fake.play = vi.fn().mockRejectedValue(new Error('blocked'));
    const p = make();
    p.setSource('./sounds/beep.mp3');
    expect(() => p.play()).not.toThrow();
  });
});
