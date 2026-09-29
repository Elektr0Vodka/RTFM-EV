import { describe, expect, it } from 'vitest';

import enManual from '../content/manual/en.md?raw';
import nlManual from '../content/manual/nl.md?raw';
import deManual from '../content/manual/de.md?raw';
import { parseManual, parseManualInline } from '../utils/manualMarkdown';

const MANUALS = { en: enManual, nl: nlManual, de: deManual };

const sectionIdsFromMarkers = (source: string) =>
  [...source.matchAll(/<!--\s*id:\s*([a-z0-9-]+)\s*-->/g)].map((m) => m[1]);

describe('manual content (User Guide)', () => {
  const enIds = sectionIdsFromMarkers(enManual);

  it('has section id markers in the English manual', () => {
    expect(enIds.length).toBeGreaterThan(5);
    expect(new Set(enIds).size).toBe(enIds.length);
  });

  it.each(Object.entries(MANUALS))('%s has the same ordered section ids as en', (_, source) => {
    expect(sectionIdsFromMarkers(source)).toEqual(enIds);
    // Every marker must be attached to a ## heading.
    expect(parseManual(source).map((s) => s.id)).toEqual(enIds);
  });

  it.each(Object.entries(MANUALS))('%s contains no em dash', (_, source) => {
    expect(source).not.toContain(String.fromCharCode(0x2014));
  });

  it.each(Object.entries(MANUALS))('%s does not ship the drafting notes section', (_, source) => {
    expect(source).not.toMatch(/Sources and uncertainties|UNVERIFIED/);
  });
});

describe('parseManual', () => {
  it('builds sections with headings, paragraphs and lists', () => {
    const sections = parseManual(
      [
        'ignored preamble',
        '<!-- id: one -->',
        '## First',
        '',
        'Para **bold** and `code`.',
        '',
        '### Sub',
        '- item a',
        '- item b',
        '',
        '1. step',
        '## Second',
        'Text',
      ].join('\n')
    );
    expect(sections.map((s) => [s.id, s.title])).toEqual([
      ['one', 'First'],
      ['second', 'Second'],
    ]);
    expect(sections[0].blocks.map((b) => b.kind)).toEqual(['p', 'h3', 'ul', 'ol']);
  });

  it('keeps unsafe link targets as plain text', () => {
    expect(parseManualInline('[x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: 'x' },
      { kind: 'text', text: ')' },
    ]);
    expect(parseManualInline('[site](https://example.org)')).toEqual([
      { kind: 'link', text: 'site', href: 'https://example.org' },
    ]);
  });
});
