import type { CardBrand } from './brand';
import type { PxRect } from './geo';

/** Link-preview size: Discord and most chats show it whole. */
export const CARD_W = 1200;
export const CARD_H = 630;
export const VISUAL_RECT: PxRect = { x: 0, y: 0, w: 690, h: 630 };
export const SIDE_RECT: PxRect = { x: 690, y: 0, w: 510, h: 630 };

export type CardTone = 'dark' | 'light';

export interface CardPalette {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  quoteBar: string;
}

export function cardPalette(tone: CardTone): CardPalette {
  return tone === 'light'
    ? {
        bg: '#eef1f4',
        panel: '#ffffff',
        text: '#16202a',
        muted: '#5b6b7b',
        accent: '#0b6bcb',
        quoteBar: '#0b6bcb',
      }
    : {
        bg: '#1b2430',
        panel: '#10151c',
        text: '#eef2f6',
        muted: '#8fa3b8',
        accent: '#4fb3ff',
        quoteBar: '#4fb3ff',
      };
}

export interface CardFigure {
  value: string;
  label: string;
}

export interface CardText {
  kicker: string;
  title: string;
  quote?: string;
  figures: CardFigure[];
  /** Base map credit; undefined when no map is drawn. */
  credit?: string;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const PAD = 36;
const ELLIPSIS = '…';

// Intl.Segmenter is not in this project's TS lib; typed locally.
type GraphemeSegmenter = new (
  locale: undefined,
  opts: { granularity: 'grapheme' }
) => { segment: (s: string) => Iterable<{ segment: string }> };

function graphemes(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter;
  if (Seg)
    return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (g) => g.segment);
  return Array.from(s);
}

function fitWithEllipsis(measure: (s: string) => number, line: string, maxWidth: number): string {
  const parts = graphemes(line);
  while (parts.length > 0 && measure(parts.join('').trimEnd() + ELLIPSIS) > maxWidth) parts.pop();
  return parts.join('').trimEnd() + ELLIPSIS;
}

/**
 * Word wrap into at most `maxLines` lines no wider than `maxWidth`. A word
 * longer than a line is broken between graphemes (never inside an emoji);
 * text that does not fit ends with an ellipsis.
 */
export function wrapLines(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || maxLines <= 0) return [];
  const lines: string[] = [];
  let line = '';
  let truncated = false;

  const push = (l: string) => {
    if (lines.length >= maxLines) {
      truncated = true;
      return;
    }
    lines.push(l);
  };

  for (const word of words) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) push(line);
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    // Break a long word between graphemes.
    let chunk = '';
    for (const g of graphemes(word)) {
      if (measure(chunk + g) > maxWidth && chunk) {
        push(chunk);
        chunk = '';
      }
      chunk += g;
    }
    line = chunk;
  }
  if (line) push(line);
  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = fitWithEllipsis(measure, lines[lines.length - 1], maxWidth);
  }
  return lines;
}

/** The side panel: kicker, title, quoted text, up to 4 figures, brand and credit. */
export function drawCardChrome(
  ctx: CanvasRenderingContext2D,
  text: CardText,
  brand: CardBrand,
  tone: CardTone
): void {
  const pal = cardPalette(tone);
  const left = SIDE_RECT.x + PAD;
  const right = SIDE_RECT.x + SIDE_RECT.w - PAD;
  const width = right - left;
  const measure = (s: string) => ctx.measureText(s).width;

  ctx.save();
  ctx.direction = 'inherit';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = pal.panel;
  ctx.fillRect(SIDE_RECT.x, SIDE_RECT.y, SIDE_RECT.w, SIDE_RECT.h);

  // Kicker
  let y = 64;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillStyle = pal.muted;
  for (const l of wrapLines(measure, text.kicker, width, 1)) ctx.fillText(l, left, y);

  // Title
  y += 50;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillStyle = pal.text;
  const titleLines = wrapLines(measure, text.title, width, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, left, y + i * 42));
  y += Math.max(1, titleLines.length) * 42;

  // Figures sit in a fixed band above the footer; the quote gets what is left.
  const figures = text.figures.slice(0, 4);
  const figRows = Math.ceil(figures.length / 2);
  const figRowH = 78;
  const footerTop = SIDE_RECT.h - 76;
  const figTop = footerTop - 16 - figRows * figRowH;

  if (text.quote) {
    const lineH = 32;
    const quoteTop = y + 8;
    const maxLines = Math.min(4, Math.floor((figTop - 20 - quoteTop) / lineH));
    ctx.font = `400 24px ${FONT}`;
    const lines = wrapLines(measure, text.quote, width - 20, maxLines);
    if (lines.length > 0) {
      ctx.fillStyle = pal.quoteBar;
      ctx.fillRect(left, quoteTop, 4, lines.length * lineH);
      ctx.fillStyle = pal.text;
      lines.forEach((l, i) => ctx.fillText(l, left + 20, quoteTop + 24 + i * lineH));
    }
  }

  const cellW = width / 2;
  figures.forEach((f, i) => {
    const cx = left + (i % 2) * cellW;
    const cy = figTop + Math.floor(i / 2) * figRowH;
    ctx.font = `700 36px ${FONT}`;
    ctx.fillStyle = pal.text;
    for (const l of wrapLines(measure, f.value, cellW - 12, 1)) ctx.fillText(l, cx, cy + 36);
    ctx.font = `400 18px ${FONT}`;
    ctx.fillStyle = pal.muted;
    for (const l of wrapLines(measure, f.label, cellW - 12, 1)) ctx.fillText(l, cx, cy + 62);
  });

  // Footer: brand left, credit right.
  ctx.fillStyle = pal.muted;
  ctx.fillRect(left, footerTop, width, 1);
  const footerMid = footerTop + 38;
  let brandRight = left;
  if (brand.icon) {
    ctx.drawImage(brand.icon, left, footerMid - 16, 32, 32);
    brandRight += 40;
  }
  if (brand.name) {
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = pal.accent;
    const [name] = wrapLines(measure, brand.name, width / 2, 1);
    if (name) {
      ctx.fillText(name, brandRight, footerMid + 8);
      brandRight += measure(name);
    }
  }
  if (text.credit) {
    ctx.font = `400 13px ${FONT}`;
    ctx.fillStyle = pal.muted;
    const lines = wrapLines(measure, text.credit, right - brandRight - 16, 2);
    const top = footerMid - (lines.length - 1) * 8 + 4;
    lines.forEach((l, i) => ctx.fillText(l, right - measure(l), top + i * 16));
  }
  ctx.restore();
}
