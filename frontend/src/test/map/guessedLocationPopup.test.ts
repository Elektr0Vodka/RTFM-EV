import { describe, it, expect } from 'vitest';
import { buildGuessedLocationPopup } from '../../map/useGuessedLocations';
import type { GuessedLocation } from '../../map/guessedLocations';
import { CONTACT_TYPE_REPEATER, type Contact } from '../../types';

// Echo the key and params so the assertions read which line was chosen.
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as unknown as Parameters<
  typeof buildGuessedLocationPopup
>[2];

const repeater = {
  public_key: 'aabb0000',
  name: 'Repeater A',
  type: CONTACT_TYPE_REPEATER,
} as Contact;

const guess = (over: Partial<GuessedLocation>): GuessedLocation => ({
  public_key: 'target',
  lat: 52,
  lon: 5,
  anchors: [],
  highConfidence: false,
  ...over,
});

const lines = (el: HTMLElement) => Array.from(el.children).map((c) => c.textContent ?? '');

describe('buildGuessedLocationPopup', () => {
  it('names the local radio for a direct-only guess', () => {
    const el = buildGuessedLocationPopup(
      guess({ anchors: [{ public_key: 'self00', lat: 52, lon: 5, isSelf: true }] }),
      [repeater],
      t,
      'My Radio'
    );
    const text = lines(el);
    expect(text).toContain('map_guessed_locations_anchor_self {"name":"My Radio"}');
    expect(text).toContain('map_guessed_locations_confidence_low_self');
    expect(text.some((l) => l.startsWith('map_guessed_locations_anchor_one'))).toBe(false);
  });

  it('lists the local radio and the repeaters separately', () => {
    const el = buildGuessedLocationPopup(
      guess({
        anchors: [
          { public_key: 'self00', lat: 52, lon: 5, isSelf: true },
          { public_key: 'aabb0000', lat: 52, lon: 5 },
        ],
        highConfidence: true,
      }),
      [repeater],
      t,
      'My Radio'
    );
    const text = lines(el);
    expect(text).toContain('map_guessed_locations_anchor_self {"name":"My Radio"}');
    expect(text).toContain('map_guessed_locations_anchor_one {"name":"Repeater A"}');
    expect(text).toContain('map_guessed_locations_confidence_high');
  });

  it('keeps the repeater-only wording when not heard direct', () => {
    const el = buildGuessedLocationPopup(
      guess({ anchors: [{ public_key: 'aabb0000', lat: 52, lon: 5 }] }),
      [repeater],
      t
    );
    const text = lines(el);
    expect(text).toContain('map_guessed_locations_anchor_one {"name":"Repeater A"}');
    expect(text).toContain('map_guessed_locations_confidence_low');
    expect(text.some((l) => l.startsWith('map_guessed_locations_anchor_self'))).toBe(false);
  });
});
