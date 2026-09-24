// Allow-listed settings for the structured repeater settings editor.
//
// This mirrors app/services/repeater_settings.py, which is the authority: the
// server re-validates every value and rejects anything off its allow-list.
// The client copy exists so the user sees range errors BEFORE the confirm
// step, not after a request. Ranges come from the stock repeater CLI
// (meshcore-dev/MeshCore src/helpers/CommonCLI.cpp); see the Python module for
// the per-setting firmware notes. `prv.key` is deliberately absent.

export type SettingKind = 'int' | 'decimal' | 'choice' | 'text' | 'textarea' | 'radio';
export type SettingGroup = 'identity' | 'radio' | 'routing' | 'adverts';

export interface SettingOption {
  value: string;
  /** i18n key; omitted for plain numeric options shown as-is. */
  labelKey?: string;
}

export interface SettingDef {
  key: string;
  group: SettingGroup;
  labelKey: string;
  kind: SettingKind;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  allowZero?: boolean;
  options?: SettingOption[];
  maxBytes?: number;
  forbiddenChars?: string;
  /** Radio f/bw/sf/cr: typed-name confirm + reboot notice. */
  strongConfirm?: boolean;
}

const ON_OFF: SettingOption[] = [
  { value: 'on', labelKey: 'repeater_settings_on' },
  { value: 'off', labelKey: 'repeater_settings_off' },
];

export const LORA_BANDWIDTHS_KHZ = [
  '7.8',
  '10.4',
  '15.6',
  '20.8',
  '31.25',
  '41.7',
  '62.5',
  '125',
  '250',
  '500',
];
export const SPREADING_FACTORS = ['5', '6', '7', '8', '9', '10', '11', '12'];
export const CODING_RATES = ['5', '6', '7', '8'];

export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'name',
    group: 'identity',
    labelKey: 'repeater_settings_name',
    kind: 'text',
    maxBytes: 31,
    forbiddenChars: '[]\\:,?*',
  },
  {
    key: 'lat',
    group: 'identity',
    labelKey: 'repeater_settings_lat',
    kind: 'decimal',
    min: -90,
    max: 90,
    decimals: 6,
  },
  {
    key: 'lon',
    group: 'identity',
    labelKey: 'repeater_settings_lon',
    kind: 'decimal',
    min: -180,
    max: 180,
    decimals: 6,
  },
  {
    key: 'owner.info',
    group: 'identity',
    labelKey: 'repeater_settings_owner_info',
    kind: 'textarea',
    maxBytes: 119,
  },
  {
    key: 'guest.password',
    group: 'identity',
    labelKey: 'repeater_settings_guest_password',
    kind: 'text',
    maxBytes: 15,
  },
  {
    key: 'radio',
    group: 'radio',
    labelKey: 'repeater_settings_radio',
    kind: 'radio',
    strongConfirm: true,
  },
  { key: 'tx', group: 'radio', labelKey: 'repeater_settings_tx', kind: 'int', min: -9, max: 30 },
  {
    key: 'dutycycle',
    group: 'radio',
    labelKey: 'repeater_settings_dutycycle',
    kind: 'decimal',
    min: 1,
    max: 100,
    decimals: 1,
  },
  {
    key: 'radio.rxgain',
    group: 'radio',
    labelKey: 'repeater_settings_rxgain',
    kind: 'choice',
    options: ON_OFF,
  },
  {
    key: 'int.thresh',
    group: 'radio',
    labelKey: 'repeater_settings_int_thresh',
    kind: 'int',
    min: 0,
    max: 255,
  },
  {
    key: 'agc.reset.interval',
    group: 'radio',
    labelKey: 'repeater_settings_agc_reset',
    kind: 'int',
    min: 0,
    max: 1020,
    step: 4,
  },
  {
    key: 'repeat',
    group: 'routing',
    labelKey: 'repeater_settings_repeat',
    kind: 'choice',
    options: ON_OFF,
  },
  {
    key: 'allow.read.only',
    group: 'routing',
    labelKey: 'repeater_settings_allow_read_only',
    kind: 'choice',
    options: ON_OFF,
  },
  {
    key: 'flood.max',
    group: 'routing',
    labelKey: 'repeater_settings_flood_max',
    kind: 'int',
    min: 0,
    max: 64,
  },
  {
    key: 'multi.acks',
    group: 'routing',
    labelKey: 'repeater_settings_multi_acks',
    kind: 'choice',
    options: [
      { value: '0', labelKey: 'repeater_settings_off' },
      { value: '1', labelKey: 'repeater_settings_on' },
    ],
  },
  {
    key: 'loop.detect',
    group: 'routing',
    labelKey: 'repeater_settings_loop_detect',
    kind: 'choice',
    options: [
      { value: 'off', labelKey: 'repeater_settings_off' },
      { value: 'minimal', labelKey: 'repeater_settings_loop_minimal' },
      { value: 'moderate', labelKey: 'repeater_settings_loop_moderate' },
      { value: 'strict', labelKey: 'repeater_settings_loop_strict' },
    ],
  },
  {
    key: 'path.hash.mode',
    group: 'routing',
    labelKey: 'repeater_settings_path_hash_mode',
    kind: 'choice',
    options: [{ value: '0' }, { value: '1' }, { value: '2' }],
  },
  {
    key: 'txdelay',
    group: 'routing',
    labelKey: 'repeater_settings_txdelay',
    kind: 'decimal',
    min: 0,
    max: 2,
    decimals: 3,
  },
  {
    key: 'direct.txdelay',
    group: 'routing',
    labelKey: 'repeater_settings_direct_txdelay',
    kind: 'decimal',
    min: 0,
    max: 2,
    decimals: 3,
  },
  {
    key: 'advert.interval',
    group: 'adverts',
    labelKey: 'repeater_settings_advert_interval',
    kind: 'int',
    min: 60,
    max: 240,
    step: 2,
    allowZero: true,
  },
  {
    key: 'flood.advert.interval',
    group: 'adverts',
    labelKey: 'repeater_settings_flood_advert_interval',
    kind: 'int',
    min: 3,
    max: 168,
    allowZero: true,
  },
];

