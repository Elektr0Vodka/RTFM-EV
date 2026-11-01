// Channel keys the wardrive page decodes with: the Public channel and hashtag
// channels. A hashtag channel's secret is the first 16 bytes of SHA-256 of its
// name, hashed verbatim with the leading '#' (as app/routers/channels.py and
// the radio clients do), so only names travel; the page derives the keys.
import { MeshCoreDecoder, type DecryptionOptions } from '@michaelhart/meshcore-decoder';

import { bytesToHex, hexToBytes } from '../packet';

export const PUBLIC_CHANNEL = { name: 'Public', secret: '8b3387e9c5cdea6ac9e5edbaa115cd72' };

// The radio's channel name field: 32 UTF-8 bytes including the '#'.
const MAX_NAME_BYTES = 32;

export interface ChannelKeys {
  options: DecryptionOptions;
  /** First byte of SHA-256(secret), 2 lower hex, to the channel's name. */
  nameByHash: Map<string, string>;
  /** Every channel per hash byte: several channels can share one. */
  byHash: Map<string, { name: string; secret: string }[]>;
}

// First byte of SHA-256 of the Public secret.
const PUBLIC_HASH = '11';

/** Keys for the Public channel alone, ready before any hashing is done. */
export function publicChannelKeys(): ChannelKeys {
  const keyStore = MeshCoreDecoder.createKeyStore({ channelSecrets: [PUBLIC_CHANNEL.secret] });
  return {
    options: { keyStore, attemptDecryption: true },
    nameByHash: new Map([[PUBLIC_HASH, PUBLIC_CHANNEL.name]]),
    byHash: new Map([[PUBLIC_HASH, [PUBLIC_CHANNEL]]]),
  };
}

/** `#name` without surrounding space or extra '#', or null when empty or too long. */
export function normalizeHashtag(name: string): string | null {
  const bare = name.trim().replace(/^#+/, '').trim();
  if (!bare) return null;
  const tagged = `#${bare}`;
  return new TextEncoder().encode(tagged).length > MAX_NAME_BYTES ? null : tagged;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/** The secret of a hashtag channel, lower hex; '#' is added when missing. */
export async function deriveChannelSecret(name: string): Promise<string> {
  const tagged = name.startsWith('#') ? name : `#${name}`;
  return bytesToHex((await sha256(new TextEncoder().encode(tagged))).subarray(0, 16));
}

async function channelHash(secretHex: string): Promise<string> {
  return bytesToHex((await sha256(hexToBytes(secretHex))).subarray(0, 1));
}

/** Keys for Public plus the given hashtag channels; names that are not
 * usable are skipped. `nameByHash` keeps the first name per hash byte;
 * `byHash` keeps them all. */
export async function buildChannelKeys(hashtags: string[]): Promise<ChannelKeys> {
  const channels = [PUBLIC_CHANNEL];
  const seen = new Set<string>();
  for (const raw of hashtags) {
    const name = normalizeHashtag(raw);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    channels.push({ name, secret: await deriveChannelSecret(name) });
  }
  const nameByHash = new Map<string, string>();
  const byHash = new Map<string, { name: string; secret: string }[]>();
  for (const c of channels) {
    const hash = await channelHash(c.secret);
    if (!nameByHash.has(hash)) nameByHash.set(hash, c.name);
    byHash.set(hash, [...(byHash.get(hash) ?? []), c]);
  }
  const keyStore = MeshCoreDecoder.createKeyStore({
    channelSecrets: channels.map((c) => c.secret),
  });
  return { options: { keyStore, attemptDecryption: true }, nameByHash, byHash };
}
