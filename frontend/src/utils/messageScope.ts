/**
 * Region-scope classification for an incoming message.
 *
 * A MeshCore packet either arrives as a plain flood (no region scope) or via a
 * TransportFlood/TransportDirect packet carrying a uint16 region scope code. The
 * backend resolves that code to a region name only when it matches an entry in
 * `known_regions`. This yields three distinguishable display states:
 *
 * - `named`: scoped and resolved to a known region name.
 * - `unknown`: scoped (a transport code is present) but not resolvable to a name
 *   we know, so we can tell it is regional without knowing which region.
 * - `unscoped`: no transport code, i.e. a plain flood with no region scope.
 */
export type MessageScope = 'named' | 'unknown' | 'unscoped';

export function classifyMessageScope(
  transportCode: number | null | undefined,
  region: string | null | undefined
): MessageScope {
  if (region) {
    return 'named';
  }
  if (transportCode != null) {
    return 'unknown';
  }
  return 'unscoped';
}

/** Hex label for an unresolved transport code, e.g. `0x1A2B`. */
export function formatTransportCode(transportCode: number): string {
  return `0x${transportCode.toString(16).toUpperCase().padStart(4, '0')}`;
}
