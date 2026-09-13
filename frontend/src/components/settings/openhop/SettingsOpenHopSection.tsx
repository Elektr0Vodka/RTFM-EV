import { useState } from 'react';
import type { AppSettings, AppSettingsUpdate, HealthStatus } from '../../../types';
import { useT } from '../../../i18n';
import { OpenHopPolicyPane } from './OpenHopPolicyPane';
import { OpenHopPluginsPane } from './plugins/OpenHopPluginsPane';
import { OpenHopConfigPane } from './config/OpenHopConfigPane';
import { OpenHopSystemPane } from './system/OpenHopSystemPane';
import { OpenHopUpdatePane } from './update/OpenHopUpdatePane';
import { OpenHopCadPane } from './cad/OpenHopCadPane';
import { OpenHopTransportPane } from './transport/OpenHopTransportPane';
import { OpenHopMqttPane } from './mqtt/OpenHopMqttPane';

interface Props {
  health: HealthStatus | null;
  appSettings: AppSettings;
  onSaveAppSettings: (u: AppSettingsUpdate) => Promise<void>;
}

type OpenHopTab =
  | 'policy'
  | 'plugins'
  | 'config'
  | 'system'
  | 'update'
  | 'cad'
  | 'transport'
  | 'mqtt';

const NODE_TABS: OpenHopTab[] = ['config', 'system', 'update', 'cad'];
const MESH_TABS: OpenHopTab[] = ['policy', 'plugins', 'transport', 'mqtt'];

/**
 * Detection-gated OpenHop settings section. Hosts a two-row sub-nav over the
 * OpenHop management panes: a "Node" row (Config, System, Update, CAD) and a
 * "Mesh" row (Policy, Plugins, Transport, MQTT). Renders nothing for non-OpenHop
 * nodes.
 */
export function SettingsOpenHopSection(props: Props) {
  const t = useT();
  const isOpenHop = props.health?.radio_device_info?.is_openhop ?? false;
  const [tab, setTab] = useState<OpenHopTab>('policy');
  if (!isOpenHop) return null;

  const labels: Record<OpenHopTab, string> = {
    policy: t('openhop_tab_policy'),
    plugins: t('openhop_tab_plugins'),
    config: t('openhop_tab_config'),
    system: t('openhop_tab_system'),
    update: t('openhop_tab_update'),
    cad: t('openhop_tab_cad'),
    transport: t('openhop_tab_transport'),
    mqtt: t('openhop_tab_mqtt'),
  };

  const tabBtn = (id: OpenHopTab) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={
        'rounded-md px-3 py-1 text-xs ' +
        (tab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')
      }
      aria-pressed={tab === id}
    >
      {labels[id]}
    </button>
  );

  const row = (title: string, tabs: OpenHopTab[]) => (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] uppercase text-muted-foreground">{title}</span>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={title}>
        {tabs.map(tabBtn)}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {row(t('openhop_group_node'), NODE_TABS)}
        {row(t('openhop_group_mesh'), MESH_TABS)}
      </div>
      {tab === 'policy' && <OpenHopPolicyPane {...props} />}
      {tab === 'plugins' && <OpenHopPluginsPane health={props.health} />}
      {tab === 'config' && <OpenHopConfigPane health={props.health} />}
      {tab === 'system' && <OpenHopSystemPane />}
      {tab === 'update' && <OpenHopUpdatePane />}
      {tab === 'cad' && <OpenHopCadPane />}
      {tab === 'transport' && <OpenHopTransportPane />}
      {tab === 'mqtt' && <OpenHopMqttPane />}
    </div>
  );
}
