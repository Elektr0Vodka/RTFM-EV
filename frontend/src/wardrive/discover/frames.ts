// The frames Auto-discover hands the companion, and the replies it reads.
// These are the only commands on this page that make the radio transmit;
// every one is sent only while Auto-discover is on (autoDiscover.ts).
// Layouts as core-hunter builds them (discover.js, announce.js,
// telemetryreq.js, anonreq.js), checked against the companion firmware
// (examples/companion_radio/MyMesh.cpp).

/** Zero-hop CONTROL / DISCOVER_REQ: nearby nodes answer directly. */
export const CMD_SEND_CONTROL_DATA = 0x37;
const CTRL_NODE_DISCOVER_REQ = 0x80;
/** Responders send an 8-byte key prefix. */
const DISCOVER_PREFIX_ONLY = 0x01;
/** All advert types answer. */
const DISCOVER_FILTER_ALL = 0xff;
/** A directed trace to one node by the first byte of its key. */
export const CMD_SEND_TRACE_PATH = 0x24;
/** The companion's own advert; byte 1 = 0 sends it zero-hop. */
export const CMD_SEND_SELF_ADVERT = 7;
export const CMD_SEND_TELEMETRY_REQ = 39;
export const CMD_SEND_ANON_REQ = 57;
export const ANON_REQ_REGIONS = 0x01;
export const ANON_REQ_OWNER = 0x02;
export const RESP_CODE_SENT = 6;
export const PUSH_TELEMETRY_RESPONSE = 0x8b;
export const PUSH_BINARY_RESPONSE = 0x8c;

const PUBKEY = /^[0-9a-f]{64}$/;

