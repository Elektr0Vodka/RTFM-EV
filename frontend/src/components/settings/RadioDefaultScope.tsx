import { useCallback, useEffect, useState } from 'react';
import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { RadioDefaultFloodScope } from '../../types';
import { stripRegionScopePrefix } from '../../utils/regionScope';
import { Button } from '../ui/button';

interface Props {
  connected: boolean;
  /** The app's outbound "Flood Scope / Region" value as edited (no `#`). */
  appFloodScope: string;
}

/**
 * Read-only line under the outbound flood scope: the default region configured
 * on the radio itself (companion CMD_GET_DEFAULT_FLOOD_SCOPE), the DMC
 * `config` topic's `region.default` seen from the companion side. RTFM-EV's
 * own setting is a per-send override, so the two can legitimately differ; the
 * hint only points that out.
 */
export function RadioDefaultScope({ connected, appFloodScope }: Props) {
  const t = useT();
  const [scope, setScope] = useState<RadioDefaultFloodScope | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setFailed(false);
    try {
      setScope(await api.getRadioDefaultFloodScope(signal));
    } catch (err) {
      if (isAbortError(err)) return;
      setScope(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!connected) {
      setScope(null);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [connected, load]);

  if (!connected) return null;

  const radioScope = scope?.scope_name ? stripRegionScopePrefix(scope.scope_name) : '';
  const appScope = appFloodScope.trim();
  let value: string;
  if (failed) value = t('settings_radio_default_scope_error');
  else if (!scope) value = '…';
  else if (!scope.supported) value = t('settings_radio_default_scope_unsupported');
  else value = radioScope || t('settings_radio_default_scope_none');
  const differs =
    !!scope?.supported && radioScope !== '' && radioScope.toLowerCase() !== appScope.toLowerCase();

  return (
    <div className="space-y-1" data-testid="radio-default-scope">
      <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted-foreground">
        <span>{t('settings_radio_default_scope_label')}</span>
        <span className="font-mono text-foreground" data-testid="radio-default-scope-value">
          {value}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => void load()}
          disabled={loading}
        >
          {t('settings_radio_default_scope_refresh')}
        </Button>
      </div>
      <p className="text-[0.8125rem] text-muted-foreground">
        {t('settings_radio_default_scope_desc')}
        {differs ? ` ${t('settings_radio_default_scope_differs')}` : ''}
      </p>
    </div>
  );
}
