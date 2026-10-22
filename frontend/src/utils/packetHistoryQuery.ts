import { KNOWN_PAYLOAD_TYPES, HOP_BYTE_WIDTH_BUCKETS, ROUTE_FILTER_TYPES } from './rawPacketStats';
import { SF_FILTER_BUCKETS } from './radioSf';

export interface HistoryParamInput {
  startTs: number;
  endTs: number;
  enabledTypes: Set<string>;
  enabledHopWidths: Set<string>;
  /** Route types to keep; left out (or all of them) filters nothing. */
  enabledRoutes?: Set<string>;
  hexQuery: string;
  /** Trimmed search term (message content or policy rule name); empty means "no search". */
  searchTerm: string;
  /** Only packets with a stored OpenHop policy verdict. */
  policyOnly?: boolean;
  /** SF buckets to keep (`SF8`, `Unknown`); left out (or all of them) filters nothing. */
  enabledSfs?: Set<string>;
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
  if (input.enabledRoutes && input.enabledRoutes.size < ROUTE_FILTER_TYPES.length) {
    for (const route of input.enabledRoutes) p.append('route_types', route);
  }
  if (input.hexQuery !== '') p.set('hex', input.hexQuery);
  if (input.searchTerm) p.set('search', input.searchTerm);
  if (input.policyOnly) p.set('policy_only', 'true');
  if (input.enabledSfs && input.enabledSfs.size === 0) {
    // Every SF unticked: nothing matches, like the live feed.
    p.append('radio_sfs', 'none');
  } else if (input.enabledSfs && input.enabledSfs.size < SF_FILTER_BUCKETS.length) {
    for (const bucket of input.enabledSfs) {
      p.append('radio_sfs', bucket === 'Unknown' ? 'Unknown' : bucket.replace(/^SF/, ''));
    }
  }
  return p;
}
