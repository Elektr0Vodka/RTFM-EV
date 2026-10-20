// The temporary zero-hop route for a directed ask (core-hunter contactpath.js,
// from coredrive-rx). The companion floods a request when the contact's
// out_path_len is unknown (0xFF) and sends it along a stored, maybe stale,
// path otherwise; Auto-discover asks only nodes it hears directly, so for the
// one ask the contact is set to zero-hop and then put back exactly as it was,
// whatever happened in between. No override, no ask: it never floods.
//
// A contact reply (RESP_CODE_CONTACT, 148 bytes) and CMD_ADD_UPDATE_CONTACT
// share a layout (MyMesh.cpp writeContactRespFrame / updateContactFromFrame):
// code(1) key(32) type(1) flags(1) out_path_len(1) out_path(64) name(32)
// last_advert(4) lat(4) lon(4) lastmod(4). The override rewrites byte 0 and
// byte 35; the restore only byte 0, so lastmod and the rest come back as read.
//
// Crash safety: before an override, the original frame is stored under the
// connected companion's and the contact's key; it goes only when the restore
// acked, and the next connect to the same companion replays what is left.

export const CMD_GET_CONTACT_BY_KEY = 30;
export const CMD_ADD_UPDATE_CONTACT = 9;
export const RESP_CODE_OK = 0;
export const RESP_CODE_ERR = 1;
export const RESP_CODE_CONTACT = 3;
const ERR_CODE_NOT_FOUND = 2;
export const CONTACT_FRAME_LEN = 148;
const OUT_PATH_LEN = 35;
const RESTORE_PREFIX = 'rtfm-wardrive-contact-restore:';
const PUBKEY = /^[0-9a-f]{64}$/;

export type ContactReply =
  { found: true; pubkey: string; outPathLen: number; raw: Uint8Array } | { found: false };