export const SETTING_GROUPS: { group: SettingGroup; labelKey: string }[] = [
  { group: 'identity', labelKey: 'repeater_settings_group_identity' },
  { group: 'radio', labelKey: 'repeater_settings_group_radio' },
  { group: 'routing', labelKey: 'repeater_settings_group_routing' },
  { group: 'adverts', labelKey: 'repeater_settings_group_adverts' },
];

/** A validation failure: i18n key plus interpolation params. */
export interface SettingError {
  key: string;
  params?: Record<string, string | number>;
}

export type ValidationResult = { ok: true; value: string } | { ok: false; error: SettingError };

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

function decimalPlaces(text: string): number {
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

function fmtNumber(text: string): string {
  return String(Number(text));
}

function validateNumber(def: SettingDef, raw: string): ValidationResult {
  const text = raw.trim();
  const pattern = def.kind === 'int' ? /^[+-]?\d+$/ : /^[+-]?\d+(\.\d+)?$/;
  if (!pattern.test(text)) {
    return {
      ok: false,
      error: {
        key: def.kind === 'int' ? 'repeater_settings_err_int' : 'repeater_settings_err_number',
      },
    };
  }
  if (def.decimals != null && decimalPlaces(text) > def.decimals) {
    return {
      ok: false,
      error: { key: 'repeater_settings_err_decimals', params: { count: def.decimals } },
    };
  }
  const value = Number(text);
  if (def.allowZero && value === 0) return { ok: true, value: '0' };
  if (value < (def.min ?? -Infinity) || value > (def.max ?? Infinity)) {
    return {
      ok: false,
      error: {
        key: def.allowZero ? 'repeater_settings_err_range_off' : 'repeater_settings_err_range',
        params: { min: def.min ?? '', max: def.max ?? '' },
      },
    };
  }
  if (def.step && value % def.step !== 0) {
    return { ok: false, error: { key: 'repeater_settings_err_step', params: { step: def.step } } };
  }
  return { ok: true, value: fmtNumber(text) };
}

function validateText(def: SettingDef, raw: string): ValidationResult {
  let text = raw;
  if (def.kind === 'textarea') {
    // Firmware stores owner.info with '|' as its line separator.
    text = text.replace(/^[\r\n]+|[\r\n]+$/g, '').replace(/\r\n?|\n/g, '|');
  }
  if (!text.trim()) return { ok: false, error: { key: 'repeater_settings_err_empty' } };
  if (text !== text.trim()) return { ok: false, error: { key: 'repeater_settings_err_spaces' } };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(text)) {
    return { ok: false, error: { key: 'repeater_settings_err_control' } };
  }
  if (def.forbiddenChars && [...text].some((ch) => def.forbiddenChars!.includes(ch))) {
    return {
      ok: false,
      error: {
        key: 'repeater_settings_err_chars',
        params: { chars: def.forbiddenChars.split('').join(' ') },
      },
    };
  }
  if (def.maxBytes != null && utf8Length(text) > def.maxBytes) {
    return {
      ok: false,
      error: { key: 'repeater_settings_err_bytes', params: { count: def.maxBytes } },
    };
  }
  return { ok: true, value: text };
}

