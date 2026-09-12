import type { Contact } from '../types';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM, CONTACT_TYPE_SENSOR } from '../types';

// The type filter selection for the merged Contacts sidebar section.
export type ContactPill = 'all' | 'companions' | 'sensors' | 'repeaters' | 'rooms';
export type ContactTypePill = Exclude<ContactPill, 'all'>;

export const CONTACT_PILL_KEYS: ContactPill[] = [
  'all',
  'companions',
  'sensors',
  'repeaters',
  'rooms',
];

const CONTACT_PILL_STORAGE_KEY = 'remoteterm-sidebar-contacts-pill';

// Which type bucket a contact belongs to. Companions is the catch-all: clients
// plus any unknown/other type not explicitly a repeater, room, or sensor.
export function contactPillFor(contact: Contact): ContactTypePill {
  switch (contact.type) {
    case CONTACT_TYPE_REPEATER:
      return 'repeaters';
    case CONTACT_TYPE_ROOM:
      return 'rooms';
    case CONTACT_TYPE_SENSOR:
      return 'sensors';
    default:
      return 'companions';
  }
}

export function loadContactPill(): ContactPill {
  try {
    const raw = localStorage.getItem(CONTACT_PILL_STORAGE_KEY);
    if (raw && (CONTACT_PILL_KEYS as string[]).includes(raw)) {
      return raw as ContactPill;
    }
  } catch {
    // Ignore storage read failures (private mode, disabled storage).
  }
  return 'all';
}

export function saveContactPill(pill: ContactPill): void {
  try {
    localStorage.setItem(CONTACT_PILL_STORAGE_KEY, pill);
  } catch {
    // Ignore storage write failures.
  }
}
