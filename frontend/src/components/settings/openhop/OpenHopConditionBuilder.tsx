import type {
  OpenHopCondition,
  OpenHopConditionValue,
  OpenHopOperator,
  OpenHopSimpleCondition,
} from '../../../types';
import { useT } from '../../../i18n';

/**
 * Fields OpenHop's policy engine evaluates (repeater/engine.py policy_context plus the
 * packet-derived fields in repeater/policy_engine.py _get_field_value).
 */
export const OPENHOP_FIELDS = [
  'route_type',
  'payload_type',
  'payload_length',
  'path_hash_size',
  'hop_count',
  'rssi',
  'snr',
  'mode',
  'local_transmission',
  'path_hashes',
  'channel_hash',
  'channel_decryptable',
  'channel_message_body',
  'channel_sender',
  'payload_hex',
  'transport_code_0',
  'transport_code_1',
] as const;

/** Operators OpenHop's PolicyEngine._compare accepts (canonical names). */
export const OPENHOP_OPERATORS: OpenHopOperator[] = [
  'equals',
  'not_equals',
  'greater_than',
  'greater_or_equal',
  'less_than',
  'less_or_equal',
  'contains',
  'in',
  'intersects',
  'starts_with',
  'ends_with',
];

export const OPENHOP_ACTIONS = ['allow', 'drop', 'log_only'] as const;

type ValueOption = { value: string; label: string };

/** MeshCore route types (src/Packet.h ROUTE_TYPE_*) for the `route_type` value picker. */
export const ROUTE_TYPE_OPTIONS: readonly ValueOption[] = [
  { value: '0', label: '0 TRANSPORT_FLOOD' },
  { value: '1', label: '1 FLOOD' },
  { value: '2', label: '2 DIRECT' },
  { value: '3', label: '3 TRANSPORT_DIRECT' },
];

/** MeshCore payload types (src/Packet.h) for the `payload_type` value picker. */
export const PAYLOAD_TYPE_OPTIONS: readonly ValueOption[] = [
  { value: '0', label: '0 REQ' },
  { value: '1', label: '1 RESPONSE' },
  { value: '2', label: '2 TXT_MSG' },
  { value: '3', label: '3 ACK' },
  { value: '4', label: '4 ADVERT' },
  { value: '5', label: '5 GRP_TXT' },
  { value: '6', label: '6 GRP_DATA' },
  { value: '7', label: '7 ANON_REQ' },
  { value: '8', label: '8 PATH' },
  { value: '9', label: '9 TRACE' },
  { value: '10', label: '10 MULTIPART' },
  { value: '11', label: '11 CONTROL' },
  { value: '15', label: '15 RAW_CUSTOM' },
];

const PATH_HASH_SIZE_OPTIONS: readonly ValueOption[] = [
  { value: '1', label: '1 byte' },
  { value: '2', label: '2 bytes' },
  { value: '3', label: '3 bytes' },
];

/** OpenHop repeater.mode values (repeater/engine.py). */
const MODE_OPTIONS: readonly ValueOption[] = [
  { value: 'forward', label: 'forward' },
  { value: 'monitor', label: 'monitor' },
  { value: 'no_tx', label: 'no_tx' },
];

const BOOLEAN_OPTIONS: readonly ValueOption[] = [
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
];

type FieldKind = 'number' | 'boolean' | 'text';
interface FieldSpec {
  kind: FieldKind;
  ops: readonly OpenHopOperator[];
  options?: readonly ValueOption[];
}

const NUMBER_OPS: readonly OpenHopOperator[] = [
  'equals',
  'not_equals',
  'greater_than',
  'greater_or_equal',
  'less_than',
  'less_or_equal',
];
const BOOLEAN_OPS: readonly OpenHopOperator[] = ['equals', 'not_equals'];
const TEXT_OPS: readonly OpenHopOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'starts_with',
  'ends_with',
  'in',
  'matches',
];

const num = (options?: readonly ValueOption[]): FieldSpec => ({
  kind: 'number',
  ops: NUMBER_OPS,
  options,
});
const bool: FieldSpec = { kind: 'boolean', ops: BOOLEAN_OPS, options: BOOLEAN_OPTIONS };

/**
 * Per-field value type, operators and value picker. OpenHop compares with plain `==`
 * (no type coercion), so numeric and boolean fields must be stored as JSON numbers and
 * booleans: a stored "0" never equals a route type of 0. Fields not listed here are
 * free text with every operator the vocabulary offers.
 */