export interface ContactIo {
  /** The contact read; null when no reply came. */
  getContact(pubkey: string): Promise<ContactReply | null>;
  /** A contact write: true on OK, false on ERR, null when no reply came. */
  writeContact(frame: Uint8Array): Promise<boolean | null>;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const lower = (s: string) => s.trim().toLowerCase();

export function buildGetContactByKey(pubkeyHex: string): Uint8Array {
  const pk = lower(pubkeyHex);
  if (!PUBKEY.test(pk)) throw new TypeError('Contact read: needs a 64-hex public key');
  const out = new Uint8Array(33);
  out[0] = CMD_GET_CONTACT_BY_KEY;
  for (let i = 0; i < 32; i++) out[1 + i] = parseInt(pk.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A found contact (kept verbatim to echo back), not found, or null for
 * anything else: half a frame echoed back would write garbage. */
export function parseContactReply(bytes: Uint8Array): ContactReply | null {
  if (bytes.length < 1) return null;
  if (bytes[0] === RESP_CODE_ERR) {
    return bytes.length >= 2 && bytes[1] === ERR_CODE_NOT_FOUND ? { found: false } : null;
  }
  if (bytes[0] === RESP_CODE_CONTACT && bytes.length >= CONTACT_FRAME_LEN) {
    const raw = Uint8Array.from(bytes.slice(0, CONTACT_FRAME_LEN));
    return { found: true, pubkey: toHex(raw.slice(1, 33)), outPathLen: raw[OUT_PATH_LEN], raw };
  }
  return null;
}

export function buildOverrideFrame(raw: Uint8Array): Uint8Array {
  const out = Uint8Array.from(raw);
  out[0] = CMD_ADD_UPDATE_CONTACT;
  out[OUT_PATH_LEN] = 0;
  return out;
}

export function buildRestoreFrame(raw: Uint8Array): Uint8Array {
  const out = Uint8Array.from(raw);
  out[0] = CMD_ADD_UPDATE_CONTACT;
  return out;
}

const restoreKey = (self: string, target: string) =>
  `${RESTORE_PREFIX}${lower(self)}:${lower(target)}`;

function decodeRecord(json: string): { self: string; target: string; raw: Uint8Array } | null {
  let rec: unknown;
  try {
    rec = JSON.parse(json);
  } catch {
    return null;
  }
  const r = rec as { self?: unknown; target?: unknown; raw?: unknown };
  if (typeof r?.self !== 'string' || typeof r.target !== 'string' || typeof r.raw !== 'string') {
    return null;
  }
  if (!/^[0-9a-f]*$/i.test(r.raw) || r.raw.length !== CONTACT_FRAME_LEN * 2) return null;
  const raw = new Uint8Array(CONTACT_FRAME_LEN);
  for (let i = 0; i < CONTACT_FRAME_LEN; i++) raw[i] = parseInt(r.raw.slice(i * 2, i * 2 + 2), 16);
  return { self: lower(r.self), target: lower(r.target), raw };
}

// Contact reads and writes carry no correlator: one exchange on the link at
// a time, each after the one before has settled.
let linkTurn: Promise<unknown> = Promise.resolve();
function onLink<T>(exchange: () => Promise<T>): Promise<T> {
  const run = linkTurn.then(exchange);
  linkTurn = run.catch(() => undefined);
  return run;
}

export interface DanceResult {
  asked: boolean;
  skipped?: string;
  restored?: boolean;
}

/** `askNonContact`: an anonymous request, which the companion sends to a
 * node it does not know yet (adding it zero-hop itself). */
export function askAtZeroHop(
  io: ContactIo,
  self: string,
  target: string,
  ask: () => Promise<void>,
  opts: { askNonContact?: boolean } = {}
): Promise<DanceResult> {
  return onLink(() => dance(io, self, target, ask, opts.askNonContact === true));
}

async function dance(
  io: ContactIo,
  self: string,
  target: string,
  ask: () => Promise<void>,
  askNonContact: boolean
): Promise<DanceResult> {
  const contact = await io.getContact(target);
  if (!contact) return { asked: false, skipped: 'no contact reading' };
  if (!contact.found) {
    if (!askNonContact) return { asked: false, skipped: 'not a contact' };
    await ask();
    return { asked: true };
  }
  if (contact.outPathLen === 0) {
    await ask();
    return { asked: true };
  }
  try {
    localStorage.setItem(
      restoreKey(self, target),
      JSON.stringify({ self: lower(self), target: lower(target), raw: toHex(contact.raw) })
    );
  } catch {
    return { asked: false, skipped: 'restore record not stored' };
  }
  let out: DanceResult = { asked: false, skipped: 'override not acknowledged' };
  try {
    if (await io.writeContact(buildOverrideFrame(contact.raw))) {
      await ask();
      out = { asked: true };
    }
  } finally {
    out.restored = await restore(io, self, target, contact.raw);
  }
  return out;
}

async function restore(
  io: ContactIo,
  self: string,
  target: string,
  raw: Uint8Array
): Promise<boolean> {
  if (!(await io.writeContact(buildRestoreFrame(raw)))) return false;
  try {
    localStorage.removeItem(restoreKey(self, target));
  } catch {
    // Storage gone: the contact is back, which is what counts.
  }
  return true;
}

/** Once per connect: put back every contact a dropped session left zero-hop
 * on this companion. Whether all restores acked, or null when none was owed. */
export function replayPendingRestores(io: ContactIo, self: string): Promise<boolean | null> {
  return onLink(async () => {
    const stored: [string, string][] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(RESTORE_PREFIX)) stored.push([key, localStorage.getItem(key) ?? '']);
      }
    } catch {
      return null;
    }
    let owed = false;
    let allAcked = true;
    for (const [key, value] of stored) {
      const rec = decodeRecord(value);
      if (!rec) {
        try {
          localStorage.removeItem(key);
        } catch {
          // Nothing to drop.
        }
        continue;
      }
      if (rec.self !== lower(self)) continue;
      owed = true;
      if (!(await restore(io, rec.self, rec.target, rec.raw))) allAcked = false;
    }
    return owed ? allAcked : null;
  });
}
