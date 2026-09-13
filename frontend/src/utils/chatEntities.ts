// Pure detectors for chat entities. Each returns non-overlapping matches with
// absolute [start, end) offsets into the input text. Used by tokenizeMessageText.

import { findLinkedChannelReferences } from './messageParser';

export interface PubkeyMatch {
  value: string;
  start: number;
  end: number;
}

export interface CoordinateMatch {
  lat: number;
  lon: number;
  start: number;
  end: number;
  raw: string;
}

// Exactly 64 hex chars not adjacent to more hex (so a 128-hex blob is not two keys).
const PUBKEY_PATTERN = /(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/g;

// A decimal lat,lon pair. Both numbers must have a fractional part to avoid
// matching scores/versions. Covers bare, PREFIX:lat,lon, and geo: forms, since
// each contains a decimal pair.
const COORD_PATTERN = /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/g;

export function findPubkeys(text: string): PubkeyMatch[] {
  const out: PubkeyMatch[] = [];
  PUBKEY_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PUBKEY_PATTERN.exec(text)) !== null) {
    out.push({ value: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function findCoordinates(text: string): CoordinateMatch[] {
  const out: CoordinateMatch[] = [];
  COORD_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COORD_PATTERN.exec(text)) !== null) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    out.push({ lat, lon, start: m.index, end: m.index + m[0].length, raw: m[0] });
  }
  return out;
}

export type ChatToken =
  | { kind: 'text'; value: string }
  | { kind: 'mention'; name: string }
  | { kind: 'url'; value: string }
  | { kind: 'hashtag'; label: string }
  | { kind: 'pubkey'; value: string }
  | { kind: 'coordinate'; lat: number; lon: number; raw: string };

export interface TokenizeOptions {
  parsePubkeys: boolean;
  parseCoordinates: boolean;
  linkifyUrls: boolean;
}

// Same URL pattern MessageList used historically (kept in sync here).
const URL_PATTERN =
  /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/g;
const MENTION_PATTERN = /@\[([^\]]+)\]/g;

interface RawMatch {
  start: number;
  end: number;
  priority: number; // lower wins on same start
  make: () => ChatToken;
}

// Split message text into ordered, non-overlapping typed tokens. One scan per
// entity kind; matches are sorted by position (priority breaks ties on the same
// start) and accepted greedily so a higher-priority entity wins an overlap
// (e.g. a URL that contains a coordinate). Mentions and hashtags are always
// parsed; url/pubkey/coordinate parsing follows the toggles.
export function tokenizeMessageText(text: string, opts: TokenizeOptions): ChatToken[] {
  const raw: RawMatch[] = [];

  MENTION_PATTERN.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = MENTION_PATTERN.exec(text)) !== null) {
    const name = mm[1];
    raw.push({
      start: mm.index,
      end: mm.index + mm[0].length,
      priority: 0,
      make: () => ({ kind: 'mention', name }),
    });
  }

  if (opts.linkifyUrls) {
    URL_PATTERN.lastIndex = 0;
    let um: RegExpExecArray | null;
    while ((um = URL_PATTERN.exec(text)) !== null) {
      const value = um[0];
      raw.push({
        start: um.index,
        end: um.index + value.length,
        priority: 1,
        make: () => ({ kind: 'url', value }),
      });
    }
  }

  if (opts.parseCoordinates) {
    for (const c of findCoordinates(text)) {
      raw.push({
        start: c.start,
        end: c.end,
        priority: 2,
        make: () => ({ kind: 'coordinate', lat: c.lat, lon: c.lon, raw: c.raw }),
      });
    }
  }

  if (opts.parsePubkeys) {
    for (const k of findPubkeys(text)) {
      raw.push({
        start: k.start,
        end: k.end,
        priority: 3,
        make: () => ({ kind: 'pubkey', value: k.value }),
      });
    }
  }

  for (const ref of findLinkedChannelReferences(text)) {
    raw.push({
      start: ref.start,
      end: ref.end,
      priority: 4,
      make: () => ({ kind: 'hashtag', label: ref.label }),
    });
  }

  raw.sort((a, b) => a.start - b.start || a.priority - b.priority);

  const tokens: ChatToken[] = [];
  let cursor = 0;
  for (const match of raw) {
    if (match.start < cursor) continue; // overlaps an already-accepted match
    if (match.start > cursor) {
      tokens.push({ kind: 'text', value: text.slice(cursor, match.start) });
    }
    tokens.push(match.make());
    cursor = match.end;
  }
  if (cursor < text.length) {
    tokens.push({ kind: 'text', value: text.slice(cursor) });
  }
  return tokens;
}
