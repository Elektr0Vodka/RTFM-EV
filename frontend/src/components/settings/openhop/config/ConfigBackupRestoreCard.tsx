import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import { Checkbox } from '../../../ui/checkbox';
import { Label } from '../../../ui/label';

/**
 * Back up (download JSON, redacted by default or full with secrets) and restore
 * (upload JSON -> config_import) the node config. Restore is guarded by a confirm;
 * on restart_required a Restart button applies the change.
 */
export function ConfigBackupRestoreCard() {
  const t = useT();
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportConfig = async () => {
    setBusy(true);
    try {
      const res = await api.getOpenHopConfigExport(includeSecrets);
      if (!res.success || !res.data) {
        toast.error(res.error || t('openhop_config_export_failed'));
        return;
      }
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openhop-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('openhop_config_export_failed'));
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        toast.error(t('openhop_config_import_bad_file'));
        return;
      }
      const obj = parsed as Record<string, unknown>;
      const data = obj?.data as Record<string, unknown> | undefined;
      const config = (data?.config ?? obj?.config ?? obj) as Record<string, unknown>;
      if (!config || typeof config !== 'object') {
        toast.error(t('openhop_config_import_bad_file'));
        return;
      }
      if (!window.confirm(t('openhop_config_import_confirm'))) return;
      void doImport(config);
    };
    reader.readAsText(file);
  };

  const doImport = async (config: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await api.importOpenHopConfig(config);
      if (res.success) {
        toast.success(
          t('openhop_config_import_ok', { sections: res.sections_updated?.length ?? 0 })
        );
        setRestartRequired(Boolean(res.restart_required));
      } else {
        toast.error(res.error || t('openhop_config_import_failed'));
      }
    } catch {
      toast.error(t('openhop_config_import_failed'));
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    if (!window.confirm(t('openhop_config_restart_confirm'))) return;
    try {
      const res = await api.restartOpenHopService();
      if (res.success) toast.success(t('openhop_config_restart_ok'));
      else toast.error(res.error || t('openhop_config_restart_failed'));
    } catch {
      toast.error(t('openhop_config_restart_failed'));
    }
  };

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium">{t('openhop_config_backup_title')}</h4>
      <div className="flex items-center gap-2">
        <Checkbox
          id="oh-secrets"
          checked={includeSecrets}
          onCheckedChange={(v) => setIncludeSecrets(v === true)}
        />
        <Label htmlFor="oh-secrets" className="text-xs">
          {t('openhop_config_export_secrets')}
        </Label>
      </div>
      {includeSecrets && (
        <p className="text-xs text-destructive">{t('openhop_config_export_secrets_warning')}</p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={() => void exportConfig()}>
          {t('openhop_config_export')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {t('openhop_config_import')}
        </Button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onFile} />
      </div>
      {restartRequired && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">{t('openhop_config_restart_required')}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void restart()}>
            {t('openhop_config_restart_now')}
          </Button>
        </div>
      )}
    </section>
  );
}
