import { useState } from 'react';
import { api } from '../../../../api';
import type { OpenHopCadResult, OpenHopCadManualCheckParams } from '../../../../types';
import { useT } from '../../../../i18n';
import { CadStreamLog } from './CadStreamLog';

const SYMBOL_OPTIONS = [1, 2, 4, 8, 16];

/**
 * OpenHop CAD calibration pane. Runs manual CAD checks and shows detection
 * metrics, streams a live calibration run, and saves calibrated peak/min values
 * behind an explicit confirm. Meaningful detection metrics require real RF
 * hardware; against a no-radio node the checks report no detections.
 */
export function OpenHopCadPane() {
  const t = useT();
  const [samples, setSamples] = useState(4);
  const [detPeak, setDetPeak] = useState<number | ''>('');
  const [detMin, setDetMin] = useState<number | ''>('');
  const [symbols, setSymbols] = useState(2);
  const [applyLive, setApplyLive] = useState(false);
  const [result, setResult] = useState<OpenHopCadResult['data'] | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [savePeak, setSavePeak] = useState(127);
  const [saveMin, setSaveMin] = useState(64);
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setError(null);
    const params: OpenHopCadManualCheckParams = { samples, cad_symbol_num: symbols };
    if (detPeak !== '') params.det_peak = detPeak;
    if (detMin !== '') params.det_min = detMin;
    if (applyLive) params.apply_live = true;
    try {
      const r = await api.openHopCadManualCheck(params);
      setResult(r.data ?? null);
    } catch (e) {
      setError(String(e));
    }
  };
  const start = async () => {
    setError(null);
    try {
      await api.openHopCadStart(samples, 100);
      setStreaming(true);
    } catch (e) {
      setError(String(e));
    }
  };
  const stop = async () => {
    try {
      await api.openHopCadStop();
    } catch (e) {
      setError(String(e));
    }
  };
  const save = async () => {
    setConfirmingSave(false);
    setError(null);
    try {
      await api.openHopCadSave(savePeak, saveMin, symbols);
    } catch (e) {
      setError(String(e));
    }
  };

  const pct = (v: number | undefined) => (v == null ? '-' : `${Math.round(v * 100)}%`);

  return (
    <div className="space-y-3 text-sm">
      <div className="text-xs text-muted-foreground">{t('openhop_cad_hw_note')}</div>

      <div className="rounded-md border border-border p-3 space-y-2">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_cad_samples')}
            <input
              type="number"
              min={1}
              max={32}
              value={samples}
              onChange={(e) => setSamples(Number(e.target.value))}
              className="mt-0.5 w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_cad_peak')}
            <input
              type="number"
              min={0}
              max={255}
              value={detPeak}
              onChange={(e) => setDetPeak(e.target.value === '' ? '' : Number(e.target.value))}
              className="mt-0.5 w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_cad_min')}
            <input
              type="number"
              min={0}
              max={255}
              value={detMin}
              onChange={(e) => setDetMin(e.target.value === '' ? '' : Number(e.target.value))}
              className="mt-0.5 w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_cad_symbols')}
            <select
              value={symbols}
              onChange={(e) => setSymbols(Number(e.target.value))}
              className="mt-0.5 w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              {SYMBOL_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={applyLive}
              onChange={(e) => setApplyLive(e.target.checked)}
            />
            {t('openhop_cad_apply_live')}
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
            onClick={() => void runCheck()}
          >
            {t('openhop_cad_manual_check')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-xs"
            onClick={() => void start()}
          >
            {t('openhop_cad_start')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1 text-xs"
            onClick={() => void stop()}
          >
            {t('openhop_cad_stop')}
          </button>
        </div>
      </div>

      {result && (
        <div className="rounded-md border border-border p-3 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              {t('openhop_cad_detections')}: {result.detections ?? 0} / {result.attempts ?? 0}
            </span>
            <span>
              {t('openhop_cad_rate')}: {pct(result.detection_rate)}
            </span>
            <span>
              {t('openhop_cad_detected')}: {result.detected ? '✓' : '✗'}
            </span>
          </div>
        </div>
      )}

      {streaming && <CadStreamLog onDone={() => setStreaming(false)} />}

      <div className="rounded-md border border-border p-3 space-y-2">
        <div className="text-xs font-medium">{t('openhop_cad_save')}</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_cad_peak')}
            <input
              type="number"
              min={0}
              max={255}
              value={savePeak}
              onChange={(e) => setSavePeak(Number(e.target.value))}
              className="mt-0.5 w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <label className="flex flex-col text-xs text-muted-foreground">
            {t('openhop_cad_min')}
            <input
              type="number"
              min={0}
              max={255}
              value={saveMin}
              onChange={(e) => setSaveMin(Number(e.target.value))}
              className="mt-0.5 w-20 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground"
            onClick={() => setConfirmingSave(true)}
          >
            {t('openhop_cad_save')}
          </button>
        </div>
        {confirmingSave && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2">
            <div className="mb-2 text-xs">{t('openhop_cad_save_confirm')}</div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-destructive px-3 py-1 text-xs text-destructive-foreground"
                onClick={() => void save()}
              >
                {t('openhop_cad_save')}
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-xs"
                onClick={() => setConfirmingSave(false)}
              >
                {t('common_cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}
