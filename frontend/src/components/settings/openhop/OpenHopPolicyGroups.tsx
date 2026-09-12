import { useState } from 'react';
import type { OpenHopGroup, OpenHopGroupKind, OpenHopPolicyDoc } from '../../../types';
import { api } from '../../../api';
import { useT, type TFn } from '../../../i18n';
import { Button } from '../../ui/button';

interface Props {
  doc: OpenHopPolicyDoc;
  onChanged: () => Promise<void> | void;
  setError: (e: string | null) => void;
}

const inputClass = 'rounded border border-input bg-background px-2 py-1 text-sm';

type RunFn = (fn: () => Promise<{ success: boolean; error?: string }>) => Promise<void>;

function GroupKind({
  kind,
  heading,
  groups,
  run,
  t,
}: {
  kind: OpenHopGroupKind;
  heading: string;
  groups: OpenHopGroup[];
  run: RunFn;
  t: TFn;
}) {
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [entryValue, setEntryValue] = useState<Record<string, string>>({});

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{heading}</h4>
      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('openhop_no_groups')}</p>
      )}
      {groups.map((g) => (
        <div key={g.id} className="space-y-1 rounded border border-input p-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{g.friendly_name || g.id}</span>
            <span className="text-xs text-muted-foreground">{g.id}</span>
            <button
              type="button"
              className="ml-auto text-xs text-destructive underline"
              onClick={() => {
                if (window.confirm(`${t('openhop_group_delete')}?`)) {
                  void run(() => api.deleteOpenHopGroup(kind, g.id));
                }
              }}
            >
              {t('openhop_group_delete')}
            </button>
          </div>
          <ul className="flex flex-wrap gap-1">
            {g.entries.map((e) => (
              <li key={e.id} className="flex items-center gap-1 rounded bg-muted px-1 text-xs">
                <span>{e.value}</span>
                <button
                  type="button"
                  aria-label={`${t('openhop_rule_delete')} ${e.value}`}
                  onClick={() => void run(() => api.deleteOpenHopGroupEntry(kind, g.id, e.value))}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1">
            <input
              className={inputClass}
              placeholder={t('openhop_entry_value')}
              aria-label={`${t('openhop_entry_value')} ${g.id}`}
              value={entryValue[g.id] ?? ''}
              onChange={(ev) => setEntryValue((p) => ({ ...p, [g.id]: ev.target.value }))}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const v = (entryValue[g.id] ?? '').trim();
                if (!v) return;
                void run(async () => {
                  const r = await api.addOpenHopGroupEntry(kind, g.id, v);
                  setEntryValue((p) => ({ ...p, [g.id]: '' }));
                  return r;
                });
              }}
            >
              {t('openhop_entry_add')}
            </Button>
          </div>
          <p className="text-[0.65rem] text-muted-foreground">{t('openhop_entry_value_hint')}</p>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1">
        <input
          className={inputClass}
          placeholder={t('openhop_group_id')}
          aria-label={`${t('openhop_group_id')} ${kind}`}
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder={t('openhop_group_name')}
          aria-label={`${t('openhop_group_name')} ${kind}`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const id = newId.trim();
            if (!id) return;
            void run(async () => {
              const r = await api.createOpenHopGroup(kind, id, newName.trim());
              setNewId('');
              setNewName('');
              return r;
            });
          }}
        >
          {t('openhop_group_create')}
        </Button>
      </div>
    </div>
  );
}

export function OpenHopPolicyGroups({ doc, onChanged, setError }: Props) {
  const t = useT();
  const run: RunFn = async (fn) => {
    setError(null);
    try {
      const r = await fn();
      if (!r.success) {
        setError(r.error ?? t('openhop_policy_invalid'));
        return;
      }
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('openhop_policy_invalid'));
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold tracking-tight">{t('openhop_groups_heading')}</h3>
      <GroupKind
        kind="channel_hashes"
        heading={t('openhop_channel_hashes')}
        groups={doc.groups.channel_hashes}
        run={run}
        t={t}
      />
      <GroupKind
        kind="pubkeys"
        heading={t('openhop_pubkeys')}
        groups={doc.groups.pubkeys}
        run={run}
        t={t}
      />
    </div>
  );
}
