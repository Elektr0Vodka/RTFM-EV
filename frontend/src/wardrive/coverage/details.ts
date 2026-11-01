// The reception card's rows: every field RTFM-EV stored for a reception, in
// the coordinate format the viewer picked. Fields not stored are left out.
import type { TFn } from '../../i18n';
import { formatCoordinates, type CoordinateFormat } from '../../utils/coordinateFormat';
import { packetTypeLabel } from '../filters';
import type { MapPoint } from './types';

export interface DetailRow {
  label: string;
  value: string;
}

const when = (value: string | number) =>
  new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString();

export function pointDetails(p: MapPoint, t: TFn, coords: CoordinateFormat): DetailRow[] {
  const rows: DetailRow[] = [];
  const add = (key: string, value: string | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') rows.push({ label: t(key), value });
  };
  const key8 = p.radio_key.slice(0, 8);
  add('wardrive_popup_heard', when(p.rx_ts));
  add('wardrive_popup_driver', p.driver);
  add('wardrive_popup_radio', p.radio_name ? `${p.radio_name} (${key8})` : key8);
  if (p.drive_id != null) add('wardrive_popup_drive', p.drive_name || `#${p.drive_id}`);
  const signal = [
    p.rssi != null ? `${p.rssi} dBm` : null,
    p.snr != null ? `SNR ${p.snr} dB` : null,
  ].filter(Boolean);
  add('wardrive_popup_signal', signal.length ? signal.join(', ') : t('wardrive_map_unknown'));
  add('wardrive_cov_popup_channel', p.channel);
  const packet = [
    packetTypeLabel(p.packet_type_name, t),
    p.route === 'F'
      ? t('wardrive_popup_route_flood')
      : p.route === 'D'
        ? t('wardrive_popup_route_direct')
        : null,
    p.len != null ? t('wardrive_popup_bytes', { count: p.len }) : null,
  ].filter(Boolean);
  add('wardrive_popup_packet', packet.join(', '));
  const path = p.path ?? [];
  add('wardrive_popup_hops', path.length ? `${p.hops} (${path.join(' > ')})` : String(p.hops));
  const where = formatCoordinates(p.lat, p.lon, coords);
  const extra = [
    p.accuracy != null ? `± ${Math.round(p.accuracy)} m` : null,
    p.src ? `(${p.src})` : null,
  ].filter(Boolean);
  add('wardrive_popup_position', extra.length ? `${where} ${extra.join(' ')}` : where);
  add('wardrive_popup_hash', p.hash);
  if (p.pub_at) add('wardrive_popup_published', when(p.pub_at));
  if (p.uploaded_at != null) add('wardrive_popup_uploaded', when(p.uploaded_at));
  return rows;
}
