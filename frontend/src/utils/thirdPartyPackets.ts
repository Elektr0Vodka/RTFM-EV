/**
 * Labels for traffic that other MeshCore firmwares and apps put on the air
 * (research 2026-10-19, docs/plans/2026-10-19-third-party-traffic/):
 *
 * - MeshCoreNG payload types 0x0D Location (MCL1, big-endian) and 0x0C Atlas
 *   (github.com/MichTronics/MeshCoreNG, docs/payloads.md, src/helpers/Atlas.cpp).
 *   Mirrors app/meshcoreng.py; keep both in step.
 * - CubeCell MeshCore discovery responses: CONTROL byte 0 = 0x81, which upstream
 *   reads as a discovery request (github.com/atomozero/CubeCellMeshCore, main.cpp).
 * - RAW_CUSTOM (0x0F, plaintext) first-byte table: MeshCore SAR media and fetch
 *   frames, SigurdOS PING/PONG, Reticulum Smart MeshCore Interface fragments.
 *
 * Only labels and field breakdowns: nothing here changes storage or handling.
 */
import { MeshCoreDecoder } from '@michaelhart/meshcore-decoder';

import type { RawPacket } from '../types';
import { fuotaFromDecoded } from './fuotaPayload';
import type { PacketByteField } from './rawPacketInspector';

export const MESHCORENG_TYPE_NAME = 'MeshCoreNG';

const PAYLOAD_CONTROL = 0x0b;
const PAYLOAD_ATLAS = 0x0c;
const PAYLOAD_LOCATION = 0x0d;
const PAYLOAD_RAW_CUSTOM = 0x0f;
const ROUTE_DIRECT = 0x02;

export interface ThirdPartyPacket {
  /** Feed / filter type name. */
  typeName: string;
  summary: string;
  /** Label for the header breakdown's payload-type field, when it differs from the library's. */
  headerTypeLabel?: string;
  fields: PacketByteField[];
}

interface DecodedLike {
  isValid: boolean;
  payloadVersion: number;
  payloadType: number;
  routeType: number;
  pathLength: number;
  totalBytes?: number;
  payload: { raw: string };
}

