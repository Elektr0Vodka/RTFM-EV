// Pure helper deciding which newly-arrived raw packets should produce an audio click.
// The raw packet store buffer is oldest-first, newest appended at the end, capped and
// deduped by observation key. This tracks the last packet we played (by observation
// key) and returns only the packets appended since then, so:
//   - the reconnect backfill (seedRawPacketStore replaces the whole buffer) is NOT
//     replayed as a burst -- the last key is gone, so we just re-baseline;
//   - normal live traffic (one packet appended per store emit) plays exactly once.

import type { RawPacket } from '../types';
import { getRawPacketObservationKey } from './rawPacketIdentity';

export interface PlaySelection {
  toPlay: RawPacket[];
  nextKey: string | null;
}

export function selectPacketsToPlay(packets: RawPacket[], lastKey: string | null): PlaySelection {
  if (packets.length === 0) {
    return { toPlay: [], nextKey: null };
  }

  const newestKey = getRawPacketObservationKey(packets[packets.length - 1]);

  // First run: baseline to the newest packet, do not play the existing buffer.
  if (lastKey === null) {
    return { toPlay: [], nextKey: newestKey };
  }

  const lastIndex = packets.findIndex((p) => getRawPacketObservationKey(p) === lastKey);

  // Last key gone (reconnect/seed replaced the buffer, or it rolled off the cap):
  // re-baseline without replaying.
  if (lastIndex === -1) {
    return { toPlay: [], nextKey: newestKey };
  }

  return { toPlay: packets.slice(lastIndex + 1), nextKey: newestKey };
}
