import { useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopPlugin } from '../../../../types';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import { Checkbox } from '../../../ui/checkbox';
import { Label } from '../../../ui/label';
import { PluginLogsView } from './PluginLogsView';
import { PluginSettingsEditor } from './PluginSettingsEditor';

interface Props {
  plugin: OpenHopPlugin;
  /** Re-fetch the installed list after an action. */
  onReload: () => void;
  /** Open the live progress log for this plugin id (install/update). */
  onOperate: (id: string) => void;
  setError: (msg: string | null) => void;
}

type DetailTab = 'logs' | 'settings';

/** One installed plugin: status, lifecycle actions, and an expandable detail area. */
export function PluginCard({ plugin, onReload, onOperate, setError }: Props) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('logs');
  const [confirmingUninstall, setConfirmingUninstall] = useState(false);
  const [deleteData, setDeleteData] = useState(false);

  // OpenHop's runtime state is uppercase (RUNNING/STOPPED/DISABLED); normalize it.
  const stateLc = (plugin.state ?? '').toLowerCase();
  const disabled = plugin.enabled === false || stateLc === 'disabled';
  const running = plugin.running === true || stateLc === 'running';
  const badge = disabled
    ? t('openhop_plugin_state_disabled')
    : running
      ? t('openhop_plugin_state_running')
      : t('openhop_plugin_state_stopped');

  const run = async (fn: Promise<{ success: boolean; error?: string }>) => {
    setError(null);
    try {
      const res = await fn;
      if (!res.success) setError(res.error ?? t('openhop_plugins_load_failed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('openhop_plugins_load_failed'));
    } finally {
      onReload();
    }
  };

  const doUninstall = async () => {
    setConfirmingUninstall(false);
    await run(api.uninstallOpenHopPlugin(plugin.id, deleteData));
  };

  const openDetail = (next: DetailTab) => {
    if (expanded && detailTab === next) {
      setExpanded(false);
    } else {
      setDetailTab(next);
      setExpanded(true);
    }
  };

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{plugin.name || plugin.id}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
              {badge}
            </span>
            {plugin.update_available && (
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
                {t('openhop_plugin_update_available')}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {plugin.id}
            {plugin.version ? ` · v${plugin.version}` : ''}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {disabled ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void run(api.openHopPluginLifecycle('enable', plugin.id))}
          >
            {t('openhop_plugin_enable')}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void run(api.openHopPluginLifecycle('disable', plugin.id))}
            >
              {t('openhop_plugin_disable')}
            </Button>
            {running ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void run(api.openHopPluginLifecycle('stop', plugin.id))}
              >
                {t('openhop_plugin_stop')}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void run(api.openHopPluginLifecycle('start', plugin.id))}
              >
                {t('openhop_plugin_start')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void run(api.openHopPluginLifecycle('restart', plugin.id))}
            >
              {t('openhop_plugin_restart')}
            </Button>
          </>
        )}
        {plugin.update_available && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void api.updateOpenHopPlugin(plugin.id);
              onOperate(plugin.id);
            }}
          >
            {t('openhop_plugin_update')}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={() => openDetail('logs')}>
          {t('openhop_plugin_logs')}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => openDetail('settings')}>
          {t('openhop_plugin_settings')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => setConfirmingUninstall(true)}
        >
          {t('openhop_plugin_uninstall')}
        </Button>
      </div>

      {confirmingUninstall && (
        <div className="mt-2 rounded-md border border-destructive/40 p-2">
          <p className="text-xs">{t('openhop_plugin_uninstall_confirm')}</p>
          <div className="mt-1 flex items-center gap-2">
            <Checkbox
              id={`del-${plugin.id}`}
              checked={deleteData}
              onCheckedChange={(v) => setDeleteData(v === true)}
            />
            <Label htmlFor={`del-${plugin.id}`} className="text-xs">
              {t('openhop_plugin_uninstall_delete_data')}
            </Label>
          </div>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => void doUninstall()}
            >
              {t('openhop_plugin_uninstall')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmingUninstall(false)}
            >
              {t('openhop_rule_cancel')}
            </Button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          {detailTab === 'logs' ? (
            <PluginLogsView id={plugin.id} />
          ) : (
            <PluginSettingsEditor id={plugin.id} />
          )}
        </div>
      )}
    </div>
  );
}
