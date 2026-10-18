import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addFrame = vi.fn();
vi.mock('../../share/gifEncoder', () => ({
  buildPalette: () => new Uint8Array(3),
  GifWriter: class {
    addFrame(...args: unknown[]) {
      addFrame(...args);
    }
    finish() {
      return new Uint8Array([0x47]);
    }
  },
}));

import { ANIM, frameProgressList, renderCard } from '../../share/renderCard';
import { recordingCtx, type RecordingCtx } from './recordingCtx';

let ctx: RecordingCtx;

beforeEach(() => {
  vi.clearAllMocks();
  ctx = recordingCtx();
  (ctx as unknown as { getImageData: () => ImageData }).getImageData = () =>
    ({ data: new Uint8ClampedArray(4) }) as ImageData;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb) {
    cb(new Blob(['png'], { type: 'image/png' }));
  });
});
afterEach(() => vi.restoreAllMocks());

describe('renderCard', () => {
  it('makes the PNG from the finished frame', async () => {
    const draw = vi.fn();
    const res = await renderCard(draw, { animate: true });
    expect(res.png.type).toBe('image/png');
    expect(draw.mock.calls[0][0]).toBe(ctx);
    expect(draw.mock.calls[0][1]).toBe(1);
  });

  it('has no GIF when the card does not animate', async () => {
    const res = await renderCard(() => {}, { animate: false });
    expect(res.gif).toBeUndefined();
  });

  it('writes one GIF frame per progress step with first and hold delays', async () => {
    const draw = vi.fn();
    const res = await renderCard(draw, { animate: true });
    const blob = await res.gif!();
    expect(blob.type).toBe('image/gif');
    const delays = addFrame.mock.calls.map((c) => c[1] as number);
    expect(delays).toHaveLength(frameProgressList().length);
    expect(delays[0]).toBe(ANIM.firstMs / 10);
    expect(delays[delays.length - 1]).toBe(ANIM.holdMs / 10);
  });

  it('stops when aborted', async () => {
    const res = await renderCard(() => {}, { animate: true });
    const ctrl = new AbortController();
    addFrame.mockImplementation(() => {
      if (addFrame.mock.calls.length === 2) ctrl.abort();
    });
    await expect(res.gif!(ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(addFrame).toHaveBeenCalledTimes(2);
    addFrame.mockReset();
  });
});
