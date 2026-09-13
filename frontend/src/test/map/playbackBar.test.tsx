import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlaybackBar } from '../../map/controls/PlaybackBar';
import type { PlaybackSnapshot } from '../../map/packets/playbackController';

const range = { minMs: 0, maxMs: 10000 };
const base: PlaybackSnapshot = { mode: 'replay', currentMs: 2000, rate: 1, playing: false };

function setup(snapshot: PlaybackSnapshot = base) {
  const handlers = {
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onSeek: vi.fn(),
    onRate: vi.fn(),
    onLive: vi.fn(),
    onLookback: vi.fn(),
  };
  render(<PlaybackBar snapshot={snapshot} range={range} lookbackMs={3600000} {...handlers} />);
  return handlers;
}

describe('PlaybackBar', () => {
  it('shows Play when paused and calls onPlay', () => {
    const h = setup({ ...base, playing: false });
    fireEvent.click(screen.getByLabelText('Play'));
    expect(h.onPlay).toHaveBeenCalledTimes(1);
  });

  it('shows Pause when playing and calls onPause', () => {
    const h = setup({ ...base, playing: true });
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(h.onPause).toHaveBeenCalledTimes(1);
  });

  it('seeks when the timeline is changed', () => {
    const h = setup();
    fireEvent.change(screen.getByLabelText('Playback timeline'), { target: { value: '3000' } });
    expect(h.onSeek).toHaveBeenCalledWith(3000);
  });

  it('sets the rate from a speed button', () => {
    const h = setup();
    fireEvent.click(screen.getByText('2x'));
    expect(h.onRate).toHaveBeenCalledWith(2);
  });

  it('jumps to live', () => {
    const h = setup();
    fireEvent.click(screen.getByText('Live'));
    expect(h.onLive).toHaveBeenCalledTimes(1);
  });
});
