import { useState } from 'react';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { useT } from '../../../i18n';
import type {
  HostRepeaterFilterRule,
  HostRepeaterFilterStats,
  HostRepeaterSettings as Settings,
} from '../../../types';

/** Firmware limits (Filter.h, PathBlock.h, SenderRules.h, MessageAge.h, AdvertLimiter.h). */
const MAX_PATHS = 8;
const MAX_RULES = 8;
const MAX_WATCH = 4;
const SENDER_MAX = 15;
const TEXT_MAX = 23;

const PATH_RE = /^(?:[0-9a-fA-F]{2}){1,4}$/;
const WATCH_RE = /^#\S+$/;

interface Props {
  draft: Settings;
  set: (patch: Partial<Settings>) => void;
  stats?: HostRepeaterFilterStats;
}

function numOrNaN(value: string): number {
  return value === '' ? NaN : Number(value);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The dmc-observer-dev additions to the DMC filter: dry-run, per-origin advert
 * window, message age limit, blocked path prefixes, sender / text rules and the
 * watch list the rules may read.
 */
export function HostRepeaterFilterExtras({ draft, set, stats }: Props) {
  const t = useT();
  const [newPath, setNewPath] = useState('');
  const [newWatch, setNewWatch] = useState('');

  const pathDrops = new Map(stats?.paths.map((p) => [p.prefix, p.drops]) ?? []);
  const canAddPath =
    PATH_RE.test(newPath.trim()) &&
    draft.filter_paths.length < MAX_PATHS &&
    !draft.filter_paths.includes(newPath.trim().toUpperCase());
  const canAddWatch =
    WATCH_RE.test(newWatch.trim()) &&
    byteLength(newWatch.trim()) <= 31 &&
    draft.filter_watch.length < MAX_WATCH &&
    !draft.filter_watch.includes(newWatch.trim());

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id="hr-filter-dryrun"
          className="mt-0.5"
          checked={draft.filter_dryrun}
          onCheckedChange={(c) => set({ filter_dryrun: c === true })}
        />
        <div className="flex-1">
          <Label htmlFor="hr-filter-dryrun">{t('settings_host_repeater_filter_dryrun')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('settings_host_repeater_filter_dryrun_desc')}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="hr-filter-advert-hours">
            {t('settings_host_repeater_filter_advert_hours')}
          </Label>
          <Input
            id="hr-filter-advert-hours"
            type="number"
            min={0}
            max={720}
            className="w-32"
            value={Number.isFinite(draft.filter_advert_hours) ? draft.filter_advert_hours : ''}
            onChange={(e) => set({ filter_advert_hours: numOrNaN(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            {t('settings_host_repeater_filter_advert_hours_desc')}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="hr-filter-age">{t('settings_host_repeater_filter_age')}</Label>
          <Input
            id="hr-filter-age"
            type="number"
            min={0}
            max={10080}
            className="w-32"
            value={Number.isFinite(draft.filter_age_minutes) ? draft.filter_age_minutes : ''}
            onChange={(e) => set({ filter_age_minutes: numOrNaN(e.target.value) })}
          />
          <p className="text-xs text-muted-foreground">
            {t('settings_host_repeater_filter_age_desc')}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('settings_host_repeater_filter_paths_heading')}</p>
        <p className="text-xs text-muted-foreground">
          {t('settings_host_repeater_filter_paths_desc')}
        </p>
        <ul className="space-y-1">
          {draft.filter_paths.map((prefix) => (
            <li key={prefix} className="flex items-center gap-2 text-sm">
              <span className="font-mono">{prefix}</span>
              {pathDrops.has(prefix) && (
                <span className="text-xs text-muted-foreground">
                  {t('settings_host_repeater_filter_drops', { count: pathDrops.get(prefix) ?? 0 })}
                </span>
              )}
              <button
                type="button"
                className="text-xs text-destructive underline"
                onClick={() =>
                  set({ filter_paths: draft.filter_paths.filter((p) => p !== prefix) })
                }
              >
                {t('settings_host_repeater_channel_remove')}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t('settings_host_repeater_filter_path_placeholder')}
            placeholder={t('settings_host_repeater_filter_path_placeholder')}
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            className="w-32 font-mono"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!canAddPath}
            onClick={() => {
              set({ filter_paths: [...draft.filter_paths, newPath.trim().toUpperCase()] });
              setNewPath('');
            }}
          >
            {t('settings_host_repeater_channel_add')}
          </Button>
        </div>
      </div>

      <RuleList
        kind="sender"
        rules={draft.filter_sender_rules}
        maxLen={SENDER_MAX}
        stats={stats?.senders}
        onChange={(rules) => set({ filter_sender_rules: rules })}
      />
      <RuleList
        kind="text"
        rules={draft.filter_text_rules}
        maxLen={TEXT_MAX}
        stats={stats?.texts}
        onChange={(rules) => set({ filter_text_rules: rules })}
      />

      <div className="space-y-2">
        <p className="text-sm font-medium">{t('settings_host_repeater_filter_watch_heading')}</p>
        <p className="text-xs text-muted-foreground">
          {t('settings_host_repeater_filter_watch_desc')}
        </p>
        <ul className="space-y-1">
          {draft.filter_watch.map((name) => (
            <li key={name} className="flex items-center gap-2 text-sm">
              <span className="font-mono">{name}</span>
              <button
                type="button"
                className="text-xs text-destructive underline"
                onClick={() => set({ filter_watch: draft.filter_watch.filter((w) => w !== name) })}
              >
                {t('settings_host_repeater_channel_remove')}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label={t('settings_host_repeater_filter_watch_placeholder')}
            placeholder={t('settings_host_repeater_filter_watch_placeholder')}
            value={newWatch}
            onChange={(e) => setNewWatch(e.target.value)}
            className="w-40"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!canAddWatch}
            onClick={() => {
              set({ filter_watch: [...draft.filter_watch, newWatch.trim()] });
              setNewWatch('');
            }}
          >
            {t('settings_host_repeater_filter_add')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface RuleListProps {
  kind: 'sender' | 'text';
  rules: HostRepeaterFilterRule[];
  maxLen: number;
  stats?: { pattern: string; drops: number; pass: number }[];
  onChange: (rules: HostRepeaterFilterRule[]) => void;
}

function RuleList({ kind, rules, maxLen, stats, onChange }: RuleListProps) {
  const t = useT();
  const [pattern, setPattern] = useState('');
  const [secs, setSecs] = useState('0');
  const [prob, setProb] = useState('100');
  const byPattern = new Map(stats?.map((s) => [s.pattern, s]) ?? []);

  const p = pattern.trim();
  const s = Number(secs);
  const pr = Number(prob);
  const valid =
    p.length > 0 &&
    !/\s/.test(p) &&
    byteLength(p) <= maxLen &&
    !(kind === 'text' && p === '^') &&
    rules.length < MAX_RULES &&
    !rules.some((r) => r.pattern === p) &&
    Number.isInteger(s) &&
    s >= 0 &&
    s <= 65535 &&
    Number.isInteger(pr) &&
    pr >= 1 &&
    pr <= 100;

  const mode = (rule: HostRepeaterFilterRule) => {
    const base =
      rule.secs > 0
        ? t('settings_host_repeater_filter_rule_throttle', { secs: rule.secs })
        : t('settings_host_repeater_filter_rule_block');
    return rule.prob < 100 ? `${base} ${rule.prob}%` : base;
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t(`settings_host_repeater_filter_${kind}_heading`)}</p>
      <p className="text-xs text-muted-foreground">
        {t(`settings_host_repeater_filter_${kind}_desc`)}
      </p>
      <ol className="space-y-1">
        {rules.map((rule, i) => {
          const st = byPattern.get(rule.pattern);
          return (
            <li key={rule.pattern} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{i + 1}.</span>
              <span className="font-mono">{rule.pattern}</span>
              <span className="text-xs">{mode(rule)}</span>
              {st && (
                <span className="text-xs text-muted-foreground">
                  {t('settings_host_repeater_filter_rule_stats', {
                    drops: st.drops,
                    passes: st.pass,
                  })}
                </span>
              )}
              <button
                type="button"
                className="text-xs text-destructive underline"
                onClick={() => onChange(rules.filter((_, k) => k !== i))}
              >
                {t('settings_host_repeater_channel_remove')}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          aria-label={t(`settings_host_repeater_filter_${kind}_placeholder`)}
          placeholder={t(`settings_host_repeater_filter_${kind}_placeholder`)}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          className="w-40 font-mono"
        />
        <Input
          aria-label={`${t(`settings_host_repeater_filter_${kind}_heading`)} ${t('settings_host_repeater_filter_rule_secs')}`}
          title={t('settings_host_repeater_filter_rule_secs')}
          type="number"
          min={0}
          max={65535}
          value={secs}
          onChange={(e) => setSecs(e.target.value)}
          className="w-24"
        />
        <Input
          aria-label={`${t(`settings_host_repeater_filter_${kind}_heading`)} ${t('settings_host_repeater_filter_rule_prob')}`}
          title={t('settings_host_repeater_filter_rule_prob')}
          type="number"
          min={1}
          max={100}
          value={prob}
          onChange={(e) => setProb(e.target.value)}
          className="w-20"
        />
        <Button
          type="button"
          variant="outline"
          disabled={!valid}
          onClick={() => {
            onChange([...rules, { pattern: p, secs: s, prob: pr }]);
            setPattern('');
            setSecs('0');
            setProb('100');
          }}
        >
          {t('settings_host_repeater_filter_add')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('settings_host_repeater_filter_rule_args_hint')}
      </p>
    </div>
  );
}
