import { describe, expect, it } from 'vitest';
import type { TFn } from '../i18n';
import de from '../i18n/locales/de.json';
import en from '../i18n/locales/en.json';
import nl from '../i18n/locales/nl.json';
import {
  buildCsv,
  buildJsonReport,
  buildSummaryText,
  channelsCsv,
  createScrambler,
  filterStatsFilename,
  percent,
  scrambleReport,
  sendersCsv,
  sourcesCsv,
  type FilterStatsReport,
} from '../utils/filterStatsReport';

const PUBLIC = '8B3387E9C5CDEA6AC9E5EDBAA115CD72';
const FAMILY = 'EE'.repeat(16);
const counts = { messages: 0, spam: 0, malformed: 0, duplicate: 0, bot_now: 0, flagged: 0 };

const REPORT: FilterStatsReport = {
  window: { start_ts: 0, end_ts: 1800, bucket_seconds: 900, channel: null },
  totals: {
    ...counts,
    messages: 40,
    spam: 10,
    malformed: 4,
    duplicate: 2,
    bot_now: 8,
    flagged: 20,
    malformed_text: 3,
    malformed_clock: 1,
    malformed_both: 0,
    malformed_unknown: 0,
    bot_flagged: 6,
    bot_listed_later: 2,
    bot_no_longer_listed: 0,
    multi_flag: 4,
  },
  series: [
    { ...counts, bucket_ts: 0, messages: 30, spam: 9 },
    { ...counts, bucket_ts: 900, messages: 10, spam: 1 },
  ],
  senders: [
    {
      ...counts,
      name: 'UD6DWREK',
      public_key: 'cd'.repeat(32),
      messages: 10,
      spam: 10,
      flagged: 10,
      bot_flagged: 0,
      bot_lists: [],
      channels: 1,
      first_seen: 100,
      last_seen: 900,
    },
    {
      ...counts,
      name: 'PingBot',
      public_key: null,
      messages: 8,
      bot_now: 8,
      flagged: 8,
      bot_flagged: 6,
      bot_lists: ['Mine', 'Shared'],
      channels: 2,
      first_seen: 50,
      last_seen: 1700,
    },
  ],
  senders_truncated: false,
  channels: [
    { ...counts, key: PUBLIC, name: 'Public', public: true, messages: 30, flagged: 15 },
    { ...counts, key: FAMILY, name: 'Family', public: false, messages: 10, flagged: 5 },
  ],
  sources: [
    { ...counts, hop: '27', messages: 12, spam: 10, flagged: 10, last_seen: 900 },
    { ...counts, hop: 'DIRECT', messages: 3, malformed: 3, flagged: 3, last_seen: 400 },
  ],
  sources_truncated: false,
  filters: {
    analysed: 30,
    clean: 18,
    stopped: 9,
    let_through: 3,
    held: 0,
    enforced: 0,
    not_enforced: 9,
    stop_rate: 75,
    blocks: [{ source: 'campaign', count: 9 }],
    confirmed: 1,
    missed: 0,
    false_positive: 0,
    flagged_later: 1,
    not_recorded: 10,
  },
  policy_rules: [],
  spam_guard_enabled: true,
  bot_lists_enabled: true,
  app_version: '3.18.0-EV.0.2',
};

const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key) as TFn;

