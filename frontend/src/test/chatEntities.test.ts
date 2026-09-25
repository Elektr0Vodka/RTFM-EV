import { describe, expect, it } from 'vitest';
import {
  findContactShares,
  findPubkeys,
  findCoordinates,
  formatContactShare,
  tokenizeMessageText,
} from '../utils/chatEntities';

const KEY = 'f40fd1f0b0dedcb2650457bf90d81f3c1b174242449e9012ec38aba5db2d87ee';

describe('findPubkeys', () => {
  it('finds a standalone 64-hex key', () => {
    const r = findPubkeys(`node ${KEY} seen`);
    expect(r).toEqual([{ value: KEY, start: 5, end: 5 + 64 }]);
  });
  it('ignores 63- and 65-hex runs', () => {
    expect(findPubkeys('a'.repeat(63))).toEqual([]);
    expect(findPubkeys('a'.repeat(65))).toEqual([]);
  });
  it('ignores hex embedded in a longer hex run', () => {
    expect(findPubkeys('0'.repeat(128))).toEqual([]);
  });
});

describe('findCoordinates', () => {
  it('finds a bare decimal pair', () => {
    const r = findCoordinates('here: 52.724169,6.997483 end');
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBeCloseTo(52.724169);
    expect(r[0].lon).toBeCloseTo(6.997483);
  });
  it('finds coords at the end of a wardriving prefix', () => {
    const r = findCoordinates('MM:8PH-GxBKXg:49.49266,-2.54089');
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBeCloseTo(49.49266);
    expect(r[0].lon).toBeCloseTo(-2.54089);
  });
  it('finds coords in a geo: URI', () => {
    const r = findCoordinates('ping geo:52.72,6.99 now');
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBeCloseTo(52.72);
  });
  it('rejects out-of-range values', () => {
    expect(findCoordinates('120.5,6.9')).toEqual([]); // lat > 90
    expect(findCoordinates('52.7,200.0')).toEqual([]); // lon > 180
  });
  it('requires decimals (ignores bare integer pairs)', () => {
    expect(findCoordinates('score 3,4 today')).toEqual([]);
  });
});

const OPTS = { parsePubkeys: true, parseCoordinates: true, linkifyUrls: true };
const KEY2 = 'f40fd1f0b0dedcb2650457bf90d81f3c1b174242449e9012ec38aba5db2d87ee';

describe('tokenizeMessageText', () => {
  it('splits text, mention, url, hashtag', () => {
    const tokens = tokenizeMessageText('hi @[Bob] see https://x.com #nl-cluster', OPTS);
    expect(tokens.map((t) => t.kind)).toEqual([
      'text',
      'mention',
      'text',
      'url',
      'text',
      'hashtag',
    ]);
  });
  it('emits pubkey and coordinate tokens', () => {
    const tokens = tokenizeMessageText(`k ${KEY2} at 52.72,6.99`, OPTS);
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toContain('pubkey');
    expect(kinds).toContain('coordinate');
  });
  it('URL wins over a coordinate inside it (overlap priority)', () => {
    const tokens = tokenizeMessageText('https://x.com/52.7,6.9', OPTS);
    const kinds = tokens.map((t) => t.kind);
    // The URL match consumes the overlapping region, so no coordinate token is
    // emitted from inside it (the URL regex excludes commas, mirroring the app).
    expect(kinds[0]).toBe('url');
    expect(kinds).not.toContain('coordinate');
  });
  it('suppresses entity kinds when toggled off', () => {
    const tokens = tokenizeMessageText(`k ${KEY2} at 52.72,6.99 https://x.com`, {
      parsePubkeys: false,
      parseCoordinates: false,
      linkifyUrls: false,
    });
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).not.toContain('pubkey');
    expect(kinds).not.toContain('coordinate');
    expect(kinds).not.toContain('url');
  });
});

describe('contact shares (<pubkey:type:Name>, upstream #347)', () => {
  it('finds the official app share form', () => {
    const r = findContactShares(`meet <${KEY.toUpperCase()}:1:Fl1p> today`);
    expect(r).toEqual([
      {
        publicKey: KEY,
        type: 1,
        name: 'Fl1p',
        raw: `<${KEY.toUpperCase()}:1:Fl1p>`,
        start: 5,
        end: 5 + 64 + 9,
      },
    ]);
  });

  it('ignores malformed tags', () => {
    expect(findContactShares(`<${KEY}:x:Name>`)).toEqual([]);
    expect(findContactShares(`<${KEY.slice(0, 63)}:1:Name>`)).toEqual([]);
    expect(findContactShares(`<${KEY}:1:>`)).toEqual([]);
    expect(findContactShares(`<${KEY}:1:   >`)).toEqual([]);
  });

  it('is tokenized even when pubkey parsing is off, and wins over the bare key', () => {
    const text = `hi <${KEY}:2:Repeater One> and ${KEY}`;
    const off = tokenizeMessageText(text, {
      parsePubkeys: false,
      parseCoordinates: false,
      linkifyUrls: true,
    });
    expect(off.map((t) => t.kind)).toEqual(['text', 'contact_share', 'text']);
    const on = tokenizeMessageText(text, {
      parsePubkeys: true,
      parseCoordinates: false,
      linkifyUrls: true,
    });
    expect(on.map((t) => t.kind)).toEqual(['text', 'contact_share', 'text', 'pubkey']);
    const share = on[1];
    expect(share.kind === 'contact_share' && share.name).toBe('Repeater One');
    expect(share.kind === 'contact_share' && share.type).toBe(2);
  });

  it('formats a tag that round-trips and strips angle brackets from the name', () => {
    const tag = formatContactShare(KEY.toUpperCase(), 3, ' Room <A> ');
    expect(tag).toBe(`<${KEY}:3:Room  A>`);
    expect(findContactShares(tag)[0].name).toBe('Room  A');
  });
});
