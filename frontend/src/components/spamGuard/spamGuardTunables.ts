import type { SpamGuardTunables } from '../../types';

export type TunableKey = keyof SpamGuardTunables;

export type TunableSpec =
  | { key: TunableKey; type: 'bool' }
  | {
      key: TunableKey;
      type: 'int';
      min: number;
      max: number;
      unit?: 'seconds' | 'days' | 'percent';
    }
  | { key: TunableKey; type: 'choice'; choices: string[] }
  | { key: TunableKey; type: 'patterns' };

export interface TunableGroup {
  /** i18n key of the group heading. */
  titleKey: string;
  items: TunableSpec[];
}

/**
 * Every tunable the Settings tab offers, grouped as in openhop-spamguard. The
 * bounds repeat the backend's (`app/spam/settings.py`), which validates again.
 * Labels live in the locale files as `spam_set_<key>_label`, `_help` and
 * `_risk` (the "watch out" note on a setting's side effects).
 */
export const TUNABLE_GROUPS: TunableGroup[] = [
  {
    titleKey: 'spam_group_repeater',
    items: [
      { key: 'enable_hop_rules', type: 'bool' },
      {
        key: 'hop_match_mode',
        type: 'choice',
        choices: ['contains_known', 'exact_paths', 'contains', 'starts_at'],
      },
      { key: 'hop_random_senders', type: 'int', min: 1, max: 100 },
      { key: 'hop_new_senders', type: 'int', min: 2, max: 200 },
      { key: 'hop_campaign_senders', type: 'int', min: 2, max: 100 },
      { key: 'hop_random_senders_long', type: 'int', min: 2, max: 500 },
      { key: 'enable_rotation_guard', type: 'bool' },
      { key: 'rotate_first_hops', type: 'int', min: 2, max: 50 },
      { key: 'route_memory_days', type: 'int', min: 1, max: 60, unit: 'days' },
      { key: 'max_paths_per_hop', type: 'int', min: 1, max: 500 },
      { key: 'max_origins_per_route', type: 'int', min: 1, max: 500 },
    ],
  },
  {
    titleKey: 'spam_group_text',
    items: [
      { key: 'enable_text_rules', type: 'bool' },
      { key: 'text_distinct_senders', type: 'int', min: 2, max: 50 },
      { key: 'similarity', type: 'int', min: 30, max: 100, unit: 'percent' },
      { key: 'min_rule_chars', type: 'int', min: 8, max: 80 },
    ],
  },
  {
    titleKey: 'spam_group_duplicates',
    items: [
      { key: 'dedupe_enabled', type: 'bool' },
      { key: 'dedupe_seconds', type: 'int', min: 30, max: 86400, unit: 'seconds' },
      { key: 'dedupe_min_chars', type: 'int', min: 10, max: 150 },
      { key: 'text_rule_chars', type: 'int', min: 10, max: 150 },
    ],
  },
  {
    titleKey: 'spam_group_known',
    items: [
      { key: 'known_min_msgs', type: 'int', min: 1, max: 20 },
      { key: 'known_days', type: 'int', min: 1, max: 365, unit: 'days' },
      { key: 'hold_links', type: 'choice', choices: ['campaign', 'always', 'off'] },
    ],
  },
  {
    titleKey: 'spam_group_names',
    items: [
      { key: 'name_score_threshold', type: 'int', min: 1, max: 6 },
      { key: 'random_name_patterns', type: 'patterns' },
    ],
  },
  {
    titleKey: 'spam_group_timing',
    items: [
      { key: 'window_seconds', type: 'int', min: 60, max: 86400, unit: 'seconds' },
      { key: 'long_window_seconds', type: 'int', min: 600, max: 86400, unit: 'seconds' },
      { key: 'block_ttl_seconds', type: 'int', min: 300, max: 315360000, unit: 'seconds' },
      { key: 'hop_block_ttl_seconds', type: 'int', min: 600, max: 315360000, unit: 'seconds' },
      { key: 'spam_text_days', type: 'int', min: 0, max: 60, unit: 'days' },
      { key: 'max_total_rules', type: 'int', min: 20, max: 2000 },
    ],
  },
  {
    titleKey: 'spam_group_evidence',
    items: [
      { key: 'evidence_log', type: 'bool' },
      { key: 'evidence_days', type: 'int', min: 1, max: 30, unit: 'days' },
    ],
  },
];

export const UNIT_KEYS: Record<'seconds' | 'days' | 'percent', string> = {
  seconds: 'spam_unit_seconds',
  days: 'spam_unit_days',
  percent: 'spam_unit_percent',
};
