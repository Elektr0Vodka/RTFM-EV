import type { SpamGuardRule } from '../types';

/** Ending of the rule names a bot list asks for (`BOT_LIST_ORIGIN` in `app/spam/rules.py`). */
const BOT_LIST_ENDING = '(bot list)';

/**
 * The rules as "Show rules" prints them. On the host repeater a bot list rule
 * carries its names inline, the same list once per protected channel; the
 * list is printed in the first such rule and the ones after say it is the same.
 * Everything else is shown as it is, and the input is not changed.
 */
export function rulesForDisplay(
  rules: SpamGuardRule[],
  sameNames: (count: number) => string
): unknown[] {
  let first: string | null = null;
  return rules.map((rule) => {
    if (!rule.name.endsWith(BOT_LIST_ENDING)) return rule;
    return {
      ...rule,
      if: {
        all: rule.if.all.map((condition) => {
          const { field, op, value } = condition;
          if (field !== 'channel_sender' || op !== 'in' || !Array.isArray(value)) return condition;
          const names = JSON.stringify(value);
          if (first === null) {
            first = names;
            return condition;
          }
          return names === first ? { ...condition, value: sameNames(value.length) } : condition;
        }),
      },
    };
  });
}
