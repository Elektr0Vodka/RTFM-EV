// Guessed (estimated) positions for nodes that have no advertised or manual
// location. Ported in spirit from meshcore-open's map screen
// (github.com/zjs81/meshcore-open, MIT, `lib/screens/map_screen.dart`,
// `_computeGuessedLocations` / `_offsetGuessedPosition`), which the plan 28
// research pass (docs/plans/28-meshcore-open-parity-gaps.md item 1.12) read
// to size this port. Pure module: no DOM, no fetch, no map instance, so the
// whole pipeline is unit-testable.
//
// Anchor direction note: meshcore-open's own `Contact.path` is stored as the
// device's direct route back to the contact (reversed from the wire), so its
// LAST entry is the hop nearest the contact. RTFM-EV's `contact_advert_paths`
// stores the path exactly as received on air: `origin -> hop0 -> ... ->
// hopN -> self` (see app/services/advert_links.py), so hop0 -- the FIRST
// hop, already precomputed server-side as `ContactAdvertPath.next_hop` -- is
// the one nearest the origin (the node being guessed). Same physical hop,
// opposite array convention: we use `next_hop`, not the tail of `path`.

import { CONTACT_TYPE_REPEATER, type Contact, type ContactAdvertPathSummary } from '../types';
import { calculateDistance, getEffectiveLocation, hasEffectiveLocation } from '../utils/pathUtils';

/** A node with no known location is only guessed while heard within this
 *  window, matching meshcore-open's own hardcoded 24h cutoff. This is
 *  intentionally NOT the map's separate Since/Until link-age filter (that
 *  one spans weeks/months of "heard recency" for links and nodes in
 *  general); a guess is only meaningful for a node that is plausibly still
 *  where it was heard, so it uses its own short, fixed freshness window. */
export const GUESSED_LOCATION_STALE_SECONDS = 24 * 60 * 60;

/**
 * Conservative practical single-hop LoRa range, in km, used only to decide
 * whether two candidate anchor repeaters could plausibly both be within
 * radio range of the same unlocated node (anchors farther apart than 2x this
 * are mutually inconsistent and dropped).
 *
 * meshcore-open derives this live from the connected device's radio
 * parameters (frequency/bandwidth/SF/TX power) via a free-space link-budget
 * formula. This layer must also work while browsing history with no radio
 * connected (a normal mode for this app), and `guessedLocations.ts` is kept
 * a pure, dependency-free module, so a live radio read is deliberately not
 * used here. 15 km is a commonly reported practical single-hop range for
 * MeshCore-class LoRa nodes with ordinary antennas in mixed rural/suburban
 * terrain -- well short of exceptional line-of-sight results, well above
 * dense-urban NLOS -- and is used as a fixed, documented estimate instead.
 */
export const ESTIMATED_LORA_RANGE_KM = 15;

/** Hop widths (bytes) trusted as guessed-location anchors. A 1-byte hop hash
 *  matches too many nodes to be a reliable anchor (see plan 28 item 1.12);
 *  only 2- and 3-byte hops are used. */
const USABLE_HOP_HEX_LENGTHS = new Set([4, 6]); // 2 bytes = 4 hex chars, 3 bytes = 6

const SINGLE_ANCHOR_OFFSET_M = 330;
const FEW_ANCHOR_OFFSET_M = 120; // 2 anchors
const MANY_ANCHOR_OFFSET_M = 80; // 3+ anchors
const METRES_PER_DEGREE = 111_320;

export interface GuessAnchor {
  public_key: string;
  lat: number;
  lon: number;
}

export interface GuessedLocation {
  public_key: string;
  lat: number;
  lon: number;
  anchors: GuessAnchor[];
  /** true when 2+ mutually-consistent anchors agreed (meshcore-open's rule for a thicker, role-coloured border). */
  highConfidence: boolean;
}

/** Index located repeaters by their public-key hex prefix (2- and 3-byte
 *  widths only). On a prefix collision (rare at this width) the first
 *  repeater encountered wins, matching meshcore-open's own `.first`. */
export function buildRepeaterAnchorIndex(contacts: Contact[]): Map<string, GuessAnchor> {
  const index = new Map<string, GuessAnchor>();
  for (const c of contacts) {
    if (c.type !== CONTACT_TYPE_REPEATER) continue;
    const loc = getEffectiveLocation(c);
    if (!loc) continue;
    const pk = c.public_key.toLowerCase();
    for (const hexLen of USABLE_HOP_HEX_LENGTHS) {
      if (pk.length < hexLen) continue;
      const prefix = pk.slice(0, hexLen);
      if (!index.has(prefix)) {
        index.set(prefix, { public_key: c.public_key, lat: loc.lat, lon: loc.lon });
      }
    }
  }
  return index;
}

/** Anchor repeaters for one contact's known advert paths: the hop nearest
 *  the origin (`next_hop`) from each path, resolved against `index` and
 *  restricted to 2-/3-byte hops. Deduplicated by repeater pubkey. */
export function anchorsForPaths(
  paths: ContactAdvertPathSummary['paths'],
  index: Map<string, GuessAnchor>
): GuessAnchor[] {
  const byKey = new Map<string, GuessAnchor>();
  for (const path of paths) {
    const hop = path.next_hop;
    if (!hop || !USABLE_HOP_HEX_LENGTHS.has(hop.length)) continue;
    const anchor = index.get(hop.toLowerCase());
    if (anchor && !byKey.has(anchor.public_key)) byKey.set(anchor.public_key, anchor);
  }
  return [...byKey.values()];
}

