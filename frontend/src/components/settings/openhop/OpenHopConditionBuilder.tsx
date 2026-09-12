import type { OpenHopCondition, OpenHopOperator, OpenHopSimpleCondition } from '../../../types';
import { useT } from '../../../i18n';

export const OPENHOP_FIELDS = [
  'channel_hash',
  'channel_sender',
  'channel_message_body',
  'channel_decryptable',
  'path_hashes',
  'transport_code_0',
  'transport_code_1',
  'payload_hex',
] as const;

export const OPENHOP_OPERATORS: OpenHopOperator[] = [
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
  'contains',
  'in',
  'starts_with',
];

export const OPENHOP_ACTIONS = ['allow', 'drop', 'log_only'] as const;

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

interface Props {
  value: OpenHopCondition;
  objects: PolicyObjects;
  onChange: (c: OpenHopCondition) => void;
}

export function OpenHopConditionBuilder({ value, objects, onChange }: Props) {
  const t = useT();
  const mode = isAll(value) ? 'all' : isAny(value) ? 'any' : 'single';
  const children: OpenHopCondition[] = isAll(value) ? value.all : isAny(value) ? value.any : [];
  const simple: OpenHopSimpleCondition = isSimple(value)
    ? value
    : { field: '', op: 'equals', value: '' };

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
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('openhop_rule_field')}
            className={selectClass}
            value={simple.field}
            onChange={(e) => onChange({ ...simple, field: e.target.value })}
          >
            <option value="">--</option>
            {OPENHOP_FIELDS.map((f) => (
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
            {OPENHOP_OPERATORS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input
            aria-label={t('openhop_rule_value')}
            className={selectClass}
            value={simple.value}
            onChange={(e) => onChange({ ...simple, value: e.target.value })}
          />
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
      ) : (
        <div className="space-y-2 pl-2">
          {children.map((child, i) => (
            <OpenHopConditionBuilder
              key={i}
              value={child}
              objects={objects}
              onChange={(c) => {
                const next = [...children];
                next[i] = c;
                wrapChildren(next);
              }}
            />
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
