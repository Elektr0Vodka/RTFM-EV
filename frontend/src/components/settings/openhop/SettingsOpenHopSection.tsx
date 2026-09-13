import { useState } from 'react';
import type { AppSettings, AppSettingsUpdate, HealthStatus } from '../../../types';
import { useT } from '../../../i18n';
import { OpenHopPolicyPane } from './OpenHopPolicyPane';
import { OpenHopPluginsPane } from './plugins/OpenHopPluginsPane';
import { OpenHopConfigPane } from './config/OpenHopConfigPane';

interface Props {
  health: HealthStatus | null;
  appSettings: AppSettings;
  onSaveAppSettings: (u: AppSettingsUpdate) => Promise<void>;
}

type OpenHopTab = 'policy' | 'plugins' | 'config';

/**
 * Detection-gated OpenHop settings section. Hosts an internal sub-nav over the
 * OpenHop management panes (Policy, Plugins). Renders nothing for non-OpenHop nodes.
 */
export function SettingsOpenHopSection(props: Props) {
  const t = useT();
  const isOpenHop = props.health?.radio_device_info?.is_openhop ?? false;
  const [tab, setTab] = useState<OpenHopTab>('policy');
  if (!isOpenHop) return null;

  const tabBtn = (id: OpenHopTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={
        'rounded-md px-3 py-1 text-xs ' +
        (tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')
      }
      aria-pressed={tab === id}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="OpenHop">
        {tabBtn('policy', t('openhop_tab_policy'))}
        {tabBtn('plugins', t('openhop_tab_plugins'))}
        {tabBtn('config', t('openhop_tab_config'))}
      </div>
      {tab === 'policy' && <OpenHopPolicyPane {...props} />}
      {tab === 'plugins' && <OpenHopPluginsPane health={props.health} />}
      {tab === 'config' && <OpenHopConfigPane health={props.health} />}
    </div>
  );
}
