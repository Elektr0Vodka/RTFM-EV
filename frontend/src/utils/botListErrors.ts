import type { TFn } from '../i18n';

/**
 * The codes `app/services/bot_list_fetch.py`, the refresh and the refusals of
 * `app/services/bot_lists.py` can answer with.
 * A Map, so an error text that happens to be an Object property name
 * ("constructor") is not taken for a code.
 */
const TEXT = new Map<string, (t: TFn) => string>([
  ['not_https', (t) => t('bot_list_error_not_https')],
  ['bad_url', (t) => t('bot_list_error_bad_url')],
  ['unsafe_url', (t) => t('bot_list_error_unsafe_url')],
  ['fetch_failed', (t) => t('bot_list_error_fetch_failed')],
  ['http_error', (t) => t('bot_list_error_http_error')],
  ['too_large', (t) => t('bot_list_error_too_large')],
  ['too_many_redirects', (t) => t('bot_list_error_too_many_redirects')],
  ['over_limit', (t) => t('bot_list_error_over_limit')],
  ['host_not_found', (t) => t('bot_list_error_host_not_found')],
  ['already_subscribed', (t) => t('bot_list_error_already_subscribed')],
  ['too_many_subscriptions', (t) => t('bot_list_error_too_many_subscriptions')],
  ['too_many_entries', (t) => t('bot_list_error_too_many_entries')],
]);

/**
 * Text for a bot list error: a known code becomes its translated sentence,
 * `invalid_file: <message>` keeps the message about the file, and anything
 * else (a refusal the server already worded) is shown as it is.
 */
export function botListErrorText(t: TFn, raw: string): string {
  const split = raw.indexOf(': ');
  if (split !== -1 && raw.slice(0, split) === 'invalid_file') {
    return t('bot_list_error_invalid_file', { message: raw.slice(split + 2) });
  }
  const known = TEXT.get(raw);
  return known ? known(t) : raw;
}
