import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { useT, type TFn } from '../../i18n';
import type {
  RepeaterAdvertIntervalsResponse,
  RepeaterNodeInfoResponse,
  RepeaterOwnerInfoResponse,
  RepeaterRadioSettingsResponse,
  RepeaterSettingSetResponse,
  RepeaterSettingsReadResponse,
} from '../../types';
import {
  CODING_RATES,
  LORA_BANDWIDTHS_KHZ,
  SETTING_DEFS,
  SETTING_GROUPS,
  SPREADING_FACTORS,
  isUnchanged,
  parseRadio,
  toEditorValue,
  validateSetting,
  type SettingDef,
  type SettingError,
} from './repeaterSettingsDefs';

type CurrentValues = Record<string, string | null | undefined>;

export interface SettingsEditorSeed {
  radioSettings: RepeaterRadioSettingsResponse | null;
  advertIntervals: RepeaterAdvertIntervalsResponse | null;
  nodeInfo: RepeaterNodeInfoResponse | null;
  ownerInfo: RepeaterOwnerInfoResponse | null;
}

/** Values the existing read-only panes already fetched with the same `get`s. */
function seedFromPanes(seed: SettingsEditorSeed): CurrentValues {
  const out: CurrentValues = {};
  const { radioSettings, advertIntervals, nodeInfo, ownerInfo } = seed;
  if (radioSettings) {
    out['radio'] = radioSettings.radio;
    out['tx'] = radioSettings.tx_power;
    if (radioSettings.duty_cycle_limit != null) out['dutycycle'] = radioSettings.duty_cycle_limit;
    out['repeat'] = radioSettings.repeat_enabled;
    out['flood.max'] = radioSettings.flood_max;
  }
  if (advertIntervals) {
    out['advert.interval'] = advertIntervals.advert_interval;
    out['flood.advert.interval'] = advertIntervals.flood_advert_interval;
  }
  if (nodeInfo) {
    out['name'] = nodeInfo.name;
    out['lat'] = nodeInfo.lat;
    out['lon'] = nodeInfo.lon;
  }
  if (ownerInfo) {
    if (ownerInfo.guest_password != null) out['guest.password'] = ownerInfo.guest_password;
    if (ownerInfo.owner_info != null) out['owner.info'] = ownerInfo.owner_info;
  }
  return out;
}

function errorText(t: TFn, error: SettingError): string {
  return t(error.key, error.params);
}

function formatValue(t: TFn, def: SettingDef, value: string | null | undefined): string {
  if (value === undefined) return t('repeater_settings_not_read');
  if (value === null || value.trim() === '') return '-';
  const editorValue = toEditorValue(def, value);
  if (def.kind === 'choice') {
    const option = def.options?.find((o) => o.value === editorValue);
    return option?.labelKey ? t(option.labelKey) : editorValue;
  }
  if (def.kind === 'radio') {
    const parts = parseRadio(value);
    return parts
      ? t('repeater_settings_radio_display', {
          freq: parts.freq,
          bw: parts.bw,
          sf: parts.sf,
          cr: parts.cr,
        })
      : value;
  }
  if (def.key === 'dutycycle') return `${editorValue}%`;
  return editorValue;
}

function hintText(t: TFn, def: SettingDef): string | null {
  const parts: string[] = [];
  if ((def.kind === 'int' || def.kind === 'decimal') && def.min != null && def.max != null) {
    parts.push(
      t(def.allowZero ? 'repeater_settings_err_range_off' : 'repeater_settings_err_range', {
        min: def.min,
        max: def.max,
      })
    );
  }
  if (def.step) parts.push(t('repeater_settings_err_step', { step: def.step }));
  if (def.decimals) parts.push(t('repeater_settings_err_decimals', { count: def.decimals }));
  if (def.maxBytes) parts.push(t('repeater_settings_err_bytes', { count: def.maxBytes }));
  if (def.forbiddenChars) {
    parts.push(t('repeater_settings_err_chars', { chars: def.forbiddenChars.split('').join(' ') }));
  }
  return parts.length ? parts.join('. ') : null;
}

const STATUS_TONE: Record<RepeaterSettingSetResponse['status'], string> = {
  ok: 'text-success border-success/40',
  mismatch: 'text-destructive border-destructive/40',
  rejected: 'text-destructive border-destructive/40',
  unverified: 'text-warning border-warning/40',
};

