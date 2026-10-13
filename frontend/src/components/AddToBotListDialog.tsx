import { useEffect, useState } from 'react';

import { api } from '../api';
import { useT } from '../i18n';
import type { Message } from '../types';
import { setBotListsState, useBotLists } from '../utils/botLists';
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
import { toast } from './ui/sonner';

const NEW_LIST = 'new';

/**
 * Put the sender of a chat message on one of the user's own bot lists. A list
 * made here is switched on at once, so the marker shows straight away.
 */
export function AddToBotListDialog({
  message,
  onClose,
}: {
  message: Message | null;
  onClose: () => void;
}) {
  const t = useT();
  const state = useBotLists();
  const localLists = (state?.lists ?? []).filter((list) => list.source === 'local');
  const firstListId = localLists[0]?.id;
  const [target, setTarget] = useState<string>(NEW_LIST);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const messageId = message?.id ?? null;

  useEffect(() => {
    if (messageId === null) return;
    setTarget(firstListId === undefined ? NEW_LIST : String(firstListId));
    setNewName('');
  }, [messageId, firstListId]);

  const name = message?.sender_name ?? '';
  const canSave = !!name && !busy && (target !== NEW_LIST || newName.trim().length > 0);

  const save = async () => {
    if (!message || !name) return;
    setBusy(true);
    try {
      let listId: number;
      if (target === NEW_LIST) {
        const known = new Set((state?.lists ?? []).map((list) => list.id));
        const created = await api.createBotList(newName.trim());
        const made = created.lists.find((list) => !known.has(list.id));
        if (!made) throw new Error('The new list was not created');
        await api.updateBotList(made.id, { enabled: true });
        listId = made.id;
      } else {
        listId = Number(target);
      }
      const key = message.type === 'PRIV' ? message.conversation_key : message.sender_key;
      setBotListsState(
        await api.addBotListEntry(listId, { name, public_key: key ?? null, note: null })
      );
      toast.success(t('bot_lists_added_toast', { name }));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('bot_lists_add_title', { name })}</DialogTitle>
          <DialogDescription>{t('bot_lists_add_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="bot-list-target">{t('bot_lists_add_list_label')}</Label>
            <select
              id="bot-list-target"
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {localLists.map((list) => (
                <option key={list.id} value={String(list.id)}>
                  {list.enabled ? list.name : `${list.name} ${t('bot_lists_list_off_suffix')}`}
                </option>
              ))}
              <option value={NEW_LIST}>{t('bot_lists_add_new_list')}</option>
            </select>
          </div>
          {target === NEW_LIST && (
            <div className="space-y-1">
              <Label htmlFor="bot-list-new-name">{t('bot_lists_add_new_list_name')}</Label>
              <Input
                id="bot-list-new-name"
                value={newName}
                maxLength={128}
                onChange={(event) => setNewName(event.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('bot_lists_cancel')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void save()}>
            {t('bot_lists_add_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