const FIELD_SPECS: Record<string, FieldSpec> = {
  route_type: num(ROUTE_TYPE_OPTIONS),
  payload_type: num(PAYLOAD_TYPE_OPTIONS),
  payload_length: num(),
  path_hash_size: num(PATH_HASH_SIZE_OPTIONS),
  hop_count: num(),
  rssi: num(),
  snr: num(),
  transport_code_0: num(),
  transport_code_1: num(),
  mode: { kind: 'text', ops: ['equals', 'not_equals', 'in'], options: MODE_OPTIONS },
  local_transmission: bool,
  channel_decryptable: bool,
  path_hashes: { kind: 'text', ops: ['contains', 'intersects'] },
  channel_hash: { kind: 'text', ops: ['equals', 'not_equals', 'contains', 'in', 'intersects'] },
  channel_message_body: { kind: 'text', ops: TEXT_OPS },
  channel_sender: { kind: 'text', ops: TEXT_OPS },
  payload_hex: { kind: 'text', ops: TEXT_OPS },
};

/** Convert form text to the field's JSON type; group refs and unparseable input stay text. */
export function toFieldValue(field: string, raw: string): OpenHopConditionValue {
  const spec = FIELD_SPECS[field];
  const text = raw.trim();
  if (!spec || text === '' || text.startsWith('@')) return raw;
  if (spec.kind === 'number') {
    const n = Number(text);
    return Number.isFinite(n) ? n : raw;
  }
  if (spec.kind === 'boolean') {
    if (text.toLowerCase() === 'true') return true;
    if (text.toLowerCase() === 'false') return false;
  }
  return raw;
}

/** `value` with its picker label when the field has one ("0 TRANSPORT_FLOOD"). */
export function formatConditionValue(field: string, value: OpenHopConditionValue): string {
  const text = Array.isArray(value) ? value.join(', ') : String(value);
  return FIELD_SPECS[field]?.options?.find((o) => o.value === text)?.label ?? text;
}

function operatorsFor(field: string, vocabulary: readonly OpenHopOperator[]): OpenHopOperator[] {
  const spec = FIELD_SPECS[field];
  return spec ? vocabulary.filter((o) => spec.ops.includes(o)) : [...vocabulary];
}

interface PolicyObjects {
  channel_hash_groups: Record<string, string[]>;
  pubkey_groups: Record<string, string[]>;
}

function isSimple(c: OpenHopCondition): c is OpenHopSimpleCondition {
  return typeof c === 'object' && c !== null && 'field' in c;
}
function isAll(c: OpenHopCondition): c is { all: OpenHopCondition[] } {
  return typeof c === 'object' && c !== null && 'all' in c;
}
function isAny(c: OpenHopCondition): c is { any: OpenHopCondition[] } {
  return typeof c === 'object' && c !== null && 'any' in c;
}

const selectClass = 'rounded border border-input bg-background px-2 py-1 text-sm';

/** Field/operator lists the builder offers. Defaults to the OpenHop API's own. */
export interface ConditionVocabulary {
  fields: readonly string[];
  operators: readonly OpenHopOperator[];
  /** Offer the per-rule `prob` / `throttle` gates (host repeater; the OpenHop API has none). */
  ruleGates?: boolean;
}

interface Props {
  value: OpenHopCondition;
  objects: PolicyObjects;
  onChange: (c: OpenHopCondition) => void;
  vocabulary?: ConditionVocabulary;
}

/** Keep a loaded rule's unknown field/operator selectable so it renders as stored. */
function withCurrent<T extends string>(list: readonly T[], current: T): T[] {
  return !current || list.includes(current) ? [...list] : [current, ...list];
}