function bytesOf(text: string): Uint8Array | null {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const ascii = (b: Uint8Array) => String.fromCharCode(...b);

function ube(b: Uint8Array, at: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + b[at + i];
  return v;
}

function sbe(b: Uint8Array, at: number, size: number): number {
  const v = ube(b, at, size);
  const max = 2 ** (size * 8);
  return v >= max / 2 ? v - max : v;
}

function fieldMaker(offset: number) {
  return (name: string, description: string, value: string, start: number, end: number) =>
    ({
      id: `third-party-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      scope: 'payload',
      name,
      description,
      value,
      startByte: start,
      endByte: end,
      absoluteStartByte: offset + start,
      absoluteEndByte: offset + end,
    }) satisfies PacketByteField;
}

// ── MeshCoreNG ───────────────────────────────────────────────────────────────

function mcl1(p: Uint8Array, offset: number): ThirdPartyPacket | null {
  if (p.length < 32 || ascii(p.slice(0, 4)) !== 'MCL1' || p[4] !== 1) return null;
  const nameLen = p[31];
  if (nameLen > 24 || p.length !== 32 + nameLen) return null;
  const f = fieldMaker(offset);
  const lat = sbe(p, 10, 4) / 1e6;
  const lon = sbe(p, 14, 4) / 1e6;
  const name = new TextDecoder().decode(p.slice(32));
  const node = hex(p.slice(6, 10));
  const parts = [`MeshCoreNG Location`, `node ${node}`, `${lat.toFixed(6)}, ${lon.toFixed(6)}`];
  if (name) parts.push(name);
  return {
    typeName: MESHCORENG_TYPE_NAME,
    headerTypeLabel: 'MeshCoreNG Location (not official)',
    summary: parts.join(' · '),
    fields: [
      f('Magic', 'MeshCoreNG compact tracker report', 'MCL1', 0, 3),
      f('Version', '', String(p[4]), 4, 4),
      f('Flags', 'Reserved', String(p[5]), 5, 5),
      f('Node ID', "First 4 bytes of the sender's public key", node, 6, 9),
      f('Latitude', 'Signed microdegrees, big-endian', lat.toFixed(6), 10, 13),
      f('Longitude', 'Signed microdegrees, big-endian', lon.toFixed(6), 14, 17),
      f('Altitude', 'Metres', `${sbe(p, 18, 2)} m`, 18, 19),
      f('Speed', 'Centimetres per second', `${ube(p, 20, 2)} cm/s`, 20, 21),
      f('Heading', 'Centidegrees', `${(ube(p, 22, 2) / 100).toFixed(2)}°`, 22, 23),
      f('Satellites', '', String(p[24]), 24, 24),
      f('Battery', '', `${ube(p, 25, 2)} mV`, 25, 26),
      f('Time', 'Unix time from the node clock', String(ube(p, 27, 4)), 27, 30),
      f('Name length', '0-24', String(nameLen), 31, 31),
      ...(nameLen > 0 ? [f('Name', 'UTF-8', name, 32, 31 + nameLen)] : []),
    ],
  };
}

const ATLAS_SUBTYPE: Record<number, string> = {
  1: 'position',
  2: 'neighbours',
  3: 'path sample',
  4: 'stats',
};

function atlas(p: Uint8Array, offset: number): ThirdPartyPacket | null {
  if (p.length === 0) return null;
  const sub = p[0];
  const n = p.length;
  let valid = false;
  if (sub === 1 && n >= 2) {
    const flags = p[1] & 0x07;
    valid = n === 14 + 2 * ((flags & 1) + ((flags >> 1) & 1) + ((flags >> 2) & 1));
  } else if (sub === 2 && n >= 2) {
    valid = p[1] <= 12 && n === 2 + 10 * p[1];
  } else if (sub === 3 && n >= 10) {
    const hops = p[9];
    if (hops <= 24 && n >= 11 + hops) {
      const hasLatency = p[10 + hops];
      valid = (hasLatency === 0 || hasLatency === 1) && n === 11 + hops + 4 * hasLatency;
    }
  } else if (sub === 4) {
    valid = n === 33;
  }
  if (!valid) return null;
  const f = fieldMaker(offset);
  return {
    typeName: MESHCORENG_TYPE_NAME,
    headerTypeLabel: 'MeshCoreNG Atlas (not official)',
    summary: `MeshCoreNG Atlas · ${ATLAS_SUBTYPE[sub]}`,
    fields: [
      f('Atlas type', '1 position, 2 neighbours, 3 path sample, 4 stats', ATLAS_SUBTYPE[sub], 0, 0),
      f('Atlas data', 'Little-endian fields (src/helpers/Atlas.cpp)', `${n - 1} bytes`, 1, n - 1),
    ],
  };
}

// ── CubeCell ─────────────────────────────────────────────────────────────────

function cubecellDiscover(p: Uint8Array, offset: number): ThirdPartyPacket | null {
  if (p.length !== 15 || p[0] !== 0x81) return null;
  const f = fieldMaker(offset);
  const key = hex(p.slice(7, 15));
  const role = p[1] === 0x02 ? 'repeater' : `type ${p[1]}`;
  return {
    typeName: 'Control',
    summary: `Discovery response (CubeCell layout) · ${role} · SNR ${p[2]} · key ${key}`,
    fields: [
      f(
        'Response flag',
        'CubeCell sends 0x81. Upstream answers with 0x90 | node type and reads 0x8x as a discovery request.',
        '0x81',
        0,
        0
      ),
      f('Node type', '2 = repeater', String(p[1]), 1, 1),
      f('SNR', 'Inbound SNR as CubeCell sends it (raw byte)', String(p[2]), 2, 2),
      f('Tag', "The request's tag, little-endian", hex(p.slice(3, 7)), 3, 6),
      f('Key prefix', 'First 8 bytes of the public key', key, 7, 14),
    ],
  };
}

// ── RAW_CUSTOM ───────────────────────────────────────────────────────────────

function rawCustom(p: Uint8Array, offset: number): ThirdPartyPacket | null {
  if (p.length === 0) return null;
  const f = fieldMaker(offset);
  const b0 = p[0];
  const n = p.length;
  const sid = n >= 5 ? hex(p.slice(1, 5)) : '';
  const out = (summary: string, fields: PacketByteField[]): ThirdPartyPacket => ({
    typeName: 'Unknown',
    summary,
    fields,
  });

  // MeshCore SAR (dz0ny/meshcore-sar docs/*-mode-technical.md)
  if ((b0 === 0x56 || b0 === 0x49) && n >= 7 && (b0 === 0x56 || n <= 158)) {
    const what = b0 === 0x56 ? 'voice' : 'image';
    return out(`MeshCore SAR ${what} fragment · session ${sid} · #${p[5]}`, [
      f('Magic', b0 === 0x56 ? "'V' voice (Codec2)" : "'I' image (AVIF)", hex(p.slice(0, 1)), 0, 0),
      f('Session', '', sid, 1, 4),
      f('Index', '', String(p[5]), 5, 5),
      f('Data', '', `${n - 6} bytes`, 6, n - 1),
    ]);
  }
  if ((b0 === 0x72 || b0 === 0x69) && n >= 13 && n === 13 + p[12]) {
    const what = b0 === 0x72 ? 'voice' : 'image';
    return out(`MeshCore SAR ${what} fetch · session ${sid} · ${p[12]} missing`, [
      f('Magic', `'${String.fromCharCode(b0)}' ${what} fetch request`, hex(p.slice(0, 1)), 0, 0),
      f('Session', '', sid, 1, 4),
      f('Flags', '', String(p[5]), 5, 5),
      f('Requester', 'Key prefix', hex(p.slice(6, 12)), 6, 11),
      f('Missing', 'Fragment indices', String(p[12]), 12, n - 1),
    ]);
  }
  if (b0 === 0x6d && n >= 14) {
    const kind = p[1];
    const swarmSid = hex(p.slice(3, 7));
    if (kind === 1 && n === 14 + p[13]) {
      return out(`MeshCore SAR swarm request · session ${swarmSid}`, [
        f('Magic', "'m' swarm", '6d', 0, 0),
        f('Kind', '1 ask, 2 have', '1', 1, 1),
        f('Session', '', swarmSid, 3, 6),
        f('Requester', 'Key prefix', hex(p.slice(7, 13)), 7, 12),
      ]);
    }
    if (kind === 2 && n >= 20 && n === 20 + p[19]) {
      return out(`MeshCore SAR swarm answer · session ${swarmSid}`, [
        f('Magic', "'m' swarm", '6d', 0, 0),
        f('Kind', '1 ask, 2 have', '2', 1, 1),
        f('Session', '', swarmSid, 3, 6),
        f('Responder', 'Key prefix', hex(p.slice(13, 19)), 13, 18),
      ]);
    }
  }

  // SigurdOS T-Deck (src/mesh/sigurd_mesh_v2.cpp): 'P' | 0x80 then "ING:"/"ONG:"
  if (b0 === 0xd0 && n >= 5) {
    const rest = ascii(p.slice(1));
    if (rest.startsWith('ING:')) {
      return out(`SigurdOS ping · tag ${rest.slice(4)}`, [
        f('Marker', "'P' with bit 7 set, zero hop", '0xD0', 0, 0),
        f('Text', '', 'PING:' + rest.slice(4), 1, n - 1),
      ]);
    }
    if (rest.startsWith('ONG:')) {
      const [tag, name, rssi] = rest.slice(4).split(':');
      const parts = [`SigurdOS pong`, `tag ${tag}`];
      if (name) parts.push(name);
      if (rssi) parts.push(`${rssi} dBm`);
      return out(parts.join(' · '), [
        f('Marker', "'P' with bit 7 set, zero hop", '0xD0', 0, 0),
        f('Text', 'Tag, responder name and the RSSI it heard', 'PONG:' + rest.slice(4), 1, n - 1),
      ]);
    }
  }

  // Reticulum Smart MeshCore Interface raw fragment, protocol v2 (high nibble 2)
  if (b0 >> 4 === 2 && n >= 10) {
    const pkt = hex(p.slice(5, 7));
    return out(`Reticulum fragment (likely) · packet ${pkt} · ${p[7] + 1}/${p[8]}`, [
      f(
        'Version + flags',
        'v2 << 4 | parity 0x08 | report 0x04 | attempt',
        hex(p.slice(0, 1)),
        0,
        0
      ),
      f('Destination', 'Key prefix', hex(p.slice(1, 3)), 1, 2),
      f('Source', 'Key prefix', hex(p.slice(3, 5)), 3, 4),
      f('Packet ID', 'Big-endian', pkt, 5, 6),
      f('Fragment', 'Index (or parity coverage mask)', String(p[7]), 7, 7),
      f('Fragments', 'Total', String(p[8]), 8, 8),
      f('RNS chunk', '', `${n - 9} bytes`, 9, n - 1),
    ]);
  }
  return null;
}

