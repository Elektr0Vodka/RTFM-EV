import { calculateDistance } from '../utils/pathUtils';
import type { Contact } from '../types';

/**
 * User cap on map link length, in kilometres. Usually the realistic RF range of
 * the radio's frequency and preset. 0 means no limit.
 */
export const LINK_MAX_KM_STORAGE_KEY = 'remoteterm-map-link-max-km';
export const LINK_MAX_KM_UPPER = 20000;

type Coord = { lat: number; lon: number };

/** True when the segment a-b fits within `maxKm` (always true when maxKm <= 0). */
export function isWithinLinkRange(a: Coord, b: Coord, maxKm: number): boolean {
  if (!(maxKm > 0)) return true;
  const km = calculateDistance(a.lat, a.lon, b.lat, b.lon);
  return km === null || km <= maxKm;
}

/**
 * Contacts usable for link generation: only those this server has heard over
 * RF (`last_seen` set). Never-heard contacts (imported from the radio's table
 * or added by hand) can sit far outside radio range, and letting a hop hash
 * resolve to them draws links that cannot exist.
 */
export function heardContactsOnly(contacts: Contact[]): Contact[] {
  return contacts.filter((c) => c.last_seen != null);
}
