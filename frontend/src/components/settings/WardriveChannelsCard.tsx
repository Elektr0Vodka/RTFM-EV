import { useCallback, useEffect, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { WardriveAdminConfig } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The hashtag channels wardrive drivers can read. Only the names are served;
 * a hashtag channel's key follows from its name, so drivers derive it. With no
 * owner list, drivers get the home radio's hashtag channels.
 */
export function WardriveChannelsCard() {
  const t = useT();
  const [config, setConfig] = useState<WardriveAdminConfig | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setConfig(await api.getWardriveConfig());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fromRadio = config !== null && config.hashtag_channels === null;
  const inUse = config ? (config.hashtag_channels ?? config.default_hashtag_channels) : [];

  const save = async (hashtagChannels: string[] | null) => {
    try {
      setConfig(await api.putWardriveConfig({ hashtag_channels: hashtagChannels }));
      setError(null);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await save([...inUse, trimmed])) setName('');
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="wardrive-channels">
      <h4 className="text-sm font-semibold">{t('settings_wardrive_channels_heading')}</h4>
      <p className="text-xs text-muted-foreground">{t('settings_wardrive_channels_desc')}</p>
      {fromRadio && (
        <p className="text-xs text-muted-foreground">
          {t('settings_wardrive_channels_from_radio')}
        </p>
      )}
      {config && inUse.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('settings_wardrive_channels_none')}</p>
      )}
      <ul className="flex flex-wrap gap-2">
        {inUse.map((channel) => (
          <li
            key={channel}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs"
          >
            <span>{channel}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              aria-label={t('settings_wardrive_channels_remove', { name: channel })}
              onClick={() => void save(inUse.filter((c) => c !== channel))}
            >
              <span aria-hidden="true">×</span>
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="wardrive-channel-name">{t('settings_wardrive_channels_name')}</Label>
          <Input
            id="wardrive-channel-name"
            value={name}
            placeholder="#zwolle"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
            className="w-48"
          />
        </div>
        <Button type="button" size="sm" onClick={() => void add()} disabled={!name.trim()}>
          {t('settings_wardrive_channels_add')}
        </Button>
        {config && !fromRadio && (
          <Button type="button" variant="outline" size="sm" onClick={() => void save(null)}>
            {t('settings_wardrive_channels_reset')}
          </Button>
        )}
      </div>
      {error && (
        <p className="text-xs text-destructive" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
