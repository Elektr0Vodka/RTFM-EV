import { useEffect, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { BotList, BotListEntry } from '../../types';
import { botListErrorText } from '../../utils/botListErrors';
import { setBotListsState, useBotLists } from '../../utils/botLists';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { toast } from '../ui/sonner';

/**
 * Names a refresh added to a subscription, for the user to confirm before
 * this repeater stops relaying them (`review`), and the same list shown in
 * full when Block forwards is switched on for a subscription (`enable`).
 *
 * Only names that were on screen are ever confirmed: a refresh that lands
 * while the dialog is open adds names the user has not seen.
 */
export function BotListReviewDialog({
  list,
  mode,
  onClose,
}: {
  list: BotList | null;
  mode: 'review' | 'enable';
  onClose: () => void;
}) {
  const t = useT();
  const exceptions = useBotLists()?.exceptions ?? [];
  const [entries, setEntries] = useState<BotListEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Why the names are not there. Shown in the dialog: a toast alone would
  // leave it empty, with nothing to say whether it is still loading.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listId = list?.id ?? null;

  useEffect(() => {
    if (listId === null) return;
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    setEntries([]);
    api
      .getBotListEntries(listId)
      .then((stored) => {
        if (cancelled) return;
        setEntries(stored);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [listId]);

  const listed = entries.filter((entry) => !exceptions.includes(entry.name));
  const waiting = listed.filter((entry) => entry.forward_reviewed === false);
  const shown = mode === 'enable' ? listed : waiting;

  const attempt = async (call: () => Promise<void>) => {
    setBusy(true);
    try {
      await call();
      return true;
    } catch (err) {
      toast.error(botListErrorText(t, err instanceof Error ? err.message : String(err)));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (names: string[], close: boolean) => {
    if (listId === null || names.length === 0) return;
    const done = await attempt(async () => {
      setBotListsState(await api.reviewBotList(listId, names));
    });
    if (!done) return;
    setEntries((current) =>
      current.map((entry) =>
        names.includes(entry.name) ? { ...entry, forward_reviewed: true } : entry
      )
    );
    if (close) onClose();
  };

  const notABot = (name: string) =>
    attempt(async () => {
      setBotListsState(await api.setBotListExceptions([...exceptions, name]));
    });

  const enable = async () => {
    if (listId === null) return;
    const names = waiting.map((entry) => entry.name);
    const done = await attempt(async () => {
      if (names.length > 0) setBotListsState(await api.reviewBotList(listId, names));
      setBotListsState(await api.updateBotList(listId, { block_forward: true }));
    });
    if (done) onClose();
  };

  return (
    <Dialog open={list !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(mode === 'enable' ? 'bot_review_enable_title' : 'bot_review_title', {
              name: list?.name ?? '',
            })}
          </DialogTitle>
          <DialogDescription>
            {t(mode === 'enable' ? 'bot_review_enable_desc' : 'bot_review_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {loadError !== null && (
            <p className="text-sm text-destructive" role="alert">
              {t('bot_review_load_failed', { error: botListErrorText(t, loadError) })}
            </p>
          )}
          {loaded && shown.length === 0 && (
            <p className="text-sm italic text-muted-foreground">{t('bot_review_none')}</p>
          )}
          {shown.map((entry) => (
            <div key={entry.name} className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm">{entry.name}</div>
                {entry.note && (
                  <div className="truncate text-xs text-muted-foreground">{entry.note}</div>
                )}
              </div>
              {mode === 'review' && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busy}
                    aria-label={t('bot_review_confirm_aria', { name: entry.name })}
                    onClick={() => void confirm([entry.name], false)}
                  >
                    {t('bot_review_confirm')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busy}
                    aria-label={t('bot_review_not_a_bot_aria', { name: entry.name })}
                    onClick={() => void notABot(entry.name)}
                  >
                    {t('bot_review_not_a_bot')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common_cancel')}
          </Button>
          {mode === 'enable' ? (
            <Button type="button" disabled={busy || !loaded} onClick={() => void enable()}>
              {t('bot_review_enable_confirm')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy || !loaded || waiting.length === 0}
              onClick={() =>
                void confirm(
                  waiting.map((entry) => entry.name),
                  true
                )
              }
            >
              {t('bot_review_confirm_all')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
