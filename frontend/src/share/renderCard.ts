import { CARD_H, CARD_W } from './cardChrome';
import { GifWriter, buildPalette } from './gifEncoder';

/** Animation timing. The first frame is the finished picture (a chat preview
 *  that only shows frame 1 still shows the result), then it plays and holds. */
export const ANIM = { fps: 12, playMs: 4000, firstMs: 1000, holdMs: 2500 } as const;

/** Progress per GIF frame: 1 (finished picture), then 0..1 over `playMs`. */
export function frameProgressList(): number[] {
  const steps = Math.round((ANIM.playMs / 1000) * ANIM.fps);
  const list = [1];
  for (let i = 0; i <= steps; i++) list.push(i / steps);
  return list;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type)
  );
}

export interface RenderedCard {
  png: Blob;
  /** Absent for a card without animation. Stops between frames once `signal`
   *  aborts (dialog closed or rebuilt). */
  gif?: (signal?: AbortSignal) => Promise<Blob>;
}

/**
 * Turns a card's frame drawer into files: the PNG is the finished frame
 * (progress 1); the GIF, made on demand, is every progress in
 * `frameProgressList()`.
 */
export async function renderCard(
  draw: (ctx: CanvasRenderingContext2D, progress: number) => void,
  opts: { animate: boolean }
): Promise<RenderedCard> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  draw(ctx, 1);
  const png = await canvasToBlob(canvas, 'image/png');
  if (!opts.animate) return { png };

  const gif = async (signal?: AbortSignal): Promise<Blob> => {
    const checkAborted = () => {
      if (signal?.aborted) throw new DOMException('GIF cancelled', 'AbortError');
    };
    const pixels = (p: number) => {
      draw(ctx, p);
      return ctx.getImageData(0, 0, CARD_W, CARD_H).data;
    };
    checkAborted();
    const palette = buildPalette([pixels(1), pixels(0)]);
    const writer = new GifWriter(CARD_W, CARD_H, palette);
    const list = frameProgressList();
    const frameCs = Math.round(100 / ANIM.fps);
    for (let i = 0; i < list.length; i++) {
      checkAborted();
      const delay =
        i === 0 ? ANIM.firstMs / 10 : i === list.length - 1 ? ANIM.holdMs / 10 : frameCs;
      writer.addFrame(pixels(list[i]), delay);
      // Keep the page responsive while the frames are encoded.
      await new Promise((r) => setTimeout(r, 0));
    }
    checkAborted();
    return new Blob([writer.finish() as BlobPart], { type: 'image/gif' });
  };

  return { png, gif };
}
