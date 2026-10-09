import { useEffect, useId, useState } from 'react';
import { useT } from '../../i18n';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { THEME_CHANGE_EVENT } from '../../utils/theme';
import {
  BUDDY_AGENT_IDS,
  BUDDY_AGENT_NAMES,
  isBuddyAgentId,
  type BuddyAgentId,
} from '../../buddy/agents';
import { BUDDY_GROUPS, type BuddyGroup } from '../../buddy/buddyLogic';
import {
  BUDDY_PREFS_CHANGE_EVENT,
  MAX_BATTERY_THRESHOLD,
  MIN_BATTERY_THRESHOLD,
  getBuddyAgent,
  getBuddyBatteryThreshold,
  getBuddyGroupsOff,
  getBuddyMute,
  getBuddyQuietHours,
  isBuddyAvailable,
  muteBuddyFor,
  muteBuddyUntilReload,
  setBuddyAgent,
  setBuddyBatteryThreshold,
  setBuddyGroupOn,
  setBuddyQuietHours,
  unmuteBuddy,
} from '../../buddy/buddyPrefs';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const GROUP_LABEL_KEYS: Record<BuddyGroup, string> = {
  messages: 'settings_buddy_group_messages',
  nodes: 'settings_buddy_group_nodes',
  radio: 'settings_buddy_group_radio',
  batteries: 'settings_buddy_group_batteries',
  updates: 'settings_buddy_group_updates',
  tips: 'settings_buddy_group_tips',
};

const MUTE_15_MINUTES_MS = 15 * 60 * 1000;
const MUTE_1_HOUR_MS = 60 * 60 * 1000;

/** Desktop buddy picker + battery warning threshold, and (unless `compact`)
 *  what it talks about, the mute and the quiet hours. Always shown under the
 *  Windows 95 theme; under other themes only once Windows 95 has been used. */
export function BuddySettings({ compact = false }: { compact?: boolean }) {
  const t = useT();
  // Rendered in both Settings and the theme dialog; keep label ids unique.
  const selectId = useId();
  const thresholdId = useId();
  const groupsId = useId();
  const quietFromId = useId();
  const quietToId = useId();
  const [available, setAvailable] = useState(() => isBuddyAvailable());
  const [agent, setAgent] = useState<BuddyAgentId | null>(() => getBuddyAgent());
  const [threshold, setThreshold] = useState(getBuddyBatteryThreshold);
  const [thresholdDraft, setThresholdDraft] = useState(() => String(getBuddyBatteryThreshold()));
  const [groupsOff, setGroupsOff] = useState(getBuddyGroupsOff);
  const [mute, setMute] = useState(() => getBuddyMute());
  // Drafts: quiet hours are only stored once both times are filled in.
  const [quietFrom, setQuietFrom] = useState(() => getBuddyQuietHours()?.from ?? '');
  const [quietTo, setQuietTo] = useState(() => getBuddyQuietHours()?.to ?? '');

  useEffect(() => {
    const sync = () => {
      setAvailable(isBuddyAvailable());
      setAgent(getBuddyAgent());
      setThreshold(getBuddyBatteryThreshold());
      setGroupsOff(getBuddyGroupsOff());
      setMute(getBuddyMute());
    };
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener(BUDDY_PREFS_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener(BUDDY_PREFS_CHANGE_EVENT, sync);
    };
  }, []);

  // A timed mute ends by itself; show the buttons again when it does.
  const muteUntil = mute?.kind === 'until' ? mute.until : null;
  useEffect(() => {
    if (muteUntil === null) return;
    const timer = window.setTimeout(
      () => setMute(getBuddyMute()),
      Math.max(0, muteUntil - Date.now()) + 50
    );
    return () => window.clearTimeout(timer);
  }, [muteUntil]);

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

  const changeQuietHours = (from: string, to: string) => {
    setQuietFrom(from);
    setQuietTo(to);
    if (from && to) setBuddyQuietHours({ from, to });
    else if (getBuddyQuietHours()) setBuddyQuietHours(null);
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

      {agent && !compact && (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium leading-none">{t('settings_buddy_groups_label')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {BUDDY_GROUPS.map((group) => (
                <div key={group} className="flex items-center gap-2">
                  <Checkbox
                    id={`${groupsId}-${group}`}
                    checked={!groupsOff.includes(group)}
                    onCheckedChange={(checked) => setBuddyGroupOn(group, checked === true)}
                  />
                  <Label htmlFor={`${groupsId}-${group}`}>{t(GROUP_LABEL_KEYS[group])}</Label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium leading-none">{t('settings_buddy_mute_label')}</p>
            {mute ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm" role="status">
                  {mute.kind === 'reload'
                    ? t('settings_buddy_mute_until_reload')
                    : t('settings_buddy_mute_until', {
                        time: formatDateTime(mute.until, { hour: '2-digit', minute: '2-digit' }),
                      })}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={unmuteBuddy}>
                  {t('settings_buddy_mute_end')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => muteBuddyFor(MUTE_15_MINUTES_MS)}
                >
                  {t('settings_buddy_mute_15m')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => muteBuddyFor(MUTE_1_HOUR_MS)}
                >
                  {t('settings_buddy_mute_1h')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={muteBuddyUntilReload}>
                  {t('settings_buddy_mute_reload')}
                </Button>
              </div>
            )}
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_buddy_mute_description')}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium leading-none">
              {t('settings_buddy_quiet_hours_label')}
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor={quietFromId}>{t('settings_buddy_quiet_hours_from')}</Label>
                <Input
                  id={quietFromId}
                  type="time"
                  value={quietFrom}
                  onChange={(e) => changeQuietHours(e.target.value, quietTo)}
                  className="w-32"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={quietToId}>{t('settings_buddy_quiet_hours_to')}</Label>
                <Input
                  id={quietToId}
                  type="time"
                  value={quietTo}
                  onChange={(e) => changeQuietHours(quietFrom, e.target.value)}
                  className="w-32"
                />
              </div>
              {(quietFrom || quietTo) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => changeQuietHours('', '')}
                >
                  {t('common_clear')}
                </Button>
              )}
            </div>
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_buddy_quiet_hours_description')}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
