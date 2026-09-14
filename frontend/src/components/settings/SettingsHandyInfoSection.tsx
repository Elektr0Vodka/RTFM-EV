import { useMemo, useState } from 'react';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';

import type {
  AppSettings,
  AppSettingsUpdate,
  HandyApplyKind,
  HandyLinkCategory,
} from '../../types';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { toast } from '../ui/sonner';
import { useT } from '../../i18n';
import type { TFn } from '../../i18n';
import {
  buildBuiltinOverride,
  EMPTY_HANDY_INFO,
  formToCustomEntry,
  HANDY_BUILTINS,
  HANDY_LINK_CATEGORIES,
  resolveHandyEntries,
  withCustomEntry,
  withHiddenBuiltin,
  withOverride,
  withoutCustomEntry,
  type HandyEntry,
  type HandyEntryForm,
} from './handyInfo';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ' +
  'ring-offset-background focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const EMPTY_FORM: HandyEntryForm = {
  label: '',
  url: '',
  group: 'links',
  category: 'community',
  applyKind: '',
  node_url_template: '',
  packet_url_template: '',
};

function genId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function entryLabel(entry: HandyEntry, t: TFn): string {
  return entry.label ?? (entry.labelKey ? t(entry.labelKey) : entry.id);
}

export function SettingsHandyInfoSection({
  appSettings,
  onSaveAppSettings,
  className,
}: {
  appSettings: AppSettings | null;
  onSaveAppSettings: (update: AppSettingsUpdate) => Promise<void>;
  className?: string;
}) {
  const t = useT();
  const overlay = appSettings?.handy_info ?? EMPTY_HANDY_INFO;
  const entries = useMemo(() => resolveHandyEntries(HANDY_BUILTINS, overlay), [overlay]);

  const analyzerEntries = entries.filter((e) => e.group === 'analyzers');
  const syncEntries = entries.filter((e) => e.group === 'sync');
  const linkEntries = entries.filter((e) => e.group === 'links');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<HandyEntryForm>(EMPTY_FORM);

  const persist = (next: AppSettingsUpdate, successKey?: string) =>
    void onSaveAppSettings(next)
      .then(() => successKey && toast.success(t(successKey)))
      .catch(() => toast.error(t('settings_handy_toast_apply_failed')));

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    toast.success(t('settings_handy_toast_copied'));
  };

  const isAnalyzerConfigured = (template: string | undefined): boolean =>
    !!template && (appSettings?.analyzer_sites ?? []).some((s) => s.node_url_template === template);

  const applyAnalyzer = (entry: HandyEntry) => {
    const template = entry.apply?.node_url_template;
    const name = entryLabel(entry, t);
    if (!template) return;
    if (isAnalyzerConfigured(template)) {
      toast.info(t('settings_handy_toast_analyzer_exists', { name }));
      return;
    }
    const next = [
      ...(appSettings?.analyzer_sites ?? []),
      {
        name,
        node_url_template: template,
        packet_url_template: entry.apply?.packet_url_template ?? null,
      },
    ];
    void onSaveAppSettings({ analyzer_sites: next })
      .then(() => toast.success(t('settings_handy_toast_analyzer_added', { name })))
      .catch(() => toast.error(t('settings_handy_toast_apply_failed')));
  };

  const applySync = (entry: HandyEntry) => {
    const name = entryLabel(entry, t);
    const field = entry.apply?.kind === 'region_sync' ? 'region_sync_url' : 'registry_sync_url';
    const current = (appSettings?.[field] ?? '').trim();
    if (current && current !== entry.url) {
      if (!window.confirm(t('settings_handy_confirm_overwrite', { name }))) return;
    }
    const update: AppSettingsUpdate =
      entry.apply?.kind === 'region_sync'
        ? { region_sync_url: entry.url }
        : { registry_sync_url: entry.url };
    persist(update, 'settings_handy_toast_sync_applied');
  };

  const deleteEntry = (entry: HandyEntry) => {
    const name = entryLabel(entry, t);
    if (entry.source === 'builtin') {
      if (!window.confirm(t('settings_handy_confirm_hide', { name }))) return;
      persist({ handy_info: withHiddenBuiltin(overlay, entry.id) });
    } else {
      if (!window.confirm(t('settings_handy_confirm_delete', { name }))) return;
      persist({ handy_info: withoutCustomEntry(overlay, entry.id) });
    }
  };

  const resetDefaults = () => {
    if (!window.confirm(t('settings_handy_confirm_reset'))) return;
    persist({ handy_info: EMPTY_HANDY_INFO }, 'settings_handy_toast_reset');
  };

  const openAdd = (mode: 'links' | 'configure') => {
    setEditingId(null);
    setForm(
      mode === 'links'
        ? { ...EMPTY_FORM, group: 'links', category: 'community' }
        : { ...EMPTY_FORM, group: 'analyzers', applyKind: 'analyzer', category: '' }
    );
    setDialogOpen(true);
  };

  const openEdit = (entry: HandyEntry) => {
    setEditingId(entry.id);
    setForm({
      label: entryLabel(entry, t),
      url: entry.url,
      group: entry.group,
      category: (entry.category as HandyLinkCategory) || '',
      applyKind: entry.apply?.kind ?? '',
      node_url_template: entry.apply?.node_url_template ?? '',
      packet_url_template: entry.apply?.packet_url_template ?? '',
    });
    setDialogOpen(true);
  };

  const setType = (kind: HandyApplyKind) =>
    setForm((f) => ({ ...f, applyKind: kind, group: kind === 'analyzer' ? 'analyzers' : 'sync' }));

  const validateForm = (): string | null => {
    if (!form.label.trim()) return t('settings_handy_err_label');
    if (!/^https?:\/\//.test(form.url.trim())) return t('settings_handy_err_url');
    if (form.group === 'links' && !form.category) return t('settings_handy_err_category');
    if (form.group === 'analyzers') {
      const node = form.node_url_template.trim();
      if (!/^https?:\/\//.test(node) || !node.includes('{pubkey}')) {
        return t('settings_handy_err_node_tpl');
      }
      const packet = form.packet_url_template.trim();
      if (packet && (!/^https?:\/\//.test(packet) || !packet.includes('{hash}'))) {
        return t('settings_handy_err_packet_tpl');
      }
    }
    return null;
  };

  const submitForm = () => {
    const error = validateForm();
    if (error) {
      toast.error(error);
      return;
    }
    const editingBuiltin = editingId ? HANDY_BUILTINS.find((b) => b.id === editingId) : undefined;
    let next;
    if (editingBuiltin) {
      const defaultLabel =
        editingBuiltin.label ?? (editingBuiltin.labelKey ? t(editingBuiltin.labelKey) : '');
      const override = buildBuiltinOverride(
        editingBuiltin,
        form,
        overlay.overrides[editingBuiltin.id],
        defaultLabel
      );
      next = withOverride(overlay, editingBuiltin.id, override);
    } else {
      const id = editingId ?? genId();
      next = withCustomEntry(overlay, formToCustomEntry(id, form));
    }
    setDialogOpen(false);
    persist({ handy_info: next }, 'settings_handy_toast_saved');
  };

  const rowClass = 'rounded-md border border-border p-2.5 flex items-start justify-between gap-3';
  const actionsClass = 'flex flex-wrap gap-1.5 justify-end';

  const editDeleteButtons = (entry: HandyEntry) => (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => openEdit(entry)}
        aria-label={t('settings_handy_edit_aria', { name: entryLabel(entry, t) })}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={() => deleteEntry(entry)}
        aria-label={
          entry.source === 'builtin'
            ? t('settings_handy_hide_aria', { name: entryLabel(entry, t) })
            : t('settings_handy_delete_aria', { name: entryLabel(entry, t) })
        }
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </>
  );

  const analyzerRow = (entry: HandyEntry) => {
    const name = entryLabel(entry, t);
    const template = entry.apply?.node_url_template ?? '';
    const configured = isAnalyzerConfigured(template);
    return (
      <li key={entry.id} className={rowClass}>
        <div className="min-w-0 flex-1 space-y-0.5">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary hover:underline"
            aria-label={t('settings_handy_open_aria', { name })}
          >
            {name}
          </a>
          <div className="text-xs font-mono text-muted-foreground break-all">{template}</div>
        </div>
        <div className={actionsClass}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(template)}
            aria-label={t('settings_handy_copy_aria', { name })}
          >
            {t('settings_handy_copy')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={configured}
            onClick={() => applyAnalyzer(entry)}
            aria-label={t('settings_handy_apply_aria', { name })}
          >
            {configured ? t('settings_handy_added') : t('settings_handy_apply')}
          </Button>
          {editDeleteButtons(entry)}
        </div>
      </li>
    );
  };

  const syncRow = (entry: HandyEntry) => {
    const name = entryLabel(entry, t);
    return (
      <li key={entry.id} className={rowClass}>
        <div className="min-w-0 flex-1 space-y-0.5">
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary hover:underline"
            aria-label={t('settings_handy_open_aria', { name })}
          >
            {name}
          </a>
          <div className="text-xs font-mono text-muted-foreground break-all">{entry.url}</div>
        </div>
        <div className={actionsClass}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(entry.url)}
            aria-label={t('settings_handy_copy_aria', { name })}
          >
            {t('settings_handy_copy')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => applySync(entry)}
            aria-label={t('settings_handy_apply_aria', { name })}
          >
            {t('settings_handy_apply')}
          </Button>
          {editDeleteButtons(entry)}
        </div>
      </li>
    );
  };

  const linkRow = (entry: HandyEntry) => {
    const name = entryLabel(entry, t);
    return (
      <li key={entry.id} className={rowClass}>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs font-mono text-muted-foreground break-all">{entry.url}</div>
        </div>
        <div className={actionsClass}>
          <a href={entry.url} target="_blank" rel="noopener noreferrer">
            <Button
              variant="outline"
              size="sm"
              aria-label={t('settings_handy_open_aria', { name })}
            >
              {t('settings_handy_open')}
            </Button>
          </a>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(entry.url)}
            aria-label={t('settings_handy_copy_aria', { name })}
          >
            {t('settings_handy_copy')}
          </Button>
          {editDeleteButtons(entry)}
        </div>
      </li>
    );
  };

  const editingConfigure = form.group !== 'links';

  return (
    <div className={className}>
      <p className="text-[0.8125rem] text-muted-foreground mb-3">{t('settings_handy_intro')}</p>

      <Tabs defaultValue="configure">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="configure" className="flex-1 sm:flex-none">
            {t('settings_handy_tab_configure')}
          </TabsTrigger>
          <TabsTrigger value="links" className="flex-1 sm:flex-none">
            {t('settings_handy_tab_links')}
          </TabsTrigger>
        </TabsList>

        {/* Configure: apply-capable entries */}
        <TabsContent value="configure" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_handy_analyzers_desc')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => openAdd('configure')}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('settings_handy_add')}
            </Button>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-semibold tracking-tight">
              {t('settings_handy_analyzers_heading')}
            </h3>
            {analyzerEntries.length ? (
              <ul className="space-y-2">{analyzerEntries.map(analyzerRow)}</ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t('settings_handy_empty')}</p>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <h3 className="text-base font-semibold tracking-tight">
              {t('settings_handy_sync_heading')}
            </h3>
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_handy_sync_desc')}
            </p>
            {syncEntries.length ? (
              <ul className="space-y-2">{syncEntries.map(syncRow)}</ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t('settings_handy_empty')}</p>
            )}
          </div>
        </TabsContent>

        {/* Links: open-only, grouped by category */}
        <TabsContent value="links" className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('settings_handy_links_desc')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => openAdd('links')}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('settings_handy_add')}
            </Button>
          </div>

          {HANDY_LINK_CATEGORIES.map((cat) => {
            const catEntries = linkEntries.filter((e) => e.category === cat);
            if (!catEntries.length) return null;
            return (
              <div key={cat} className="space-y-2">
                <h3 className="text-base font-semibold tracking-tight">
                  {t(`settings_handy_cat_${cat}`)}
                </h3>
                <ul className="space-y-2">{catEntries.map(linkRow)}</ul>
              </div>
            );
          })}

          <Separator />

          <Button variant="ghost" size="sm" onClick={resetDefaults}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            {t('settings_handy_reset')}
          </Button>
        </TabsContent>
      </Tabs>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('settings_handy_dialog_edit') : t('settings_handy_dialog_add')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {editingConfigure ? (
              <div className="space-y-1">
                <Label htmlFor="handy-type">{t('settings_handy_field_type')}</Label>
                <select
                  id="handy-type"
                  className={SELECT_CLASS}
                  value={form.applyKind || 'analyzer'}
                  disabled={!!editingId}
                  onChange={(e) => setType(e.target.value as HandyApplyKind)}
                >
                  <option value="analyzer">{t('settings_handy_type_analyzer')}</option>
                  <option value="region_sync">{t('settings_handy_type_region_sync')}</option>
                  <option value="registry_sync">{t('settings_handy_type_registry_sync')}</option>
                </select>
              </div>
            ) : null}

            <div className="space-y-1">
              <Label htmlFor="handy-label">{t('settings_handy_field_label')}</Label>
              <Input
                id="handy-label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="handy-url">{t('settings_handy_field_url')}</Label>
              <Input
                id="handy-url"
                value={form.url}
                placeholder="https://"
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>

            {form.group === 'links' ? (
              <div className="space-y-1">
                <Label htmlFor="handy-category">{t('settings_handy_field_category')}</Label>
                <select
                  id="handy-category"
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
            ) : null}

            {form.group === 'analyzers' ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="handy-node">{t('settings_handy_field_node_tpl')}</Label>
                  <Input
                    id="handy-node"
                    value={form.node_url_template}
                    placeholder="https://.../{pubkey}"
                    onChange={(e) => setForm((f) => ({ ...f, node_url_template: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="handy-packet">{t('settings_handy_field_packet_tpl')}</Label>
                  <Input
                    id="handy-packet"
                    value={form.packet_url_template}
                    placeholder="https://.../{hash}"
                    onChange={(e) =>
                      setForm((f) => ({ ...f, packet_url_template: e.target.value }))
                    }
                  />
                </div>
              </>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('settings_handy_cancel')}
            </Button>
            <Button onClick={submitForm}>{t('settings_handy_save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
