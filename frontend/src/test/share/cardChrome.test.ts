import { describe, expect, it } from 'vitest';
import { SIDE_RECT, drawCardChrome, wrapLines, type CardText } from '../../share/cardChrome';
import type { CardBrand } from '../../share/brand';
import { recordingCtx } from './recordingCtx';

const measure = (s: string) => Array.from(s).length * 10;

const text: CardText = {
  kicker: '#public, 21:14',
  title: "How Jan's message reached me",
  quote: 'Anyone hearing this in Utrecht?',
  figures: [
    { value: '2', label: 'routes' },
    { value: '3 to 4', label: 'hops' },
  ],
};
const brand: CardBrand = { name: 'RTFM-EV', icon: null };

describe('wrapLines', () => {
  it('truncates with an ellipsis at maxLines', () => {
    const lines = wrapLines(measure, 'one two three four five six', 100, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(100);
  });

  it('keeps short text on one line', () => {
    expect(wrapLines(measure, 'hello there', 200, 3)).toEqual(['hello there']);
  });

  it('breaks a word longer than the line', () => {
    expect(wrapLines(measure, 'x'.repeat(25), 100, 3)).toEqual([
      'xxxxxxxxxx',
      'xxxxxxxxxx',
      'xxxxx',
    ]);
  });

  it('never splits an emoji', () => {
    const lines = wrapLines((s) => Array.from(s).length * 10, '👍🏽👍🏽👍🏽👍🏽', 20, 4);
    expect(lines.join('')).toBe('👍🏽👍🏽👍🏽👍🏽');
  });

  it('returns nothing for empty text', () => {
    expect(wrapLines(measure, '   ', 100, 2)).toEqual([]);
  });
});

describe('drawCardChrome', () => {
  it('draws the kicker, title, quote and figures', () => {
    const ctx = recordingCtx();
    drawCardChrome(ctx, text, brand, 'dark');
    const texts = ctx.texts();
    expect(texts).toContain('#public, 21:14');
    expect(texts).toContain("How Jan's message reached me");
    expect(texts.join(' ')).toContain('Anyone hearing this in Utrecht?');
    expect(texts).toContain('3 to 4');
    expect(texts).toContain('hops');
    expect(texts).toContain('RTFM-EV');
  });

  it('draws at most four figures', () => {
    const ctx = recordingCtx();
    drawCardChrome(
      ctx,
      {
        ...text,
        figures: Array.from({ length: 6 }, (_, i) => ({ value: `${i}`, label: `f${i}` })),
      },
      brand,
      'dark'
    );
    expect(ctx.texts().filter((s) => /^f\d$/.test(s))).toEqual(['f0', 'f1', 'f2', 'f3']);
  });

  it('omits the credit when none is given and draws it when given', () => {
    const without = recordingCtx();
    drawCardChrome(without, text, brand, 'light');
    expect(without.texts().join(' ')).not.toContain('Esri');
    const withCredit = recordingCtx();
    drawCardChrome(withCredit, { ...text, credit: 'Tiles © Esri' }, brand, 'light');
    expect(withCredit.texts().join(' ')).toContain('Esri');
  });

  it('keeps every text inside the side panel', () => {
    const ctx = recordingCtx();
    drawCardChrome(
      ctx,
      { ...text, credit: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' },
      brand,
      'dark'
    );
    for (const call of ctx.calls('fillText')) {
      const x = call.args[1] as number;
      const s = String(call.args[0]);
      expect(x).toBeGreaterThanOrEqual(SIDE_RECT.x);
      expect(x + measure(s)).toBeLessThanOrEqual(SIDE_RECT.x + SIDE_RECT.w);
    }
  });

  it('draws the brand icon when there is one', () => {
    const ctx = recordingCtx();
    const icon = {} as HTMLImageElement;
    drawCardChrome(ctx, text, { name: '', icon }, 'dark');
    expect(ctx.calls('drawImage').some((c) => c.args[0] === icon)).toBe(true);
    expect(ctx.texts()).not.toContain('RTFM-EV');
  });
});
