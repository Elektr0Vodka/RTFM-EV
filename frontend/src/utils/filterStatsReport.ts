/**
 * The report behind the Mesh Health "Spam & bots" tab (`GET /api/filter-stats`)
 * and everything derived from it in the browser: the scrambled view, the text
 * summary, the CSV files and the JSON download. All of them are built from the
 * one loaded report, so they cannot disagree.
 */

import type { TFn } from '../i18n';
import { escapeCsvValue, toLocalIsoString } from './packetCsv';

export interface FilterCounts {
  messages: number;
  spam: number;
  malformed: number;
  duplicate: number;
  /** Messages whose sender is on an enabled bot list today. */
  bot_now: number;
  /** Messages with at least one of the four flags. */
  flagged: number;
}

export interface FilterStatsTotals extends FilterCounts {
  malformed_text: number;
  malformed_clock: number;
  malformed_both: number;
  malformed_unknown: number;
  /** The sender was listed when the message arrived. */
  bot_flagged: number;
  bot_listed_later: number;
  bot_no_longer_listed: number;
  multi_flag: number;
}

export interface FilterStatsBucket extends FilterCounts {
  bucket_ts: number;
}

export interface FilterStatsSender extends FilterCounts {
  /** Empty when the stored message has no sender name. */
  name: string;
  public_key: string | null;
  bot_flagged: number;
  bot_lists: string[];
  channels: number;
  first_seen: number;
  last_seen: number;
}

export interface FilterStatsChannel extends FilterCounts {
  key: string;
  name: string;
  public: boolean;
  /** Spam Guard reads this channel (a protected channel). */
  protected?: boolean;
}

export interface FilterStatsSource extends FilterCounts {
  /** First relay on the path, or DIRECT_HOP. */
  hop: string;
  last_seen: number;
}

export interface FilterStatsFilters {
  analysed: number;
  clean: number;
  stopped: number;
  let_through: number;
  held: number;
  enforced: number;
  not_enforced: number;
  stop_rate: number | null;
  blocks: { source: string; count: number }[];
  confirmed: number;
  missed: number;
  false_positive: number;
  flagged_later: number;
  not_recorded: number;
}

export interface FilterStatsPolicyRule {
  action: string;
  rule: string | null;
  packets: number;
}

export interface FilterStatsReport {
  window: { start_ts: number; end_ts: number; bucket_seconds: number; channel: string | null };
  totals: FilterStatsTotals;
  series: FilterStatsBucket[];
  senders: FilterStatsSender[];
  senders_truncated: boolean;
  channels: FilterStatsChannel[];
  sources: FilterStatsSource[];
  sources_truncated: boolean;
  filters: FilterStatsFilters;
  policy_rules: FilterStatsPolicyRule[];
  spam_guard_enabled: boolean;
  bot_lists_enabled: boolean;
  app_version: string;
}

/** `hop` of a message heard without a relay. */
export const DIRECT_HOP = 'DIRECT';

// ─── Scramble ───────────────────────────────────────────────────────────────

export interface Scrambler {
  sender(name: string): string;
  channel(key: string): string;
  rule(name: string): string;
}

/** Rules Spam Guard put on an OpenHop node; their names hold no person and no channel key. */
const SPAM_GUARD_RULE_PREFIX = 'rtfm-spam:';

