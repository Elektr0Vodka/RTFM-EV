import { describe, expect, it } from 'vitest';
import { GifWriter, buildPalette, lzwEncode } from '../../share/gifEncoder';

function solid(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  }
  return out;
}

function noise(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = i % 4 === 3 ? 255 : seed & 0xff;
  }
  return out;
}

function ascii(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
}

/** Reference GIF LZW decoder, independent of the encoder under test. */
function lzwDecodeForTest(data: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = [];
    dict[end] = [];
    codeSize = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let bitPos = 0;
  let prev: number[] | null = null;
  const totalBits = data.length * 8;
  while (bitPos + codeSize <= totalBits) {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const bit = (data[(bitPos + i) >> 3] >> ((bitPos + i) & 7)) & 1;
      code |= bit << i;
    }
    bitPos += codeSize;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad code ' + code);
    out.push(...entry);
    if (prev) {
      dict.push([...prev, entry[0]]);
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return Uint8Array.from(out);
}

interface ParsedImage {
  minCodeSize: number;
  data: Uint8Array;
  transparentIndex: number | null;
}

/** Walks the GIF block structure (not a byte search) and returns each image. */
function parseImages(bytes: Uint8Array): ParsedImage[] {
  let p = 6 + 7;
  const flags = bytes[10];
  if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
  const images: ParsedImage[] = [];
  let transparent: number | null = null;
  const readSubBlocks = (): Uint8Array => {
    const parts: number[] = [];
    while (bytes[p] !== 0) {
      const n = bytes[p];
      parts.push(...bytes.slice(p + 1, p + 1 + n));
      p += n + 1;
    }
    p += 1;
    return Uint8Array.from(parts);
  };
  while (p < bytes.length) {
    const b = bytes[p];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[p + 1];
      p += 2;
      if (label === 0xf9) {
        const packed = bytes[p + 1];
        transparent = packed & 1 ? bytes[p + 4] : null;
      }
      readSubBlocks();
    } else if (b === 0x2c) {
      const packed = bytes[p + 9];
      p += 10;
      if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));
      const minCodeSize = bytes[p];
      p += 1;
      images.push({ minCodeSize, data: readSubBlocks(), transparentIndex: transparent });
      transparent = null;
    } else {
      throw new Error('unexpected block 0x' + b.toString(16) + ' at ' + p);
    }
  }
  return images;
}

describe('GifWriter', () => {
  it('writes a GIF89a header, loop extension, one image per frame and a trailer', () => {
    const pal = buildPalette([solid(4, 4, [255, 0, 0]), solid(4, 4, [0, 0, 255])]);
    const w = new GifWriter(4, 4, pal);
    w.addFrame(solid(4, 4, [255, 0, 0]), 10);
    w.addFrame(solid(4, 4, [0, 0, 255]), 10);
    const bytes = w.finish();
    expect(ascii(bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes[6] | (bytes[7] << 8)).toBe(4);
    expect(bytes[8] | (bytes[9] << 8)).toBe(4);
    expect(ascii(bytes)).toContain('NETSCAPE2.0');
    expect(parseImages(bytes)).toHaveLength(2);
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  it('writes every pixel of the first frame in the closest palette colour', () => {
    const pal = buildPalette([solid(3, 2, [250, 10, 10])]);
    const w = new GifWriter(3, 2, pal);
    w.addFrame(solid(3, 2, [250, 10, 10]), 10);
    const [img] = parseImages(w.finish());
    const idx = lzwDecodeForTest(img.data, img.minCodeSize);
    expect(idx).toHaveLength(6);
    const i = idx[0];
    expect(i).not.toBe(255);
    expect(Array.from(idx).every((v) => v === i)).toBe(true);
    expect(Math.abs(pal[i * 3] - 250)).toBeLessThanOrEqual(8);
  });

  it('an unchanged second frame encodes as fully transparent', () => {
    const frame = noise(8, 8);
    const w = new GifWriter(8, 8, buildPalette([frame]));
    w.addFrame(frame, 10);
    w.addFrame(frame, 10);
    const images = parseImages(w.finish());
    expect(images[1].transparentIndex).toBe(255);
    const idx = lzwDecodeForTest(images[1].data, images[1].minCodeSize);
    expect(idx).toHaveLength(64);
    expect(Array.from(idx).every((v) => v === 255)).toBe(true);
  });
});

describe('lzwEncode', () => {
  it('round-trips through a reference decoder', () => {
    const idx = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) % 13);
    expect(lzwDecodeForTest(lzwEncode(idx, 4), 4)).toEqual(idx);
  });

  it('round-trips long varied input that fills the code table', () => {
    const idx = Uint8Array.from({ length: 40000 }, (_, i) => (i * 2654435761) >>> 24);
    expect(lzwDecodeForTest(lzwEncode(idx, 8), 8)).toEqual(idx);
  });
});

describe('buildPalette', () => {
  it('never returns more than 255 colours', () => {
    expect(buildPalette([noise(64, 64)]).length / 3).toBeLessThanOrEqual(255);
  });
});
