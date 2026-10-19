// The driver's wardrive account on the page: proving a radio is theirs, and
// remembering who is logged in for when RTFM-EV cannot be reached mid-drive.
import { WardriveApiError, wardriveApi, type SignedRadio, type WardriveMe } from './api';
import { bytesToHex, hexToBytes } from './packet';
import type { Companion } from './radio/companion';

const CACHE_KEY = 'rtfm-wardrive-me';

/** Asks RTFM-EV for a challenge and the radio to sign exactly its bytes. */
export async function signedRadio(companion: Companion, publicKey: string): Promise<SignedRadio> {
  const { nonce, message_hex } = await wardriveApi.challenge(publicKey);
  const signature = await companion.sign(hexToBytes(message_hex));
  return { public_key: publicKey, nonce, signature: bytesToHex(signature) };
}

function readCache(): WardriveMe | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as WardriveMe) : null;
  } catch {
    return null;
  }
}

export function rememberMe(me: WardriveMe | null): void {
  try {
    if (me) localStorage.setItem(CACHE_KEY, JSON.stringify(me));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage blocked: the page then needs the server to know who is logged in.
  }
}

/** The logged-in account. When RTFM-EV cannot be reached, the last one seen
 * (the session cookie is still there); a 401 forgets it. */
export async function loadMe(): Promise<{ me: WardriveMe | null; offline: boolean }> {
  try {
    const me = await wardriveApi.me();
    rememberMe(me);
    return { me, offline: false };
  } catch (e) {
    if (e instanceof WardriveApiError && e.status === 0) return { me: readCache(), offline: true };
    if (e instanceof WardriveApiError && e.status === 401) rememberMe(null);
    return { me: null, offline: false };
  }
}

export type RadioState = 'logged-out' | 'on-account' | 'not-on-account';

export function radioState(me: WardriveMe | null, publicKey: string): RadioState {
  if (!me) return 'logged-out';
  const key = publicKey.toUpperCase();
  return me.radios.some((r) => r.public_key.toUpperCase() === key)
    ? 'on-account'
    : 'not-on-account';
}
