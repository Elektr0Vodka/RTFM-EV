// Signing in to a collector with the radio's own key (the DutchMeshCore
// collectors verify it with @michaelhart/meshcore-decoder). The radio signs
// the token; its private key never leaves it. Same claims as core-hunter's
// companionsign.js.
import { bytesToHex } from '../packet';

/** How long a token stays valid; a reconnect inside that window reuses it. */
export const TOKEN_TTL_S = 86400;
/** A token with less life than this is replaced before connecting. */
export const TOKEN_MARGIN_S = 600;

const b64url = (text: string) =>
  btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function brokerUsername(publicKey: string): string {
  return `v1_${publicKey.toUpperCase()}`;
}

/** The audience a collector checks is the host the client connected to. */
export function audienceOf(url: string): string {
  return new URL(url).hostname;
}

export async function buildToken(
  publicKey: string,
  audience: string,
  nowSec: number,
  sign: (bytes: Uint8Array) => Promise<Uint8Array>
): Promise<string> {
  const header = { alg: 'Ed25519', typ: 'JWT' };
  const payload = {
    publicKey: publicKey.toUpperCase(),
    aud: audience,
    iat: nowSec,
    exp: nowSec + TOKEN_TTL_S,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await sign(new TextEncoder().encode(input));
  if (signature.length !== 64) throw new Error('Expected a 64-byte signature');
  return `${input}.${bytesToHex(signature)}`;
}

export function tokenUsable(
  token: string | null | undefined,
  publicKey: string,
  audience: string,
  nowSec: number
): boolean {
  if (!token) return false;
  try {
    const part = token.split('.')[1] ?? '';
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return (
      claims.publicKey === publicKey.toUpperCase() &&
      claims.aud === audience &&
      Number.isFinite(claims.exp) &&
      claims.exp - nowSec > TOKEN_MARGIN_S
    );
  } catch {
    return false;
  }
}
