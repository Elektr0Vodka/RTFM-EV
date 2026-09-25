import { useState } from 'react';
import type {
  OpenHopAction,
  OpenHopCondition,
  OpenHopRule,
  PolicyThrottleKey,
} from '../../../types';
import { useT } from '../../../i18n';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Checkbox } from '../../ui/checkbox';
import {
  OPENHOP_ACTIONS,
  OpenHopConditionBuilder,
  type ConditionVocabulary,
} from './OpenHopConditionBuilder';

interface PolicyObjects {
  channel_hash_groups: Record<string, string[]>;
  pubkey_groups: Record<string, string[]>;
}

interface Props {
  rule: OpenHopRule;
  objects: PolicyObjects;
  onSave: (r: OpenHopRule) => void;
  onCancel: () => void;
  vocabulary?: ConditionVocabulary;
}

const selectClass = 'rounded border border-input bg-background px-2 py-1 text-sm';
const THROTTLE_KEYS: readonly PolicyThrottleKey[] = ['rule', 'sender', 'channel', 'path_first'];

function parseGate(raw: string, min: number, max: number): number | undefined {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

/** Build `then` without empty gates so the stored document stays minimal. */
function buildThen(
  action: OpenHopAction,
  prob: number | undefined,
  throttle: number | undefined,
  key: PolicyThrottleKey
): OpenHopRule['then'] {
  const then: OpenHopRule['then'] = { action };
  if (prob !== undefined) then.prob = prob;
  if (throttle !== undefined) {
    then.throttle_seconds = throttle;
    if (key !== 'rule') then.throttle_key = key;
  }
  return then;
}

function hasCondition(c: OpenHopCondition): boolean {
  return typeof c === 'object' && c !== null && ('field' in c || 'all' in c || 'any' in c);
}

function normalizeCondition(c: OpenHopCondition): OpenHopCondition {
  // An all-empty single condition collapses to {} (no condition).
  if (typeof c === 'object' && c !== null && 'field' in c && !c.field && !c.value) {
    return {};
  }
  return c;
}

export function OpenHopRuleForm({ rule, objects, onSave, onCancel, vocabulary }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<OpenHopRule>(rule);
  const [prob, setProb] = useState<string>(rule.then.prob != null ? String(rule.then.prob) : '');
  const [throttle, setThrottle] = useState<string>(
    rule.then.throttle_seconds != null ? String(rule.then.throttle_seconds) : ''
  );
  const [throttleKey, setThrottleKey] = useState<PolicyThrottleKey>(
    rule.then.throttle_key ?? 'rule'
  );
  const gates = vocabulary?.ruleGates === true;
  const cond: OpenHopCondition = hasCondition(draft.if)
    ? draft.if
    : { field: '', op: 'equals', value: '' };

  return (
    <div className="space-y-3 rounded border border-input p-3">
      <div className="space-y-1">
        <Label htmlFor="oh-rule-name">{t('openhop_rule_name')}</Label>
        <Input
          id="oh-rule-name"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="oh-rule-enabled"
          checked={draft.enabled}
          onCheckedChange={(c) => setDraft({ ...draft, enabled: c === true })}
        />
        <Label htmlFor="oh-rule-enabled">{t('openhop_rule_enabled')}</Label>
      </div>
      <div className="space-y-1">
        <Label htmlFor="oh-rule-action">{t('openhop_rule_action')}</Label>
        <select
          id="oh-rule-action"
          className={selectClass}
          value={draft.then.action}
          onChange={(e) =>
            setDraft({ ...draft, then: { ...draft.then, action: e.target.value as OpenHopAction } })
          }
        >
          {OPENHOP_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <OpenHopConditionBuilder
        value={cond}
        objects={objects}
        vocabulary={vocabulary}
        onChange={(c) => setDraft({ ...draft, if: c })}
      />
      {gates && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="oh-rule-prob">{t('openhop_rule_prob')}</Label>
            <Input
              id="oh-rule-prob"
              type="number"
              min={1}
              max={100}
              placeholder="100"
              value={prob}
              onChange={(e) => setProb(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('openhop_rule_prob_hint')}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="oh-rule-throttle">{t('openhop_rule_throttle')}</Label>
            <Input
              id="oh-rule-throttle"
              type="number"
              min={1}
              max={65535}
              value={throttle}
              onChange={(e) => setThrottle(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('openhop_rule_throttle_hint')}</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="oh-rule-throttle-key">{t('openhop_rule_throttle_key')}</Label>
            <select
              id="oh-rule-throttle-key"
              className={selectClass}
              value={throttleKey}
              disabled={throttle.trim() === ''}
              onChange={(e) => setThrottleKey(e.target.value as PolicyThrottleKey)}
            >
              {THROTTLE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {t(`openhop_rule_throttle_key_${k}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() =>
            onSave({
              ...draft,
              if: normalizeCondition(draft.if),
              then: gates
                ? buildThen(
                    draft.then.action,
                    parseGate(prob, 1, 100),
                    parseGate(throttle, 1, 65535),
                    throttleKey
                  )
                : draft.then,
            })
          }
        >
          {t('openhop_rule_save')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('openhop_rule_cancel')}
        </Button>
      </div>
    </div>
  );
}