describe('scrambleReport', () => {
  it('replaces sender names with stable codes and removes their keys', () => {
    const scrambler = createScrambler();
    const first = scrambleReport(REPORT, scrambler);
    const second = scrambleReport(REPORT, scrambler);
    expect(first.senders[0].name).toMatch(/^user-[0-9a-f]{8}$/);
    expect(first.senders[0].name).not.toBe(first.senders[1].name);
    expect(second.senders[0].name).toBe(first.senders[0].name);
    expect(first.senders.every((sender) => sender.public_key === null)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('UD6DWREK');
    expect(JSON.stringify(first)).not.toContain('PingBot');
  });

  it('gives a different code in another session', () => {
    const one = scrambleReport(REPORT, createScrambler()).senders[0].name;
    const two = scrambleReport(REPORT, createScrambler()).senders[0].name;
    expect(one).not.toBe(two);
  });

  it('keeps public channel names and codes the others', () => {
    const out = scrambleReport(REPORT, createScrambler());
    expect(out.channels[0].name).toBe('Public');
    expect(out.channels[1].name).toMatch(/^channel-[0-9a-f]{8}$/);
  });

  it('leaves the numbers, the repeaters and the original report alone', () => {
    const out = scrambleReport(REPORT, createScrambler());
    expect(out.totals).toEqual(REPORT.totals);
    expect(out.sources).toEqual(REPORT.sources);
    expect(REPORT.senders[0].name).toBe('UD6DWREK');
  });

  it('keeps an empty sender name empty', () => {
    const withUnknown = { ...REPORT, senders: [{ ...REPORT.senders[0], name: '' }] };
    expect(scrambleReport(withUnknown, createScrambler()).senders[0].name).toBe('');
  });

  it('codes rule names the user wrote and keeps the ones Spam Guard made', () => {
    // A rule on an OpenHop node is named by whoever wrote it, and can name a person.
    const withRules = {
      ...REPORT,
      policy_rules: [
        { action: 'drop', rule: 'block-Piet', packets: 4 },
        { action: 'allow', rule: 'rtfm-spam:known-people:Public', packets: 3 },
        { action: 'drop', rule: null, packets: 2 },
        { action: 'log_only', rule: 'block-Piet', packets: 1 },
      ],
    };
    const out = scrambleReport(withRules, createScrambler());
    expect(out.policy_rules[0].rule).toMatch(/^rule-[0-9a-f]{8}$/);
    expect(out.policy_rules[3].rule).toBe(out.policy_rules[0].rule);
    expect(out.policy_rules[1].rule).toBe('rtfm-spam:known-people:Public');
    expect(out.policy_rules[2].rule).toBeNull();
    expect(out.policy_rules.map((rule) => rule.packets)).toEqual([4, 3, 2, 1]);
    expect(JSON.stringify(out)).not.toContain('Piet');
  });
});

describe('wording', () => {
  it('names Scramble the way the Spam Guard evidence export does', () => {
    // There it is "Geanonimiseerd" (nl) and "Anonymisiert" (de).
    expect((nl as unknown as Record<string, string>).mesh_filter_scramble).toMatch(/anonimis/i);
    expect((de as unknown as Record<string, string>).mesh_filter_scramble).toMatch(/anonymis/i);
  });

  // The Spam Guard page already has a word for "stopped" and one for "held".
  // This tab counts the same things and must not swap them.
  it.each([
    ['en', en],
    ['nl', nl],
    ['de', de],
  ])('%s uses the Spam Guard page words for stopped and held', (_name, locale) => {
    const text = locale as unknown as Record<string, string>;
    const lower = (key: string) => text[key].toLowerCase();
    expect(lower('spam_stat_stopped')).toContain(lower('mesh_filter_outcome_stopped'));
    expect(lower('spam_stat_held_genuine')).toContain(lower('mesh_filter_outcome_held'));
  });
});

describe('percent', () => {
  it('rounds to one decimal and survives an empty total', () => {
    expect(percent(10, 40)).toBe('25');
    expect(percent(1, 3)).toBe('33.3');
    expect(percent(0, 0)).toBe('0');
  });
});

describe('buildCsv', () => {
  it('quotes values with commas, quotes and line breaks', () => {
    expect(buildCsv(['a', 'b'], [['x,y', 'say "hi"']])).toBe('a,b\r\n"x,y","say ""hi"""');
  });

  it('defuses a text cell a spreadsheet would run as a formula', () => {
    const csv = buildCsv(
      ['name', 'n'],
      [
        ['=HYPERLINK("http://x")', -5],
        ['+1', 2],
        ['@x', 3],
        ['-x', 4],
      ]
    );
    const lines = csv.split('\r\n');
    expect(lines[1].startsWith('"\'=HYPERLINK')).toBe(true);
    expect(lines[1].endsWith(',-5')).toBe(true);
    expect(lines[2]).toBe("'+1,2");
    expect(lines[3]).toBe("'@x,3");
    expect(lines[4]).toBe("'-x,4");
  });
});

describe('table CSV files', () => {
  it('senders: one row per sender with bot lists joined', () => {
    const lines = sendersCsv(REPORT, t).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].split(',')[0]).toBe('mesh_filter_col_sender');
    expect(lines[1].startsWith(`UD6DWREK,${'cd'.repeat(32)},10,10,10,0,0,0,0,,1,`)).toBe(true);
    expect(lines[2]).toContain('Mine; Shared');
  });

  it('channels: no channel key', () => {
    const csv = channelsCsv(REPORT, t);
    expect(csv).not.toContain(PUBLIC);
    expect(csv).not.toContain(FAMILY);
    expect(csv.split('\r\n')[1].startsWith('Public,30,15,')).toBe(true);
  });

  it('sources: a direct message gets a readable label', () => {
    const lines = sourcesCsv(REPORT, t).split('\r\n');
    expect(lines[1].startsWith('27,12,10,')).toBe(true);
    expect(lines[2].startsWith('mesh_filter_source_direct,3,3,')).toBe(true);
  });
});

