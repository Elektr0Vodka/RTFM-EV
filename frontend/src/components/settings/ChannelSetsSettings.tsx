import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from '../ui/sonner';
import type {
  Channel,
  ChannelSet,
  ChannelSetApplyItem,
  ChannelSetApplyResult,
  ChannelSetContactApplyItem,
  Contact,
} from '../../types';

/** Contacts shown in the editor list at once; filtering finds the rest. */
const CONTACT_LIST_LIMIT = 100;

interface EditorState {
  setId: string | null;
  name: string;
  selected: Set<string>;
  selectedContacts: Set<string>;
}

/** Per-channel and per-contact outcome of loading a loadout onto the radio. */
export function ApplyResultList({ result }: { result: ChannelSetApplyResult }) {
  const t = useT();
  const line = (item: ChannelSetApplyItem) => {
    if (item.status === 'loaded') return t('channel_sets_item_loaded', { slot: item.slot ?? '?' });
    if (item.status === 'already_loaded')
      return t('channel_sets_item_already', { slot: item.slot ?? '?' });
    return item.error === 'no_free_slot'
      ? t('channel_sets_item_no_free_slot')
      : t('channel_sets_item_radio_error');
  };
  const contactLine = (item: ChannelSetContactApplyItem) => {
    if (item.status === 'loaded') return t('channel_sets_item_contact_loaded');
    if (item.status === 'already_loaded') return t('channel_sets_item_contact_already');
    if (item.error === 'table_full') return t('channel_sets_item_table_full');
    if (item.error === 'unknown_contact') return t('channel_sets_item_unknown_contact');
    if (item.error === 'excluded') return t('channel_sets_item_excluded');
    return t('channel_sets_item_contact_radio_error');
  };
  return (
    <ul className="space-y-0.5 text-xs" data-testid="channel-set-result">
      {result.items.map((item) => (
        <li
          key={item.key}
          className={item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}
        >
          <span className="font-medium text-foreground">{item.name}</span>: {line(item)}
        </li>
      ))}
      {(result.contact_items ?? []).map((item) => (
        <li
          key={item.public_key}
          className={item.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}
        >
          <span className="font-medium text-foreground">
            {item.name || item.public_key.slice(0, 12)}
          </span>
          : {contactLine(item)}
        </li>
      ))}
    </ul>
  );
}

