// What the radio heard, read for the driver: the packet type, hop count, who
// sent it as far as the frame tells, the channel and the channel text. The
// rules follow rx.mesh-hunter.eu's reading of a reception (who was heard
// directly), designed for this page.
import {
  ChannelCrypto,
  MeshCoreDecoder,
  PayloadType,
  RouteType,
  getDeviceRoleName,
  getPayloadTypeName,
  type DecodedPacket,
} from '@michaelhart/meshcore-decoder';

import { bytesToHex } from '../packet';
import type { ChannelKeys } from './channels';

export type SenderKind =
  'advert_pubkey' | 'discover_pubkey' | 'relay' | 'path_hash' | 'direct_hash' | 'channel_name';

export interface Sender {
  kind: SenderKind | null;
  id: string | null;
  label: string | null;
  role: string | null;
}

export interface Decoded {
  packetType: string;
  hops: number;
  /** True when the sender (or the relay that passed it to us) was heard directly. */
  heardDirect: boolean;
  sender: Sender;
  channel: string | null;
  text: string | null;
}

export const UNKNOWN_TYPE = 'Unknown';

export const NO_SENDER: Sender = { kind: null, id: null, label: null, role: null };

const noSender = (): Sender => ({ ...NO_SENDER });

function unknown(): Decoded {
  return {
    packetType: UNKNOWN_TYPE,
    hops: 0,
    heardDirect: false,
    sender: noSender(),
    channel: null,
    text: null,
  };
}

function typeName(payloadType: number): string {
  const name = getPayloadTypeName(payloadType);
  return name.startsWith('Unknown') ? UNKNOWN_TYPE : name;
}

const isFlood = (route: RouteType) =>
  route === RouteType.Flood || route === RouteType.TransportFlood;

type Fields = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function senderOf(pkt: DecodedPacket, hops: number): Sender {
  const d = (pkt.payload.decoded ?? {}) as Fields;
  // A trace's path bytes are SNR readings, not hops.
  if (pkt.payloadType === PayloadType.Trace) return noSender();
  if (hops > 0) {
    // Relayed: only on a flood route is the last path entry the node we heard.
    const last = isFlood(pkt.routeType) ? str(pkt.path?.[pkt.path.length - 1]) : null;
    if (!last) return noSender();
    const id = last.toLowerCase();
    if (id.length >= 4) return { kind: 'relay', id, label: null, role: null };
    if (id.length === 2) return { kind: 'path_hash', id, label: id, role: null };
    return noSender();
  }
  if (pkt.payloadType === PayloadType.Advert) {
    const key = str(d.publicKey);
    // A forged or unchecked signature keeps the measurement, not the identity.
    if (!key || d.signatureValid !== true) return noSender();
    const app = (d.appData ?? {}) as Fields;
    const role = typeof app.deviceRole === 'number' ? getDeviceRoleName(app.deviceRole) : null;
    return { kind: 'advert_pubkey', id: key.toLowerCase(), label: str(app.name), role };
  }
  if (pkt.payloadType === PayloadType.GroupText) {
    const name = str((d.decrypted as Fields | undefined)?.sender);
    return name ? { kind: 'channel_name', id: name, label: name, role: null } : noSender();
  }
  // A discover reply (or another payload) that carries the node's own key.
  const key = str(d.publicKey);
  if (key) {
    return {
      kind: 'discover_pubkey',
      id: key.toLowerCase(),
      label: null,
      role: str(d.nodeTypeName),
    };
  }
  const source = str(d.sourceHash);
  if (source) {
    const id = source.toLowerCase();
    return { kind: 'direct_hash', id, label: id, role: null };
  }
  return noSender();
}

/** The channel a decrypted channel message came on. Its 1-byte hash alone can
 * belong to several channels (and to channels the page has no key for), so
 * with more than one known candidate the one whose key decrypts it wins. */
function channelOf(d: Fields, keys: ChannelKeys): string | null {
  const hash = str(d.channelHash)?.toLowerCase();
  const candidates = hash ? (keys.byHash.get(hash) ?? []) : [];
  if (candidates.length <= 1) return candidates[0]?.name ?? null;
  const ciphertext = str(d.ciphertext);
  const mac = str(d.cipherMac);
  if (!ciphertext || !mac) return null;
  const hit = candidates.find(
    (c) => ChannelCrypto.decryptGroupTextMessage(ciphertext, mac, c.secret).success
  );
  return hit?.name ?? null;
}

/** Decode one reception. Never throws: a frame the decoder cannot read is
 * an `Unknown` reception without a sender. */
export async function decodeReception(raw: Uint8Array, keys: ChannelKeys): Promise<Decoded> {
  let pkt: DecodedPacket;
  try {
    const hex = bytesToHex(raw);
    if (!hex) return unknown();
    pkt = MeshCoreDecoder.decode(hex, keys.options);
    if (!pkt.isValid || (pkt.payload.decoded as Fields | null)?.isValid === false) return unknown();
    // Signatures are checked for adverts only: they carry the name and
    // position a forger would want the page to believe. The decoder marks a
    // forged advert invalid as a whole; the reception itself still counts.
    if (pkt.payloadType === PayloadType.Advert && pkt.payload.decoded) {
      const verified = await MeshCoreDecoder.decodeWithVerification(hex, keys.options);
      const signed = (verified.payload.decoded as Fields | null)?.signatureValid === true;
      (pkt.payload.decoded as unknown as Fields).signatureValid = signed;
    }
  } catch {
    return unknown();
  }
  const hops = pkt.pathLength || 0;
  const sender = senderOf(pkt, hops);
  let channel: string | null = null;
  let text: string | null = null;
  if (pkt.payloadType === PayloadType.GroupText) {
    const d = (pkt.payload.decoded ?? {}) as Fields;
    const decrypted = d.decrypted as Fields | undefined;
    if (decrypted) {
      channel = channelOf(d, keys);
      text = str(decrypted.message);
    }
  }
  return {
    packetType: typeName(pkt.payloadType),
    hops,
    heardDirect: sender.kind !== null,
    sender,
    channel,
    text,
  };
}
