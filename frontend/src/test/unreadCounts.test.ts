/**
 * Tests for the messageContainsMention utility function.
 *
 * The unread counting and lookup logic (shouldIncrementUnread, getUnreadCount)
 * is tested through component-level and integration tests rather than
 * re-implementing the logic locally. See appFavorites.test.tsx, sidebar.test.tsx,
 * and integration.test.ts for those paths.
 */

import { describe, it, expect } from 'vitest';
import { messageContainsMention } from '../utils/messageParser';

describe('messageContainsMention', () => {
  it('returns true when text contains mention of the name', () => {
    expect(messageContainsMention('Hey @[Alice] check this out', 'Alice')).toBe(true);
  });

  it('returns false when text does not contain the mention', () => {
    expect(messageContainsMention('Hey Alice check this out', 'Alice')).toBe(false);
  });

  it('returns false when name is null', () => {
    expect(messageContainsMention('Hey @[Alice] check this out', null)).toBe(false);
  });

  it('returns false when text is empty', () => {
    expect(messageContainsMention('', 'Alice')).toBe(false);
  });

  it('matches case insensitively', () => {
    expect(messageContainsMention('Hey @[ALICE] check this out', 'alice')).toBe(true);
    expect(messageContainsMention('Hey @[alice] check this out', 'ALICE')).toBe(true);
  });

  it('handles emojis in names', () => {
    expect(messageContainsMention('Hey @[FlightlessDt🥝] nice!', 'FlightlessDt🥝')).toBe(true);
    expect(messageContainsMention('Hey @[🎉Party🎉]', '🎉Party🎉')).toBe(true);
  });

  it('handles special regex characters in names', () => {
    expect(messageContainsMention('Hey @[Test.User] hello', 'Test.User')).toBe(true);
    expect(messageContainsMention('Hey @[User+1] hello', 'User+1')).toBe(true);
    expect(messageContainsMention('Hey @[User*Star] hello', 'User*Star')).toBe(true);
    expect(messageContainsMention('Hey @[What?] hello', 'What?')).toBe(true);
  });

  it('does not match partial names', () => {
    expect(messageContainsMention('Hey @[Alice] check this', 'Ali')).toBe(false);
  });

  it('handles mention at start of text', () => {
    expect(messageContainsMention('@[Bob] hello there', 'Bob')).toBe(true);
  });

  it('handles mention at end of text', () => {
    expect(messageContainsMention('hello @[Bob]', 'Bob')).toBe(true);
  });

  it('handles multiple mentions - matches if user is mentioned', () => {
    expect(messageContainsMention('@[Alice] and @[Bob] should see this', 'Alice')).toBe(true);
    expect(messageContainsMention('@[Alice] and @[Bob] should see this', 'Bob')).toBe(true);
    expect(messageContainsMention('@[Alice] and @[Bob] should see this', 'Charlie')).toBe(false);
  });
});

describe('messageContainsMention ignores reactions', () => {
  it('does not treat a channel reaction ("@[Name]emoji\nhash") as a mention', () => {
    expect(messageContainsMention('Bob: @[Alice]👍\nABCD1234', 'Alice')).toBe(false);
  });

  it('does not treat the emoji-first reaction order as a mention', () => {
    expect(messageContainsMention('Bob: 🔥@[Alice]\nABCD1234', 'Alice')).toBe(false);
  });

  it('does not treat a reply-prefixed r: reaction as a mention', () => {
    expect(messageContainsMention('Bob: @[Alice] r:1a2b:00', 'Alice')).toBe(false);
  });

  it('still treats an ordinary two-line message with a mention as a mention', () => {
    expect(messageContainsMention('Bob: @[Alice] look\nat this', 'Alice')).toBe(true);
  });
});