function keyBytes(pubkeyHex: string, what: string): Uint8Array {
  const pk = String(pubkeyHex).trim().toLowerCase();
  if (!PUBKEY.test(pk)) throw new TypeError(`${what}: needs a 64-hex public key`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(pk.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const u32le = (v: number) => {
  const n = v >>> 0;
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
};

/** `tag`: 4 random bytes, echoed in every answer. */
export function buildDiscoverFrame(tag: Uint8Array): Uint8Array {
  return new Uint8Array([
    CMD_SEND_CONTROL_DATA,
    CTRL_NODE_DISCOVER_REQ | DISCOVER_PREFIX_ONLY,
    DISCOVER_FILTER_ALL,
    ...tag,
  ]);
}

/** tag (4 LE), auth (4 LE), flags 0 (1-byte hashes), then the path. The
 * firmware refuses an empty path, so it is refused here. */
export function buildTracePathFrame(tag: number, authCode: number, path: number[]): Uint8Array {
  if (path.length === 0) throw new Error('A trace needs a path');
  return new Uint8Array([CMD_SEND_TRACE_PATH, ...u32le(tag), ...u32le(authCode), 0x00, ...path]);
}

export function buildSelfAdvertFrame(): Uint8Array {
  return new Uint8Array([CMD_SEND_SELF_ADVERT, 0]);
}

/** [39][3 bytes not read][key 32]: the firmware reads the key at byte 4. */
export function buildTelemetryRequest(pubkeyHex: string): Uint8Array {
  const out = new Uint8Array(36);
  out[0] = CMD_SEND_TELEMETRY_REQ;
  out.set(keyBytes(pubkeyHex, 'Telemetry request'), 4);
  return out;
}

/** [57][key 32][type][reply path length 0: answer zero-hop]. */
export function buildAnonRequest(pubkeyHex: string, type: 1 | 2): Uint8Array {
  if (type !== ANON_REQ_REGIONS && type !== ANON_REQ_OWNER) {
    throw new TypeError('Anonymous request: unknown type');
  }
  const out = new Uint8Array(35);
  out[0] = CMD_SEND_ANON_REQ;
  out.set(keyBytes(pubkeyHex, 'Anonymous request'), 1);
  out[33] = type;
  out[34] = 0;
  return out;
}

export interface SentAck {
  tag: number;
  isFlood: boolean;
  estTimeoutMs: number;
}

/** RESP_CODE_SENT: [6][1 = flood][tag 4 LE][estimated timeout 4 LE]. */
export function parseSentAck(bytes: Uint8Array): SentAck | null {
  if (bytes.length < 10 || bytes[0] !== RESP_CODE_SENT) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { tag: v.getUint32(2, true), isFlood: bytes[1] === 1, estTimeoutMs: v.getUint32(6, true) };
}

// CayenneLPP sizes (the firmware's LPPDataHelpers.h): voltage and
// temperature are read, the rest skipped by size; an unknown type ends the walk.
const LPP_TEMPERATURE = 103;
const LPP_VOLTAGE = 116;
const LPP_SIZE: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 2,
  100: 4,
  101: 2,
  102: 1,
  103: 2,
  104: 1,
  113: 6,
  115: 2,
  116: 2,
  117: 2,
  118: 4,
  120: 1,
  121: 2,
  125: 2,
  128: 2,
  130: 4,
  131: 4,
  132: 2,
  133: 4,
  134: 6,
  135: 3,
  136: 9,
  142: 1,
};

export interface Telemetry {
  voltage_v?: number;
  temp_c?: number;
}

function parseLpp(bytes: Uint8Array): Telemetry {
  const out: Telemetry = {};
  let i = 0;
  while (i + 2 <= bytes.length) {
    const type = bytes[i + 1];
    const size = LPP_SIZE[type];
    if (size === undefined || i + 2 + size > bytes.length) break;
    const at = i + 2;
    const raw = (bytes[at] << 8) | bytes[at + 1];
    if (type === LPP_VOLTAGE) out.voltage_v = raw / 100;
    else if (type === LPP_TEMPERATURE) out.temp_c = (raw >= 0x8000 ? raw - 0x10000 : raw) / 10;
    i = at + size;
  }
  return out;
}

/** 0x8B: [0x8B][0][responder key prefix 6][LPP...]. */
export function parseTelemetryResponse(
  bytes: Uint8Array
): { prefix: string; telemetry: Telemetry } | null {
  if (bytes.length < 8 || bytes[0] !== PUSH_TELEMETRY_RESPONSE) return null;
  let prefix = '';
  for (let i = 2; i < 8; i++) prefix += bytes[i].toString(16).padStart(2, '0');
  return { prefix, telemetry: parseLpp(bytes.slice(8)) };
}

/** 0x8C: [0x8C][0][tag 4 LE][data], the data starting with the repeater's clock. */
export function parseBinaryResponse(bytes: Uint8Array): { tag: number; data: Uint8Array } | null {
  if (bytes.length < 10 || bytes[0] !== PUSH_BINARY_RESPONSE) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { tag: v.getUint32(2, true), data: bytes.slice(6) };
}

// The reply is a block cipher's plaintext, NUL-padded: the padding goes.
function body(data: Uint8Array): Uint8Array {
  let end = data.length;
  while (end > 4 && data[end - 1] === 0) end--;
  return data.slice(4, end);
}
const clockOf = (data: Uint8Array) =>
  new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
/** A list of 139 bytes or more may have names left out (the repeater's
 * 172-byte budget skips a name that does not fit). */
const TRUNCATION_WARN_BYTES = 139;

export function readRegionsReply(data: Uint8Array) {
  const csv = body(data);
  const text = new TextDecoder().decode(csv);
  return {
    repeaterClock: clockOf(data),
    regions: text.length ? text.split(',') : [],
    truncated: csv.length >= TRUNCATION_WARN_BYTES,
  };
}

export function readOwnerReply(data: Uint8Array) {
  const text = new TextDecoder().decode(body(data));
  const nl = text.indexOf('\n');
  return {
    repeaterClock: clockOf(data),
    name: nl === -1 ? text : text.slice(0, nl),
    owner: nl === -1 ? '' : text.slice(nl + 1),
  };
}
