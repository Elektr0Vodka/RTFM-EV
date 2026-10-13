import { useEffect, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { BotList, BotListEntry } from '../../types';
import { setBotListsState } from '../../utils/botLists';
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
import { toast } from '../ui/sonner';

/** The names on one bot list. Only a list of the user's own can be edited. */
export function BotListDialog({ list, onClose }: { list: BotList | null; onClose: () => void }) {
  const t = useT();
  const [entries, setEntries] = useState<BotListEntry[]>([]);
  const [name, setName] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Saving replaces the whole list, so nothing may be saved (or shown as
  // "empty") until the stored names have actually arrived.
  const [loaded, setLoaded] = useState(false);
  const listId = list?.id ?? null;
  const editable = list?.source === 'local' && loaded;

  useEffect(() => {
    if (listId === null) return;
    let cancelled = false;
    setLoaded(false);
    setEntries([]);
    setName('');
    setPublicKey('');
    setNote('');
    api
      .getBotListEntries(listId)
      .then((stored) => {
        if (cancelled) return;
        setEntries(stored);
        setLoaded(true);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const trimmed = name.trim();
  const canAdd = trimmed.length > 0 && !entries.some((entry) => entry.name === trimmed);

  const add = () => {
    if (!canAdd) return;
    setEntries([
      ...entries,
      { name: trimmed, public_key: publicKey.trim() || null, note: note.trim() || null },
    ]);
    setName('');
    setPublicKey('');
    setNote('');
  };

  const save = async () => {
    if (listId === null) return;
    setBusy(true);
    try {
      setBotListsState(await api.setBotListEntries(listId, entries));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={list !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('bot_list_dialog_title', { name: list?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {list?.source === 'local'
              ? t('settings_bot_lists_desc')
              : t('bot_list_dialog_read_only')}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {loaded && entries.length === 0 && (
            <p className="text-sm italic text-muted-foreground">{t('bot_list_dialog_empty')}</p>
          )}
          {entries.map((entry) => (
            <div key={entry.name} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm">{entry.name}</div>
                {(entry.note || entry.public_key) && (
                  <div className="truncate text-xs text-muted-foreground">
                    {[entry.note, entry.public_key].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 text-xs"
                  aria-label={t('bot_list_dialog_remove', { name: entry.name })}
                  onClick={() => setEntries(entries.filter((e) => e.name !== entry.name))}
                >
                  ×
                </Button>
              )}
            </div>
          ))}
        </div>
        {editable && (
          <div className="space-y-2 border-t border-border/60 pt-3">
            <Input
              id="bot-entry-name"
              placeholder={t('bot_list_dialog_name')}
              value={name}
              maxLength={128}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              placeholder={t('bot_list_dialog_key')}
              value={publicKey}
              maxLength={64}
              onChange={(event) => setPublicKey(event.target.value)}
            />
            <Input
              placeholder={t('bot_list_dialog_note')}
              value={note}
              maxLength={256}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button type="button" variant="outline" size="sm" disabled={!canAdd} onClick={add}>
              {t('bot_list_dialog_add')}
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('bot_list_dialog_close')}
          </Button>
          {editable && (
            <Button type="button" disabled={busy} onClick={() => void save()}>
              {t('bot_list_dialog_save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
