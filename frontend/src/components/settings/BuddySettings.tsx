import { useEffect, useId, useState } from 'react';
import { useT } from '../../i18n';
import { THEME_CHANGE_EVENT } from '../../utils/theme';
import {
  BUDDY_AGENT_IDS,
  BUDDY_AGENT_NAMES,
  isBuddyAgentId,
  type BuddyAgentId,
} from '../../buddy/agents';
import {
  BUDDY_PREFS_CHANGE_EVENT,
  MAX_BATTERY_THRESHOLD,
  MIN_BATTERY_THRESHOLD,
  getBuddyAgent,
  getBuddyBatteryThreshold,
  isBuddyAvailable,
  setBuddyAgent,
  setBuddyBatteryThreshold,
} from '../../buddy/buddyPrefs';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/** Desktop buddy picker + battery warning threshold. Always shown under the
 *  Windows 95 theme; under other themes only once Windows 95 has been used. */
export function BuddySettings() {
  const t = useT();
  // Rendered in both Settings and the theme dialog; keep label ids unique.
  const selectId = useId();
  const thresholdId = useId();
  const [available, setAvailable] = useState(() => isBuddyAvailable());
  const [agent, setAgent] = useState<BuddyAgentId | null>(() => getBuddyAgent());
  const [threshold, setThreshold] = useState(getBuddyBatteryThreshold);
  const [thresholdDraft, setThresholdDraft] = useState(() => String(getBuddyBatteryThreshold()));

  useEffect(() => {
    const sync = () => {
      setAvailable(isBuddyAvailable());
      setAgent(getBuddyAgent());
      setThreshold(getBuddyBatteryThreshold());
    };
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener(BUDDY_PREFS_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener(BUDDY_PREFS_CHANGE_EVENT, sync);
    };
  }, []);

  if (!available) return null;

  const commitThreshold = () => {
    const value = Number(thresholdDraft);
    if (thresholdDraft.trim() === '' || !Number.isFinite(value)) {
      setThresholdDraft(String(threshold));
      return;
    }
    setBuddyBatteryThreshold(value);
    setThresholdDraft(String(getBuddyBatteryThreshold()));
  };

  return (
    <section className="mt-4 space-y-3" data-testid="buddy-settings">
      <div className="space-y-2">
        <Label htmlFor={selectId}>{t('settings_buddy_label')}</Label>
        <select
          id={selectId}
          value={agent ?? 'off'}
          onChange={(event) => {
            const value = event.target.value;
            setBuddyAgent(isBuddyAgentId(value) ? value : null);
          }}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="off">{t('settings_buddy_off')}</option>
          {BUDDY_AGENT_IDS.map((id) => (
            <option key={id} value={id}>
              {BUDDY_AGENT_NAMES[id]}
            </option>
          ))}
        </select>
        <p className="text-[0.8125rem] text-muted-foreground">{t('settings_buddy_description')}</p>
      </div>

      {agent && (
        <div className="space-y-2">
          <Label htmlFor={thresholdId}>{t('settings_buddy_battery_threshold_label')}</Label>
          <Input
            id={thresholdId}
            type="number"
            inputMode="numeric"
            min={MIN_BATTERY_THRESHOLD}
            max={MAX_BATTERY_THRESHOLD}
            value={thresholdDraft}
            onChange={(e) => setThresholdDraft(e.target.value)}
            onBlur={commitThreshold}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitThreshold();
            }}
            className="w-28"
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_buddy_battery_threshold_description')}
          </p>
        </div>
      )}
    </section>
  );
}
