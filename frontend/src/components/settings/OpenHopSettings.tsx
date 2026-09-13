import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { AppSettings, AppSettingsUpdate, HealthStatus, OpenHopStatus } from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { useT } from '../../i18n';

interface Props {
  health: HealthStatus | null;
  appSettings: AppSettings;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
}

/**
 * Detection-gated config for the opt-in OpenHop REST management surface.
 *
 * Renders nothing unless the connected radio is detected as OpenHop, so
 * non-OpenHop nodes are entirely unaffected. Lets the user store the node's
 * REST API url + token (persisted in app settings); the actual management
 * panes are gated on this configuration and built separately.
 */
export function OpenHopSettings({ health, appSettings, onSaveAppSettings }: Props) {
  const t = useT();
  const isOpenHop = health?.radio_device_info?.is_openhop ?? false;
  const [url, setUrl] = useState(appSettings.openhop_api_url ?? '');
  // Write-only: the token is never returned by the API, so the input starts empty
  // and a blank value on save keeps the currently stored token.
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OpenHopStatus | null>(null);

  useEffect(() => {
    if (!isOpenHop) return;
    let active = true;
    api
      .getOpenHopStatus()
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        // Status is advisory; a transient failure must not break the form.
      });
    return () => {
      active = false;
    };
  }, [isOpenHop]);

  if (!isOpenHop) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const update: AppSettingsUpdate = { openhop_api_url: url.trim() };
      const trimmedToken = token.trim();
      if (trimmedToken) update.openhop_api_token = trimmedToken;
      await onSaveAppSettings(update);
      setToken('');
      try {
        setStatus(await api.getOpenHopStatus());
      } catch {
        // Advisory refresh only.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings_openhop_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Separator />
      <h3 className="text-base font-semibold tracking-tight">{t('settings_openhop_heading')}</h3>
      <p className="text-xs text-muted-foreground">{t('settings_openhop_desc')}</p>

      <div className="space-y-2">
        <Label htmlFor="openhop-api-url">{t('settings_openhop_url_label')}</Label>
        <Input
          id="openhop-api-url"
          type="url"
          value={url}
          placeholder="http://127.0.0.1:8000"
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="openhop-api-token">{t('settings_openhop_token_label')}</Label>
        <Input
          id="openhop-api-token"
          type="password"
          autoComplete="off"
          value={token}
          placeholder={t('settings_openhop_token_placeholder')}
          onChange={(e) => setToken(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('settings_openhop_token_desc')}</p>
      </div>

      {status && (
        <p className="text-xs text-muted-foreground">
          {status.configured
            ? t('settings_openhop_status_configured')
            : t('settings_openhop_status_unconfigured')}
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button type="button" disabled={saving} onClick={save}>
        {t('settings_openhop_save')}
      </Button>
    </div>
  );
}
