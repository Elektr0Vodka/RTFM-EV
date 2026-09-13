import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../../../api';
import { useT } from '../../../../i18n';
import type { HealthStatus } from '../../../../types';
import { ConfigOverviewCard } from './ConfigOverviewCard';
import { ConfigModeCard } from './ConfigModeCard';
import { ConfigRadioCard } from './ConfigRadioCard';
import { ConfigBackupRestoreCard } from './ConfigBackupRestoreCard';

interface Props {
  health: HealthStatus | null;
}

/**
 * Detection- and config-gated OpenHop config pane. Reads the node config on mount
 * to seed the current mode; composes the overview/mode/radio/backup cards.
 */
export function OpenHopConfigPane({ health }: Props) {
  const t = useT();
  const isOpenHop = health?.radio_device_info?.is_openhop ?? false;
  const [mode, setMode] = useState<string | undefined>(undefined);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setNotConfigured(false);
    try {
      const res = await api.getOpenHopConfigExport();
      const cfg = res.data?.config as Record<string, unknown> | undefined;
      const rep = cfg?.repeater as Record<string, unknown> | undefined;
      if (typeof rep?.mode === 'string') setMode(rep.mode);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setNotConfigured(true);
      else setError(t('openhop_config_load_failed'));
    } finally {
      setLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    if (isOpenHop) void load();
  }, [isOpenHop, load]);

  if (!isOpenHop) return null;
  if (!loaded) return null;
  if (notConfigured) {
    return <p className="text-xs text-muted-foreground">{t('openhop_config_configure_first')}</p>;
  }

  return (
    <div className="space-y-4">
      <ConfigOverviewCard />
      <div className="border-t pt-3">
        <ConfigModeCard currentMode={mode} />
      </div>
      <div className="border-t pt-3">
        <ConfigRadioCard />
      </div>
      <div className="border-t pt-3">
        <ConfigBackupRestoreCard />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