function randomCode(): string {
  // getRandomValues, not crypto.subtle: subtle does not exist on a plain
  // http:// LAN address, which is how this app is usually opened.
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Codes from a random table: the same name gives the same code until it is thrown away. */
export function createScrambler(): Scrambler {
  const senders = new Map<string, string>();
  const channels = new Map<string, string>();
  const rules = new Map<string, string>();
  const code = (table: Map<string, string>, prefix: string, value: string) => {
    let found = table.get(value);
    if (!found) {
      found = `${prefix}-${randomCode()}`;
      table.set(value, found);
    }
    return found;
  };
  return {
    sender: (name) => code(senders, 'user', name),
    channel: (key) => code(channels, 'channel', key),
    rule: (name) => code(rules, 'rule', name),
  };
}

let sessionScrambler: Scrambler | null = null;

/** One table per page load: codes stay put across refreshes, and change next time. */
export function getSessionScrambler(): Scrambler {
  if (sessionScrambler === null) sessionScrambler = createScrambler();
  return sessionScrambler;
}

/**
 * Sender names become codes and lose their key; a channel whose key is not
 * public knowledge becomes a code. Numbers and repeaters are left alone.
 */
export function scrambleReport(report: FilterStatsReport, scrambler: Scrambler): FilterStatsReport {
  return {
    ...report,
    senders: report.senders.map((sender) => ({
      ...sender,
      name: sender.name ? scrambler.sender(sender.name) : sender.name,
      public_key: null,
    })),
    channels: report.channels.map((channel) =>
      channel.public ? channel : { ...channel, name: scrambler.channel(channel.key) }
    ),
    // A rule the user wrote on an OpenHop node is free text and can name a person.
    policy_rules: report.policy_rules.map((rule) =>
      rule.rule === null || rule.rule.startsWith(SPAM_GUARD_RULE_PREFIX)
        ? rule
        : { ...rule, rule: scrambler.rule(rule.rule) }
    ),
  };
}

// ─── Text summary ───────────────────────────────────────────────────────────

/** Share of `whole`, one decimal at most, without the percent sign. */
export function percent(part: number, whole: number): string {
  if (whole <= 0) return '0';
  return `${Math.round((part / whole) * 1000) / 10}`;
}

function senderLabel(name: string, t: TFn): string {
  return name || t('mesh_filter_sender_unknown');
}

function sourceLabel(hop: string, t: TFn): string {
  return hop === DIRECT_HOP ? t('mesh_filter_source_direct') : hop;
}

/** A short plain text report of the window, sized for a chat message. */
export function buildSummaryText(
  report: FilterStatsReport,
  t: TFn,
  opts: { windowLabel: string; channelLabel: string }
): string {
  const { totals, filters } = report;
  const category = (labelKey: string, count: number) =>
    t('mesh_filter_summary_line_cat', {
      label: t(labelKey),
      count,
      percent: percent(count, totals.messages),
    });
  const lines = [
    t('mesh_filter_summary_title', { window: opts.windowLabel, channel: opts.channelLabel }),
    t('mesh_filter_summary_line_total', { count: totals.messages }),
    category('mesh_filter_tile_spam', totals.spam),
    category('mesh_filter_tile_malformed', totals.malformed),
    category('mesh_filter_tile_duplicates', totals.duplicate),
    category('mesh_filter_tile_bots', totals.bot_now),
  ];
  if (filters.analysed > 0) {
    lines.push(
      // "Stopped" only where forwards were really withheld; the rest would have been.
      t('mesh_filter_summary_line_outcome', {
        stopped: filters.enforced,
        would: filters.not_enforced,
        let_through: filters.let_through,
        held: filters.held,
      })
    );
  }
  if (report.senders.length > 0) {
    lines.push(t('mesh_filter_summary_top_senders'));
    for (const sender of report.senders.slice(0, 5)) {
      lines.push(
        t('mesh_filter_summary_item', { name: senderLabel(sender.name, t), count: sender.flagged })
      );
    }
  }
  if (report.sources.length > 0) {
    lines.push(t('mesh_filter_summary_top_sources'));
    for (const source of report.sources.slice(0, 3)) {
      lines.push(
        t('mesh_filter_summary_item', { name: sourceLabel(source.hop, t), count: source.flagged })
      );
    }
  }
  return lines.join('\n');
}

// ─── OpenHop rules ──────────────────────────────────────────────────────────

/** 0: the node owner's own rules, 1: rules Spam Guard put there, 2: the default action. */
function policyRuleGroup(rule: FilterStatsPolicyRule): number {
  if (rule.rule === null) return 2;
  return rule.rule.startsWith(SPAM_GUARD_RULE_PREFIX) ? 1 : 0;
}

/**
 * The node owner's own rules first, in name order with numbers counted ("2"
 * before "10"), as they usually number them. Then Spam Guard's rules by
 * packets, then the default action.
 */
export function sortPolicyRules(rules: FilterStatsPolicyRule[]): FilterStatsPolicyRule[] {
  return [...rules].sort((a, b) => {
    const group = policyRuleGroup(a) - policyRuleGroup(b);
    if (group !== 0) return group;
    if (policyRuleGroup(a) === 0) {
      return (
        (a.rule ?? '').localeCompare(b.rule ?? '', undefined, {
          numeric: true,
          sensitivity: 'base',
        }) || a.action.localeCompare(b.action)
      );
    }
    return b.packets - a.packets || (a.rule ?? '').localeCompare(b.rule ?? '');
  });
}

/** The OpenHop rule list as plain text, in the order the page shows it. */
export function buildPolicyRulesText(
  report: FilterStatsReport,
  t: TFn,
  opts: { windowLabel: string; actionLabel: (action: string) => string }
): string {
  const lines = [t('mesh_filter_policy_summary_title', { window: opts.windowLabel })];
  for (const rule of report.policy_rules) {
    lines.push(
      t('mesh_filter_policy_summary_item', {
        rule: rule.rule ?? t('mesh_filter_policy_default'),
        action: opts.actionLabel(rule.action),
        count: rule.packets,
      })
    );
  }
  if (report.filters.not_recorded > 0) {
    lines.push(t('mesh_filter_not_recorded', { count: report.filters.not_recorded }));
  }
  return lines.join('\n');
}

// ─── CSV ────────────────────────────────────────────────────────────────────

/**
 * Sender names are chosen by whoever sends them. A text cell that starts with
 * one of these runs as a formula in a spreadsheet, so it gets a leading quote.
 */
function csvCell(value: string | number): string {
  if (typeof value === 'number') return `${value}`;
  return escapeCsvValue(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
}

export function buildCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

function iso(unixSeconds: number): string {
  return toLocalIsoString(new Date(unixSeconds * 1000));
}

function countHeaders(t: TFn): string[] {
  return [
    t('mesh_filter_col_messages'),
    t('mesh_filter_col_flagged'),
    t('mesh_filter_col_spam'),
    t('mesh_filter_col_malformed'),
    t('mesh_filter_col_duplicates'),
    t('mesh_filter_col_bots'),
  ];
}

function countCells(row: FilterCounts): number[] {
  return [row.messages, row.flagged, row.spam, row.malformed, row.duplicate, row.bot_now];
}

export function sendersCsv(report: FilterStatsReport, t: TFn): string {
  return buildCsv(
    [
      t('mesh_filter_col_sender'),
      t('mesh_filter_col_public_key'),
      ...countHeaders(t),
      t('mesh_filter_col_flagged_arrival'),
      t('mesh_filter_col_bot_lists'),
      t('mesh_filter_col_channels'),
      t('mesh_filter_col_first_seen'),
      t('mesh_filter_col_last_seen'),
    ],
    report.senders.map((sender) => [
      senderLabel(sender.name, t),
      sender.public_key ?? '',
      ...countCells(sender),
      sender.bot_flagged,
      sender.bot_lists.join('; '),
      sender.channels,
      iso(sender.first_seen),
      iso(sender.last_seen),
    ])
  );
}

export function channelsCsv(report: FilterStatsReport, t: TFn): string {
  return buildCsv(
    [t('mesh_filter_col_channel'), ...countHeaders(t)],
    report.channels.map((channel) => [
      channel.name || t('mesh_filter_channel_unknown'),
      ...countCells(channel),
    ])
  );
}

export function sourcesCsv(report: FilterStatsReport, t: TFn): string {
  return buildCsv(
    [t('mesh_filter_col_source'), ...countHeaders(t), t('mesh_filter_col_last_seen')],
    report.sources.map((source) => [
      sourceLabel(source.hop, t),
      ...countCells(source),
      iso(source.last_seen),
    ])
  );
}

// ─── JSON ───────────────────────────────────────────────────────────────────

/** Everything the tab shows for the window. A channel key is never part of it. */
export function buildJsonReport(
  report: FilterStatsReport,
  meta: { generatedAt: Date; channelLabel: string; scrambled: boolean }
): string {
  const { window: win, channels, app_version, ...rest } = report;
  return JSON.stringify(
    {
      format: 'rtfm-ev-filter-stats',
      version: 1,
      generated_at: toLocalIsoString(meta.generatedAt),
      app_version,
      scrambled: meta.scrambled,
      channel: meta.channelLabel,
      window: {
        start_ts: win.start_ts,
        end_ts: win.end_ts,
        bucket_seconds: win.bucket_seconds,
      },
      ...rest,
      channels: channels.map((channel) => {
        // The lint config allows an unused name that starts with an underscore.
        const { key: _key, ...withoutKey } = channel;
        return withoutKey;
      }),
    },
    null,
    2
  );
}

// ─── Download ───────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `spam-bots-<kind>_YYYYMMDD_HHMMSS.<ext>` in local time. */
export function filterStatsFilename(kind: string, ext: string, at: Date): string {
  const stamp =
    `${at.getFullYear()}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}` +
    `_${pad2(at.getHours())}${pad2(at.getMinutes())}${pad2(at.getSeconds())}`;
  return `spam-bots-${kind}_${stamp}.${ext}`;
}

/** Hand a text file to the browser. `bom` is for CSV, so a spreadsheet reads UTF-8. */
export function downloadText(filename: string, text: string, mime: string, bom = false): void {
  const blob = new Blob(bom ? ['﻿', text] : [text], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
