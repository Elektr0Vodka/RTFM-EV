/**
 * meshcore_fuota firmware-update packets (https://marcelverdult.github.io/meshcore_fuota/,
 * draft 2026-10-18). Payload type 0x0E (unassigned upstream), route DIRECT, no path.
 * Byte 0 is the kind, byte 1 the sender's 1-byte key prefix, bytes 2-5 the campaign ID.
 * The draft states no byte order: multi-byte fields are read little-endian (assumed).
 * Mirrors app/fuota.py; keep the two in step.
 */
import type { PacketByteField } from './rawPacketInspector';

export type FuotaKind = 'offer' | 'request' | 'data' | 'retract';

export interface FuotaMessage {
  kind: FuotaKind;
  sender: string;
  campaign: string | null;
  manifestLen: number | null;
  patchSize: number | null;
  target: number | null;
  build: number | null;
  sourcePrefix: string | null;
  tail: string | null;
  block: number | null;
  missingMask: number | null;
  fragment: number | null;
  dataLen: number | null;
  payloadLen: number;
}

export const FUOTA_TYPE_NAME = 'FUOTA';
const FUOTA_PAYLOAD_TYPE = 0x0e;
const ROUTE_DIRECT = 0x02;
/** Header byte plus path byte in front of the payload. */
const PAYLOAD_OFFSET = 2;
const ASSUMED_LE = 'Byte order assumed little-endian (not stated in the protocol draft).';

const KIND_LABEL: Record<FuotaKind, string> = {
  offer: 'Offer',
  request: 'Request',
  data: 'Data',
  retract: 'Retract',
};

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function le(bytes: Uint8Array, start: number, size: number): number {
  let v = 0;
  for (let i = size - 1; i >= 0; i--) v = v * 256 + bytes[start + i];
  return v;
}

