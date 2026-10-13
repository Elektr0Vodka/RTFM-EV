import { describe, expect, it } from 'vitest';

import type { TFn } from '../i18n';
import { filterProfileErrorText } from '../utils/filterProfileErrors';

// A stand-in that shows which key and which parameters were asked for.
const t: TFn = (key, params) => (params ? `${key}|${JSON.stringify(params)}` : key);

describe('filterProfileErrorText', () => {
  it.each([
    'too_large',
    'not_json',
    'not_a_profile',
    'unsupported_version',
    'unknown_kind',
    'too_many_profiles',
    'not_found',
    'needs_confirm',
    'conflict',
    'openhop_starts_at',
    'unreadable_file',
  ])('words the code %s', (code) => {
    expect(filterProfileErrorText(t, code)).toBe(`filter_profile_error_${code}`);
  });

  it('keeps the message of a file that fails validation', () => {
    expect(filterProfileErrorText(t, 'invalid_file: payload: mode: Field required')).toBe(
      'filter_profile_error_invalid_file|{"message":"payload: mode: Field required"}'
    );
  });

  it('keeps the message of a stored profile that no longer fits', () => {
    expect(filterProfileErrorText(t, 'invalid_profile: similarity: too low')).toBe(
      'filter_profile_error_invalid_profile|{"message":"similarity: too low"}'
    );
  });

  it('shows anything else as it is', () => {
    expect(filterProfileErrorText(t, 'Failed to fetch')).toBe('Failed to fetch');
    expect(filterProfileErrorText(t, 'name: String should have at most 64 characters')).toBe(
      'name: String should have at most 64 characters'
    );
    // A text that happens to be an Object property name is not a code.
    expect(filterProfileErrorText(t, 'constructor')).toBe('constructor');
  });
});
