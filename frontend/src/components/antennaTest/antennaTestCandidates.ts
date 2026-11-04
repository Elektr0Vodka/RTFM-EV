/**
 * Which nodes the antenna test can trace. In MeshCore firmware a node answers a
 * trace only when its allowPacketForward() passes: repeaters and room servers
 * (unless forwarding is off), companions only with repeat mode on. So only
 * repeaters and room servers are offered. Nodes whose latest
 * heard advert came in direct (0 hops) are pre-selected: they are the ones the
 * radio can reach without help, which is what an antenna test measures.
 */

import type { Contact, RadioConfig } from '../../types';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM } from '../../types';
import { calculateDistance, isValidLocation } from '../../utils/pathUtils';
import { getContactDisplayName } from '../../utils/pubkey';

export interface AntennaTestCandidate {
  publicKey: string;
  name: string;
  type: number;
  /** Hop count of the latest heard advert; undefined = no advert path stored. */
  hops: number | undefined;
  distanceKm: number | null;
}

function distanceKm(contact: Contact, config: RadioConfig | null): number | null {
  if (
    !config ||
    !isValidLocation(config.lat, config.lon) ||
    !isValidLocation(contact.lat, contact.lon)
  ) {
    return null;
  }
  return calculateDistance(config.lat, config.lon, contact.lat, contact.lon);
}

/** Direct-heard first (nearest first), then by hop count, then by name. */
export function antennaTestCandidates(
  contacts: Contact[],
  config: RadioConfig | null,
  latestHops: Map<string, number>
): AntennaTestCandidate[] {
  const candidates = contacts
    .filter(
      (contact) =>
        (contact.type === CONTACT_TYPE_REPEATER || contact.type === CONTACT_TYPE_ROOM) &&
        /^[0-9a-f]{64}$/i.test(contact.public_key)
    )
    .map((contact) => ({
      publicKey: contact.public_key.toLowerCase(),
      name: getContactDisplayName(contact.name, contact.public_key, contact.last_advert),
      type: contact.type,
      hops: latestHops.get(contact.public_key.toLowerCase()),
      distanceKm: distanceKm(contact, config),
    }));

  const hopRank = (hops: number | undefined) =>
    hops === undefined ? Number.MAX_SAFE_INTEGER : hops;
  return candidates.sort((a, b) => {
    const byHops = hopRank(a.hops) - hopRank(b.hops);
    if (byHops !== 0) return byHops;
    if (a.hops === 0 && a.distanceKm !== null && b.distanceKm !== null) {
      const byDistance = a.distanceKm - b.distanceKm;
      if (byDistance !== 0) return byDistance;
    }
    return a.name.localeCompare(b.name);
  });
}

/** The keys pre-selected for a new run: every direct-heard candidate. */
export function defaultSelection(candidates: AntennaTestCandidate[], limit: number): string[] {
  return candidates
    .filter((candidate) => candidate.hops === 0)
    .slice(0, limit)
    .map((candidate) => candidate.publicKey);
}
