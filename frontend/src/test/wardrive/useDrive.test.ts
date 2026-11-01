import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Fix } from '../../wardrive/messages';
import type { Queue } from '../../wardrive/queue';
import type { Companion } from '../../wardrive/radio/companion';
import { useDrive } from '../../wardrive/useDrive';

function fakeQueue(): Queue {
  return { addObs: vi.fn(async () => {}), addTrack: vi.fn(async () => {}) } as unknown as Queue;
}

const companion = { onReception: () => () => {} } as unknown as Companion;

function useDriveWith(queue: Queue | null) {
  const fixRef = useRef<Fix | null>({ lat: 52.1, lon: 5.1, accM: 5, at: Date.now() });
  return useDrive(queue, fixRef);
}

describe('useDrive', () => {
  // The page re-renders while a drive runs; only leaving the page ends it.
  // Before, a pending effect cleanup holding an older stop ended a drive
  // that had just started.
  it('keeps a running drive when the hook gets a new stop function', () => {
    const { result, rerender } = renderHook(({ queue }) => useDriveWith(queue), {
      initialProps: { queue: fakeQueue() },
    });
    act(() => result.current.start(companion, 'AB'));
    expect(result.current.running).toBe(true);
    rerender({ queue: fakeQueue() });
    expect(result.current.running).toBe(true);
  });

  it('tags every row of a drive with that drive and a new drive with a new uid', () => {
    const queue = fakeQueue();
    const { result } = renderHook(() => useDriveWith(queue));
    act(() => result.current.start(companion, 'AB'));
    act(() => result.current.stop());
    act(() => result.current.start(companion, 'AB'));
    act(() => result.current.stop());
    const calls = (queue.addTrack as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const [first, second] = calls.map((c) => c[3] as string);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
    // The track message itself carries no drive field.
    expect(Object.keys(calls[0][1] as object)).not.toContain('drive');
  });

  it('ends the drive and closes the track when the page goes', () => {
    const queue = fakeQueue();
    const { result, unmount } = renderHook(() => useDriveWith(queue));
    act(() => result.current.start(companion, 'AB'));
    unmount();
    expect(queue.addTrack).toHaveBeenCalledTimes(1);
  });
});
