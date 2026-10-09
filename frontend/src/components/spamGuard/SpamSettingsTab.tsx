import { useEffect, useState } from 'react';

import { api } from '../../api';
import type { SpamGuardController } from '../../hooks/useSpamGuard';
import { useT } from '../../i18n';
import type {
  Channel,
  SpamGuardRules,
  SpamGuardSettings,
  SpamGuardState,
  SpamGuardTunables,
} from '../../types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { toast } from '../ui/sonner';
import { TUNABLE_GROUPS, UNIT_KEYS, type TunableKey, type TunableSpec } from './spamGuardTunables';

type TunableValue = SpamGuardTunables[TunableKey];

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** One exception list (trusted names, never-block repeaters, allowed texts). */
function ExceptionList({
  title,
  help,
  items,
  placeholder,
  addLabel,
  removeLabel,
  disabled,
  onAdd,
  onRemove,
}: {
  title: string;
  help: string;
  items: string[];
  placeholder?: string;
  addLabel: string;
  removeLabel: (item: string) => string;
  disabled: boolean;
  onAdd: (value: string) => Promise<boolean>;
  onRemove: (value: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState('');
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="text-[0.8125rem] text-muted-foreground">{help}</p>
      {items.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground">{t('spam_exceptions_none')}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-[0.8125rem] text-foreground"
            >
              {item}
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                aria-label={removeLabel(item)}
                title={removeLabel(item)}
                disabled={disabled}
                onClick={() => onRemove(item)}
              >
                {'×'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd(value.trim()).then((ok) => ok && setValue(''));
        }}
      >
        <Input
          className="h-9 w-56"
          aria-label={title}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={disabled || !value.trim()}>
          {addLabel}
        </Button>
      </form>
    </div>
  );
}

export function SpamSettingsTab({
  state,
  guard,
  channels,
}: {
  state: SpamGuardState;
  guard: SpamGuardController;
  channels: Channel[];
}) {
  const t = useT();
  const [draft, setDraft] = useState<SpamGuardSettings>(state.settings);
  const [dirty, setDirty] = useState(false);
  const [rules, setRules] = useState<SpamGuardRules | null>(null);

  // Follow the server while there are no local edits. With edits, keep them but
  // take over the exception lists: those are changed by actions, not this form.
  useEffect(() => {
    setDraft((prev) =>
      dirty
        ? {
            ...prev,
            allow_hops: state.settings.allow_hops,
            allow_senders: state.settings.allow_senders,
            allow_texts: state.settings.allow_texts,
          }
        : state.settings
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dirty` is read, not a trigger
  }, [state.settings]);

  const disabled = guard.busy || !state.enabled;
  const preset = state.presets[draft.sensitivity] ?? {};
  const baseline = (key: TunableKey): TunableValue =>
    (preset[key] ?? state.defaults[key]) as TunableValue;
  const valueOf = (key: TunableKey): TunableValue =>
    (draft.overrides[key] ?? baseline(key)) as TunableValue;

  const setTunable = (key: TunableKey, value: TunableValue) => {
    setDirty(true);
    setDraft((prev) => {
      const overrides = { ...prev.overrides } as Record<string, unknown>;
      if (sameValue(value, baseline(key))) delete overrides[key];
      else overrides[key] = value;
      return { ...prev, overrides: overrides as Partial<SpamGuardTunables> };
    });
  };

  const toggleChannel = (channel: Channel, on: boolean) => {
    setDirty(true);
    setDraft((prev) => ({
      ...prev,
      channels: on
        ? [...prev.channels, { key: channel.key.toUpperCase(), name: channel.name }]
        : prev.channels.filter((c) => c.key !== channel.key.toUpperCase()),
    }));
  };

  const saveDraft = async () => {
    if (await guard.save(draft)) setDirty(false);
  };

  const showRules = async () => {
    try {
      setRules(await api.getSpamGuardRules(true));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const control = (spec: TunableSpec) => {
    const id = `spam-set-${spec.key}`;
    const value = valueOf(spec.key);
    if (spec.type === 'bool') {
      return (
        <input
          id={id}
          type="checkbox"
          className="h-4 w-4 accent-current"
          checked={value === true}
          disabled={disabled}
          onChange={(e) => setTunable(spec.key, e.target.checked)}
        />
      );
    }
    if (spec.type === 'choice') {
      const choices = spec.choices.filter(
        (choice) => choice !== 'starts_at' || state.backend === 'host'
      );
      return (
        <select
          id={id}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={String(value)}
          disabled={disabled}
          onChange={(e) => setTunable(spec.key, e.target.value as TunableValue)}
        >
          {choices.map((choice) => (
            <option key={choice} value={choice}>
              {t(`spam_choice_${spec.key}_${choice}`)}
            </option>
          ))}
        </select>
      );
    }
    if (spec.type === 'patterns') {
      return (
        <textarea
          id={id}
          className="min-h-16 w-full rounded-md border border-input bg-background p-2 font-mono text-[0.8125rem]"
          value={(value as string[]).join('\n')}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) =>
            setTunable(
              spec.key,
              e.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
            )
          }
        />
      );
    }
    return (
      <span className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          className="h-9 w-28"
          min={spec.min}
          max={spec.max}
          value={Number(value)}
          disabled={disabled}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) setTunable(spec.key, Math.round(next));
          }}
        />
        {spec.unit && (
          <span className="text-[0.8125rem] text-muted-foreground">{t(UNIT_KEYS[spec.unit])}</span>
        )}
      </span>
    );
  };

  const protectedKeys = new Set(draft.channels.map((c) => c.key));
  const knownChannelKeys = new Set(channels.map((c) => c.key.toUpperCase()));

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-md border border-border/60 p-3">
        <h3 className="text-sm font-semibold text-foreground">{t('spam_channels_title')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('spam_channels_desc')}</p>
        <ul className="grid gap-1 md:grid-cols-2">
          {channels.map((channel) => {
            const id = `spam-channel-${channel.key}`;
            return (
              <li key={channel.key} className="flex items-center gap-2 text-sm">
                <input
                  id={id}
                  type="checkbox"
                  className="h-4 w-4 accent-current"
                  checked={protectedKeys.has(channel.key.toUpperCase())}
                  disabled={disabled}
                  onChange={(e) => toggleChannel(channel, e.target.checked)}
                />
                <label htmlFor={id}>{channel.name}</label>
              </li>
            );
          })}
          {draft.channels
            .filter((c) => !knownChannelKeys.has(c.key))
            .map((c) => (
              <li key={c.key} className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-current"
                  checked
                  aria-label={c.name || c.key.slice(0, 8)}
                  disabled={disabled}
                  onChange={() => {
                    setDirty(true);
                    setDraft((prev) => ({
                      ...prev,
                      channels: prev.channels.filter((x) => x.key !== c.key),
                    }));
                  }}
                />
                {t('spam_channels_missing', { name: c.name || c.key.slice(0, 8) })}
              </li>
            ))}
        </ul>
      </section>

      {TUNABLE_GROUPS.map((group) => (
        <section key={group.titleKey} className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{t(group.titleKey)}</h3>
          {group.items.map((spec) => {
            const overridden = spec.key in draft.overrides;
            return (
              <div
                key={spec.key}
                className="space-y-1 rounded-md border border-border/60 p-3"
                data-testid={`spam-setting-${spec.key}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor={`spam-set-${spec.key}`} className="text-sm font-medium">
                    {t(`spam_set_${spec.key}_label`)}
                  </label>
                  <span className="flex items-center gap-2">
                    {control(spec)}
                    {overridden && (
                      <button
                        type="button"
                        className="text-[0.75rem] text-muted-foreground underline hover:text-foreground"
                        disabled={disabled}
                        onClick={() => setTunable(spec.key, baseline(spec.key))}
                      >
                        {t('spam_setting_reset')}
                      </button>
                    )}
                  </span>
                </div>
                <p className="text-[0.8125rem] text-muted-foreground">
                  {t(`spam_set_${spec.key}_help`)}
                </p>
                <p className="text-[0.8125rem] text-warning">
                  {t('spam_setting_watch_out', { text: t(`spam_set_${spec.key}_risk`) })}
                </p>
              </div>
            );
          })}
        </section>
      ))}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-background py-2">
        <Button size="sm" disabled={disabled || !dirty} onClick={() => void saveDraft()}>
          {t('spam_settings_save')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty}
          onClick={() => {
            setDraft(state.settings);
            setDirty(false);
          }}
        >
          {t('spam_settings_discard')}
        </Button>
        {dirty && (
          <span className="text-[0.8125rem] text-warning">{t('spam_settings_unsaved')}</span>
        )}
      </div>

      <section className="space-y-4 rounded-md border border-border/60 p-3">
        <h3 className="text-sm font-semibold text-foreground">{t('spam_exceptions_title')}</h3>
        <ExceptionList
          title={t('spam_exceptions_senders')}
          help={t('spam_exceptions_senders_help')}
          items={state.settings.allow_senders}
          addLabel={t('spam_exceptions_add')}
          removeLabel={(item) => t('spam_exceptions_remove', { item })}
          disabled={disabled}
          onAdd={(sender) => guard.action('allow_sender', { sender })}
          onRemove={(sender) => void guard.action('unallow_sender', { sender })}
        />
        <ExceptionList
          title={t('spam_exceptions_hops')}
          help={t('spam_exceptions_hops_help')}
          items={state.settings.allow_hops}
          placeholder="27"
          addLabel={t('spam_exceptions_add')}
          removeLabel={(item) => t('spam_exceptions_remove', { item })}
          disabled={disabled}
          onAdd={(hop) => guard.action('allow_hop', { hop })}
          onRemove={(hop) => void guard.action('unallow_hop', { hop })}
        />
        <ExceptionList
          title={t('spam_exceptions_texts')}
          help={t('spam_exceptions_texts_help')}
          items={state.settings.allow_texts}
          addLabel={t('spam_exceptions_add')}
          removeLabel={(item) => t('spam_exceptions_remove', { item })}
          disabled={disabled}
          onAdd={(text) => guard.action('allow_text', { text })}
          onRemove={(text) => void guard.action('unallow_text', { text })}
        />
        {Object.keys(state.suppressed).length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-muted-foreground">
            {t('spam_suppressed_count', { count: Object.keys(state.suppressed).length })}
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => void guard.action('clear_suppressed')}
            >
              {t('spam_suppressed_clear')}
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-md border border-border/60 p-3">
        <h3 className="text-sm font-semibold text-foreground">{t('spam_rules_title')}</h3>
        <p className="text-[0.8125rem] text-muted-foreground">{t('spam_rules_desc')}</p>
        <Button size="sm" variant="outline" onClick={() => void showRules()}>
          {t('spam_rules_show')}
        </Button>
        {rules && (
          <>
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('spam_rules_count', {
                before: rules.before.length,
                after: rules.after.length,
                known: rules.known_senders.length,
              })}
              {rules.truncated ? ` ${t('spam_rules_truncated')}` : ''}
            </p>
            <pre className="max-h-80 overflow-auto rounded bg-muted p-2 text-[0.6875rem]">
              {JSON.stringify([...rules.before, ...rules.after], null, 2)}
            </pre>
          </>
        )}
      </section>
    </div>
  );
}
