import { useEffect, useState } from 'react';

import { useT } from '../../i18n';
import type {
  AppSettingsUpdate,
  Channel,
  TeamBeaconSettings as TeamBeaconConfig,
} from '../../types';
import { isPublicChannelKey } from '../../utils/publicChannel';
import { Button } from '../ui/button';
import { toast } from '../ui/sonner';

const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 3600;

/**
 * Master toggle, channel and interval for the periodic MeshCore TEAM #TEL:
 * beacon (app_settings.team_beacon). Off by default; when on, the backend
 * transmits this radio's advertised position on the chosen private channel.
 */
export function TeamBeaconSettings({
  config,
  channels,
  onSaveAppSettings,
}: {
  config: TeamBeaconConfig;
  channels: Channel[];
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState(config.enabled);
  const [channelKey, setChannelKey] = useState(config.channel_key);
  const [intervalText, setIntervalText] = useState(String(config.interval_seconds));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(config.enabled);
    setChannelKey(config.channel_key);
    setIntervalText(String(config.interval_seconds));
  }, [config.enabled, config.channel_key, config.interval_seconds]);

  // TEAM keeps tracking traffic off public and hashtag channels; so do we.
  const privateChannels = channels.filter((c) => !c.is_hashtag && !isPublicChannelKey(c.key));

  const save = async () => {
    const parsed = Number.parseInt(intervalText, 10);
    const seconds = Number.isFinite(parsed)
      ? Math.min(MAX_INTERVAL_SECONDS, Math.max(MIN_INTERVAL_SECONDS, parsed))
      : config.interval_seconds;
    setSaving(true);
    try {
      await onSaveAppSettings({
        team_beacon: { enabled, channel_key: channelKey, interval_seconds: seconds },
      });
      setIntervalText(String(seconds));
    } catch (err) {
      toast.error(t('settings_team_beacon_save_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="team-beacon-settings">
      <h3 className="text-base font-semibold tracking-tight">
        {t('settings_team_beacon_heading')}
      </h3>
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_team_beacon_desc')}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t('settings_team_beacon_enable')}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t('settings_team_beacon_channel')}</span>
        <select
          className="w-full text-sm rounded border border-border bg-background p-2"
          value={channelKey}
          onChange={(e) => setChannelKey(e.target.value)}
        >
          <option value="">{t('settings_team_beacon_channel_none')}</option>
          {privateChannels.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{t('settings_team_beacon_interval')}</span>
        <input
          type="number"
          min={MIN_INTERVAL_SECONDS}
          max={MAX_INTERVAL_SECONDS}
          value={intervalText}
          onChange={(e) => setIntervalText(e.target.value)}
          className="w-32 rounded border border-border bg-background p-2 text-sm"
        />
      </label>
      <p className="text-xs text-muted-foreground">{t('settings_team_beacon_interval_help')}</p>
      <p className="text-xs text-muted-foreground">{t('settings_team_beacon_position_help')}</p>
      <Button type="button" onClick={save} disabled={saving || (enabled && !channelKey)}>
        {t('settings_team_beacon_save')}
      </Button>
    </div>
  );
}
