// What the stored-data map shows on a tap: every field RTFM-EV stored for a
// reception (and who it came through), and the drivers on the road now.
import type { FeatureCollection, Point } from 'geojson';

import type { TFn } from '../../i18n';
import { formatCoordinates, type CoordinateFormat } from '../../utils/coordinateFormat';
import type { WardriveDataObs, WardriveLiveDriver } from '../api';
import { packetTypeLabel } from '../filters';
import { payloadTypeName } from '../forward/payloads';

export interface DetailRow {
  label: string;
  value: string;
}

const when = (value: string | number) =>
  new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString();

/** One labelled line per stored field; fields that were not stored are left out. */
export function receptionDetails(
  o: WardriveDataObs,
  t: TFn,
  coords: CoordinateFormat
): DetailRow[] {
  const rows: DetailRow[] = [];
  const add = (key: string, value: string | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') rows.push({ label: t(key), value });
  };
  const key8 = o.radio_key.slice(0, 8);
  add('wardrive_popup_heard', when(o.rx_at));
  add('wardrive_popup_driver', o.username);
  add('wardrive_popup_radio', o.radio_name ? `${o.radio_name} (${key8})` : key8);
  if (o.drive_id != null) add('wardrive_popup_drive', o.drive_name || `#${o.drive_id}`);
  const signal = [
    o.rssi != null ? `${o.rssi} dBm` : null,
    o.snr != null ? `SNR ${o.snr} dB` : null,
  ].filter(Boolean);
  add('wardrive_popup_signal', signal.length ? signal.join(', ') : t('wardrive_map_unknown'));
  const packet = [
    o.packet_type != null ? packetTypeLabel(payloadTypeName(o.packet_type), t) : null,
    o.route === 'F'
      ? t('wardrive_popup_route_flood')
      : o.route === 'D'
        ? t('wardrive_popup_route_direct')
        : null,
    o.len != null ? t('wardrive_popup_bytes', { count: o.len }) : null,
  ].filter(Boolean);
  add('wardrive_popup_packet', packet.join(', '));
  const path = o.path ?? [];
  add('wardrive_popup_hops', path.length ? `${path.length} (${path.join(' > ')})` : '0');
  if (o.heard_id) {
    add(
      'wardrive_popup_heard_via',
      o.heard_name
        ? `${o.heard_guess ? '~' : ''}${o.heard_name} (${o.heard_id.slice(0, 8)})`
        : o.heard_id.slice(0, 8)
    );
  }
  const where = formatCoordinates(o.lat, o.lon, coords);
  const extra = [
    o.accuracy != null ? `± ${Math.round(o.accuracy)} m` : null,
    o.src ? `(${o.src})` : null,
  ].filter(Boolean);
  add('wardrive_popup_position', extra.length ? `${where} ${extra.join(' ')}` : where);
  add('wardrive_popup_hash', o.hash);
  if (o.pub_at) add('wardrive_popup_published', when(o.pub_at));
  if (o.uploaded_at != null) add('wardrive_popup_uploaded', when(o.uploaded_at));
  return rows;
}

/** The drivers on the road now, each at their newest position. */
export function liveGeoJson(drivers: WardriveLiveDriver[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: drivers.map((d) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
      properties: {
        label: d.username ?? d.radio_key.slice(0, 8),
        radio: d.radio_name ?? d.radio_key.slice(0, 8),
        key: `${d.user_id}:${d.radio_key}`,
      },
    })),
  };
}
