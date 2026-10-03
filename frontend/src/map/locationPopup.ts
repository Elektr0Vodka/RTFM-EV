// DOM pieces shared by the map popups of chat-derived pins: shared locations
// (useSharedLocations) and MeshCore TEAM beacons and waypoints (useTeamBeacons).

import type { SearchNavigateTarget } from '../components/SearchView';
import type { TFn } from '../i18n';
import type { Contact, MessagePath, RadioConfig } from '../types';
import type { DistanceUnit } from '../utils/distanceUnits';
import { calculateDistance, formatDistance, isValidLocation } from '../utils/pathUtils';

const MUTED_LINE = 'text-xs text-muted-foreground';
const LINK = 'text-primary underline hover:text-primary/80';

/** Fewest hops any copy of the message took; null when no path is known. */
export function hopCount(paths: MessagePath[] | null): number | null {
  const counts = (paths ?? [])
    .map((p) => (p.path_len != null ? p.path_len : Math.floor(p.path.length / 2)))
    .filter((n) => Number.isFinite(n));
  return counts.length ? Math.min(...counts) : null;
}

/** Append a text line to a popup body. */
export function appendPopupLine(el: HTMLElement, text: string, className = MUTED_LINE) {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  el.append(div);
  return div;
}

/** `key` in lower case when it belongs to a known contact, else null. */
export function knownContactKey(key: string | null | undefined, contacts: Contact[]) {
  const lower = key?.toLowerCase();
  if (!lower) return null;
  return contacts.some((c) => c.public_key.toLowerCase() === lower) ? lower : null;
}

/** Append a "node details" link to a line, opening the sender's contact info. */
export function appendContactDetailsLink(
  line: HTMLElement,
  contactKey: string,
  deps: { t: TFn; onOpenContactInfo?: (publicKey: string) => void; onAction?: () => void }
) {
  if (!deps.onOpenContactInfo) return;
  const details = document.createElement('button');
  details.type = 'button';
  details.className = `ml-1 ${LINK}`;
  details.textContent = deps.t('map_node_details');
  details.addEventListener('click', () => {
    deps.onOpenContactInfo?.(contactKey);
    deps.onAction?.();
  });
  line.append(details);
}

/** Append the distance from our own node and the hop count, when known. */
export function appendDistanceAndHops(
  el: HTMLElement,
  point: { lat: number; lon: number; paths: MessagePath[] | null },
  deps: { t: TFn; config: RadioConfig | null | undefined; distanceUnit: DistanceUnit }
) {
  const { t } = deps;
  const own = deps.config;
  if (own && isValidLocation(own.lat, own.lon)) {
    const km = calculateDistance(own.lat, own.lon, point.lat, point.lon);
    if (km != null) {
      appendPopupLine(
        el,
        t('map_shared_locations_distance', { distance: formatDistance(km, deps.distanceUnit) })
      );
    }
  }
  const hops = hopCount(point.paths);
  if (hops != null) {
    appendPopupLine(
      el,
      hops === 0
        ? t('map_shared_locations_direct')
        : t('map_shared_locations_hops', { count: hops })
    );
  }
}

/** Append the "Open in chat" and "Open in OpenStreetMap" actions. */
export function appendPopupActions(
  el: HTMLElement,
  point: { lat: number; lon: number },
  target: SearchNavigateTarget,
  deps: {
    t: TFn;
    onNavigateToMessage?: (target: SearchNavigateTarget) => void;
    onAction?: () => void;
  }
) {
  const actions = document.createElement('div');
  actions.className = 'flex flex-wrap gap-3 pt-1';
  if (deps.onNavigateToMessage) {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = `text-xs ${LINK}`;
    open.textContent = deps.t('map_shared_locations_open_in_chat');
    open.addEventListener('click', () => {
      deps.onNavigateToMessage?.(target);
      deps.onAction?.();
    });
    actions.append(open);
  }
  const external = document.createElement('a');
  external.className = `text-xs ${LINK}`;
  external.href = `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=16/${point.lat}/${point.lon}`;
  external.target = '_blank';
  external.rel = 'noopener noreferrer';
  external.textContent = deps.t('map_shared_locations_open_osm');
  actions.append(external);
  el.append(actions);
}
