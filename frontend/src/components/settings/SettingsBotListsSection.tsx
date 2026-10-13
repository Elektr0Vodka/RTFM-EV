import { useEffect, useRef, useState } from 'react';

import { api } from '../../api';
import { useT } from '../../i18n';
import type { AppSettings, AppSettingsUpdate, BotList, BotListsState } from '../../types';
import { botListErrorText } from '../../utils/botListErrors';
import { loadBotLists, setBotListsState, useBotLists } from '../../utils/botLists';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from '../ui/sonner';
import { BotListDialog } from './BotListDialog';
import { SubscribeBotListDialog } from './SubscribeBotListDialog';

function hostOf(url: string | null): string {
  try {
    return new URL(url ?? '').host;
  } catch {
    return '';
  }
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'));
    reader.readAsText(file);
  });
}

/**
 * Bot lists in Settings: the Hide bots switch, the lists with their Enabled
 * switch, file import and export, and the names that are never a bot.
 */
export function SettingsBotListsSection({
  appSettings,
  onSaveAppSettings,
}: {
  appSettings?: AppSettings | null;
  onSaveAppSettings?: (update: AppSettingsUpdate) => void;
}) {
  const t = useT();
  const state = useBotLists();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState('');
  const [newException, setNewException] = useState('');
  const [openList, setOpenList] = useState<BotList | null>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);

  useEffect(() => {
    void loadBotLists().catch((err) =>
      toast.error(err instanceof Error ? err.message : String(err))
    );
  }, []);

  const run = async (call: () => Promise<BotListsState>) => {
    try {
      setBotListsState(await call());
      return true;
    } catch (err) {
      toast.error(botListErrorText(t, err instanceof Error ? err.message : String(err)));
      return false;
    }
  };

  const lists = state?.lists ?? [];
  const exceptions = state?.exceptions ?? [];
  const sourceLabel = (list: BotList) =>
    list.source === 'shipped'
      ? t('settings_bot_lists_source_shipped')
      : list.source === 'url'
        ? t('settings_bot_lists_source_url')
        : t('settings_bot_lists_source_local');

  // Host only: the full address can carry a token in its query.
  const subscriptionLine = (list: BotList) => {
    const host = hostOf(list.url);
    return list.fetched_at
      ? t('settings_bot_lists_last_refresh', {
          host,
          date: formatDateTime(new Date(list.fetched_at * 1000), {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
          }),
        })
      : t('settings_bot_lists_never_refreshed', { host });
  };

  const createList = async () => {
    const name = newName.trim();
    if (!name) return;
    if (await run(() => api.createBotList(name))) setNewName('');
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    await run(async () => api.importBotList(await readText(file)));
    if (fileRef.current) fileRef.current.value = '';
  };

  const addException = async () => {
    const name = newException.trim();
    if (!name || exceptions.includes(name)) return;
    if (await run(() => api.setBotListExceptions([...exceptions, name]))) setNewException('');
  };

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3">
      <div className="text-sm font-semibold">{t('settings_bot_lists_heading')}</div>
      <p className="text-[0.8125rem] text-muted-foreground">{t('settings_bot_lists_desc')}</p>

      <div className="flex items-start gap-3">
        <Checkbox
          id="bot-lists-hide"
          checked={appSettings?.hide_bots ?? false}
          onCheckedChange={(checked) => onSaveAppSettings?.({ hide_bots: checked === true })}
          className="mt-0.5"
        />
        <div className="space-y-1">
          <Label htmlFor="bot-lists-hide">{t('settings_bot_lists_hide_label')}</Label>
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('settings_bot_lists_hide_desc')}
          </p>
        </div>
      </div>

      {lists.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">{t('settings_bot_lists_none')}</p>
      ) : (
        <div className="space-y-2">
          {lists.map((list) => (
            <div
              key={list.id}
              data-testid="bot-list-row"
              className="flex flex-wrap items-center gap-2 rounded border border-border/40 p-2"
            >
              <Checkbox
                checked={list.enabled}
                aria-label={t('settings_bot_lists_enabled_label', { name: list.name })}
                onCheckedChange={(checked) =>
                  void run(() => api.updateBotList(list.id, { enabled: checked === true }))
                }
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{list.name}</div>
                <div className="text-xs text-muted-foreground">
                  <span>{sourceLabel(list)}</span>
                  {' · '}
                  <span>{t('settings_bot_lists_entry_count', { count: list.entry_count })}</span>
                </div>
                {list.source === 'url' && (
                  <div className="truncate text-xs text-muted-foreground">
                    {subscriptionLine(list)}
                  </div>
                )}
                {list.last_error && (
                  <div className="text-xs text-destructive">
                    {t('settings_bot_lists_error', {
                      error: botListErrorText(t, list.last_error),
                    })}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setOpenList(list)}
              >
                {t('settings_bot_lists_entries_button')}
              </Button>
              {list.source === 'url' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void run(() => api.refreshBotList(list.id))}
                >
                  {t('settings_bot_lists_refresh_button')}
                </Button>
              )}
              <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
                <a href={api.botListExportUrl(list.id)} download>
                  {t('settings_bot_lists_export_button')}
                </a>
              </Button>
              {list.source !== 'shipped' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    if (window.confirm(t('settings_bot_lists_delete_confirm', { name: list.name })))
                      void run(() => api.deleteBotList(list.id));
                  }}
                >
                  {t('settings_bot_lists_delete_button')}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 max-w-56"
          placeholder={t('settings_bot_lists_new_placeholder')}
          value={newName}
          maxLength={128}
          onChange={(event) => setNewName(event.target.value)}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => void createList()}>
          {t('settings_bot_lists_new_button')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          {t('settings_bot_lists_import_button')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setSubscribeOpen(true)}>
          {t('settings_bot_lists_subscribe_button')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void importFile(event.target.files?.[0])}
        />
      </div>

      <div className="space-y-2" data-testid="bot-exceptions">
        <div className="text-xs font-medium text-muted-foreground">
          {t('settings_bot_lists_exceptions_heading')}
        </div>
        <p className="text-[0.8125rem] text-muted-foreground">
          {t('settings_bot_lists_exceptions_desc')}
        </p>
        {exceptions.map((name) => (
          <div key={name} className="flex items-center justify-between gap-2">
            <span className="truncate text-sm">{name}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 text-xs"
              aria-label={t('settings_bot_lists_exception_remove', { name })}
              onClick={() =>
                void run(() => api.setBotListExceptions(exceptions.filter((n) => n !== name)))
              }
            >
              ×
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Input
            className="h-8 max-w-56"
            placeholder={t('settings_bot_lists_exception_placeholder')}
            value={newException}
            maxLength={128}
            onChange={(event) => setNewException(event.target.value)}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => void addException()}>
            {t('settings_bot_lists_exception_add')}
          </Button>
        </div>
      </div>

      <BotListDialog list={openList} onClose={() => setOpenList(null)} />
      <SubscribeBotListDialog open={subscribeOpen} onClose={() => setSubscribeOpen(false)} />
    </div>
  );
}