function StatusBadge({ status }: { status: RepeaterSettingSetResponse['status'] }) {
  const t = useT();
  return (
    <span
      className={cn('rounded border px-1 text-[0.625rem] leading-4', STATUS_TONE[status])}
      data-testid="setting-status"
    >
      {t(`repeater_settings_status_${status}`)}
    </span>
  );
}

// --- Edit + confirm dialog ---------------------------------------------------

type Step = 'edit' | 'confirm' | 'sending' | 'result';

function SettingEditDialog({
  def,
  current,
  repeaterName,
  confirmPhrase,
  onApply,
  onApplied,
  onClose,
}: {
  def: SettingDef;
  current: string | null | undefined;
  repeaterName: string;
  confirmPhrase: string;
  onApply: (setting: string, value: string) => Promise<RepeaterSettingSetResponse>;
  onApplied: (setting: string, result: RepeaterSettingSetResponse) => void;
  onClose: () => void;
}) {
  const t = useT();
  const initial = toEditorValue(def, current);
  // No guessed defaults: the pane only opens the radio editor once the current
  // value has been read, so every field starts from what the repeater holds.
  const initialRadio = parseRadio(current ?? null) ?? { freq: '', bw: '', sf: '', cr: '' };

  const [step, setStep] = useState<Step>('edit');
  const [draft, setDraft] = useState(initial);
  const [radio, setRadio] = useState(initialRadio);
  const [error, setError] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState('');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [result, setResult] = useState<RepeaterSettingSetResponse | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  const label = t(def.labelKey);
  const rawDraft =
    def.kind === 'radio' ? `${radio.freq},${radio.bw},${radio.sf},${radio.cr}` : draft;
  const phraseOk = !def.strongConfirm || typedPhrase.trim() === confirmPhrase;

  const review = () => {
    const validated = validateSetting(def, rawDraft);
    if (!validated.ok) {
      setError(errorText(t, validated.error));
      return;
    }
    if (isUnchanged(def, current, validated.value)) {
      setError(t('repeater_settings_err_unchanged'));
      return;
    }
    setError(null);
    setPendingValue(validated.value);
    setTypedPhrase('');
    setStep('confirm');
  };

  const send = async () => {
    if (!phraseOk) return;
    setStep('sending');
    setRequestError(null);
    try {
      const res = await onApply(def.key, pendingValue);
      setResult(res);
      onApplied(def.key, res);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    }
    setStep('result');
  };

  const displayPending =
    def.kind === 'textarea' ? pendingValue.replace(/\|/g, '\n') : formatValue(t, def, pendingValue);

  return (
    <Dialog open onOpenChange={(open) => !open && step !== 'sending' && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t('repeater_settings_dialog_title', { setting: label })}</DialogTitle>
          <DialogDescription>
            {step === 'edit'
              ? t('repeater_settings_dialog_edit_desc')
              : t('repeater_settings_rf_warning', { name: repeaterName })}
          </DialogDescription>
        </DialogHeader>

        {step === 'edit' && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              review();
            }}
          >
            <div className="text-xs text-muted-foreground">
              {t('repeater_settings_old_value')}:{' '}
              <span className="whitespace-pre-wrap text-foreground">
                {formatValue(t, def, current)}
              </span>
            </div>
            {def.kind === 'radio' ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="setting-radio-freq">{t('repeater_settings_radio_freq')}</Label>
                  <Input
                    id="setting-radio-freq"
                    inputMode="decimal"
                    value={radio.freq}
                    onChange={(e) => setRadio({ ...radio, freq: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setting-radio-bw">{t('repeater_settings_radio_bw')}</Label>
                  <select
                    id="setting-radio-bw"
                    value={radio.bw}
                    onChange={(e) => setRadio({ ...radio, bw: e.target.value })}
                    className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  >
                    {LORA_BANDWIDTHS_KHZ.map((bw) => (
                      <option key={bw} value={bw}>
                        {bw}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setting-radio-sf">{t('repeater_settings_radio_sf')}</Label>
                  <select
                    id="setting-radio-sf"
                    value={radio.sf}
                    onChange={(e) => setRadio({ ...radio, sf: e.target.value })}
                    className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  >
                    {SPREADING_FACTORS.map((sf) => (
                      <option key={sf} value={sf}>
                        {sf}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="setting-radio-cr">{t('repeater_settings_radio_cr')}</Label>
                  <select
                    id="setting-radio-cr"
                    value={radio.cr}
                    onChange={(e) => setRadio({ ...radio, cr: e.target.value })}
                    className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  >
                    {CODING_RATES.map((cr) => (
                      <option key={cr} value={cr}>
                        {cr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="setting-value">{t('repeater_settings_new_value')}</Label>
                {def.kind === 'choice' ? (
                  <select
                    id="setting-value"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="block h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm"
                  >
                    {!def.options?.some((o) => o.value === draft) && <option value={draft} />}
                    {def.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.labelKey ? t(o.labelKey) : o.value}
                      </option>
                    ))}
                  </select>
                ) : def.kind === 'textarea' ? (
                  <textarea
                    id="setting-value"
                    value={draft}
                    rows={3}
                    onChange={(e) => setDraft(e.target.value)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
                  />
                ) : (
                  <Input
                    id="setting-value"
                    value={draft}
                    inputMode={def.kind === 'text' ? undefined : 'decimal'}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                  />
                )}
                {hintText(t, def) && (
                  <p className="text-xs text-muted-foreground">{hintText(t, def)}</p>
                )}
              </div>
            )}
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common_cancel')}
              </Button>
              <Button type="submit">{t('repeater_settings_review')}</Button>
            </DialogFooter>
          </form>
        )}

        {(step === 'confirm' || step === 'sending') && (
          <div className="space-y-3">
            {def.strongConfirm && (
              <div
                className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
                role="alert"
              >
                <p className="font-semibold text-destructive">
                  {t('repeater_settings_radio_warning_title')}
                </p>
                <p>{t('repeater_settings_radio_warning')}</p>
                <p className="text-muted-foreground">{t('repeater_settings_radio_reboot_note')}</p>
              </div>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">{t('repeater_settings_setting')}</dt>
              <dd>{label}</dd>
              <dt className="text-muted-foreground">{t('repeater_settings_old_value')}</dt>
              <dd className="whitespace-pre-wrap" data-testid="confirm-old">
                {formatValue(t, def, current)}
              </dd>
              <dt className="text-muted-foreground">{t('repeater_settings_new_value')}</dt>
              <dd className="whitespace-pre-wrap font-medium" data-testid="confirm-new">
                {displayPending}
              </dd>
              <dt className="text-muted-foreground">{t('repeater_settings_command')}</dt>
              <dd>
                <code className="break-all text-xs" data-testid="confirm-command">
                  {`set ${def.key} ${pendingValue}`}
                </code>
              </dd>
            </dl>
            {def.strongConfirm && (
              <div className="space-y-1">
                <Label htmlFor="setting-confirm-phrase">
                  {t('repeater_settings_type_to_confirm', { phrase: confirmPhrase })}
                </Label>
                <Input
                  id="setting-confirm-phrase"
                  value={typedPhrase}
                  autoComplete="off"
                  onChange={(e) => setTypedPhrase(e.target.value)}
                  disabled={step === 'sending'}
                />
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep('edit')}
                disabled={step === 'sending'}
              >
                {t('repeater_settings_back')}
              </Button>
              <Button
                type="button"
                variant={def.strongConfirm ? 'destructive' : 'default'}
                onClick={() => void send()}
                disabled={!phraseOk || step === 'sending'}
              >
                {step === 'sending' ? t('repeater_settings_sending') : t('repeater_settings_send')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'result' && (
          <div className="space-y-3 text-sm" data-testid="setting-result">
            {requestError ? (
              <p className="text-destructive" role="alert">
                {t('repeater_settings_request_failed', { error: requestError })}
              </p>
            ) : result ? (
              <>
                <div className="flex items-center gap-2">
                  <StatusBadge status={result.status} />
                </div>
                {result.status === 'ok' && (
                  <p className="text-success">
                    {t('repeater_settings_result_ok', {
                      value: formatValue(t, def, result.readback),
                    })}
                  </p>
                )}
                {result.status === 'mismatch' && (
                  <p className="font-medium text-destructive" role="alert">
                    {t('repeater_settings_result_mismatch', {
                      expected: formatValue(t, def, result.value),
                      value: formatValue(t, def, result.readback),
                    })}
                  </p>
                )}
                {result.status === 'rejected' && (
                  <p className="font-medium text-destructive" role="alert">
                    {t('repeater_settings_result_rejected', { reply: result.set_reply ?? '' })}
                  </p>
                )}
                {result.status === 'unverified' && (
                  <p className="text-warning" role="alert">
                    {t('repeater_settings_result_unverified')}
                  </p>
                )}
                {result.reboot_required && result.status !== 'rejected' && (
                  <p className="font-medium">{t('repeater_settings_result_reboot')}</p>
                )}
              </>
            ) : null}
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                {t('common_close')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// --- Pane ----------------------------------------------------------------------

export function SettingsEditorPane({
  seed,
  repeaterName,
  confirmPhrase,
  onRead,
  onApply,
  disabled,
}: {
  seed: SettingsEditorSeed;
  repeaterName: string;
  /** Text the user must type to confirm radio f/bw/sf/cr changes. */
  confirmPhrase: string;
  onRead: (settings?: string[]) => Promise<RepeaterSettingsReadResponse>;
  onApply: (setting: string, value: string) => Promise<RepeaterSettingSetResponse>;
  disabled?: boolean;
}) {
  const t = useT();
  const [readValues, setReadValues] = useState<CurrentValues>({});
  const [results, setResults] = useState<Record<string, RepeaterSettingSetResponse>>({});
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SettingDef | null>(null);

  const seeded = useMemo(() => seedFromPanes(seed), [seed]);
  const currentOf = (key: string) => (key in readValues ? readValues[key] : seeded[key]);

  const readAll = async () => {
    setReading(true);
    setReadError(null);
    try {
      const res = await onRead();
      setReadValues((prev) => ({ ...prev, ...res.values }));
    } catch (err) {
      setReadError(err instanceof Error ? err.message : String(err));
    } finally {
      setReading(false);
    }
  };

  const handleApplied = (setting: string, result: RepeaterSettingSetResponse) => {
    setResults((prev) => ({ ...prev, [setting]: result }));
    if (result.readback != null && result.status !== 'unverified') {
      setReadValues((prev) => ({ ...prev, [setting]: result.readback }));
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden" data-testid="settings-editor">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-muted/50 border-b border-border">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t('repeater_settings_editor_title')}</h3>
          <p className="text-[0.6875rem] text-muted-foreground">
            {t('repeater_settings_editor_note')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void readAll()}
          disabled={disabled || reading}
          className="h-7 px-2 text-xs"
        >
          {reading ? t('repeater_settings_reading') : t('repeater_settings_read_all')}
        </Button>
      </div>
      <div className="p-3 space-y-3">
        {readError && <p className="text-xs text-destructive">{readError}</p>}
        {SETTING_GROUPS.map(({ group, labelKey }) => (
          <div key={group}>
            <div className="text-xs font-medium text-muted-foreground mb-1">{t(labelKey)}</div>
            <div className="divide-y divide-border/50">
              {SETTING_DEFS.filter((d) => d.group === group).map((def) => {
                const result = results[def.key];
                // Radio f/bw/sf/cr must start from the repeater's real values,
                // never from defaults, so it stays locked until read.
                const needsRead =
                  def.strongConfirm === true && parseRadio(currentOf(def.key)) == null;
                return (
                  <div
                    key={def.key}
                    className="flex items-center justify-between gap-2 py-1 text-sm"
                    data-testid={`setting-row-${def.key}`}
                  >
                    <span className="text-muted-foreground">{t(def.labelKey)}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate whitespace-pre-wrap text-right">
                        {formatValue(t, def, currentOf(def.key))}
                      </span>
                      {result && <StatusBadge status={result.status} />}
                      <button
                        type="button"
                        onClick={() => setEditing(def)}
                        disabled={disabled || reading || needsRead}
                        title={needsRead ? t('repeater_settings_read_first') : undefined}
                        className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
                        aria-label={t('repeater_settings_edit_label', { setting: t(def.labelKey) })}
                      >
                        {t('repeater_settings_edit')}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <SettingEditDialog
          def={editing}
          current={currentOf(editing.key)}
          repeaterName={repeaterName}
          confirmPhrase={confirmPhrase}
          onApply={onApply}
          onApplied={handleApplied}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
