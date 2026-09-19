import type { Contact } from '../types';
import { getContactDisplayName } from './pubkey';

export interface ResolvedHop {
  /** The original hop hex prefix, casing preserved. */
  hex: string;
  /** Contact display name when the prefix uniquely matches one contact, else null. */
  name: string | null;
  /** True when a unique contact match resolved the prefix to a name. */
  resolved: boolean;
}

/**
 * Resolve each hop hex prefix to a contact display name ONLY when the prefix
 * uniquely matches exactly one contact's public key. Ambiguous (2+ matches) or
 * unknown (0 matches) prefixes keep their raw hex. Matching is case-insensitive;
 * the original hex casing is preserved on the returned hop. Shared by the live
 * packet feed, the history browser, and the packet detail dialog.
 */
export function resolvePathHopNames(hops: string[], contacts: Contact[]): ResolvedHop[] {
  return hops.map((hex) => {
    const needle = hex.toLowerCase();
    const matches = contacts.filter((ct) => (ct.public_key ?? '').toLowerCase().startsWith(needle));
    if (matches.length === 1) {
      const c = matches[0];
      return { hex, name: getContactDisplayName(c.name, c.public_key), resolved: true };
    }
    return { hex, name: null, resolved: false };
  });
}
