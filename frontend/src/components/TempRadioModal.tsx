import { useEffect, useMemo, useState } from 'react';

import { api } from '../api';
import { matchPreset, useRadioPresetList } from '../hooks/useRadioPresetList';
import { useT } from '../i18n';
import type { FanoutConfig, RadioStamp, TempRadioOptIns } from '../types';
import { formatRadioStamp, parseRadioFields } from '../utils/radioSf';
import { setCurrentRadioStamp, setTempRadioState, useTempRadioState } from '../utils/tempRadio';
import { TempRadioScanTab } from './TempRadioScanTab';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const SELECT_CLASS =
  'w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2';

const NO_OPT_INS: TempRadioOptIns = {
  adverts: false,
  team_beacon: false,
  telemetry: false,
  client_repeat: false,
  polls: false,
  fanout_ids: [],
};

type OptInFlag = 'adverts' | 'team_beacon' | 'telemetry' | 'client_repeat' | 'polls';
const OPT_IN_FLAGS: { key: OptInFlag; label: string }[] = [
  { key: 'adverts', label: 'temp_radio_optin_adverts' },
  { key: 'team_beacon', label: 'temp_radio_optin_team_beacon' },
  { key: 'telemetry', label: 'temp_radio_optin_telemetry' },
  { key: 'client_repeat', label: 'temp_radio_optin_client_repeat' },
  { key: 'polls', label: 'temp_radio_optin_polls' },
];

interface TempRadioModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The radio's current settings (shown as "normal" when no session runs). */
  normal: RadioStamp | null;
  /** Prefill, for example a contact's saved settings. */
  initial?: { radio?: RadioStamp; region?: string | null };
}