export interface RadioParts {
  freq: string;
  bw: string;
  sf: string;
  cr: string;
}

export function parseRadio(value: string | null | undefined): RadioParts | null {
  if (!value) return null;
  const parts = value.split(',').map((p) => p.trim());
  if (parts.length !== 4) return null;
  const [freq, bw, sf, cr] = parts;
  if (![freq, bw, sf, cr].every((p) => Number.isFinite(Number(p)) && p !== '')) return null;
  // Firmware prints float32 via ftoa ("869.5250244", "250.0"); round for editing.
  return {
    freq: String(Number(Number(freq).toFixed(3))),
    bw: String(Number(Number(bw).toFixed(3))),
    sf: String(Number(sf)),
    cr: String(Number(cr)),
  };
}

function validateRadio(raw: string): ValidationResult {
  const parts = raw.split(',').map((p) => p.trim());
  if (parts.length !== 4) return { ok: false, error: { key: 'repeater_settings_err_radio' } };
  const [freq, bw, sf, cr] = parts;
  if (!/^\d+(\.\d+)?$/.test(freq) || decimalPlaces(freq) > 3) {
    return { ok: false, error: { key: 'repeater_settings_err_freq' } };
  }
  const f = Number(freq);
  if (f < 150 || f > 2500) return { ok: false, error: { key: 'repeater_settings_err_freq' } };
  const bwNorm = fmtNumber(bw);
  if (!LORA_BANDWIDTHS_KHZ.includes(bwNorm)) {
    return { ok: false, error: { key: 'repeater_settings_err_radio' } };
  }
  if (!SPREADING_FACTORS.includes(sf) || !CODING_RATES.includes(cr)) {
    return { ok: false, error: { key: 'repeater_settings_err_radio' } };
  }
  return { ok: true, value: `${fmtNumber(freq)},${bwNorm},${sf},${cr}` };
}

export function validateSetting(def: SettingDef, raw: string): ValidationResult {
  switch (def.kind) {
    case 'int':
    case 'decimal':
      return validateNumber(def, raw);
    case 'choice': {
      const value = raw.trim().toLowerCase();
      return def.options?.some((o) => o.value === value)
        ? { ok: true, value }
        : { ok: false, error: { key: 'repeater_settings_err_choice' } };
    }
    case 'text':
    case 'textarea':
      return validateText(def, raw);
    case 'radio':
      return validateRadio(raw);
  }
}

/** Current-value text (as read from firmware) turned into the editor's form. */
export function toEditorValue(def: SettingDef, current: string | null | undefined): string {
  if (current == null) return '';
  const text = current.trim();
  switch (def.kind) {
    case 'decimal':
    case 'int': {
      const stripped = text.replace(/%$/, '').trim();
      return Number.isFinite(Number(stripped)) && stripped !== '' ? fmtNumber(stripped) : stripped;
    }
    case 'choice':
      return text.toLowerCase();
    case 'textarea':
      return current.replace(/\|/g, '\n');
    case 'radio': {
      const parts = parseRadio(text);
      return parts ? `${parts.freq},${parts.bw},${parts.sf},${parts.cr}` : text;
    }
    default:
      return current;
  }
}

/** True when the validated new value equals the current one (nothing to send). */
export function isUnchanged(def: SettingDef, current: string | null | undefined, next: string) {
  if (current == null) return false;
  const cur = toEditorValue(def, current);
  const normalizedCur = validateSetting(def, cur);
  return normalizedCur.ok && normalizedCur.value === next;
}
