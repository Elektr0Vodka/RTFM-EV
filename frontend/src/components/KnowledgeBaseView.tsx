import { useMemo, useState } from 'react';
import { ExternalLink, Plus, X } from 'lucide-react';

import type { AppSettingsUpdate, HandyInfoSettings, HandyLinkCategory } from '../types';
import { useT } from '../i18n';
import {
  EMPTY_HANDY_INFO,
  HANDY_BUILTINS,
  HANDY_LINK_CATEGORIES,
  formToCustomEntry,
  handyEntryLabel,
  newHandyEntryId,
  resolveHandyEntries,
  withCustomEntry,
  withKnowledgeBase,
  type HandyEntry,
} from './settings/handyInfo';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { toast } from './ui/sonner';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 ' +
  'focus-visible:ring-ring focus-visible:ring-offset-2';

interface AddForm {
  label: string;
  url: string;
  category: HandyLinkCategory;
}

const EMPTY_ADD_FORM: AddForm = { label: '', url: '', category: 'community' };

/**
 * Tools > Knowledge base: the Handy Info links the user flagged for it, grouped
 * by category. Adding creates a flagged custom link; removing only unflags
 * (the link stays in Settings > Handy Info). Stored in the handy_info overlay.
 */
export function KnowledgeBaseView({
  handyInfo,
  onSaveAppSettings,
}: {
  handyInfo: HandyInfoSettings | null | undefined;
  onSaveAppSettings?: (update: AppSettingsUpdate) => Promise<void> | void;
}) {
  const t = useT();
  const overlay = handyInfo ?? EMPTY_HANDY_INFO;
  const kbEntries = useMemo(
    () => resolveHandyEntries(HANDY_BUILTINS, overlay).filter((e) => e.group === 'links' && e.kb),
    [overlay]
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_ADD_FORM);

  const persist = (next: HandyInfoSettings, successKey: string) => {
    if (!onSaveAppSettings) return;
    void Promise.resolve(onSaveAppSettings({ handy_info: next }))
      .then(() => toast.success(t(successKey)))
      .catch(() => toast.error(t('settings_handy_toast_apply_failed')));
  };

  const remove = (entry: HandyEntry) =>
    persist(withKnowledgeBase(overlay, entry, false), 'settings_handy_toast_kb_removed');

  const openAdd = () => {
    setForm(EMPTY_ADD_FORM);
    setDialogOpen(true);
  };

  const submitAdd = () => {
    if (!form.label.trim()) {
      toast.error(t('settings_handy_err_label'));
      return;
    }
    if (!/^https?:\/\//.test(form.url.trim())) {
      toast.error(t('settings_handy_err_url'));
      return;
    }
    const entry = formToCustomEntry(
      newHandyEntryId(),
      {
        label: form.label,
        url: form.url,
        group: 'links',
        category: form.category,
        applyKind: '',
        node_url_template: '',
        packet_url_template: '',
        channel_url_template: '',
        node_api_url_template: '',
      },
      true
    );
    setDialogOpen(false);
    persist(withCustomEntry(overlay, entry), 'settings_handy_toast_kb_added');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="font-semibold text-base text-foreground">{t('nav_knowledge_base')}</h2>
          <p className="hidden md:block text-xs text-muted-foreground">
            {t('knowledge_base_desc')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={openAdd}
          disabled={!onSaveAppSettings}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('knowledge_base_add')}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          <p className="text-[0.8125rem] text-muted-foreground md:hidden">
            {t('knowledge_base_desc')}
          </p>
          {kbEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('knowledge_base_empty')}</p>
          ) : (
            HANDY_LINK_CATEGORIES.map((cat) => {
              const catEntries = kbEntries.filter((e) => e.category === cat);
              if (!catEntries.length) return null;
              return (
                <section key={cat} className="space-y-2">
                  <h3 className="text-sm font-semibold tracking-tight">
                    {t(`settings_handy_cat_${cat}`)}
                  </h3>
                  <ul className="space-y-2">
                    {catEntries.map((entry) => {
                      const name = handyEntryLabel(entry, t);
                      return (
                        <li
                          key={entry.id}
                          className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5"
                        >
                          <a
                            href={entry.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 flex-1 group"
                            aria-label={t('settings_handy_open_aria', { name })}
                          >
                            <span className="flex items-center gap-1.5 text-sm font-medium text-primary group-hover:underline">
                              {name}
                              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                            </span>
                            <span className="block text-xs font-mono text-muted-foreground break-all">
                              {entry.url}
                            </span>
                          </a>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => remove(entry)}
                            disabled={!onSaveAppSettings}
                            aria-label={t('settings_handy_kb_remove_aria', { name })}
                            title={t('settings_handy_kb_remove_aria', { name })}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('knowledge_base_add')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="kb-label">{t('settings_handy_field_label')}</Label>
              <Input
                id="kb-label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kb-url">{t('settings_handy_field_url')}</Label>
              <Input
                id="kb-url"
                value={form.url}
                placeholder="https://"
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="kb-category">{t('settings_handy_field_category')}</Label>
              <select
                id="kb-category"
                className={SELECT_CLASS}
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value as HandyLinkCategory }))
                }
              >
                {HANDY_LINK_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {t(`settings_handy_cat_${cat}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
              {t('settings_handy_cancel')}
            </Button>
            <Button type="button" onClick={submitAdd}>
              {t('settings_handy_save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
