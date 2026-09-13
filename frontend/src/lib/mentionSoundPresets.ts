// Single source of truth for bundled mention-sound presets. Files live in
// frontend/public/sounds/<id>.mp3 and are referenced by relative path.
export const MENTION_SOUND_PRESET_IDS = ['beep', 'bingbong', 'bong', 'tuduludu', 'uh-oh'] as const;

export type MentionSoundPresetId = (typeof MENTION_SOUND_PRESET_IDS)[number];

export const DEFAULT_MENTION_SOUND_PRESET: MentionSoundPresetId = 'beep';

export function isMentionSoundPreset(id: string): id is MentionSoundPresetId {
  return (MENTION_SOUND_PRESET_IDS as readonly string[]).includes(id);
}

/** Resolve a settings `mention_sound_choice` to a playable URL.
 *  Presets resolve to the bundled file; 'custom' resolves to the API endpoint
 *  with a cache-busting version derived from the custom sound's updated_at. */
export function mentionSoundUrl(choice: string, customVersion?: number | null): string {
  if (choice === 'custom') {
    const v = customVersion ? `?v=${customVersion}` : '';
    return `./api/settings/mention-sound${v}`;
  }
  const id = isMentionSoundPreset(choice) ? choice : DEFAULT_MENTION_SOUND_PRESET;
  return `./sounds/${id}.mp3`;
}
