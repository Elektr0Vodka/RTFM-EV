import { MeshCoreDecoder, Utils } from '@michaelhart/meshcore-decoder';

import type { Channel, RawPacket } from '../types';
import type { PacketFilters } from '../hooks/usePacketFilters';
import { KNOWN_PAYLOAD_TYPES, classifyDecodedHopByteWidth } from './rawPacketStats';
import { createDecoderOptions } from './rawPacketInspector';

const KNOWN_PAYLOAD_TYPE_SET = new Set<string>(KNOWN_PAYLOAD_TYPES);

/** The subset of PacketFilters the client-side predicate needs. */
export type PacketFilterPredicateInput = Pick<
  PacketFilters,
  | 'enabledTypes'
  | 'enabledHopWidths'
  | 'hexQuery'
  | 'searchTerm'
  | 'allTypesEnabled'
  | 'allHopWidthsEnabled'
>;

/**
 * Match a live packet against the message-content search term. Mirrors the
 * server-side history search (message text / sender / channel), but reads the
 * live packet's WS-provided `decrypted_info`. A packet with no decrypted_info
 * (or no field containing the term) does not match while a term is active.
 */
function matchesSearchTerm(packet: RawPacket, term: string): boolean {
  const needle = term.toLowerCase();
  const info = packet.decrypted_info;
  if (!info) return false;
  return [info.message, info.sender, info.channel_name].some(
    (field) => field != null && field.toLowerCase().includes(needle)
  );
}

/**
 * Client-side equivalent of the server-side history filters, used to decide
 * whether a live packet belongs in the history browser while it is "live".
 * Mirrors the live feed's own single-decode classification so live and
 * historical rows obey identical rules. A non-hex/invalid query is the caller's
 * concern; here an empty hexQuery means "no hex filter".
 */
export function matchesPacketFilters(
  packet: RawPacket,
  filters: PacketFilterPredicateInput,
  channels?: Channel[]
): boolean {
  if (filters.hexQuery !== '' && !packet.data.toLowerCase().includes(filters.hexQuery)) {
    return false;
  }
  if (filters.searchTerm && !matchesSearchTerm(packet, filters.searchTerm)) {
    return false;
  }
  if (filters.allTypesEnabled && filters.allHopWidthsEnabled) return true;
  try {
    const decoded = MeshCoreDecoder.decode(packet.data, createDecoderOptions(channels));
    const name = decoded.isValid ? Utils.getPayloadTypeName(decoded.payloadType) : 'Unknown';
    const payloadType = KNOWN_PAYLOAD_TYPE_SET.has(name) ? name : 'Unknown';
    const hopWidth = classifyDecodedHopByteWidth(decoded);
    return (
      (filters.allTypesEnabled || filters.enabledTypes.has(payloadType)) &&
      (filters.allHopWidthsEnabled || filters.enabledHopWidths.has(hopWidth))
    );
  } catch {
    // Undecodable: treat as the "Unknown" payload type with "No path" width.
    return (
      (filters.allTypesEnabled || filters.enabledTypes.has('Unknown')) &&
      (filters.allHopWidthsEnabled || filters.enabledHopWidths.has('No path'))
    );
  }
}
