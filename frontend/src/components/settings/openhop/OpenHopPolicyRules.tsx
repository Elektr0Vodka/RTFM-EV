import { useState } from 'react';
import type { OpenHopCondition, OpenHopPolicyEngine, OpenHopRule } from '../../../types';
import { useT } from '../../../i18n';
import { Button } from '../../ui/button';
import { OpenHopRuleForm } from './OpenHopRuleForm';

interface Props {
  engine: OpenHopPolicyEngine;
  onChange: (e: OpenHopPolicyEngine) => void;
}

export function summarizeCondition(c: OpenHopCondition): string {
  if (typeof c !== 'object' || c === null) return '';
  if ('all' in c) return c.all.map(summarizeCondition).join(' AND ');
  if ('any' in c) return c.any.map(summarizeCondition).join(' OR ');
  if ('field' in c) return `${c.field || '?'} ${c.op} ${c.value}`;
  return '(any)';
}

function newRuleId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

export function OpenHopPolicyRules({ engine, onChange }: Props) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const rules = engine.rules;
  const setRules = (next: OpenHopRule[]) => onChange({ ...engine, rules: next });

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= rules.length) return;
    const next = [...rules];
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
    setRules(next);
  };

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold tracking-tight">{t('openhop_rules_heading')}</h3>
      {rules.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('openhop_no_rules')}</p>
      )}
      <ul className="space-y-2">
        {rules.map((rule, i) => (
          <li key={rule.id} className="rounded border border-input p-2">
            {editing === rule.id ? (
              <OpenHopRuleForm
                rule={rule}
                objects={engine.objects}
                onSave={(r) => {
                  const next = [...rules];
                  next[i] = r;
                  setRules(next);
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={t('openhop_rule_enabled')}
                  checked={rule.enabled}
                  onChange={(e) => {
                    const next = [...rules];
                    next[i] = { ...rule, enabled: e.target.checked };
                    setRules(next);
                  }}
                />
                <span className="font-medium">{rule.name || '(unnamed)'}</span>
                <span className="rounded bg-muted px-1 text-xs">{rule.then.action}</span>
                <span className="text-xs text-muted-foreground">{summarizeCondition(rule.if)}</span>
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    aria-label={t('openhop_rule_up')}
                    className="px-1"
                    onClick={() => move(i, -1)}
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    aria-label={t('openhop_rule_down')}
                    className="px-1"
                    onClick={() => move(i, 1)}
                  >
                    &darr;
                  </button>
                  <button
                    type="button"
                    className="px-1 underline"
                    onClick={() => setEditing(rule.id)}
                  >
                    {t('openhop_rule_edit')}
                  </button>
                  <button
                    type="button"
                    className="px-1 text-destructive underline"
                    onClick={() => {
                      if (window.confirm(`${t('openhop_rule_delete')}?`)) {
                        setRules(rules.filter((_, k) => k !== i));
                      }
                    }}
                  >
                    {t('openhop_rule_delete')}
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          const r: OpenHopRule = {
            id: newRuleId(),
            name: '',
            enabled: true,
            if: {},
            then: { action: 'drop' },
          };
          setRules([...rules, r]);
          setEditing(r.id);
        }}
      >
        {t('openhop_rule_add')}
      </Button>
    </div>
  );
}
