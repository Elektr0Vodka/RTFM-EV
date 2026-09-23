import { getEffectiveLocation, isValidLocation } from './pathUtils';

/** The subset of Contact fields a GPX waypoint needs. */
export interface GpxExportContact {
  public_key: string;
  name: string | null;
  type: number;
  lat: number | null;
  lon: number | null;
  manual_lat?: number | null;
  manual_lon?: number | null;
}

export interface GpxExportOptions {
  /** Translated label for a contact type (role), e.g. "Repeater". */
  typeLabel: (type: number) => string;
  /** Translated note appended to a waypoint placed by its manual-location
   *  override rather than its advertised position, e.g. "manual location". */
  manualLocationLabel: string;
  /** Lowercase public_key -> meshcore:// link. Built from a stored raw advert
   *  (never a per-node radio command); a key with no entry gets no link. */
  links?: Map<string, string> | Record<string, string>;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function linkFor(
  publicKey: string,
  links: Map<string, string> | Record<string, string> | undefined
): string | undefined {
  if (!links) return undefined;
  const key = publicKey.toLowerCase();
  return links instanceof Map ? links.get(key) : links[key];
}

/**
 * Build a GPX 1.1 document with one waypoint per contact that has a usable
 * location: its advertised position, or its manual (fallback) override when
 * the advertised one is missing or invalid. Contacts with neither are
 * skipped. Waypoints only, no tracks, following meshcore-open's
 * `utils/gpx_export.dart`: name, lat/lon, a desc with the node type and
 * public key, and a `meshcore://` link when one is supplied for that node. A
 * waypoint placed by its manual override is noted in the desc.
 */
export function buildNodesGpx(contacts: GpxExportContact[], options: GpxExportOptions): string {
  const waypoints: string[] = [];

  for (const contact of contacts) {
    const loc = getEffectiveLocation(contact);
    if (!loc) continue;

    const isManual = !isValidLocation(contact.lat, contact.lon);
    const name = contact.name?.trim() || contact.public_key.slice(0, 12);
    let desc = `${options.typeLabel(contact.type)} - ${contact.public_key}`;
    if (isManual) desc += ` (${options.manualLocationLabel})`;

    const link = linkFor(contact.public_key, options.links);

    const lines = [
      `  <wpt lat="${loc.lat}" lon="${loc.lon}">`,
      `    <name>${xmlEscape(name)}</name>`,
      `    <desc>${xmlEscape(desc)}</desc>`,
    ];
    if (link) {
      lines.push(`    <link href="${xmlEscape(link)}"><text>${xmlEscape(link)}</text></link>`);
    }
    lines.push('  </wpt>');
    waypoints.push(lines.join('\n'));
  }

  const body = waypoints.length > 0 ? waypoints.join('\n') + '\n' : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="RTFM-EV" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    body +
    '</gpx>\n'
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `rtfm-ev-nodes-YYYY-MM-DD.gpx`. */
export function gpxExportFilename(at: Date): string {
  return `rtfm-ev-nodes-${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}.gpx`;
}
