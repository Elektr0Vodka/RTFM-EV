#!/usr/bin/env node
/**
 * Compare a character converted by acs_to_clippy.py with the same character as
 * shipped by clippyjs (Clippy, Peedy, Bonzi, ...). clippyjs' data was made from
 * the original .acs files, so it is the ground truth for the converter.
 *
 *   node scripts/buddy/compare_with_clippyjs.mjs out/clippit clippy
 *   node scripts/buddy/compare_with_clippyjs.mjs out/peedy peedy --clippyjs frontend/node_modules/clippyjs
 *
 * Checks frame size, animation names, per-frame timing/branching and the
 * pixels of every frame. Exit code 0 when everything matches.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

/** Decode an 8-bit, non-interlaced PNG (palette, RGB or RGBA) to RGBA. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const data = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const tag = buffer.toString('latin1', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    if (tag === 'IHDR') header = body;
    else if (tag === 'PLTE') palette = body;
    else if (tag === 'tRNS') transparency = body;
    else if (tag === 'IDAT') data.push(body);
    pos += 12 + length;
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [depth, colourType, , , interlace] = header.subarray(8);
  const channels = { 2: 3, 3: 1, 6: 4 }[colourType];
  if (depth !== 8 || !channels || interlace) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${colourType})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (line[x] + predicted) & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (colourType === 3) {
      const index = pixels[i];
      palette.copy(rgba, i * 4, index * 3, index * 3 + 3);
      rgba[i * 4 + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    } else if (colourType === 2) {
      pixels.copy(rgba, i * 4, i * 3, i * 3 + 3);
      const keyed =
        transparency &&
        pixels[i * 3] === transparency[1] &&
        pixels[i * 3 + 1] === transparency[3] &&
        pixels[i * 3 + 2] === transparency[5];
      rgba[i * 4 + 3] = keyed ? 0 : 255;
    } else {
      pixels.copy(rgba, i * 4, i * 4, i * 4 + 4);
    }
  }
  return { width, height, rgba };
}

/** One frame as RGBA: clippyjs stacks `images` as nested elements, last on top. */
function renderFrame(sheet, [frameW, frameH], images) {
  const out = Buffer.alloc(frameW * frameH * 4);
  for (const [sx, sy] of images ?? []) {
    for (let y = 0; y < frameH; y++) {
      for (let x = 0; x < frameW; x++) {
        if (sx + x >= sheet.width || sy + y >= sheet.height) continue;
        const src = ((sy + y) * sheet.width + sx + x) * 4;
        if (sheet.rgba[src + 3] === 0) continue;
        sheet.rgba.copy(out, (y * frameW + x) * 4, src, src + 4);
      }
    }
  }
  return out;
}

function differingPixels(a, b) {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    const bothClear = a[i + 3] === 0 && b[i + 3] === 0;
    if (!bothClear && a.readUInt32LE(i) !== b.readUInt32LE(i)) count++;
  }
  return count;
}

const FRAME_FIELDS = ['duration', 'exitBranch', 'branching', 'sound'];

export function compare(mine, theirs) {
  const problems = [];
  const stats = { animations: 0, frames: 0, fieldMismatches: 0, pixelMismatchFrames: 0 };
  if (String(mine.agent.framesize) !== String(theirs.agent.framesize)) {
    problems.push(`framesize ${mine.agent.framesize} vs ${theirs.agent.framesize}`);
    return { problems, stats };
  }
  const byLower = new Map(Object.keys(mine.agent.animations).map((n) => [n.toLowerCase(), n]));
  for (const name of Object.keys(theirs.agent.animations)) {
    const ownName = byLower.get(name.toLowerCase());
    if (!ownName) {
      problems.push(`animation "${name}" missing from the conversion`);
      continue;
    }
    if (ownName !== name) problems.push(`animation name case: "${ownName}" vs "${name}"`);
    byLower.delete(name.toLowerCase());
    stats.animations++;
    const a = mine.agent.animations[ownName];
    const b = theirs.agent.animations[name];
    if (!!a.useExitBranching !== !!b.useExitBranching) {
      problems.push(`${name}: useExitBranching ${!!a.useExitBranching} vs ${!!b.useExitBranching}`);
    }
    if (a.frames.length !== b.frames.length) {
      problems.push(`${name}: ${a.frames.length} frames vs ${b.frames.length}`);
      continue;
    }
    a.frames.forEach((frame, i) => {
      stats.frames++;
      for (const key of FRAME_FIELDS) {
        // Sound names are arbitrary labels; only compare whether one plays.
        const left = key === 'sound' ? frame[key] !== undefined : JSON.stringify(frame[key]);
        const right = key === 'sound' ? b.frames[i][key] !== undefined : JSON.stringify(b.frames[i][key]);
        if (left !== right) {
          stats.fieldMismatches++;
          if (problems.length < 40) problems.push(`${name}[${i}].${key}: ${left} vs ${right}`);
        }
      }
      const diff = differingPixels(
        renderFrame(mine.sheet, mine.agent.framesize, frame.images),
        renderFrame(theirs.sheet, theirs.agent.framesize, b.frames[i].images)
      );
      if (diff) {
        stats.pixelMismatchFrames++;
        if (problems.length < 40) problems.push(`${name}[${i}]: ${diff} pixels differ`);
      }
    });
  }
  for (const extra of byLower.values()) problems.push(`animation "${extra}" only in the conversion`);
  return { problems, stats };
}

function dataUrlToBuffer(url) {
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

async function main() {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--clippyjs');
  const clippyDir = flag >= 0 ? args.splice(flag, 2)[1] : 'frontend/node_modules/clippyjs';
  const [convertedDir, agentName] = args;
  if (!convertedDir || !agentName) {
    console.error('usage: compare_with_clippyjs.mjs <converted dir> <clippyjs agent> [--clippyjs DIR]');
    process.exit(2);
  }
  const mine = {
    agent: JSON.parse(readFileSync(path.join(convertedDir, 'agent.json'), 'utf8')),
    sheet: decodePng(readFileSync(path.join(convertedDir, 'map.png'))),
  };
  const base = path.resolve(clippyDir, 'dist', 'agents', agentName);
  const theirs = {
    agent: (await import(pathToFileURL(path.join(base, 'agent.mjs')).href)).default,
    sheet: decodePng(
      dataUrlToBuffer((await import(pathToFileURL(path.join(base, 'map.mjs')).href)).default)
    ),
  };
  const { problems, stats } = compare(mine, theirs);
  console.log(
    `${stats.animations} animations and ${stats.frames} frames compared: ` +
      `${stats.fieldMismatches} field mismatches, ${stats.pixelMismatchFrames} frames with pixel differences`
  );
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(problems.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
