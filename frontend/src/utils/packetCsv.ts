import type { Channel, Contact, RawPacket } from '../types';
import { createDecoderOptions, decodePacketSummary } from './rawPacketInspector';
import { resolvePathHopNames } from './pathHopNames';

/** CSV column keys, in output order. Headers are supplied (translated) by the caller. */
export const PACKET_CSV_COLUMN_KEYS = [
  'timestamp_iso',
  'timestamp_unix',
  'payload_type',
  'route_type',
  'snr',
  'rssi',
  'decrypted',
  'summary',
  'path',
  'data_hex',
] as const;

export type PacketCsvColumnKey = (typeof PACKET_CSV_COLUMN_KEYS)[number];

const pad2 = (n: number) => String(n).padStart(2, '0');

function csvNumber(value: number): string {
  if (Number.isInteger(value)) return `${value}`;
  return `${Number(value.toPrecision(12))}`;
}

function escapeCsvValue(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Local-time ISO 8601 with offset, so a packet's wall-clock time survives the
 *  trip into a spreadsheet without the reader having to know our timezone. */
export function toLocalIsoString(date: Date): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
    `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`
  );
}

/** `packet-history_YYYYMMDD_HHMMSS.csv`. */
export function packetCsvFilename(at: Date): string {
  const stamp =
    `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}` +
    `_${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`;
  return `packet-history_${stamp}.csv`;
}

/**
 * Build CSV text for the given packets. Each packet is decoded (summary, route
 * type, path) the same way the list renders it; path hops resolve to contact
 * names when a unique prefix matches, else raw hex. `headers` supplies the
 * translated column headers so this stays pure and testable.
 */
export function buildPacketCsv(
  packets: RawPacket[],
  headers: Record<PacketCsvColumnKey, string>,
  options?: { channels?: Channel[]; contacts?: Contact[] }
): string {
  const decoderOptions = createDecoderOptions(options?.channels);
  const contacts = options?.contacts ?? [];

  const rows: string[] = [PACKET_CSV_COLUMN_KEYS.map((k) => escapeCsvValue(headers[k])).join(',')];

  for (const packet of packets) {
    const decoded = decodePacketSummary(packet, decoderOptions);
    const path =
      decoded.pathTokens && decoded.pathTokens.length > 0
        ? resolvePathHopNames(decoded.pathTokens, contacts)
            .map((hop) => (hop.resolved && hop.name ? hop.name : hop.hex.toUpperCase()))
            .join(' > ')
        : '';

    const record: Record<PacketCsvColumnKey, string> = {
      timestamp_iso: toLocalIsoString(new Date(packet.timestamp * 1000)),
      timestamp_unix: `${packet.timestamp}`,
      payload_type: packet.payload_type ?? '',
      route_type: decoded.routeType ?? '',
      snr: packet.snr == null ? '' : csvNumber(packet.snr),
      rssi: packet.rssi == null ? '' : csvNumber(packet.rssi),
      decrypted: packet.decrypted ? 'yes' : 'no',
      summary: decoded.summary ?? '',
      path,
      data_hex: packet.data.toUpperCase(),
    };
    rows.push(PACKET_CSV_COLUMN_KEYS.map((k) => escapeCsvValue(record[k])).join(','));
  }

  return rows.join('\r\n');
}
