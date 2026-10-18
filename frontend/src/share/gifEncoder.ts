/**
 * A small GIF89a encoder for share-card animations.
 *
 * One global palette for the whole clip (built from sample frames), and a
 * pixel that did not change since the previous frame is written as the
 * transparent index, so a still base map under moving routes costs almost
 * nothing after the first frame.
 */

/** Palette index reserved for "unchanged since the previous frame". */
export const TRANSPARENT_INDEX = 255;

const key15 = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * Popularity palette: colours quantised to 5 bits per channel, the most used
 * buckets win, each entry is the average of the real colours in its bucket.
 * Returns RGB triplets, at most `maxColors` of them.
 */
export function buildPalette(samples: Uint8ClampedArray[], maxColors = 255): Uint8Array {
  const count = new Uint32Array(32768);
  const sumR = new Float64Array(32768);
  const sumG = new Float64Array(32768);
  const sumB = new Float64Array(32768);
  for (const rgba of samples) {
    for (let i = 0; i < rgba.length; i += 4) {
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const k = key15(r, g, b);
      count[k]++;
      sumR[k] += r;
      sumG[k] += g;
      sumB[k] += b;
    }
  }
  const used: number[] = [];
  for (let k = 0; k < 32768; k++) if (count[k] > 0) used.push(k);
  used.sort((a, b) => count[b] - count[a]);
  const top = used.slice(0, Math.min(maxColors, TRANSPARENT_INDEX));
  const out = new Uint8Array(top.length * 3);
  top.forEach((k, i) => {
    out[i * 3] = Math.round(sumR[k] / count[k]);
    out[i * 3 + 1] = Math.round(sumG[k] / count[k]);
    out[i * 3 + 2] = Math.round(sumB[k] / count[k]);
  });
  return out;
}

/** GIF variable-length LZW: clear code first, reset at 4096 codes, end code. */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  const out: number[] = [];
  let bitBuf = 0;
  let bitCount = 0;
  let codeSize = minCodeSize + 1;
  const emit = (code: number) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.push(bitBuf & 0xff);
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  // Keys are (prefix code << 8) | next index; a Map is fast enough here.
  let table = new Map<number, number>();
  let nextCode = end + 1;
  emit(clear);
  if (indices.length === 0) {
    emit(end);
    if (bitCount > 0) out.push(bitBuf & 0xff);
    return Uint8Array.from(out);
  }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const tkey = (prefix << 8) | k;
    const found = table.get(tkey);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (nextCode === 4096) {
      emit(clear);
      table = new Map();
      nextCode = end + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (nextCode >= 1 << codeSize) codeSize++;
      table.set(tkey, nextCode++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bitCount > 0) out.push(bitBuf & 0xff);
  return Uint8Array.from(out);
}

class ByteSink {
  private chunks: Uint8Array[] = [];
  private cur: number[] = [];
  byte(b: number) {
    this.cur.push(b & 0xff);
    if (this.cur.length >= 65536) this.flush();
  }
  word(w: number) {
    this.byte(w & 0xff);
    this.byte((w >> 8) & 0xff);
  }
  bytes(arr: ArrayLike<number>) {
    this.flush();
    this.chunks.push(Uint8Array.from(arr));
  }
  ascii(s: string) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  flush() {
    if (this.cur.length) {
      this.chunks.push(Uint8Array.from(this.cur));
      this.cur = [];
    }
  }
  result(): Uint8Array {
    this.flush();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }
}

export class GifWriter {
  private sink = new ByteSink();
  private prev: Uint8ClampedArray | null = null;
  private nearestCache = new Int16Array(32768).fill(-1);
  private readonly palette: Uint8Array;
  private readonly colors: number;

  constructor(
    private readonly width: number,
    private readonly height: number,
    palette: Uint8Array
  ) {
    this.palette = palette;
    this.colors = Math.min(TRANSPARENT_INDEX, Math.floor(palette.length / 3));
    const s = this.sink;
    s.ascii('GIF89a');
    s.word(width);
    s.word(height);
    s.byte(0xf7); // global colour table, 8-bit resolution, 256 entries
    s.byte(0); // background index
    s.byte(0); // pixel aspect ratio
    const table = new Uint8Array(256 * 3);
    table.set(palette.subarray(0, this.colors * 3));
    s.bytes(table);
    // NETSCAPE2.0: loop forever.
    s.byte(0x21);
    s.byte(0xff);
    s.byte(11);
    s.ascii('NETSCAPE2.0');
    s.byte(3);
    s.byte(1);
    s.word(0);
    s.byte(0);
  }

  private nearest(r: number, g: number, b: number): number {
    const k = key15(r, g, b);
    const cached = this.nearestCache[k];
    if (cached >= 0) return cached;
    const pal = this.palette;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.colors; i++) {
      const dr = pal[i * 3] - r;
      const dg = pal[i * 3 + 1] - g;
      const db = pal[i * 3 + 2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.nearestCache[k] = best;
    return best;
  }

  addFrame(rgba: Uint8ClampedArray, delayCs: number): void {
    const n = this.width * this.height;
    const idx = new Uint8Array(n);
    const prev = this.prev;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (
        prev &&
        prev[p] === rgba[p] &&
        prev[p + 1] === rgba[p + 1] &&
        prev[p + 2] === rgba[p + 2]
      ) {
        idx[i] = TRANSPARENT_INDEX;
      } else {
        idx[i] = this.nearest(rgba[p], rgba[p + 1], rgba[p + 2]);
      }
    }
    this.prev = rgba.slice();

    const s = this.sink;
    // Graphic control extension: disposal "do not dispose", transparency on.
    s.byte(0x21);
    s.byte(0xf9);
    s.byte(4);
    s.byte((1 << 2) | 1);
    s.word(Math.max(0, Math.round(delayCs)));
    s.byte(TRANSPARENT_INDEX);
    s.byte(0);
    // Image descriptor, full frame, no local colour table.
    s.byte(0x2c);
    s.word(0);
    s.word(0);
    s.word(this.width);
    s.word(this.height);
    s.byte(0);
    s.byte(8);
    const data = lzwEncode(idx, 8);
    const blocks: number[] = [];
    for (let p = 0; p < data.length; p += 255) {
      const len = Math.min(255, data.length - p);
      blocks.push(len);
      for (let j = 0; j < len; j++) blocks.push(data[p + j]);
    }
    blocks.push(0);
    s.bytes(blocks);
  }

  finish(): Uint8Array {
    this.sink.byte(0x3b);
    return this.sink.result();
  }
}