function hexToBytes(text: string): Uint8Array | null {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function empty(kind: FuotaKind, p: Uint8Array): FuotaMessage {
  return {
    kind,
    sender: p[1].toString(16).padStart(2, '0'),
    campaign: kind === 'retract' ? null : hex(p.slice(2, 6)),
    manifestLen: null,
    patchSize: null,
    target: null,
    build: null,
    sourcePrefix: null,
    tail: null,
    block: null,
    missingMask: null,
    fragment: null,
    dataLen: null,
    payloadLen: p.length,
  };
}

/** Decode a FUOTA payload (everything after the header and path byte). */
export function parseFuotaPayload(p: Uint8Array): FuotaMessage | null {
  const n = p.length;
  if (n < 2) return null;
  const kind = p[0];
  if (kind === 1 && n === 30) {
    return {
      ...empty('offer', p),
      manifestLen: le(p, 6, 2),
      patchSize: le(p, 8, 4),
      target: le(p, 12, 4),
      build: le(p, 16, 4),
      sourcePrefix: hex(p.slice(20, 28)),
      tail: hex(p.slice(28, 30)),
    };
  }
  if (kind === 2 && n === 12) {
    return {
      ...empty('request', p),
      block: le(p, 6, 2),
      missingMask: le(p, 8, 2),
      tail: hex(p.slice(10, 12)),
    };
  }
  if (kind === 3 && n > 8 && n <= 184) {
    return { ...empty('data', p), fragment: le(p, 6, 2), dataLen: n - 8 };
  }
  if (kind === 4 && n === 82) return empty('retract', p);
  return null;
}

/** Recognise a whole raw packet (hex) as FUOTA: version 0, type 0x0E, DIRECT, 0 hops. */
export function parseFuotaPacket(rawHex: string): FuotaMessage | null {
  const bytes = hexToBytes(rawHex);
  if (!bytes || bytes.length < PAYLOAD_OFFSET + 1) return null;
  const header = bytes[0];
  const version = header >> 6;
  const payloadType = (header >> 2) & 0x0f;
  const route = header & 0x03;
  const hops = bytes[1] & 0x3f;
  if (version !== 0 || payloadType !== FUOTA_PAYLOAD_TYPE || route !== ROUTE_DIRECT || hops !== 0) {
    return null;
  }
  return parseFuotaPayload(bytes.slice(PAYLOAD_OFFSET));
}

/** The same check on an already decoded packet (decoder library output). */
export function fuotaFromDecoded(decoded: {
  isValid: boolean;
  payloadVersion: number;
  payloadType: number;
  routeType: number;
  pathLength: number;
  payload: { raw: string };
}): FuotaMessage | null {
  if (
    !decoded.isValid ||
    decoded.payloadVersion !== 0 ||
    decoded.payloadType !== FUOTA_PAYLOAD_TYPE ||
    decoded.routeType !== ROUTE_DIRECT ||
    decoded.pathLength !== 0
  ) {
    return null;
  }
  const bytes = hexToBytes(decoded.payload.raw);
  return bytes ? parseFuotaPayload(bytes) : null;
}

export function fuotaSummary(msg: FuotaMessage): string {
  const parts = [`${FUOTA_TYPE_NAME} ${KIND_LABEL[msg.kind]}`];
  if (msg.kind === 'retract') {
    parts.push('signed retract (not verified)');
  } else {
    parts.push(`campaign ${msg.campaign}`);
    if (msg.kind === 'offer') parts.push(`build ${msg.build}`);
    if (msg.kind === 'data') parts.push(`fragment ${msg.fragment}`);
    if (msg.kind === 'request') parts.push(`block ${msg.block}`);
  }
  parts.push(`from ${msg.sender}`);
  return parts.join(' · ');
}

function field(
  id: string,
  name: string,
  description: string,
  value: string,
  startByte: number,
  endByte: number
): PacketByteField {
  return {
    id: `fuota-${id}`,
    scope: 'payload',
    name,
    description,
    value,
    startByte,
    endByte,
    absoluteStartByte: PAYLOAD_OFFSET + startByte,
    absoluteEndByte: PAYLOAD_OFFSET + endByte,
  };
}

/** Byte-by-byte payload breakdown for the packet detail view. */
export function fuotaPayloadFields(msg: FuotaMessage): PacketByteField[] {
  const fields: PacketByteField[] = [
    field('kind', 'Kind', '1 Offer, 2 Request, 3 Data, 4 Retract', KIND_LABEL[msg.kind], 0, 0),
    field(
      'sender',
      'Sender',
      "First byte of the sender's public key (unsigned). FUOTA is never forwarded, so this is a direct neighbour.",
      msg.sender,
      1,
      1
    ),
  ];
  if (msg.kind === 'retract') {
    fields.push(
      field(
        'retract',
        'Signed retract',
        'Stops a build. Signed with the release key, which is not public, so this is not verified.',
        `${msg.payloadLen - 2} bytes`,
        2,
        msg.payloadLen - 1
      )
    );
    return fields;
  }
  fields.push(
    field(
      'campaign',
      'Campaign ID',
      'First 4 bytes of SHA-256 of the signed manifest.',
      msg.campaign ?? '',
      2,
      5
    )
  );
  if (msg.kind === 'offer') {
    fields.push(
      field('manifest', 'Manifest length', ASSUMED_LE, String(msg.manifestLen), 6, 7),
      field('patch', 'Patch size', `Bytes. ${ASSUMED_LE}`, String(msg.patchSize), 8, 11),
      field(
        'target',
        'Target',
        `Board or hardware target. ${ASSUMED_LE}`,
        String(msg.target),
        12,
        15
      ),
      field(
        'build',
        'Build',
        `Build number being offered. ${ASSUMED_LE}`,
        String(msg.build),
        16,
        19
      ),
      field(
        'source',
        'Source image',
        'First 8 bytes of SHA-256 of the running image this patch applies to.',
        msg.sourcePrefix ?? '',
        20,
        27
      ),
      field('tail', 'Pages + nonce', 'Split not published; shown raw.', msg.tail ?? '', 28, 29)
    );
  } else if (msg.kind === 'request') {
    fields.push(
      field('block', 'Block', `Block of 16 fragments. ${ASSUMED_LE}`, String(msg.block), 6, 7),
      field(
        'mask',
        'Missing mask',
        `Bitmap of missing fragments. ${ASSUMED_LE}`,
        String(msg.missingMask),
        8,
        9
      ),
      field(
        'tail',
        'Target + nonce',
        'Provider asked (0xFF = anyone) and nonce; split not published, shown raw.',
        msg.tail ?? '',
        10,
        11
      )
    );
  } else {
    fields.push(
      field('fragment', 'Fragment', ASSUMED_LE, String(msg.fragment), 6, 7),
      field(
        'data',
        'Fragment data',
        'Patch or manifest bytes.',
        `${msg.dataLen} bytes`,
        8,
        msg.payloadLen - 1
      )
    );
  }
  return fields;
}
