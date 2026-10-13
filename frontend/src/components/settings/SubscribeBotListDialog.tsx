import { useEffect, useRef, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { BotListPreview } from '../../types';
import { botListErrorText } from '../../utils/botListErrors';
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
import { Label } from '../ui/label';
import { toast } from '../ui/sonner';

/**
 * Subscribe to a bot list by URL, in two steps: show what the address serves,
 * then store it. Subscribe is only there for the address that was shown.
 */
export function SubscribeBotListDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<BotListPreview | null>(null);
  const [busy, setBusy] = useState(false);
  // An answer only counts for the request that is current: the dialog may have
  // been closed and opened again while a slow address was still being fetched.
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    requestRef.current += 1;
    setUrl('');
    setPreview(null);
    setBusy(false);
  }, [open]);

  const fail = (err: unknown) =>
    toast.error(botListErrorText(t, err instanceof Error ? err.message : String(err)));

  const show = async () => {
    const mine = ++requestRef.current;
    setBusy(true);
    try {
      const shown = await api.previewBotListUrl(url.trim());
      if (mine === requestRef.current) setPreview(shown);
    } catch (err) {
      if (mine === requestRef.current) {
        setPreview(null);
        fail(err);
      }
    } finally {
      if (mine === requestRef.current) setBusy(false);
    }
  };

  const subscribe = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      setBotListsState(await api.subscribeBotList(preview.url));
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('bot_list_subscribe_title')}</DialogTitle>
          <DialogDescription>{t('bot_list_subscribe_desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="bot-list-url">{t('bot_list_subscribe_url_label')}</Label>
            <Input
              id="bot-list-url"
              type="url"
              placeholder="https://"
              value={url}
              maxLength={2048}
              // Locked while fetching, so the list shown is always the one for
              // the address in this field.
              disabled={busy}
              onChange={(event) => {
                setUrl(event.target.value);
                setPreview(null);
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || url.trim().length === 0}
            onClick={() => void show()}
          >
            {t('bot_list_subscribe_preview')}
          </Button>
          {preview && (
            <div className="space-y-2 border-t border-border/60 pt-3">
              <div className="text-sm font-medium">
                {t('bot_list_subscribe_summary', {
                  name: preview.name,
                  count: preview.entries.length,
                })}
              </div>
              {preview.description && (
                <p className="text-[0.8125rem] text-muted-foreground">{preview.description}</p>
              )}
              <div className="max-h-[40vh] space-y-1 overflow-y-auto">
                {preview.entries.map((entry) => (
                  <div key={entry.name} className="min-w-0">
                    <div className="truncate text-sm">{entry.name}</div>
                    {entry.note && (
                      <div className="truncate text-xs text-muted-foreground">{entry.note}</div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[0.8125rem] text-muted-foreground">
                {t('bot_list_subscribe_off_note')}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('bot_lists_cancel')}
          </Button>
          {preview && (
            <Button type="button" disabled={busy} onClick={() => void subscribe()}>
              {t('bot_list_subscribe_confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
