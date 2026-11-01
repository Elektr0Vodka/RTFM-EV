// A raw MeshCore frame's routing preamble and the firmware packet hash, as the
// wardrive obs message carries them. Layout from the firmware (src/Packet.h,
// src/Packet.cpp), the same reading core-hunter's wardrive.js does:
//   header     route type in bits 0-1, payload type in bits 2-5
//   transport  2 x uint16, only on route types 0 and 3
//   path_len   hop count in bits 0-5, (hash size - 1) in bits 6-7
//   path       count x size bytes
//   payload    the rest

const ROUTE_TRANSPORT_FLOOD = 0;
const ROUTE_TRANSPORT_DIRECT = 3;
const PAYLOAD_TYPE_TRACE = 0x09;
const MAX_PATH_SIZE = 64;
const HASH_BYTES = 8;

export interface FrameWalk {
  routeType: number;
  payloadType: number;
  pathLen: number;
  hops: string[];
  payloadStart: number;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? '' : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The routing preamble, or null when the frame is too short, its path length
 * is not valid (Packet::isValidPathLen) or no payload is left. */
export function frameWalk(raw: Uint8Array): FrameWalk | null {
  if (!raw || raw.length < 2) return null;
  const header = raw[0];
  const routeType = header & 0x03;
  let i = 1;
  if (routeType === ROUTE_TRANSPORT_FLOOD || routeType === ROUTE_TRANSPORT_DIRECT) i += 4;
  if (i >= raw.length) return null;
  const pathLen = raw[i++];
  const count = pathLen & 63;
  const size = (pathLen >> 6) + 1;
  if (size === 4 || count * size > MAX_PATH_SIZE) return null;
  const hops: string[] = [];
  for (let k = 0; k < count; k++)
    hops.push(bytesToHex(raw.subarray(i + k * size, i + (k + 1) * size)));
  i += count * size;
  if (i >= raw.length) return null;
  return { routeType, payloadType: (header >> 2) & 0x0f, pathLen, hops, payloadStart: i };
}

/** Packet::calculatePacketHash: SHA-256 over the payload type (a TRACE adds
 * path_len as a little-endian uint16) and the payload; the route and path are
 * left out, so a packet keeps one identity however it travelled. First 8
 * bytes, lower-case hex. */
export async function hashOfWalk(raw: Uint8Array, w: FrameWalk): Promise<string> {
  const prefix =
    w.payloadType === PAYLOAD_TYPE_TRACE ? [w.payloadType, w.pathLen, 0] : [w.payloadType];
  const payload = raw.subarray(w.payloadStart);
  const buf = new Uint8Array(prefix.length + payload.length);
  buf.set(prefix, 0);
  buf.set(payload, prefix.length);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return bytesToHex(new Uint8Array(digest).subarray(0, HASH_BYTES));
}

export async function packetHash(raw: Uint8Array): Promise<string | null> {
  const w = frameWalk(raw);
  return w ? hashOfWalk(raw, w) : null;
}
