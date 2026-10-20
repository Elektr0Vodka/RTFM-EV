// The float readout: the HUD reading drawn on a canvas, streamed into a
// video and taken out of the page, so a driver using another app (navigation)
// still sees the signal. The stream carries a frame only when the reading is
// drawn (captureStream(0) and requestFrame): nothing waits on
// requestAnimationFrame, which a hidden page does not run.
//
// The open path is tested against fakes; the drawing is canvas glue, checked
// in a browser.
import { tierColor } from '../signal';
import type { FloatModel } from './floatModel';

export interface FloatLabels {
  empty: string;
  emptyHint: string;
  dbm: string;
}

interface Orientation {
  lock?: (o: 'portrait') => Promise<void>;
  unlock?: () => void;
}

export interface FloatReadoutOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  mode: 'pip' | 'fullscreen';
  labels: FloatLabels;
  cvd: boolean;
  onChange?: (open: boolean) => void;
  /** screen.orientation, passed in so the portrait lock can be tested. */
  orientation?: Orientation | null;
}

// 16:9, the shape Android gives a floating video.
const W = 960;
const H = 540;
const LEFT = 64;
const RIGHT = W - 48;
const BAR = 26;
const BG = '#0b0f14';
const TEXT = '#f3f4f6';
const MUTED = '#9ca3af';
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
/** Android hands a fullscreen video to its floating window in two steps;
 * a check in between would read the hand-over as a close. */
const SYNC_DELAY_MS = 600;

// Intl.Segmenter is ES2022; the project's lib is older.
type GraphemeSegmenter = new (
  locale: undefined,
  opts: { granularity: 'grapheme' }
) => { segment(text: string): Iterable<{ segment: string }> };
const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;

/** Cuts a name to fit by whole graphemes, so an emoji is never split. */
export function fitText(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  const parts = Segmenter
    ? Array.from(
        new Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
        (s) => s.segment
      )
    : Array.from(text);
  while (parts.length > 1 && measure(parts.join('') + '…') > maxWidth) parts.pop();
  return parts.join('') + '…';
}

export class FloatReadout {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly frame: (() => void) | null;
  private model: FloatModel | null = null;
  private out = false;
  private opening: Promise<boolean> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly doc: Document;

