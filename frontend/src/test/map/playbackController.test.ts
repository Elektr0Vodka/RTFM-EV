import { describe, it, expect, vi } from 'vitest';
import { createPlaybackController } from '../../map/packets/playbackController';

describe('PlaybackController', () => {
  it('tracks wall time (minus buffer) in live mode', () => {
    const c = createPlaybackController();
    c.setBufferMs(2000);
    c.tick(10000);
    expect(c.snapshot().mode).toBe('live');
    expect(c.snapshot().currentMs).toBe(8000);
    c.tick(11000); // wall advances continuously between packets
    expect(c.snapshot().currentMs).toBe(9000);
  });

  it('seek enters replay at the clamped time', () => {
    const c = createPlaybackController();
    c.setRange(0, 10000);
    c.seek(1000);
    expect(c.snapshot().mode).toBe('replay');
    expect(c.snapshot().currentMs).toBe(1000);
    c.seek(999999);
    expect(c.snapshot().currentMs).toBe(10000);
  });

  it('advances currentMs by elapsed * rate while replaying', () => {
    const c = createPlaybackController();
    c.setRange(0, 10000);
    c.seek(1000);
    c.setRate(1);
    c.play();
    c.tick(5000); // first tick establishes the wall baseline
    c.tick(6000); // +1000ms at rate 1
    expect(c.snapshot().currentMs).toBe(2000);
  });

  it('clamps at the end of the buffer and pauses', () => {
    const c = createPlaybackController();
    c.setRange(0, 2000);
    c.seek(1500);
    c.play();
    c.tick(5000);
    c.tick(6000); // would reach 2500, clamps to 2000
    expect(c.snapshot().currentMs).toBe(2000);
    expect(c.snapshot().playing).toBe(false);
  });

  it('goLive returns to live and resumes wall-follow', () => {
    const c = createPlaybackController();
    c.setRange(0, 2000);
    c.seek(500);
    c.goLive();
    c.tick(20000);
    expect(c.snapshot().mode).toBe('live');
    expect(c.snapshot().currentMs).toBe(20000); // buffer 0
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const c = createPlaybackController();
    c.setRange(0, 10000);
    const spy = vi.fn();
    const unsub = c.subscribe(spy);
    c.seek(1000);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
    c.seek(2000);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
