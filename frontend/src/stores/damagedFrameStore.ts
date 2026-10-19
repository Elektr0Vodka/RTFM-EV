import { useSyncExternalStore } from 'react';

import type { RawPacket } from '../types';
import { rxBadFrameToRawPacket, type RxBadFrame } from '../utils/damagedFrames';
import { appendRawPacketUnique } from '../utils/rawPacketIdentity';

/**
 * Damaged frames from Full capture, apart from the raw packet store so the map,
 * visualizer, signal audio and stats never see them. Only the Packet Feed reads
 * this store.
 */
export const MAX_DAMAGED_FRAMES = 200;

let frames: RawPacket[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function recordDamagedFrame(frame: RxBadFrame): void {
  const next = appendRawPacketUnique(frames, rxBadFrameToRawPacket(frame), MAX_DAMAGED_FRAMES);
  if (next === frames) return;
  frames = next;
  emit();
}

export function getDamagedFrames(): RawPacket[] {
  return frames;
}

export function resetDamagedFrameStore(): void {
  frames = [];
  emit();
}

export function useDamagedFrames(): RawPacket[] {
  return useSyncExternalStore(subscribe, getDamagedFrames);
}
