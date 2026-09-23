/**
 * Tests for MeshCore Open rich-chat payload parsing (GIFs and reactions).
 *
 * Formats are ported from meshcore-open; see meshcoreOpenPayloads.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  parseReactionV1,
  isReactionPayload,
  REACTION_EMOJIS,
  giphyUrlForId,
  parseGif,
  parseGifPayload,
  parseGifUrl,
  parseMeshCoreOneReaction,
  parseReaction,
  splitReplyMention,
} from '../utils/meshcoreOpenPayloads';

describe('parseGif', () => {
  it('parses a g:<id> payload', () => {
    expect(parseGif('g:abc123')).toBe('abc123');
  });

  it('accepts ids with underscores and dashes', () => {
    expect(parseGif('g:aB3_-xY')).toBe('aB3_-xY');
  });

  it('trims surrounding whitespace', () => {
    expect(parseGif('  g:abc123  ')).toBe('abc123');
  });

  it('returns null for non-gif text', () => {
    expect(parseGif('hello world')).toBeNull();
    expect(parseGif('g:')).toBeNull();
    expect(parseGif('g:abc 123')).toBeNull();
    expect(parseGif('prefix g:abc')).toBeNull();
    expect(parseGif('g:abc!')).toBeNull();
  });

  it('builds the Giphy media URL', () => {
    expect(giphyUrlForId('abc123')).toBe('https://media.giphy.com/media/abc123/giphy.gif');
  });
});

describe('parseGifUrl', () => {
  it('parses the direct media URL with a scheme', () => {
    expect(parseGifUrl('https://media.giphy.com/media/abc123/giphy.gif')).toBe('abc123');
    expect(parseGifUrl('http://media.giphy.com/media/abc123/giphy.gif')).toBe('abc123');
  });

  it('parses the direct media URL without a scheme', () => {
    expect(parseGifUrl('media.giphy.com/media/abc123/giphy.gif')).toBe('abc123');
  });

  it('parses the giphy.com page URL with a title prefix', () => {
    expect(parseGifUrl('https://giphy.com/gifs/funny-cat-dancing-abc123')).toBe('abc123');
  });

  it('parses the giphy.com page URL with no title', () => {
    expect(parseGifUrl('https://giphy.com/gifs/abc123')).toBe('abc123');
    expect(parseGifUrl('giphy.com/gifs/abc123')).toBe('abc123');
  });

  it('allows a trailing slash on the page URL', () => {
    expect(parseGifUrl('https://giphy.com/gifs/funny-cat-abc123/')).toBe('abc123');
  });

  it('trims surrounding whitespace', () => {
    expect(parseGifUrl('  https://media.giphy.com/media/abc123/giphy.gif  ')).toBe('abc123');
  });

  it('takes the last dash-separated segment as the id', () => {
    // ids cannot contain dashes, so a greedy title prefix backtracks to the
    // last dash - "part-of-title" is the title, "abc123" is the id.
    expect(parseGifUrl('giphy.com/gifs/part-of-title-abc123')).toBe('abc123');
  });

  it('returns null for a non-matching giphy URL', () => {
    expect(parseGifUrl('https://giphy.com/search?q=cats')).toBeNull();
    expect(parseGifUrl('https://giphy.com/channel/some-channel')).toBeNull();
    expect(parseGifUrl('https://www.giphy.com/gifs/abc123')).toBeNull();
    expect(parseGifUrl('https://media.giphy.com/media/abc123/source.gif')).toBeNull();
    expect(parseGifUrl('not a url at all')).toBeNull();
    expect(parseGifUrl('')).toBeNull();
  });

  it('rejects a page URL id containing a dash-unsafe trailing query', () => {
    expect(parseGifUrl('https://giphy.com/gifs/abc123?utm_source=x')).toBeNull();
  });
});

describe('parseGifPayload', () => {
  it('accepts the g:<id> form', () => {
    expect(parseGifPayload('g:abc123')).toBe('abc123');
  });

  it('accepts either Giphy URL form', () => {
    expect(parseGifPayload('https://media.giphy.com/media/abc123/giphy.gif')).toBe('abc123');
    expect(parseGifPayload('https://giphy.com/gifs/funny-cat-abc123')).toBe('abc123');
  });

  it('returns null for text matching none of the forms', () => {
    expect(parseGifPayload('hello world')).toBeNull();
    expect(parseGifPayload('https://example.com/cat.gif')).toBeNull();
  });
});

describe('parseReaction', () => {
  it('decodes the first emoji (index 00)', () => {
    const result = parseReaction('r:1a2b:00');
    expect(result).toEqual({ emoji: REACTION_EMOJIS[0], targetHash: '1a2b' });
    expect(result?.emoji).toBe('👍');
  });

  it('decodes a non-zero index', () => {
    // index 0x06 -> first smiley (after the 6 quick emojis)
    const result = parseReaction('r:ffff:06');
    expect(result?.emoji).toBe(REACTION_EMOJIS[6]);
    expect(result?.targetHash).toBe('ffff');
  });

  it('trims surrounding whitespace', () => {
    expect(parseReaction('  r:1a2b:00  ')?.emoji).toBe('👍');
  });

  it('returns null for an out-of-range index', () => {
    // 0xff (255) is beyond the emoji list length
    expect(parseReaction('r:1a2b:ff')).toBeNull();
  });

  it('returns null for malformed reactions', () => {
    expect(parseReaction('r:1a2b')).toBeNull();
    expect(parseReaction('r:1a2:00')).toBeNull(); // hash too short
    expect(parseReaction('r:1A2B:00')).toBeNull(); // uppercase hex not accepted
    expect(parseReaction('r:1a2b:0')).toBeNull(); // index too short
    expect(parseReaction('hello')).toBeNull();
  });

  it('exposes a stable, deduplication-free emoji index range', () => {
    // 6 quick + 64 smileys + 33 gestures + 32 hearts + 49 objects
    expect(REACTION_EMOJIS.length).toBe(184);
    // every defined index decodes to a string
    for (let i = 0; i < REACTION_EMOJIS.length; i++) {
      const hex = i.toString(16).padStart(2, '0');
      expect(parseReaction(`r:0000:${hex}`)?.emoji).toBe(REACTION_EMOJIS[i]);
    }
  });
});

describe('splitReplyMention', () => {
  it('splits a reply-prefixed gif into mention + body (issue #291)', () => {
    // meshcore-open sends GIF replies as "@[senderName] g:<id>".
    expect(splitReplyMention('@[Alice] g:abc123')).toEqual({
      mention: '@[Alice]',
      body: 'g:abc123',
    });
  });

  it('the split body parses as a gif while the whole string does not', () => {
    const whole = '@[Alice] g:abc123';
    expect(parseGif(whole)).toBeNull(); // anchored regex rejects the prefix
    const split = splitReplyMention(whole);
    expect(split && parseGif(split.body)).toBe('abc123');
  });

  it('splits a reply-prefixed reaction', () => {
    expect(splitReplyMention('@[Bob] r:1a2b:00')).toEqual({
      mention: '@[Bob]',
      body: 'r:1a2b:00',
    });
  });

  it('trims surrounding whitespace and preserves names with spaces', () => {
    expect(splitReplyMention('  @[Node One]   g:xy  ')).toEqual({
      mention: '@[Node One]',
      body: 'g:xy',
    });
  });

  it('returns null without a leading reply mention', () => {
    expect(splitReplyMention('g:abc123')).toBeNull();
    expect(splitReplyMention('hello world')).toBeNull();
    expect(splitReplyMention('@[Alice]')).toBeNull(); // mention only, no body
    expect(splitReplyMention('text @[Alice] g:abc')).toBeNull(); // not a leading mention
  });
});

describe('parseMeshCoreOneReaction', () => {
  it('parses a channel reaction "{emoji}@[sender]\n{hash}" (issue #354)', () => {
    expect(parseMeshCoreOneReaction('\u{1F44D}@[AlphaNode]\nb45pc4ek')).toEqual({
      emoji: '\u{1F44D}',
      targetHash: 'b45pc4ek',
      targetSender: 'AlphaNode',
    });
  });

  it('parses a DM reaction with no target sender', () => {
    expect(parseMeshCoreOneReaction('\u{1F44D}\nb45pc4ek')).toEqual({
      emoji: '\u{1F44D}',
      targetHash: 'b45pc4ek',
    });
  });

  it('parses the newer "@[sender]{emoji}" ordering', () => {
    expect(parseMeshCoreOneReaction('@[Node One]\u{1F92F}\ntpmh79ve')).toEqual({
      emoji: '\u{1F92F}',
      targetHash: 'tpmh79ve',
      targetSender: 'Node One',
    });
  });

  it('keeps emoji modifiers (variation selector, ZWJ, skin tone)', () => {
    expect(parseMeshCoreOneReaction('\u2764\ufe0f@[Bob]\nb45pc4ek')?.emoji).toBe('\u2764\ufe0f');
    expect(parseMeshCoreOneReaction('\u{1F44D}\u{1F3FD}\nb45pc4ek')?.emoji).toBe(
      '\u{1F44D}\u{1F3FD}'
    );
  });

  it('rejects non-reaction text', () => {
    expect(parseMeshCoreOneReaction('hello\nworld123')).toBeNull(); // no emoji
    expect(parseMeshCoreOneReaction('\u{1F44D}\nb45pc4e')).toBeNull(); // hash too short
    expect(parseMeshCoreOneReaction('\u{1F44D}\nb45pc4eu')).toBeNull(); // "u" not Crockford
    expect(parseMeshCoreOneReaction('\u{1F44D} b45pc4ek')).toBeNull(); // single line
    expect(parseMeshCoreOneReaction('\u{1F44D}@[Bob]\nb45pc4ek\nmore')).toBeNull();
    expect(parseMeshCoreOneReaction('r:1a2b:00')).toBeNull();
  });
});

describe('parseReactionV1 (older meshcore-open clients)', () => {
  it('parses r:<millis>_<nameHash>_<textHash>:<emoji>', () => {
    expect(parseReactionV1('r:1700000000123_12345_67890:👍')).toEqual({
      emoji: '👍',
      targetHash: '1700000000123_12345_67890',
    });
  });

  it('rejects non-emoji and malformed ids', () => {
    expect(parseReactionV1('r:1700000000123_12345_67890:ok')).toBeNull();
    expect(parseReactionV1('r:17000_12345:👍')).toBeNull();
    expect(parseReactionV1('r:1a2b:00')).toBeNull();
  });

  it('counts as a reaction payload, also behind a reply prefix', () => {
    expect(isReactionPayload('r:1700000000123_12345_67890:👍')).toBe(true);
    expect(isReactionPayload('@[Me] r:1700000000123_12345_67890:👍')).toBe(true);
  });
});
