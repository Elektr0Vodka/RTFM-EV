// Topics and the observer `packets` payload. Wardrive topics carry the
// stream label where an observer's IATA code would be: a moving receiver is
// not a fixed observer (core-hunter wardrive.js).
import type { ObsMessage } from '../messages';

export function obsTopic(label: string, radioKey: string): string {
  return `meshcore/${label}/${radioKey.toUpperCase()}/wardriver/obs`;
}

export function trackTopic(label: string, radioKey: string): string {
  return `meshcore/${label}/${radioKey.toUpperCase()}/wardriver/track`;
}

/** The obs as published: core-hunter stamps pub_at when it publishes, right
 * after rx_at, so a consumer can tell a live obs from a backlog one. */
export function withPubAt(obs: ObsMessage, pubAt: string): ObsMessage {
  const { v, origin_id, rx_at, pub_at: _old, ...rest } = obs;
  void _old;
  return { v, origin_id, rx_at, pub_at: pubAt, ...rest };
}

// The payload type names of @michaelhart/meshcore-decoder (core-hunter's
// decode.js re-exports its getPayloadTypeName), kept here so the page does not
// bundle the whole decoder for one table. A test checks them against it.
const PAYLOAD_TYPE_NAMES = [
  'Request',
  'Response',
  'TextMessage',
  'Ack',
  'Advert',
  'GroupText',
  'GroupData',
  'AnonRequest',
  'Path',
  'Trace',
  'Multipart',
  'Control',
];
const RAW_CUSTOM = 15;

export function payloadTypeName(type: number): string {
  if (type === RAW_CUSTOM) return 'RawCustom';
  return PAYLOAD_TYPE_NAMES[type] ?? `Unknown (0x${type.toString(16)})`;
}

/** The observer topic RTFM-EV's community MQTT publisher uses
 * (app/fanout/community_mqtt.py): region upper case, key upper case. */
export function observerTopic(region: string, radioKey: string): string {
  return `meshcore/${region.toUpperCase()}/${radioKey.toUpperCase()}/packets`;
}

// Header route type to the letter the community publisher sends.
const ROUTE_LETTERS = ['F', 'F', 'D', 'T'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** A stored obs as the observer packet RTFM-EV's community MQTT publisher
 * sends (_format_raw_packet), key for key and in its order. Differences:
 * `timestamp`, `time` and `date` are the reception time (the publisher has
 * only the publish time, which for a live packet is the same second), and a
 * stored obs is never one the publisher would skip. */
export function observerPacket(obs: ObsMessage, radioName?: string): Record<string, unknown> {
  const at = new Date(obs.rx_at);
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  const header = parseInt(obs.raw.slice(0, 2), 16);
  const route = Number.isNaN(header) ? (obs.route ?? 'F') : ROUTE_LETTERS[header & 0x03];
  const packet: Record<string, unknown> = {
    origin: radioName || 'MeshCore Device',
    origin_id: obs.origin_id.toUpperCase(),
    timestamp: obs.rx_at,
    type: 'PACKET',
    direction: 'rx',
    time: `${pad2(when.getUTCHours())}:${pad2(when.getUTCMinutes())}:${pad2(when.getUTCSeconds())}`,
    date: `${pad2(when.getUTCDate())}/${pad2(when.getUTCMonth() + 1)}/${when.getUTCFullYear()}`,
    len: String(obs.len),
    packet_type: String(obs.packet_type),
    route,
    payload_len: String(obs.payload_len),
    raw: obs.raw.toUpperCase(),
    SNR: obs.SNR ?? 'Unknown',
    RSSI: obs.RSSI ?? 'Unknown',
    hash: obs.hash.toUpperCase(),
  };
  if (route === 'D') packet.path = obs.path.join(',');
  return packet;
}
