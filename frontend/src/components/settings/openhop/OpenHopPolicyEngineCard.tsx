import type { OpenHopAction, OpenHopPolicyEngine } from '../../../types';
import { useT } from '../../../i18n';
import { Label } from '../../ui/label';
import { Checkbox } from '../../ui/checkbox';
import { OPENHOP_ACTIONS } from './OpenHopConditionBuilder';

interface Props {
  engine: OpenHopPolicyEngine;
  onChange: (e: OpenHopPolicyEngine) => void;
}

const selectClass = 'rounded border border-input bg-background px-2 py-1 text-sm';

export function OpenHopPolicyEngineCard({ engine, onChange }: Props) {
  const t = useT();
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold tracking-tight">{t('openhop_policy_heading')}</h3>
      <div className="flex items-center gap-2">
        <Checkbox
          id="oh-engine-enabled"
          checked={engine.enabled}
          onCheckedChange={(c) => onChange({ ...engine, enabled: c === true })}
        />
        <Label htmlFor="oh-engine-enabled">{t('openhop_policy_enabled_label')}</Label>
      </div>
      <div className="space-y-1">
        <Label htmlFor="oh-engine-default">{t('openhop_policy_default_action')}</Label>
        <select
          id="oh-engine-default"
          className={selectClass}
          value={engine.default_action}
          onChange={(e) => onChange({ ...engine, default_action: e.target.value as OpenHopAction })}
        >
          {OPENHOP_ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
