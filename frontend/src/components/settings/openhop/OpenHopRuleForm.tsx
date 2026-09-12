import { useState } from 'react';
import type { OpenHopAction, OpenHopCondition, OpenHopRule } from '../../../types';
import { useT } from '../../../i18n';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Checkbox } from '../../ui/checkbox';
import { OPENHOP_ACTIONS, OpenHopConditionBuilder } from './OpenHopConditionBuilder';

interface PolicyObjects {
  channel_hash_groups: Record<string, string[]>;
  pubkey_groups: Record<string, string[]>;
}

interface Props {
  rule: OpenHopRule;
  objects: PolicyObjects;
  onSave: (r: OpenHopRule) => void;
  onCancel: () => void;
}

const selectClass = 'rounded border border-input bg-background px-2 py-1 text-sm';

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

export function OpenHopRuleForm({ rule, objects, onSave, onCancel }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<OpenHopRule>(rule);
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
            setDraft({ ...draft, then: { action: e.target.value as OpenHopAction } })
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
        onChange={(c) => setDraft({ ...draft, if: c })}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={() => onSave({ ...draft, if: normalizeCondition(draft.if) })}
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