export function OpenHopConditionBuilder({ value, objects, onChange, vocabulary }: Props) {
  const t = useT();
  const mode = isAll(value) ? 'all' : isAny(value) ? 'any' : 'single';
  const children: OpenHopCondition[] = isAll(value) ? value.all : isAny(value) ? value.any : [];
  const simple: OpenHopSimpleCondition = isSimple(value)
    ? value
    : { field: '', op: 'equals', value: '' };
  const vocabularyOps = vocabulary?.operators ?? OPENHOP_OPERATORS;
  const fields = withCurrent(vocabulary?.fields ?? OPENHOP_FIELDS, simple.field);
  const operators = withCurrent(operatorsFor(simple.field, vocabularyOps), simple.op);
  const options = FIELD_SPECS[simple.field]?.options;
  const valueText = Array.isArray(simple.value) ? simple.value.join(',') : String(simple.value);
  const showPicker =
    options !== undefined && (valueText === '' || options.some((o) => o.value === valueText));

  const setField = (field: string) => {
    const allowed = operatorsFor(field, vocabularyOps);
    const op = allowed.includes(simple.op) ? simple.op : (allowed[0] ?? simple.op);
    onChange({ field, op, value: toFieldValue(field, valueText) });
  };

  const setMode = (next: 'single' | 'all' | 'any') => {
    if (next === mode) return;
    if (next === 'single') {
      onChange(children[0] ?? simple);
      return;
    }
    const list = mode === 'single' ? [simple] : children;
    onChange(next === 'all' ? { all: list } : { any: list });
  };

  const wrapChildren = (next: OpenHopCondition[]) =>
    onChange(mode === 'all' ? { all: next } : { any: next });

  const moveChild = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= children.length) return;
    const next = [...children];
    [next[i], next[j]] = [next[j], next[i]];
    wrapChildren(next);
  };

  const groupRefs = [
    ...Object.keys(objects.channel_hash_groups).map((n) => `@channel_hash_groups.${n}`),
    ...Object.keys(objects.pubkey_groups).map((n) => `@pubkey_groups.${n}`),
  ];

  return (
    <div className="space-y-2 rounded border border-input p-2">
      <select
        aria-label={t('openhop_condition_mode')}
        className={selectClass}
        value={mode}
        onChange={(e) => setMode(e.target.value as 'single' | 'all' | 'any')}
      >
        <option value="single">{t('openhop_rule_match_single')}</option>
        <option value="all">{t('openhop_rule_match_all')}</option>
        <option value="any">{t('openhop_rule_match_any')}</option>
      </select>

      {mode === 'single' ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t('openhop_rule_field')}
              className={selectClass}
              value={simple.field}
              onChange={(e) => setField(e.target.value)}
            >
              <option value="">--</option>
              {fields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <select
              aria-label={t('openhop_rule_op')}
              className={selectClass}
              value={simple.op}
              onChange={(e) => onChange({ ...simple, op: e.target.value as OpenHopOperator })}
            >
              {operators.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            {showPicker ? (
              <select
                aria-label={t('openhop_rule_value')}
                className={selectClass}
                value={valueText}
                onChange={(e) =>
                  onChange({ ...simple, value: toFieldValue(simple.field, e.target.value) })
                }
              >
                <option value="">--</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                aria-label={t('openhop_rule_value')}
                className={selectClass}
                value={valueText}
                onChange={(e) =>
                  onChange({ ...simple, value: toFieldValue(simple.field, e.target.value) })
                }
              />
            )}
            {groupRefs.length > 0 && (
              <select
                aria-label={t('openhop_rule_use_group')}
                className={selectClass}
                value=""
                onChange={(e) => {
                  if (e.target.value) onChange({ ...simple, value: e.target.value });
                }}
              >
                <option value="">{t('openhop_rule_use_group')}</option>
                {groupRefs.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
          </div>
          {simple.field === 'channel_message_body' && (
            <p className="text-xs text-muted-foreground">{t('openhop_rule_body_order_hint')}</p>
          )}
        </div>
      ) : (
        <div className="space-y-2 pl-2">
          {children.map((child, i) => (
            <div key={i} className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <OpenHopConditionBuilder
                  value={child}
                  objects={objects}
                  vocabulary={vocabulary}
                  onChange={(c) => {
                    const next = [...children];
                    next[i] = c;
                    wrapChildren(next);
                  }}
                />
              </div>
              <button
                type="button"
                aria-label={t('openhop_condition_up')}
                className="px-1"
                disabled={i === 0}
                onClick={() => moveChild(i, -1)}
              >
                &uarr;
              </button>
              <button
                type="button"
                aria-label={t('openhop_condition_down')}
                className="px-1"
                disabled={i === children.length - 1}
                onClick={() => moveChild(i, 1)}
              >
                &darr;
              </button>
              <button
                type="button"
                aria-label={t('openhop_condition_remove')}
                className="px-1 text-destructive"
                disabled={children.length <= 1}
                onClick={() => wrapChildren(children.filter((_, k) => k !== i))}
              >
                &times;
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs underline"
            onClick={() => wrapChildren([...children, { field: '', op: 'equals', value: '' }])}
          >
            {t('openhop_rule_add_condition')}
          </button>
        </div>
      )}
    </div>
  );
}
