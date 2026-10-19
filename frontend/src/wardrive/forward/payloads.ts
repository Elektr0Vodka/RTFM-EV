// Topics and the on8ar `packets` payload. Wardrive topics carry the
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

/** on8ar's ACL binds the topic to the client id, both the key in lower case
 * as core-hunter sends them. */
export function packetsTopic(radioKey: string): string {
  return `meshcore/hunter/${radioKey.toLowerCase()}/packets`;
}

const PAYLOAD_TYPE_TRACE = 9;

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

/** core-hunter's Publisher.buildPayload, from a stored obs. NOT VERIFIED
 * against on8ar's ingest. core-hunter fills the sender fields by decoding the
 * packet; the page does not, so they are null. `is_direct` follows the
 * structure core-hunter's classifyReception uses ("heard the transmitter
 * itself"): never for a TRACE, yes at 0 hops or from a flood's last relay, no
 * for a relayed direct route. `packet_type` is the payload type name, as the
 * decoder core-hunter uses names it. */
export function packetsPayload(obs: ObsMessage, radioName?: string): Record<string, unknown> {
  const hops = obs.path.length;
  const isDirect = obs.packet_type !== PAYLOAD_TYPE_TRACE && (hops === 0 || obs.route === 'F');
  return {
    origin_id: obs.origin_id.toLowerCase(),
    ...(radioName ? { origin: radioName } : {}),
    timestamp: obs.rx_at,
    type: 'PACKET',
    direction: 'rx',
    raw: obs.raw,
    SNR: obs.SNR,
    RSSI: obs.RSSI,
    is_direct: isDirect,
    hops,
    sender_kind: null,
    sender_id: null,
    sender_label: null,
    sender_role: null,
    channel_name: null,
    packet_type: payloadTypeName(obs.packet_type),
    gps: { lat: obs.pos.lat, lon: obs.pos.lon, acc_m: obs.pos.accuracy },
  };
}