  constructor(private readonly opts: FloatReadoutOptions) {
    const { canvas, video } = opts;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as
      (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
    this.frame = track?.requestFrame ? () => track.requestFrame?.() : null;
    video.srcObject = stream;
    video.muted = true;
    this.doc = video.ownerDocument;
    this.doc.addEventListener('fullscreenchange', this.onFullscreenChange);
    video.addEventListener('leavepictureinpicture', this.sync);
    video.addEventListener('enterpictureinpicture', this.onEnterPip);
  }

  isOpen(): boolean {
    return this.out;
  }

  /** Draws the reading; a frame goes out only now. */
  update(model: FloatModel): void {
    this.model = model;
    this.draw();
  }

  /** Must run inside a tap: play, picture-in-picture and fullscreen all need
   * the gesture. A second tap while the first is asking gets the same try. */
  open(model: FloatModel): Promise<boolean> {
    if (!this.opening) {
      this.opening = this.openOnce(model).finally(() => {
        this.opening = null;
      });
    }
    return this.opening;
  }

  async close(): Promise<void> {
    const { video } = this.opts;
    try {
      if (this.doc.fullscreenElement === video) await this.doc.exitFullscreen();
    } catch {
      // Already out.
    }
    try {
      if (this.doc.pictureInPictureElement === video) await this.doc.exitPictureInPicture();
    } catch {
      // Already out.
    }
    video.pause();
    this.setOpen(false);
  }

  /** Stops listening (the page unmounts). */
  dispose(): void {
    clearTimeout(this.syncTimer);
    this.doc.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.opts.video.removeEventListener('leavepictureinpicture', this.sync);
    this.opts.video.removeEventListener('enterpictureinpicture', this.onEnterPip);
  }

  private async openOnce(model: FloatModel): Promise<boolean> {
    // The window shows the current frame the moment it opens.
    this.update(model);
    const { video } = this.opts;
    try {
      await video.play();
    } catch {
      // A muted stream normally plays; the request below still decides.
    }
    // On Android picture-in-picture would hide the page: fullscreen only.
    const ok =
      this.opts.mode === 'fullscreen'
        ? await this.fullscreen()
        : (await this.pip()) || (await this.fullscreen());
    if (ok) this.setOpen(true);
    else video.pause();
    return ok;
  }

  private async pip(): Promise<boolean> {
    const { video } = this.opts;
    if (!this.doc.pictureInPictureEnabled || !video.requestPictureInPicture) return false;
    try {
      await video.requestPictureInPicture();
      return true;
    } catch {
      return false;
    }
  }

  private async fullscreen(): Promise<boolean> {
    const { video } = this.opts;
    if (!video.requestFullscreen) return false;
    try {
      await video.requestFullscreen();
    } catch {
      return false;
    }
    // The canvas is landscape; the lock keeps a phone in a holder upright.
    try {
      await this.opts.orientation?.lock?.('portrait');
    } catch {
      // Refused: the readout is still out.
    }
    return true;
  }

  private setOpen(open: boolean): void {
    if (open === this.out) return;
    this.out = open;
    this.opts.onChange?.(open);
  }

  private readonly onEnterPip = () => {
    clearTimeout(this.syncTimer);
    this.setOpen(true);
  };

  private readonly onFullscreenChange = () => {
    if (this.doc.fullscreenElement !== this.opts.video) {
      try {
        this.opts.orientation?.unlock?.();
      } catch {
        // Nothing locked.
      }
    }
    this.sync();
  };

  /** Closed from outside the page (the window's own close, back out of
   * fullscreen): the button follows. */
  private readonly sync = () => {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      const { video } = this.opts;
      const stillOut =
        this.doc.fullscreenElement === video || this.doc.pictureInPictureElement === video;
      if (!stillOut && this.out) {
        video.pause();
        this.setOpen(false);
      }
    }, SYNC_DELAY_MS);
  };

  private draw(): void {
    const ctx = this.ctx;
    const m = this.model;
    if (!ctx || !m) return;
    const { labels, cvd } = this.opts;
    const tier = tierColor(m.tier, cvd);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    // The tier down the left edge: closer or further from the corner of an eye.
    ctx.fillStyle = tier;
    ctx.fillRect(0, 0, BAR, H);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const measure = (s: string) => ctx.measureText(s).width;
    if (m.empty) {
      ctx.fillStyle = TEXT;
      ctx.font = `700 76px ${MONO}`;
      ctx.fillText(fitText(labels.empty, RIGHT - LEFT, measure), LEFT, 220);
      ctx.fillStyle = MUTED;
      ctx.font = `500 40px ${MONO}`;
      ctx.fillText(fitText(labels.emptyHint, RIGHT - LEFT, measure), LEFT, 310);
    } else {
      if (m.rssi) {
        ctx.fillStyle = tier;
        ctx.font = `700 170px ${MONO}`;
        ctx.fillText(m.rssi, LEFT, 205);
        const w = measure(m.rssi);
        ctx.fillStyle = MUTED;
        ctx.font = `500 46px ${MONO}`;
        ctx.fillText(labels.dbm, LEFT + w + 20, 205);
      }
      // SNR left, age right; numbers are never cut.
      ctx.fillStyle = MUTED;
      ctx.font = `500 48px ${MONO}`;
      ctx.fillText(m.snr, LEFT, 290);
      ctx.textAlign = 'right';
      ctx.fillText(m.since, RIGHT, 290);
      ctx.textAlign = 'left';
      ctx.font = `600 56px ${MONO}`;
      const y = 400;
      if (!m.sender.name) {
        ctx.fillStyle = MUTED;
        ctx.fillText(fitText(m.sender.note, RIGHT - LEFT, measure), LEFT, y);
      } else {
        let x = LEFT;
        if (m.sender.prefix) {
          ctx.fillStyle = MUTED;
          ctx.fillText(m.sender.prefix, x, y);
          x += measure(m.sender.prefix);
        }
        ctx.fillStyle = TEXT;
        ctx.fillText(fitText(m.sender.name, RIGHT - x, measure), x, y);
      }
    }
    this.frame?.();
  }
}
