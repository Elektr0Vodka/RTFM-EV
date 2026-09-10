/**
 * Parsing for rich-chat payloads sent by MeshCore Open clients as ordinary
 * plaintext mesh messages.
 *
 * MeshCore Open encodes some rich features into the message body with a short
 * prefix. RemoteTerm recognizes two of them for display:
 *
 *   g:<gifId>        Giphy GIF        -> https://media.giphy.com/media/<id>/giphy.gif
 *   r:<hash>:<index> Emoji reaction   -> <index> picks an emoji from a fixed list
 *
 * Formats and the emoji table are ported verbatim from meshcore-open:
 *   lib/helpers/gif_helper.dart
 *   lib/helpers/reaction_helper.dart
 *   lib/widgets/emoji_picker.dart
 * (github.com/zjs81/meshcore-open, dev branch).
 *
 * Reaction support here is intentionally "generic display only": we decode the
 * emoji from <index> and show it, but we do NOT resolve <hash> back to the
 * target message (that requires porting Dart's String.hashCode). See issue #291.
 *
 * A third payload, the location marker `m:<lat>,<lon>|<label>|<flags>`, is
 * ported at the bottom of this file (see meshcore-open lib/screens/map_screen.dart
 * _formatMarkerMessage / parseMarkerText).
 */

import { isValidLocation } from './pathUtils';

// --- Emoji table (order must match meshcore-open exactly for index compat) ---

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🔥'];

// prettier-ignore
const SMILEYS = [
  '😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂',
  '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋',
  '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩',
  '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖',
  '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯',
  '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔',
  '🤭', '🤫', '🤥', '😶',
];

// prettier-ignore
const GESTURES = [
  '👍', '👎', '👊', '✊', '🤛', '🤜', '🤞', '✌️', '🤟', '🤘',
  '👌', '🤌', '🤏', '👈', '👉', '👆', '👇', '☝️', '👋', '🤚',
  '🖐️', '✋', '🖖', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️',
  '💅', '🤳', '💪',
];

// prettier-ignore
const HEARTS = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
  '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟',
  '💌', '💢', '💥', '💫', '💦', '💨', '🕳️', '💬', '👁️‍🗨️', '🗨️',
  '🗯️', '💭',
];

// prettier-ignore
const OBJECTS = [
  '🎉', '🎊', '🎈', '🎁', '🎀', '🪅', '🪆', '🏆', '🥇', '🥈',
  '🥉', '⚽', '⚾', '🥎', '🏀', '🏐', '🏈', '🏉', '🎾', '🥏',
  '🎳', '🏏', '🏑', '🏒', '🥍', '🏓', '🏸', '🥊', '🥋', '🥅',
  '⛳', '🔥', '⭐', '🌟', '✨', '⚡', '💡', '🔦', '🏮', '🪔',
  '📱', '💻', '⌚', '📷', '📺', '📻', '🎵', '🎶', '🚀',
];

/** Combined reaction emoji list, in the fixed index order used on the wire. */
export const REACTION_EMOJIS: readonly string[] = [
  ...QUICK_EMOJIS,
  ...SMILEYS,
  ...GESTURES,
  ...HEARTS,
  ...OBJECTS,
];

// --- GIF (g:<gifId>) ---

const GIF_PATTERN = /^g:([A-Za-z0-9_-]+)$/;

/**
 * Parse a MeshCore Open GIF payload. Returns the Giphy GIF id, or null if the
 * (trimmed) text is not a `g:<id>` payload.
 */
export function parseGif(text: string): string | null {
  const match = GIF_PATTERN.exec(text.trim());
  return match ? match[1] : null;
}

/** Build the Giphy media URL for a GIF id. */
export function giphyUrlForId(gifId: string): string {
  return `https://media.giphy.com/media/${gifId}/giphy.gif`;
}

// --- Reaction (r:<hash>:<index>) ---

const REACTION_PATTERN = /^r:([0-9a-f]{4}):([0-9a-f]{2})$/;

export interface ParsedReaction {
  /** The decoded reaction emoji. */
  emoji: string;
  /** 4-hex hash identifying the target message (not resolved here). */
  targetHash: string;
}

/**
 * Parse a MeshCore Open reaction payload. Returns the decoded emoji and the
 * (unresolved) target-message hash, or null if the (trimmed) text is not a
 * valid `r:<hash>:<index>` payload or the index is out of range.
 */
export function parseReaction(text: string): ParsedReaction | null {
  const match = REACTION_PATTERN.exec(text.trim());
  if (!match) return null;
  const index = parseInt(match[2], 16);
  if (!Number.isInteger(index) || index < 0 || index >= REACTION_EMOJIS.length) {
    return null;
  }
  return { emoji: REACTION_EMOJIS[index], targetHash: match[1] };
}

// --- Reply-mention prefix (@[senderName] <payload>) ---

// meshcore-open prefixes replies with "@[senderName] " before the message body
// (see meshcore-open channels.md / BLE_PROTOCOL.md). Its own display code strips
// that prefix before parsing rich payloads, so a GIF/reaction reply arrives on
// the wire as "@[Name] g:<id>". parseGif/parseReaction stay strict (whole-body
// only); this splits the reply prefix off so the remainder can be parsed.
const REPLY_MENTION_PREFIX = /^(@\[[^\]]+\])\s+([\s\S]+)$/;

export interface SplitReplyMention {
  /** The leading "@[Name]" reply-mention token. */
  mention: string;
  /** The message remainder after the reply-mention prefix. */
  body: string;
}

/**
 * Split a leading meshcore-open reply mention ("@[Name] ") off the text, or
 * return null when there is no such prefix.
 */
export function splitReplyMention(text: string): SplitReplyMention | null {
  const match = REPLY_MENTION_PREFIX.exec(text.trim());
  if (!match) return null;
  return { mention: match[1], body: match[2] };
}

// --- Location marker (m:<lat>,<lon>|<label>|<flags>) ---
//
// MeshCore Open shares a location as this plaintext payload (see meshcore-open
// lib/screens/map_screen.dart _formatMarkerMessage / parseMarkerText). The flag
// "poi" marks a shared point of interest. Coordinates use 6 decimals.

// Anchored whole-body match (like parseGif/parseReaction). Both pipes required;
// the label (group 3) cannot contain a pipe.
const MARKER_PATTERN = /^m:(-?[0-9.]+),(-?[0-9.]+)\|([^|]*)\|(.*)$/;

export interface ParsedMarker {
  lat: number;
  lon: number;
  label: string;
  flags: string;
}

/** Remove pipe characters (they delimit the payload) and trim. */
export function sanitizeMarkerLabel(label: string): string {
  return label.replace(/\|/g, '').trim();
}

/** Build a MeshCore Open location marker payload: `m:<lat>,<lon>|<label>|poi`. */
export function buildMarkerPayload(lat: number, lon: number, label: string): string {
  return `m:${lat.toFixed(6)},${lon.toFixed(6)}|${sanitizeMarkerLabel(label)}|poi`;
}

/**
 * Parse a MeshCore Open location marker payload. Returns the coordinates, label,
 * and flags, or null when the (trimmed) text is not a valid marker or the
 * coordinates are out of range / unset (0,0).
 */
export function parseMarker(text: string): ParsedMarker | null {
  const match = MARKER_PATTERN.exec(text.trim());
  if (!match) return null;
  const lat = Number.parseFloat(match[1]);
  const lon = Number.parseFloat(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !isValidLocation(lat, lon)) {
    return null;
  }
  return { lat, lon, label: match[3].trim(), flags: match[4].trim() };
}
