// MeshCore companion frames the wardrive page uses. It only reads what the
// radio hears, asks the radio for its own identity and its contact table, and
// asks it to sign; it never sends anything over the air.
// Sources: the companion firmware (examples/companion_radio/MyMesh.cpp,
// docs/companion_protocol.md), as read by core-hunter and by the meshcore
// Python library this repo uses.
import type { DirectoryNode } from '../names';

export const CMD_APP_START = 0x01;
export const RESP_SELF_INFO = 0x05;
export const PUSH_LOG_RX_DATA = 0x88;
export const CMD_GET_CONTACTS = 0x04;
/** The radio's clock (RESP_CURR_TIME: uint32 seconds). A local read. */
export const CMD_GET_DEVICE_TIME = 0x05;
export const RESP_CURR_TIME = 9;
export const RESP_CONTACTS_START = 0x02;
export const RESP_CONTACT = 0x03;
export const RESP_END_OF_CONTACTS = 0x04;
export const CMD_SIGN_START = 33;
export const CMD_SIGN_DATA = 34;
export const CMD_SIGN_FINISH = 35;
export const RESP_OK = 0x00;
export const RESP_ERR = 0x01;
export const RESP_SIGN_START = 19;
export const RESP_SIGNATURE = 20;
/** Data bytes per SIGN_DATA frame: a frame is at most 176 bytes. */
export const SIGN_CHUNK = 128;
/** CMD_GET_STATS and its reply (meshcore reader.py RESP_CODE_STATS). */
export const CMD_GET_STATS = 0x38;
export const RESP_STATS = 24;
export const STATS_CORE = 0;
export const STATS_RADIO = 1;

const int8 = (b: number) => (b < 128 ? b : b - 256);
const hexUpper = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

/** APP_START: [0x01][7 reserved bytes][app name, UTF-8]. */
export function appStartFrame(appName: string): Uint8Array {
  const name = new TextEncoder().encode(appName);
  const frame = new Uint8Array(8 + name.length);
  frame[0] = CMD_APP_START;
  frame.set(name, 8);
  return frame;
}

/** SELF_INFO: public key at bytes 4-35, the spreading factor at byte 56
 * (null when absent or not 5..12), the name from byte 58 (NUL-trimmed). */
export function parseSelfInfo(
  frame: Uint8Array
): { publicKey: string; name: string; sf: number | null } | null {
  if (frame.length < 36 || frame[0] !== RESP_SELF_INFO) return null;
  let name = '';
  if (frame.length > 58) {
    name = new TextDecoder().decode(frame.subarray(58)).replace(/\0+$/, '');
  }
  const sfByte = frame.length > 56 ? frame[56] : 0;
  const sf = sfByte >= 5 && sfByte <= 12 ? sfByte : null;
  return { publicKey: hexUpper(frame.subarray(4, 36)), name, sf };
}

/** RX log push: [0x88][snr int8, quarter dB][rssi int8][raw packet]. */
export function parseRxLog(
  frame: Uint8Array
): { snr: number; rssi: number; raw: Uint8Array } | null {
  if (frame.length < 4 || frame[0] !== PUSH_LOG_RX_DATA) return null;
  return { snr: int8(frame[1]) / 4, rssi: int8(frame[2]), raw: frame.slice(3) };
}

// Contact type as the radio stores it, named as the decoder names roles.
const CONTACT_ROLES: Record<number, string> = {
  1: 'Chat Node',
  2: 'Repeater',
  3: 'Room Server',
  4: 'Sensor',
};
// code, key 32, type, flags, out_path_len, out_path 64, name 32, last_advert, lat, lon
const CONTACT_MIN_LENGTH = 144;

/** RESP_CONTACT: the contact's key, advertised name, role, advertised
 * position ((0, 0) is none) and when it was last heard: the radio's own
 * lastmod when the frame carries it, else the advert time (the node's clock,
 * which can be far off); 0 is unknown. lastmod is by the radio's clock, which
 * nothing may have set: `clockOffsetS` (page clock minus radio clock, from
 * CMD_GET_DEVICE_TIME) puts it on the page's clock. */
export function parseContact(frame: Uint8Array, clockOffsetS = 0): DirectoryNode | null {
  if (frame.length < CONTACT_MIN_LENGTH || frame[0] !== RESP_CONTACT) return null;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const nameBytes = frame.subarray(100, 132);
  const end = nameBytes.indexOf(0);
  const name = new TextDecoder().decode(end < 0 ? nameBytes : nameBytes.subarray(0, end)).trim();
  const lastAdvert = view.getUint32(132, true);
  const lastmod = frame.length >= CONTACT_MIN_LENGTH + 4 ? view.getUint32(144, true) : 0;
  const lat = view.getInt32(136, true) / 1e6;
  const lon = view.getInt32(140, true) / 1e6;
  const placed = lat !== 0 || lon !== 0;
  return {
    publicKey: hexUpper(frame.subarray(1, 33)).toLowerCase(),
    name: name || null,
    role: CONTACT_ROLES[frame[33]] ?? null,
    lat: placed ? lat : null,
    lon: placed ? lon : null,
    seen: lastmod ? lastmod + clockOffsetS : lastAdvert || null,
  };
}

/** RESP_CODE_STATS + STATS_TYPE_CORE (11 bytes, `<B B H I H B`): battery mV. */
export function parseStatsCore(frame: Uint8Array): { batteryMv: number } | null {
  if (frame.length < 11 || frame[0] !== RESP_STATS || frame[1] !== STATS_CORE) return null;
  return {
    batteryMv: new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint16(2, true),
  };
}

/** RESP_CODE_STATS + STATS_TYPE_RADIO (14 bytes, `<B B h b b I I`): noise floor dBm. */
export function parseStatsRadio(frame: Uint8Array): { noiseFloor: number } | null {
  if (frame.length < 14 || frame[0] !== RESP_STATS || frame[1] !== STATS_RADIO) return null;
  return {
    noiseFloor: new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getInt16(2, true),
  };
}
