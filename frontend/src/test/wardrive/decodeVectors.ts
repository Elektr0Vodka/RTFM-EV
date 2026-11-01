// Frames for the wardrive page's decoding tests.
import { createCipheriv, createHash, createHmac } from 'node:crypto';

// A public repeater beacon as heard on air, with a valid signature (from
// core-hunter app/src/__tests__/decode.test.js, master 000bb89). Name
// NL-OV-ENS-ESNODE, role Repeater.
export const REAL_ADVERT =
  '12004250ea787ea3c29f099074f9066f2da643e6f4bc0201da0122e23a81ddb806202a6e7b6aaf114f76dbd2afc6e732160cab0f45881163c98535dc5177f8e04ac796da9108cfb21bf5657452e23ed12f1007194e8da4937179ce214abf2465272e541ef80d929cda1c03b88d69004e4c2d4f562d454e532d45534e4f4445';
export const REAL_ADVERT_KEY = '4250ea787ea3c29f099074f9066f2da643e6f4bc0201da0122e23a81ddb80620';

// A captured direct Response from source hash 4a, zero hops (same source).
export const REAL_DIRECT = '0640774ad5974332ebc33dde2e08ef96b7b337d3358d';

/** REAL_ADVERT with one signature byte flipped: structurally fine, forged. */
export const FORGED_ADVERT = (() => {
  const at = 128; // hex offset inside the 64-byte signature (offsets 76-203)
  const byte = parseInt(REAL_ADVERT.slice(at, at + 2), 16) ^ 0xff;
  return REAL_ADVERT.slice(0, at) + byte.toString(16).padStart(2, '0') + REAL_ADVERT.slice(at + 2);
})();

/** A hashtag channel's secret: first 16 bytes of SHA-256 of the name. */
export function hashtagSecret(name: string): string {
  return createHash('sha256').update(name, 'utf8').digest().subarray(0, 16).toString('hex');
}

export const TEST_SECRET = hashtagSecret('#test');

/**
 * A GroupText frame on a flood route, built as the firmware does: plaintext
 * is a 4-byte LE timestamp, a flag byte and "sender: text", zero padded to a
 * 16-byte block, AES-128-ECB with the secret; the MAC is the first 2 bytes of
 * HMAC-SHA256 over the ciphertext keyed with the secret zero-padded to 32
 * bytes; the payload starts with the first byte of SHA-256(secret).
 * `path` is the hop bytes as hex, `hashSize` the bytes per hop.
 */
export function groupTextFrame(
  secretHex: string,
  sender: string,
  text: string,
  path = '',
  hashSize = 1
): string {
  const secret = Buffer.from(secretHex, 'hex');
  const body = Buffer.from(`${sender}: ${text}`, 'utf8');
  const plain = Buffer.alloc(Math.ceil((5 + body.length) / 16) * 16);
  plain.writeUInt32LE(1792404000, 0);
  plain[4] = 0;
  body.copy(plain, 5);
  const cipher = createCipheriv('aes-128-ecb', secret, null);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const macKey = Buffer.alloc(32);
  secret.copy(macKey);
  const mac = createHmac('sha256', macKey).update(ciphertext).digest().subarray(0, 2);
  const channelHash = createHash('sha256').update(secret).digest().subarray(0, 1);
  const hops = path.length / 2 / hashSize;
  const pathLen = hops | ((hashSize - 1) << 6);
  const header = (5 << 2) | 1; // GroupText, flood
  return (
    header.toString(16).padStart(2, '0') +
    pathLen.toString(16).padStart(2, '0') +
    path +
    Buffer.concat([channelHash, mac, ciphertext]).toString('hex')
  );
}

/** A TRACE heard on a flood route with one hop: its path bytes are SNRs, never a sender. */
export const TRACE_FRAME = '2501a1' + '01020304' + '00000000' + '00' + 'b2';