/** Recognise a decoded packet as one of the third-party formats above. */
export function recognizeThirdParty(decoded: DecodedLike): ThirdPartyPacket | null {
  if (!decoded.isValid || decoded.payloadVersion !== 0) return null;
  const p = bytesOf(decoded.payload.raw);
  if (!p) return null;
  const offset = (decoded.totalBytes ?? 0) - p.length;
  switch (decoded.payloadType) {
    case PAYLOAD_LOCATION:
      return mcl1(p, offset);
    case PAYLOAD_ATLAS:
      return decoded.routeType === ROUTE_DIRECT && decoded.pathLength === 0
        ? atlas(p, offset)
        : null;
    case PAYLOAD_CONTROL:
      return cubecellDiscover(p, offset);
    case PAYLOAD_RAW_CUSTOM:
      return rawCustom(p, offset);
    default:
      return null;
  }
}

/**
 * True for packets we know carry no encryption at all, so the UI says "Not
 * encrypted" instead of "Encrypted": FUOTA and the formats above.
 */
export function isNotEncrypted(packet: RawPacket): boolean {
  try {
    const decoded = MeshCoreDecoder.decode(packet.data);
    return fuotaFromDecoded(decoded) !== null || recognizeThirdParty(decoded) !== null;
  } catch {
    return false;
  }
}
