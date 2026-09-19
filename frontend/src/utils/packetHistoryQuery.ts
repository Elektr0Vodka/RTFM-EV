import { KNOWN_PAYLOAD_TYPES, HOP_BYTE_WIDTH_BUCKETS } from './rawPacketStats';

export interface HistoryParamInput {
  startTs: number;
  endTs: number;
  enabledTypes: Set<string>;
  enabledHopWidths: Set<string>;
  hexQuery: string;
  /** Trimmed message-content search term; empty string means "no search". */
  searchTerm: string;
  limit: number;
  beforeId?: number | null;
}

/**
 * Build query params for GET /api/packets/history. A filter axis is omitted
 * entirely when all of its options are enabled (the server then returns
 * everything for that axis), mirroring the live feed's "no filter = all".
 */
export function buildHistoryParams(input: HistoryParamInput): URLSearchParams {
  const p = new URLSearchParams();
  p.set('after_ts', String(Math.floor(input.startTs)));
  p.set('before_ts', String(Math.floor(input.endTs)));
  p.set('limit', String(input.limit));
  if (input.beforeId != null) p.set('before_id', String(input.beforeId));

  if (input.enabledTypes.size < KNOWN_PAYLOAD_TYPES.length) {
    for (const type of input.enabledTypes) p.append('payload_types', type);
  }
  if (input.enabledHopWidths.size < HOP_BYTE_WIDTH_BUCKETS.length) {
    for (const width of input.enabledHopWidths) p.append('hop_widths', width);
  }
  if (input.hexQuery !== '') p.set('hex', input.hexQuery);
  if (input.searchTerm) p.set('search', input.searchTerm);
  return p;
}
