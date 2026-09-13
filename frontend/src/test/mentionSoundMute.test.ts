import { describe, it, expect, beforeEach } from 'vitest';
import { isConversationSoundMuted, toggleConversationSoundMuted } from '../lib/mentionSoundMute';

describe('mentionSoundMute', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to not muted', () => {
    expect(isConversationSoundMuted('channel', 'abc')).toBe(false);
  });

  it('toggles on and off and persists', () => {
    expect(toggleConversationSoundMuted('contact', 'k1')).toBe(true);
    expect(isConversationSoundMuted('contact', 'k1')).toBe(true);
    expect(toggleConversationSoundMuted('contact', 'k1')).toBe(false);
    expect(isConversationSoundMuted('contact', 'k1')).toBe(false);
  });

  it('keys channels and contacts separately', () => {
    toggleConversationSoundMuted('channel', 'x');
    expect(isConversationSoundMuted('channel', 'x')).toBe(true);
    expect(isConversationSoundMuted('contact', 'x')).toBe(false);
  });
});
