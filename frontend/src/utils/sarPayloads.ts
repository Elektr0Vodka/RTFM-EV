// --- MeshCore SAR marker (S:<emoji>:<colour>:<lat>,<lon>[:<notes>]) ---
//
// MeshCore SAR (dz0ny/meshcore-sar, lib/utils/sar_message_parser.dart) shares a
// search-and-rescue marker as plain channel text. Only the first line counts;
// the colour index (0-7) is missing in the old form. `S2:` markers use
// custom-map coordinates, not geographic ones, and are ignored. Mirrors
// `_parse_sar` in app/location_payloads.py so chat and map agree.

import type { ParsedMarker } from './meshcoreOpenPayloads';
import { isValidLocation } from './pathUtils';

const SAR_PATTERN = /^S:([^:]+):(\d):(-?\d+\.?\d*),(-?\d+\.?\d*):?(.*)$/;
const SAR_OLD_PATTERN = /^S:([^:]+):(-?\d+\.?\d*),(-?\d+\.?\d*):?(.*)$/;

/** Parse a MeshCore SAR marker into the shared marker shape, or null. */
export function parseSarMarker(text: string): ParsedMarker | null {
  const first = text.trim().split('\n', 1)[0];
  let emoji: string;
  let latText: string;
  let lonText: string;
  let notes: string;
  let flags = '';
  const match = SAR_PATTERN.exec(first);
  if (match) {
    [, emoji, , latText, lonText, notes] = match;
    flags = `color=${match[2]}`;
  } else {
    const old = SAR_OLD_PATTERN.exec(first);
    if (!old) return null;
    [, emoji, latText, lonText, notes] = old;
  }
  const lat = Number.parseFloat(latText);
  const lon = Number.parseFloat(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isValidLocation(lat, lon)) {
    return null;
  }
  return { lat, lon, label: `${emoji} ${notes.trim()}`.trim(), flags };
}
