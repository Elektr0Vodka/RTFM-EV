import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';

import type { RawPacket } from '../types';

/**
 * Content identity of a packet, independent of its routing path.
 *
 * A flooded packet is re-broadcast across many paths: each hop appends to the
 * path header, but the payload (the actual message/advert content) is identical.
 * Stripping the header/path and keying on the payload bytes lets us recognise
 * "the same packet heard across different paths" for the fold-by-content view.
 *
 * Undecodable frames keep their full hex as the key, so they only ever group
 * with a byte-identical twin (we cannot safely strip a path we cannot parse).
 */
const contentKeyCache = new WeakMap<RawPacket, string>();

export function getRawPacketContentKey(packet: RawPacket): string {
  const cached = contentKeyCache.get(packet);
  if (cached !== undefined) {
    return cached;
  }

  let key: string;
  try {
    const structure = MeshCoreDecoder.analyzeStructure(packet.data);
    const payloadHex = structure?.payload?.hex ?? '';
    key =
      payloadHex.length > 0 ? `p:${payloadHex.toUpperCase()}` : `d:${packet.data.toUpperCase()}`;
  } catch {
    key = `d:${packet.data.toUpperCase()}`;
  }

  contentKeyCache.set(packet, key);
  return key;
}

export interface FoldedPacket {
  /** Representative packet for the group: the newest sighting. */
  packet: RawPacket;
  /** How many packets (copies across paths) fell into this group. */
  count: number;
}

/**
 * Collapse packets that share content (see getRawPacketContentKey) into one
 * entry per unique content. The representative is the newest sighting so the
 * row's time reflects the most recent hearing; `count` is the number of copies.
 * Group order follows first appearance in the input; callers sort afterwards.
 */
export function foldPacketsByContent(
  packets: RawPacket[],
  keyFn: (packet: RawPacket) => string = getRawPacketContentKey
): FoldedPacket[] {
  const groups = new Map<string, FoldedPacket>();
  for (const packet of packets) {
    const key = keyFn(packet);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { packet, count: 1 });
      continue;
    }
    existing.count += 1;
    if (packet.timestamp > existing.packet.timestamp) {
      existing.packet = packet;
    }
  }
  return [...groups.values()];
}