describe('buildSummaryText', () => {
  it('holds the totals, the outcome line and the top rows', () => {
    const text = buildSummaryText(REPORT, t, { windowLabel: '30m', channelLabel: 'All channels' });
    const lines = text.split('\n');
    expect(lines[0]).toContain('"window":"30m"');
    expect(lines[0]).toContain('"channel":"All channels"');
    expect(text).toContain('mesh_filter_summary_line_total {"count":40}');
    expect(text).toContain('"label":"mesh_filter_tile_spam","count":10,"percent":"25"');
    // In Monitor nothing is withheld: 9 would have been stopped, none were.
    expect(text).toContain('"stopped":0,"would":9,"let_through":3,"held":0');
    expect(text).toContain('"name":"UD6DWREK","count":10');
    expect(text).toContain('"name":"mesh_filter_source_direct","count":3');
  });

  it('leaves the outcome line out when nothing was analysed', () => {
    const none = { ...REPORT, filters: { ...REPORT.filters, analysed: 0 } };
    const text = buildSummaryText(none, t, { windowLabel: '30m', channelLabel: 'x' });
    expect(text).not.toContain('mesh_filter_summary_line_outcome');
  });
});

describe('buildJsonReport', () => {
  it('has a header and never a channel key', () => {
    const at = new Date(2026, 9, 14, 12, 0, 0);
    const text = buildJsonReport(REPORT, {
      generatedAt: at,
      channelLabel: 'All channels',
      scrambled: false,
    });
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe('rtfm-ev-filter-stats');
    expect(parsed.version).toBe(1);
    expect(parsed.app_version).toBe('3.18.0-EV.0.2');
    expect(parsed.scrambled).toBe(false);
    expect(parsed.channel).toBe('All channels');
    expect(parsed.generated_at.startsWith('2026-10-14T12:00:00')).toBe(true);
    expect(parsed.totals.messages).toBe(40);
    expect(parsed.channels[0]).not.toHaveProperty('key');
    expect(parsed.window).not.toHaveProperty('channel');
    expect(text).not.toContain(FAMILY);
  });
});

describe('filterStatsFilename', () => {
  it('names the file after its content and the local time', () => {
    const at = new Date(2026, 9, 14, 9, 5, 7);
    expect(filterStatsFilename('senders', 'csv', at)).toBe('spam-bots-senders_20261014_090507.csv');
  });
});
