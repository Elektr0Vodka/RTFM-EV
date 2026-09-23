import type { Contact, RadioConfig, RadioTraceNode } from '../types';
import { getEffectiveLocation, isValidLocation } from './pathUtils';

/** One trace node projected onto a map location, or null lat/lon when it
 *  cannot be placed (custom hop, unknown repeater, or missing GPS). */
export interface TraceMapNode {
  /** Position in the full node list (origin, hops, terminal), used for
   *  marker numbering and to detect skipped hops between segments. */
  index: number;
  role: RadioTraceNode['role'];
  publicKey: string | null;
  name: string | null;
  snr: number | null;
  lat: number | null;
  lon: number | null;
}

/** A drawn line segment between two consecutive LOCATED nodes. `dashed` is
 *  true when one or more unlocated hops were skipped between them, so the
 *  map shows a visible gap instead of implying a direct hop. */
export interface TraceMapSegment {
  fromIndex: number;
  toIndex: number;
  coordinates: [[number, number], [number, number]];
  dashed: boolean;
}

/**
 * Resolve each trace node to a map location.
 *
 * - 'local' nodes (the trace origin and terminal, both the local radio) use
 *   the radio config's own location.
 * - 'repeater' nodes look up the matching contact by public key; the
 *   advertised location wins, a manual override is the fallback (same rule
 *   the rest of the map uses).
 * - 'custom' hops have no resolved identity and are never located.
 */
export function resolveTraceNodeLocations(
  nodes: RadioTraceNode[],
  config: Pick<RadioConfig, 'lat' | 'lon'> | null,
  contactsByKey: ReadonlyMap<string, Contact>
): TraceMapNode[] {
  return nodes.map((node, index) => {
    let lat: number | null = null;
    let lon: number | null = null;

    if (node.role === 'local') {
      if (config && isValidLocation(config.lat, config.lon)) {
        lat = config.lat;
        lon = config.lon;
      }
    } else if (node.role === 'repeater' && node.public_key) {
      const contact = contactsByKey.get(node.public_key);
      const loc = contact ? getEffectiveLocation(contact) : null;
      if (loc) {
        lat = loc.lat;
        lon = loc.lon;
      }
    }
    // 'custom' hops (raw hex prefixes with no matched contact) stay unlocated.

    return {
      index,
      role: node.role,
      publicKey: node.public_key,
      name: node.name,
      snr: node.snr,
      lat,
      lon,
    };
  });
}

/** Build the map route as line segments between consecutive located nodes,
 *  skipping unlocated hops and marking the bridging segment dashed. */
type LocatedTraceMapNode = TraceMapNode & { lat: number; lon: number };

function isLocated(node: TraceMapNode): node is LocatedTraceMapNode {
  return node.lat !== null && node.lon !== null;
}

export function buildTraceMapSegments(nodes: TraceMapNode[]): TraceMapSegment[] {
  const segments: TraceMapSegment[] = [];
  let prev: LocatedTraceMapNode | null = null;

  for (const node of nodes) {
    if (!isLocated(node)) {
      continue;
    }
    if (prev) {
      segments.push({
        fromIndex: prev.index,
        toIndex: node.index,
        coordinates: [
          [prev.lon, prev.lat],
          [node.lon, node.lat],
        ],
        dashed: node.index - prev.index > 1,
      });
    }
    prev = node;
  }

  return segments;
}

export interface TraceMapData {
  nodes: TraceMapNode[];
  segments: TraceMapSegment[];
}

/** Convenience wrapper combining location resolution and segment building:
 *  turns a raw trace result into everything a map needs to draw it. */
export function buildTraceMapData(
  nodes: RadioTraceNode[],
  config: Pick<RadioConfig, 'lat' | 'lon'> | null,
  contactsByKey: ReadonlyMap<string, Contact>
): TraceMapData {
  const mapNodes = resolveTraceNodeLocations(nodes, config, contactsByKey);
  return { nodes: mapNodes, segments: buildTraceMapSegments(mapNodes) };
}

/** Format an SNR value for display, e.g. "+3.5 dB". Returns null when the
 *  value is missing so callers can omit the SNR entirely. */
export function formatSNR(snr: number | null | undefined): string | null {
  if (typeof snr !== 'number' || Number.isNaN(snr)) {
    return null;
  }
  return `${snr >= 0 ? '+' : ''}${snr.toFixed(1)} dB`;
}