/** Drop anchors with no other anchor within `2 * maxRangeKm`: a node cannot
 *  be simultaneously in radio range of two points farther apart than that,
 *  so an isolated outlier is not trustworthy. No-op for 0 or 1 anchors. */
export function filterConsistentAnchors(
  anchors: GuessAnchor[],
  maxRangeKm: number = ESTIMATED_LORA_RANGE_KM
): GuessAnchor[] {
  if (anchors.length <= 1) return anchors;
  const maxDistKm = maxRangeKm * 2;
  return anchors.filter((a) =>
    anchors.some(
      (b) => b !== a && (calculateDistance(a.lat, a.lon, b.lat, b.lon) ?? Infinity) <= maxDistKm
    )
  );
}

/**
 * Weighted centre of several anchors, biased toward the earlier ones in
 * `anchors` (index 0 carries weight 1, index 1 weight 0.5, index 2 weight
 * 0.25, ...). `anchorsForPaths` yields anchors in the order paths were
 * returned, which the backend orders most-recently/most-heard first, so the
 * bias favours the freshest anchor.
 *
 * meshcore-open computes the same decaying weights but then divides the
 * weighted sum by the anchor COUNT rather than by the SUM OF WEIGHTS ACTUALLY
 * APPLIED. Those only match when every weight is 1: with decaying weights
 * the applied total is always less than the count (e.g. two anchors sum to
 * 1.5, not 2), so their average is silently pulled toward (0, 0) as more
 * anchors are combined. This divides by the true weight sum instead, which
 * is the correct weighted average.
 */
export function weightedCentre(anchors: GuessAnchor[]): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  let totalWeight = 0;
  let weight = 1;
  for (const a of anchors) {
    lat += a.lat * weight;
    lon += a.lon * weight;
    totalWeight += weight;
    weight /= 2;
  }
  return { lat: lat / totalWeight, lon: lon / totalWeight };
}

/** FNV-1a-style 32-bit hash of a hex-encoded public key, masked to 31 bits.
 *  Mirrors meshcore-open's `_guessSeed` in spirit (same construction: FNV
 *  offset basis/prime, XOR-then-multiply per byte) to give each node a
 *  stable pseudo-random angle; exact bit values differ (this uses a real
 *  32-bit wraparound multiply via `Math.imul`, whereas Dart's `int` does
 *  not overflow at 32 bits), which does not matter since only this app's
 *  own determinism is required. */
export function guessSeed(publicKeyHex: string): number {
  let seed = 0x811c9dc5;
  for (let i = 0; i + 1 < publicKeyHex.length; i += 2) {
    const byte = parseInt(publicKeyHex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) continue;
    seed ^= byte;
    seed = Math.imul(seed, 0x01000193) & 0x7fffffff;
  }
  return seed >>> 0;
}

/** Offset `anchor` by `radiusMeters` at an angle seeded from `publicKeyHex`,
 *  so the same node always renders at the same guessed point. */
export function offsetGuessedPosition(
  anchor: { lat: number; lon: number },
  publicKeyHex: string,
  radiusMeters: number
): { lat: number; lon: number } {
  const seed = guessSeed(publicKeyHex);
  const angle = ((seed & 0xffff) / 0x10000) * 2 * Math.PI;
  const latOffsetDeg = (radiusMeters / METRES_PER_DEGREE) * Math.cos(angle);
  const lonScale = Math.max(Math.abs(Math.cos((anchor.lat * Math.PI) / 180)), 0.2);
  const lonOffsetDeg = (radiusMeters / (METRES_PER_DEGREE * lonScale)) * Math.sin(angle);
  return { lat: anchor.lat + latOffsetDeg, lon: anchor.lon + lonOffsetDeg };
}

/**
 * Compute guessed positions for every contact that has no known location,
 * was heard within the last 24h, and has at least one advert path whose
 * origin-side hop resolves to a located repeater.
 */
export function computeGuessedLocations(
  contacts: Contact[],
  pathSummaries: ContactAdvertPathSummary[],
  nowSec: number,
  maxRangeKm: number = ESTIMATED_LORA_RANGE_KM
): GuessedLocation[] {
  const anchorIndex = buildRepeaterAnchorIndex(contacts);
  if (anchorIndex.size === 0) return [];

  const contactsByKey = new Map(contacts.map((c) => [c.public_key.toLowerCase(), c]));
  const result: GuessedLocation[] = [];

  for (const summary of pathSummaries) {
    const contact = contactsByKey.get(summary.public_key.toLowerCase());
    if (!contact) continue;
    if (hasEffectiveLocation(contact)) continue;
    if (contact.last_seen == null || nowSec - contact.last_seen > GUESSED_LOCATION_STALE_SECONDS) {
      continue;
    }

    const candidates = anchorsForPaths(summary.paths, anchorIndex);
    const anchors = filterConsistentAnchors(candidates, maxRangeKm);
    if (anchors.length === 0) continue;

    const base = anchors.length === 1 ? anchors[0] : weightedCentre(anchors);
    const radius =
      anchors.length === 1
        ? SINGLE_ANCHOR_OFFSET_M
        : anchors.length === 2
          ? FEW_ANCHOR_OFFSET_M
          : MANY_ANCHOR_OFFSET_M;
    const position = offsetGuessedPosition(base, contact.public_key, radius);
    if (!isFinitePosition(position)) continue;

    result.push({
      public_key: contact.public_key,
      lat: position.lat,
      lon: position.lon,
      anchors,
      highConfidence: anchors.length >= 2,
    });
  }

  return result;
}

function isFinitePosition(p: { lat: number; lon: number }): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lon >= -180 &&
    p.lon <= 180
  );
}