/** Checkboxes for what keeps running during a session (spec 4.5); shared with scan lists. */
export function TempRadioOptInFields({
  value,
  onChange,
  idPrefix,
  open,
}: {
  value: TempRadioOptIns;
  onChange: (next: TempRadioOptIns) => void;
  idPrefix: string;
  open: boolean;
}) {
  const t = useT();
  const [integrations, setIntegrations] = useState<FanoutConfig[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .getFanoutConfigs()
      .then((configs) => {
        if (!cancelled) setIntegrations(configs.filter((c) => c.enabled));
      })
      .catch(() => setIntegrations([]));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggleFanout = (id: string, checked: boolean) => {
    const ids = new Set(value.fanout_ids);
    if (checked) ids.add(id);
    else ids.delete(id);
    onChange({ ...value, fanout_ids: [...ids] });
  };

  return (
    <fieldset className="space-y-1.5 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">{t('temp_radio_keep_running_heading')}</legend>
      <p className="text-xs text-muted-foreground">{t('temp_radio_keep_running_hint')}</p>
      {OPT_IN_FLAGS.map(({ key, label }) => (
        <label key={key} className="flex items-center gap-2 text-sm">
          <input
            id={`${idPrefix}-${key}`}
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
          {t(label)}
        </label>
      ))}
      {integrations.map((config) => (
        <label key={config.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={value.fanout_ids.includes(config.id)}
            onChange={(e) => toggleFanout(config.id, e.target.checked)}
          />
          {t('temp_radio_optin_integration', { name: config.name })}
        </label>
      ))}
    </fieldset>
  );
}

export function TempRadioModal({ open, onOpenChange, normal, initial }: TempRadioModalProps) {
  const t = useT();
  const session = useTempRadioState();
  const presets = useRadioPresetList(open);

  const [freq, setFreq] = useState('');
  const [bw, setBw] = useState('');
  const [sf, setSf] = useState('');
  const [cr, setCr] = useState('');
  const [region, setRegion] = useState('');
  const [mode, setMode] = useState<'temporary' | 'normal'>('temporary');
  const [duration, setDuration] = useState('30');
  const [unit, setUnit] = useState<'minutes' | 'hours'>('minutes');
  const [optIns, setOptIns] = useState<TempRadioOptIns>(NO_OPT_INS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fill the form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    const start = initial?.radio ?? (session.active ? session.temp : null) ?? normal;
    setFreq(start ? String(start.freq) : '');
    setBw(start ? String(start.bw) : '');
    setSf(start ? String(start.sf) : '');
    setCr(start ? String(start.cr) : '');
    setRegion(initial?.region ?? '');
    setMode('temporary');
    setDuration('30');
    setUnit('minutes');
    setOptIns(session.active ? session.opt_ins : NO_OPT_INS);
    setError(null);
    // Only on open: later session updates must not reset what the user typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const preset = useMemo(
    () =>
      matchPreset(presets, {
        freq: Number.parseFloat(freq),
        bw: Number.parseFloat(bw),
        sf: Number(sf),
        cr: Number(cr),
      }),
    [presets, freq, bw, sf, cr]
  );

  const applyPreset = (name: string) => {
    const found = presets.find((p) => p.name === name);
    if (!found) return;
    setFreq(String(found.freq));
    setBw(String(found.bw));
    setSf(String(found.sf));
    setCr(String(found.cr));
  };

  const normalShown = session.active && session.original ? session.original : normal;

  const submit = async () => {
    const parsed = parseRadioFields({ freq, bw, sf, cr });
    if (parsed.error) {
      setError(t(parsed.error));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (mode === 'normal') {
        const saved = await api.updateRadioConfig(
          session.active ? { radio: parsed.stamp, end_temp_session: true } : { radio: parsed.stamp }
        );
        // The pills compare against "normal": follow the new one right away.
        if (saved?.radio) setCurrentRadioStamp(saved.radio);
      } else {
        const amount = Number(duration);
        if (!Number.isFinite(amount) || amount <= 0) {
          setError(t('temp_radio_error_duration'));
          return;
        }
        const seconds = Math.round(amount * (unit === 'hours' ? 3600 : 60));
        const trimmedRegion = region.trim();
        setTempRadioState(
          await api.startTempRadio({
            radio: parsed.stamp,
            duration_secs: seconds,
            region: trimmedRegion.length > 0 ? trimmedRegion : null,
            opt_ins: optIns,
          })
        );
      }
      onOpenChange(false);
    } catch (err) {
      setError(t('temp_radio_failed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      setTempRadioState(await api.restoreTempRadio());
      onOpenChange(false);
    } catch (err) {
      setError(
        t('temp_radio_restore_failed', { error: err instanceof Error ? err.message : String(err) })
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('temp_radio_title')}</DialogTitle>
          <DialogDescription>{t('temp_radio_description')}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="switch">
          <TabsList className="w-full">
            <TabsTrigger value="switch" className="flex-1">
              {t('temp_radio_tab_switch')}
            </TabsTrigger>
            <TabsTrigger value="scan" className="flex-1">
              {t('temp_radio_tab_scan')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="switch" className="space-y-4">
            {normalShown && (
              <p className="text-xs text-muted-foreground">
                {t('temp_radio_normal_settings', { settings: formatRadioStamp(normalShown) })}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="temp-radio-preset">{t('temp_radio_preset_label')}</Label>
              <select
                id="temp-radio-preset"
                className={SELECT_CLASS}
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option value="custom">{t('temp_radio_preset_custom')}</option>
                {presets.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="temp-radio-freq">{t('temp_radio_freq_label')}</Label>
                <Input
                  id="temp-radio-freq"
                  inputMode="decimal"
                  value={freq}
                  onChange={(e) => setFreq(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="temp-radio-bw">{t('temp_radio_bw_label')}</Label>
                <Input
                  id="temp-radio-bw"
                  inputMode="decimal"
                  value={bw}
                  onChange={(e) => setBw(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="temp-radio-sf">{t('temp_radio_sf_label')}</Label>
                <Input
                  id="temp-radio-sf"
                  inputMode="numeric"
                  value={sf}
                  onChange={(e) => setSf(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="temp-radio-cr">{t('temp_radio_cr_label')}</Label>
                <Input
                  id="temp-radio-cr"
                  inputMode="numeric"
                  value={cr}
                  onChange={(e) => setCr(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm" role="radiogroup">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="temp-radio-mode"
                  className="accent-primary"
                  checked={mode === 'temporary'}
                  onChange={() => setMode('temporary')}
                />
                {t('temp_radio_mode_temporary')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="temp-radio-mode"
                  className="accent-primary"
                  checked={mode === 'normal'}
                  onChange={() => setMode('normal')}
                />
                {t('temp_radio_mode_new_normal')}
              </label>
            </div>

            {mode === 'temporary' && (
              <>
                <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="temp-radio-duration">{t('temp_radio_duration_label')}</Label>
                    <Input
                      id="temp-radio-duration"
                      inputMode="decimal"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    />
                  </div>
                  <select
                    aria-label={t('temp_radio_duration_unit_label')}
                    className={SELECT_CLASS}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as 'minutes' | 'hours')}
                  >
                    <option value="minutes">{t('temp_radio_unit_minutes')}</option>
                    <option value="hours">{t('temp_radio_unit_hours')}</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="temp-radio-region">{t('temp_radio_region_label')}</Label>
                  <Input
                    id="temp-radio-region"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t('temp_radio_region_hint')}</p>
                </div>

                <TempRadioOptInFields
                  value={optIns}
                  onChange={setOptIns}
                  idPrefix="temp-radio-optin"
                  open={open}
                />

                <p className="text-xs text-warning">{t('temp_radio_warning')}</p>
              </>
            )}

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}

            <DialogFooter className="gap-2">
              {session.active && (
                <Button type="button" variant="outline" disabled={busy} onClick={restore}>
                  {t('temp_radio_restore_now')}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('temp_radio_cancel')}
              </Button>
              <Button type="button" disabled={busy} onClick={submit}>
                {mode === 'normal' ? t('temp_radio_save_new_normal') : t('temp_radio_start')}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="scan">
            <TempRadioScanTab open={open} normal={normalShown ?? null} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
