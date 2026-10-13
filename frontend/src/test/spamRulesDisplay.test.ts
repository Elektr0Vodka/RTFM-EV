import { describe, expect, it } from 'vitest';

import type { SpamGuardRule } from '../types';
import { rulesForDisplay } from '../utils/spamRulesDisplay';

function botRule(channel: string, names: string[]): SpamGuardRule {
  return {
    id: `spam:bots:${channel}`,
    name: `spam:bots:${channel} (bot list)`,
    enabled: true,
    if: {
      all: [
        { field: 'payload_type', op: 'equals', value: 5 },
        { field: 'channel_hash', op: 'equals', value: channel },
        { field: 'channel_sender', op: 'in', value: names },
      ],
    },
    then: { action: 'drop' },
  };
}

const KNOWN: SpamGuardRule = {
  id: 'spam:known-people:11',
  name: 'spam:known-people:11',
  enabled: true,
  if: { all: [{ field: 'channel_sender', op: 'in', value: ['Dave', 'Sarah'] }] },
  then: { action: 'allow' },
};

const same = (count: number) => `same ${count} names`;

describe('rulesForDisplay', () => {
  it('prints a bot list once and refers to it in the rules after', () => {
    const names = ['[NU]', 'PingBot'];
    const shown = rulesForDisplay([botRule('11', names), botRule('22', names)], same);
    expect(shown[0]).toEqual(botRule('11', names));
    expect(shown[1]).toEqual({
      ...botRule('22', names),
      if: {
        all: [
          { field: 'payload_type', op: 'equals', value: 5 },
          { field: 'channel_hash', op: 'equals', value: '22' },
          { field: 'channel_sender', op: 'in', value: 'same 2 names' },
        ],
      },
    });
  });

  it('leaves every other rule as it is', () => {
    const rules = [KNOWN, botRule('11', ['[NU]']), KNOWN];
    expect(rulesForDisplay(rules, same)).toEqual(rules);
  });

  it('keeps a bot rule whose names differ from the first', () => {
    const rules = [botRule('11', ['[NU]']), botRule('22', ['Other'])];
    expect(rulesForDisplay(rules, same)).toEqual(rules);
  });

  it('does not change the rules it was given', () => {
    const rules = [botRule('11', ['[NU]']), botRule('22', ['[NU]'])];
    const copy = JSON.parse(JSON.stringify(rules));
    rulesForDisplay(rules, same);
    expect(rules).toEqual(copy);
  });
});
