import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../../../api';
import { useT } from '../../../../i18n';
import { Button } from '../../../ui/button';
import { Input } from '../../../ui/input';
import { Label } from '../../../ui/label';
import type { OpenHopRadioPreset } from '../../../../types';

interface Fields {
  frequency: string; // MHz
  bandwidth: string; // kHz
  spreading_factor: string;
  coding_rate: string;
  tx_power: string;
  node_name: string;
}
const EMPTY: Fields = {
  frequency: '',
  bandwidth: '',
  spreading_factor: '',
  coding_rate: '',
  tx_power: '',
  node_name: '',
};

/**
 * Edit the node's radio parameters. Presets prefill the form. Save is guarded by
 * a confirm (freq/bw/SF/CR changes need a restart and can drop the node off-mesh);
 * on restart_required a Restart button applies the change.
 */
export function ConfigRadioCard() {
  const t = useT();
  const [presets, setPresets] = useState<OpenHopRadioPreset[]>([]);
  const [f, setF] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    void api
      .getOpenHopPresets()
      .then((r) => setPresets(r.presets ?? []))
      .catch(() => setPresets([]));
  }, []);

  const applyPreset = (title: string) => {
    const p = presets.find((x) => x.title === title);
    if (!p) return;
    setF((prev) => ({
      ...prev,
      frequency: p.frequency ?? prev.frequency,
      bandwidth: p.bandwidth ?? prev.bandwidth,
      spreading_factor: p.spreading_factor ?? prev.spreading_factor,
      coding_rate: p.coding_rate ?? prev.coding_rate,
    }));
  };

  const buildParams = (): Record<string, number | string> => {
    const p: Record<string, number | string> = {};
    if (f.frequency.trim()) p.frequency = Math.round(parseFloat(f.frequency) * 1_000_000);
    if (f.bandwidth.trim()) p.bandwidth = Math.round(parseFloat(f.bandwidth) * 1000);
    if (f.spreading_factor.trim()) p.spreading_factor = parseInt(f.spreading_factor, 10);
    if (f.coding_rate.trim()) p.coding_rate = parseInt(f.coding_rate, 10);
    if (f.tx_power.trim()) p.tx_power = parseInt(f.tx_power, 10);
    if (f.node_name.trim()) p.node_name = f.node_name.trim();
    return p;
  };

  const save = async () => {
    const params = buildParams();
    if (Object.keys(params).length === 0) return;
    if (!window.confirm(t('openhop_config_radio_confirm'))) return;
    setBusy(true);
    try {
      const res = await api.updateOpenHopRadio(params);
      if (res.success) {
        toast.success(t('openhop_config_radio_saved'));
        setRestartRequired(Boolean(res.data?.restart_required));
      } else {
        toast.error(res.error || t('openhop_config_radio_failed'));
      }
    } catch {
      toast.error(t('openhop_config_radio_failed'));
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

  const field = (key: keyof Fields, label: string) => (
    <div className="space-y-1">
      <Label htmlFor={`ohr-${key}`}>{label}</Label>
      <Input
        id={`ohr-${key}`}
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <section className="space-y-3">
      <h4 className="text-sm font-medium">{t('openhop_config_radio_title')}</h4>
      {presets.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="ohr-preset">{t('openhop_config_radio_preset')}</Label>
          <select
            id="ohr-preset"
            className="w-full rounded-md border bg-background px-2 py-1 text-sm"
            defaultValue=""
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="" disabled>
              {t('openhop_config_radio_preset_placeholder')}
            </option>
            {presets.map((p) => (
              <option key={p.title} value={p.title}>
                {p.title} {p.description ? `(${p.description})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {field('frequency', t('openhop_config_radio_frequency'))}
        {field('bandwidth', t('openhop_config_radio_bandwidth'))}
        {field('spreading_factor', t('openhop_config_radio_sf'))}
        {field('coding_rate', t('openhop_config_radio_cr'))}
        {field('tx_power', t('openhop_config_radio_tx_power'))}
        {field('node_name', t('openhop_config_radio_node_name'))}
      </div>
      <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
        {t('openhop_config_radio_save')}
      </Button>
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
