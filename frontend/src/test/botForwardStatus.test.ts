import { describe, expect, it } from 'vitest';

import en from '../i18n/locales/en.json';
import type { TFn } from '../i18n';
import type { BotForwardState } from '../types';
import { botForwardStatusText } from '../utils/botForwardStatus';

const t = ((key: string, params?: Record<string, unknown>) => {
  const entry = (en as Record<string, unknown>)[key];
  const text =
    typeof entry === 'string'
      ? entry
      : (entry as Record<string, string>)[params?.count === 1 ? 'one' : 'other'];
  return text.replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? ''));
}) as unknown as TFn;

describe('botForwardStatusText', () => {
  it('counts the channels while active', () => {
    expect(botForwardStatusText(t, { state: 'active', channels: 1, names: 3 })).toBe(
      'Active on 1 channel'
    );
    expect(botForwardStatusText(t, { state: 'active', channels: 4, names: 3 })).toBe(
      'Active on 4 channels'
    );
  });

  it('names the reason it waits', () => {
    const cases: [BotForwardState, string][] = [
      ['off', 'Waiting: Spam Guard is off'],
      ['monitor', 'Waiting: Spam Guard is in Monitor'],
      ['paused', 'Waiting: Spam Guard is paused'],
      ['no_names', 'Waiting: no confirmed names to block'],
      ['rules_failed', 'Waiting: the rules could not be applied'],
      ['key_not_shared', 'Waiting: the channel key is not shared with the OpenHop node'],
      ['no_channels', 'Waiting: Spam Guard has no protected channels'],
      ['not_armed', 'Waiting: the host repeater is not armed'],
      ['not_synced', 'Waiting: the rules are not on the OpenHop node yet'],
    ];
    for (const [state, text] of cases) {
      expect(botForwardStatusText(t, { state, channels: 0, names: 1 })).toBe(text);
    }
  });
});