export function ChannelSetsSettings({
  channels,
  contacts = [],
}: {
  channels: Channel[];
  contacts?: Contact[];
}) {
  const t = useT();
  const [sets, setSets] = useState<ChannelSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [query, setQuery] = useState('');
  const [contactQuery, setContactQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ChannelSetApplyResult>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .getChannelSets()
      .then((loaded) => {
        if (!cancelled) setSets(loaded);
      })
      .catch(() => {
        if (!cancelled) toast.error(t('channel_sets_load_failed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const sortedChannels = useMemo(
    () => [...channels].sort((a, b) => a.name.localeCompare(b.name)),
    [channels]
  );
  const visibleChannels = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sortedChannels.filter((c) => c.name.toLowerCase().includes(q)) : sortedChannels;
  }, [sortedChannels, query]);

  // Only contacts with a full key can be put on the radio.
  const sortedContacts = useMemo(
    () =>
      contacts
        .filter((c) => c.public_key.length === 64)
        .sort((a, b) => (a.name || a.public_key).localeCompare(b.name || b.public_key)),
    [contacts]
  );
  const contactLabel = (contact: Contact) => contact.name || contact.public_key.slice(0, 12);
  const matchingContacts = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    const matches = q
      ? sortedContacts.filter(
          (c) =>
            (c.name ?? '').toLowerCase().includes(q) || c.public_key.toLowerCase().startsWith(q)
        )
      : sortedContacts;
    // Selected contacts first, so they stay visible while the list is capped.
    const selected = editor?.selectedContacts ?? new Set<string>();
    return [
      ...matches.filter((c) => selected.has(c.public_key.toLowerCase())),
      ...matches.filter((c) => !selected.has(c.public_key.toLowerCase())),
    ];
  }, [sortedContacts, contactQuery, editor?.selectedContacts]);
  const visibleContacts = matchingContacts.slice(0, CONTACT_LIST_LIMIT);

  const openEditor = (set: ChannelSet | null) => {
    setQuery('');
    setContactQuery('');
    setEditor({
      setId: set?.id ?? null,
      name: set?.name ?? '',
      selected: new Set(set?.channels.map((c) => c.key.toUpperCase()) ?? []),
      selectedContacts: new Set(set?.contacts.map((c) => c.public_key.toLowerCase()) ?? []),
    });
  };

  const toggleChannel = (key: string) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const selected = new Set(prev.selected);
      const upper = key.toUpperCase();
      if (selected.has(upper)) selected.delete(upper);
      else selected.add(upper);
      return { ...prev, selected };
    });
  };

  const toggleContact = (publicKey: string) => {
    setEditor((prev) => {
      if (!prev) return prev;
      const selectedContacts = new Set(prev.selectedContacts);
      const lower = publicKey.toLowerCase();
      if (selectedContacts.has(lower)) selectedContacts.delete(lower);
      else selectedContacts.add(lower);
      return { ...prev, selectedContacts };
    });
  };

  const save = async () => {
    if (!editor) return;
    const name = editor.name.trim();
    const keys = sortedChannels
      .map((c) => c.key.toUpperCase())
      .filter((k) => editor.selected.has(k));
    // Keep channels of the set that are no longer in the channel list.
    for (const key of editor.selected) if (!keys.includes(key)) keys.push(key);
    const contactKeys = sortedContacts
      .map((c) => c.public_key.toLowerCase())
      .filter((k) => editor.selectedContacts.has(k));
    for (const key of editor.selectedContacts)
      if (!contactKeys.includes(key)) contactKeys.push(key);
    try {
      if (editor.setId) {
        const updated = await api.updateChannelSet(editor.setId, {
          name,
          channel_keys: keys,
          contact_keys: contactKeys,
        });
        setSets((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        const created = await api.createChannelSet(name, keys, contactKeys);
        setSets((prev) => [...prev, created]);
      }
      setEditor(null);
      toast.success(t('channel_sets_saved', { name }));
    } catch (err) {
      toast.error(t('channel_sets_save_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const remove = async (set: ChannelSet) => {
    if (!confirm(t('channel_sets_confirm_delete', { name: set.name }))) return;
    try {
      await api.deleteChannelSet(set.id);
      setSets((prev) => prev.filter((s) => s.id !== set.id));
      if (editor?.setId === set.id) setEditor(null);
    } catch {
      toast.error(t('channel_sets_delete_failed'));
    }
  };

  const apply = async (set: ChannelSet) => {
    setBusyId(set.id);
    try {
      const result = await api.applyChannelSet(set.id);
      setResults((prev) => ({ ...prev, [set.id]: result }));
      const summary = t('channel_sets_apply_summary', {
        loaded: result.loaded,
        already: result.already_loaded,
        failed: result.failed,
      });
      if (result.failed > 0) toast.warning(summary);
      else toast.success(summary);
    } catch (err) {
      toast.error(t('channel_sets_apply_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusyId(null);
    }
  };

  const canSave =
    editor !== null &&
    editor.name.trim() !== '' &&
    (editor.selected.size > 0 || editor.selectedContacts.size > 0);

  const summaryLine = (set: ChannelSet) => {
    const parts: string[] = [];
    if (set.channels.length > 0) {
      parts.push(
        `${t('channel_sets_channel_count', { count: set.channels.length })}: ${set.channels
          .map((c) => c.name)
          .join(', ')}`
      );
    }
    if ((set.contacts ?? []).length > 0) {
      parts.push(
        `${t('channel_sets_contact_count', { count: set.contacts.length })}: ${set.contacts
          .map((c) => c.name || c.public_key.slice(0, 12))
          .join(', ')}`
      );
    }
    return parts.join(' / ');
  };

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold tracking-tight">{t('channel_sets_heading')}</h3>
      <p className="text-[0.8125rem] text-muted-foreground">{t('channel_sets_desc')}</p>

      {loading ? null : sets.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">{t('channel_sets_empty')}</p>
      ) : (
        <div className="space-y-2">
          {sets.map((set) => (
            <div key={set.id} className="space-y-2 rounded-md border border-border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{set.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{summaryLine(set)}</div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void apply(set)}
                  >
                    {busyId === set.id ? t('channel_sets_applying') : t('channel_sets_apply')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => openEditor(set)}>
                    {t('channel_sets_edit')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void remove(set)}
                  >
                    {t('channel_sets_delete')}
                  </Button>
                </div>
              </div>
              {results[set.id] && <ApplyResultList result={results[set.id]} />}
            </div>
          ))}
        </div>
      )}

      {editor ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="channel-set-name">{t('channel_sets_name_label')}</Label>
            <Input
              id="channel-set-name"
              value={editor.name}
              maxLength={64}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="channel-set-filter">
              {t('channel_sets_channels_label', { count: editor.selected.size })}
            </Label>
            <Input
              id="channel-set-filter"
              value={query}
              placeholder={t('channel_sets_filter_placeholder')}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {visibleChannels.map((channel) => {
                const id = `channel-set-ch-${channel.key}`;
                return (
                  <div key={channel.key} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={editor.selected.has(channel.key.toUpperCase())}
                      onCheckedChange={() => toggleChannel(channel.key)}
                    />
                    <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                      {channel.name}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="channel-set-contact-filter">
              {t('channel_sets_contacts_label', { count: editor.selectedContacts.size })}
            </Label>
            <Input
              id="channel-set-contact-filter"
              value={contactQuery}
              placeholder={t('channel_sets_contact_filter_placeholder')}
              onChange={(e) => setContactQuery(e.target.value)}
            />
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {visibleContacts.map((contact) => {
                const id = `channel-set-ct-${contact.public_key}`;
                return (
                  <div key={contact.public_key} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={editor.selectedContacts.has(contact.public_key.toLowerCase())}
                      onCheckedChange={() => toggleContact(contact.public_key)}
                    />
                    <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                      {contactLabel(contact)}
                    </Label>
                  </div>
                );
              })}
            </div>
            {matchingContacts.length > visibleContacts.length && (
              <p className="text-xs text-muted-foreground">
                {t('channel_sets_contacts_truncated', {
                  shown: visibleContacts.length,
                  total: matchingContacts.length,
                })}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" disabled={!canSave} onClick={() => void save()}>
              {t('channel_sets_save')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditor(null)}>
              {t('channel_sets_cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="outline" className="w-full" onClick={() => openEditor(null)}>
          {t('channel_sets_new')}
        </Button>
      )}
    </div>
  );
}
