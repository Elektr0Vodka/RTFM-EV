import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { radarFont } from '../components/mynode/radar/radar';

// Vitest serves CSS imports empty, so read the files from disk.
const css = readFileSync(resolve(__dirname, '../accessibility.css'), 'utf8');
const indexCss = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

const FAMILIES: Record<string, string> = {
  opendyslexic: 'OpenDyslexic',
  atkinson: 'Atkinson Hyperlegible',
  lexend: 'Lexend',
};

/** The declarations of the first rule whose selector contains `needle`. */
function ruleBody(needle: string): string {
  const at = css.indexOf(needle);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('reading font CSS', () => {
  it.each(Object.entries(FAMILIES))('sets the sans font for %s', (id, family) => {
    const body = ruleBody(`[data-reading-font='${id}']`);
    expect(body).toMatch(new RegExp(`--font-sans:[^;]*'${family}'`));
    // Keeps the flag-emoji font first, as the base stack does.
    expect(body).toMatch(/--font-sans:\s*'Twemoji Country Flags'/);
  });

  it.each(Object.values(FAMILIES))('declares a @font-face for %s', (family) => {
    expect(indexCss).toMatch(new RegExp(`font-family: '${family}';`));
  });

  it('overrides themes that set a heading font directly', () => {
    expect(css).toMatch(/\[data-theme='darkdutch'\][^{]*\.app-statusbar h1/);
    expect(css).toMatch(/\[data-theme='darkdutch'\][^{]*\.dd-section-label/);
    expect(css).toMatch(/\[data-theme\^='mceu-'\][^{]*h1/);
  });

  it('reaches the chat text of the mIRC popup pane', () => {
    expect(css).toMatch(/\[data-theme\^='mirc'\][^{]*\.popout-pane/);
  });

  it('never changes the monospace font', () => {
    expect(css).not.toMatch(/--font-mono/);
  });
});

describe('radarFont', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--font-sans');
    delete document.documentElement.dataset.readingFont;
  });

  it('keeps the system font under the theme font, whatever the theme sets', () => {
    document.documentElement.style.setProperty('--font-sans', 'Tahoma, sans-serif');
    expect(radarFont(11)).toBe('11px system-ui, sans-serif');
  });

  it('uses the page sans font when a reading font is picked', () => {
    document.documentElement.dataset.readingFont = 'lexend';
    document.documentElement.style.setProperty('--font-sans', "'Lexend', sans-serif");
    expect(radarFont(12)).toBe("12px 'Lexend', sans-serif");
  });
});
