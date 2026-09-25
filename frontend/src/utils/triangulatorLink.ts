/**
 * Deep link into the DMC triangulator (plan [13] option (a): link out, not a
 * port). The standalone app reads `?prefixes=<PREFIX or PREFIX:count, ...>`
 * (2/4/6 hex path-hash prefixes) from the URL, pre-fills its query and runs
 * discovery against the public mc-radar / map.meshcore.io feeds by itself, so
 * RTFM-EV only hands over the node's prefix; nothing else leaves the app.
 */

export const TRIANGULATOR_BASE_URL = 'https://triangulator.dutchmeshcore.nl/';

/** Widest prefix the triangulator accepts (3-byte path hash = 6 hex). */
export const TRIANGULATOR_PREFIX_HEX = 6;

/**
 * URL that opens the triangulator on this node, or null when the key is too
 * short to form a prefix (needs at least one hash byte).
 */
export function buildTriangulatorUrl(publicKey: string): string | null {
  const hex = publicKey.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex) || hex.length < 2) return null;
  // Even hex count only: a path-hash prefix is whole bytes.
  const width = Math.min(TRIANGULATOR_PREFIX_HEX, hex.length - (hex.length % 2));
  if (width < 2) return null;
  return `${TRIANGULATOR_BASE_URL}?prefixes=${hex.slice(0, width)}`;
}
