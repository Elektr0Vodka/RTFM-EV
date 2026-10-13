import type { TFn } from '../i18n';

/**
 * The codes the filter library answers with (`app/filter_profiles/format.py`,
 * `app/services/filter_profiles.py`, `app/services/filter_profile_spam.py`).
 * A Map, so an error text that happens to be an Object property name
 * ("constructor") is not taken for a code.
 */
const TEXT = new Map<string, (t: TFn) => string>([
  ['too_large', (t) => t('filter_profile_error_too_large')],
  ['not_json', (t) => t('filter_profile_error_not_json')],
  ['not_a_profile', (t) => t('filter_profile_error_not_a_profile')],
  ['unsupported_version', (t) => t('filter_profile_error_unsupported_version')],
  ['unknown_kind', (t) => t('filter_profile_error_unknown_kind')],
  ['too_many_profiles', (t) => t('filter_profile_error_too_many_profiles')],
  ['not_found', (t) => t('filter_profile_error_not_found')],
  ['needs_confirm', (t) => t('filter_profile_error_needs_confirm')],
  ['conflict', (t) => t('filter_profile_error_conflict')],
  ['openhop_starts_at', (t) => t('filter_profile_error_openhop_starts_at')],
  // Not from the server: the browser could not read the picked file.
  ['unreadable_file', (t) => t('filter_profile_error_unreadable_file')],
]);

/** Codes that come as `code: message`; the message says what is wrong. */
const WITH_MESSAGE = new Map<string, (t: TFn, message: string) => string>([
  ['invalid_file', (t, message) => t('filter_profile_error_invalid_file', { message })],
  ['invalid_profile', (t, message) => t('filter_profile_error_invalid_profile', { message })],
]);

/**
 * Text for a filter library error: a known code becomes its translated
 * sentence, and anything else (a validation message the server already
 * worded, a network failure) is shown as it is.
 */
export function filterProfileErrorText(t: TFn, raw: string): string {
  const split = raw.indexOf(': ');
  if (split !== -1) {
    const withMessage = WITH_MESSAGE.get(raw.slice(0, split));
    if (withMessage) return withMessage(t, raw.slice(split + 2));
  }
  const known = TEXT.get(raw);
  return known ? known(t) : raw;
}
