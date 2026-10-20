// Companion frames for the wardrive tests, in the layout of the companion
// firmware (as the meshcore Python library reads them, reader.py).

/** RESP_CONTACT (0x03): key 32, type, flags, out_path_len, out_path 64,
 * name 32 (NUL padded), last_advert u32 LE, lat/lon i32 LE x 1e6, lastmod u32. */
export function contactFrame(c: {
  keyHex: string;
  type?: number;
  name?: string;
  lastAdvert?: number;
  lat?: number;
  lon?: number;
}): Uint8Array {
  const f = new Uint8Array(1 + 32 + 3 + 64 + 32 + 16);
  const view = new DataView(f.buffer);
  f[0] = 0x03;
  for (let i = 0; i < 32; i++) f[1 + i] = parseInt(c.keyHex.slice(i * 2, i * 2 + 2), 16);
  f[33] = c.type ?? 1;
  f[35] = 0xff; // flood: no out path
  f.set(new TextEncoder().encode(c.name ?? ''), 100);
  view.setUint32(132, c.lastAdvert ?? 0, true);
  view.setInt32(136, Math.round((c.lat ?? 0) * 1e6), true);
  view.setInt32(140, Math.round((c.lon ?? 0) * 1e6), true);
  return f;
}

/** RESP_CONTACTS_START (0x02) with the count. */
export function contactsStartFrame(count: number): Uint8Array {
  const f = new Uint8Array(5);
  f[0] = 0x02;
  new DataView(f.buffer).setUint32(1, count, true);
  return f;
}

/** RESP_END_OF_CONTACTS (0x04) with the lastmod. */
export function contactsEndFrame(): Uint8Array {
  return new Uint8Array([0x04, 0, 0, 0, 0]);
}
