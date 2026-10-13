import { describe, expect, it } from 'vitest';

import type { TFn } from '../i18n';
import { botListErrorText } from '../utils/botListErrors';

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}|${JSON.stringify(params)}` : key) as unknown as TFn;

describe('botListErrorText', () => {
  it('maps a known code to its string', () => {
    expect(botListErrorText(t, 'not_https')).toBe('bot_list_error_not_https');
    expect(botListErrorText(t, 'unsafe_url')).toBe('bot_list_error_unsafe_url');
    expect(botListErrorText(t, 'over_limit')).toBe('bot_list_error_over_limit');
    expect(botListErrorText(t, 'host_not_found')).toBe('bot_list_error_host_not_found');
    expect(botListErrorText(t, 'already_subscribed')).toBe('bot_list_error_already_subscribed');
    expect(botListErrorText(t, 'too_many_subscriptions')).toBe(
      'bot_list_error_too_many_subscriptions'
    );
    expect(botListErrorText(t, 'too_many_entries')).toBe('bot_list_error_too_many_entries');
  });

  it('passes the format message of an invalid file on', () => {
    expect(botListErrorText(t, 'invalid_file: unsupported bot list version 2')).toBe(
      'bot_list_error_invalid_file|{"message":"unsupported bot list version 2"}'
    );
  });

  it('leaves text it does not know as it is', () => {
    expect(botListErrorText(t, 'That URL is already subscribed')).toBe(
      'That URL is already subscribed'
    );
    expect(botListErrorText(t, 'the file is not valid JSON')).toBe('the file is not valid JSON');
    expect(botListErrorText(t, 'constructor')).toBe('constructor');
    expect(botListErrorText(t, 'toString')).toBe('toString');
  });
});
