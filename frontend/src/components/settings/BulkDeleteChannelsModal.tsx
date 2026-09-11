import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { isPublicChannelKey } from '../../utils/publicChannel';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { toast } from '../ui/sonner';
import { useT } from '../../i18n';
import type { Channel } from '../../types';

type SortField = 'name' | 'key';
type SortDir = 'asc' | 'desc';
type TypeFilter = 'all' | 'hashtag' | 'standard';

interface BulkDeleteChannelsModalProps {
  open: boolean;
  onClose: () => void;
  channels: Channel[];
  onDeleted: (deletedKeys: string[]) => void;
}

export function BulkDeleteChannelsModal({
  open,
  onClose,
  channels,
  onDeleted,
}: BulkDeleteChannelsModalProps) {
  const t = useT();
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [deleting, setDeleting] = useState(false);
  const lastClickedKeyRef = useRef<string | null>(null);

  const resetAndClose = useCallback(() => {
    setStep('select');
    setSelectedKeys(new Set());
    setQuery('');
    setTypeFilter('all');
    setSortField('name');
    setSortDir('asc');
    lastClickedKeyRef.current = null;
    onClose();
  }, [onClose]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      else {
        setSortField(field);
        setSortDir('asc');
      }
    },
    [sortField]
  );

  // The canonical Public channel can never be deleted; keep it out of the list entirely.
  const deletable = useMemo(() => channels.filter((c) => !isPublicChannelKey(c.key)), [channels]);

  const filtered = useMemo(() => {
    let list = [...deletable];
    if (typeFilter === 'hashtag') list = list.filter((c) => c.is_hashtag);
    else if (typeFilter === 'standard') list = list.filter((c) => !c.is_hashtag);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      const av = sortField === 'name' ? a.name.toLowerCase() : a.key.toLowerCase();
      const bv = sortField === 'name' ? b.name.toLowerCase() : b.key.toLowerCase();
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return list;
  }, [deletable, typeFilter, query, sortField, sortDir]);

  const handleToggle = (key: string, shiftKey: boolean) => {
    if (shiftKey && lastClickedKeyRef.current && lastClickedKeyRef.current !== key) {
      const keys = filtered.map((c) => c.key);
      const lastIdx = keys.indexOf(lastClickedKeyRef.current);
      const curIdx = keys.indexOf(key);
      if (lastIdx >= 0 && curIdx >= 0) {
        const from = Math.min(lastIdx, curIdx);
        const to = Math.max(lastIdx, curIdx);
        const rangeKeys = keys.slice(from, to + 1);
        setSelectedKeys((prev) => {
          const next = new Set(prev);
          for (const k of rangeKeys) next.add(k);
          return next;
        });
        lastClickedKeyRef.current = key;
        return;
      }
    }
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    lastClickedKeyRef.current = key;
  };

  const selectedChannels = useMemo(
    () => deletable.filter((c) => selectedKeys.has(c.key)),
    [deletable, selectedKeys]
  );

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const keysToDelete = [...selectedKeys];
      await api.bulkDeleteChannels(keysToDelete);
      toast.success(t('bulkdelete_toast_channels_deleted', { count: keysToDelete.length }));
      onDeleted(keysToDelete);
      resetAndClose();
    } catch (err) {
      toast.error(t('bulkdelete_toast_failed_title'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  const typeLabel = (c: Channel) =>
    c.is_hashtag ? t('bulkdelete_channels_type_hashtag') : t('bulkdelete_channels_type_standard');

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && resetAndClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === 'select'
              ? t('settings_radioapp_bulk_delete_channels_heading')
              : t('bulkdelete_channels_confirm_title')}
          </DialogTitle>
          <DialogDescription>
            {step === 'select'
              ? t('bulkdelete_channels_select_description')
              : t('bulkdelete_channels_confirm_description')}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  {t('bulkdelete_filter_show_label')}
                </label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                  className="block h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="all">{t('packet_filter_all_label')}</option>
                  <option value="hashtag">{t('bulkdelete_channels_type_hashtag')}</option>
                  <option value="standard">{t('bulkdelete_channels_type_standard')}</option>
                </select>
              </div>
              <div className="flex-1 min-w-[160px] space-y-1">
                <label className="text-xs text-muted-foreground">{t('common_name')}</label>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('bulkdelete_channels_search_placeholder')}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedKeys(new Set(filtered.map((c) => c.key)))}
              >
                {t('channel_io_select_all')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedKeys(new Set())}
              >
                {t('bulkdelete_select_none_button')}
              </Button>
            </div>

            <div className="text-xs text-muted-foreground">
              {t('bulkdelete_channels_shown', { count: filtered.length })}
              {' · '}
              {t('bulkdelete_selected_count', { count: selectedKeys.size })}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 border border-border rounded-md">
              {filtered.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {t('bulkdelete_channels_no_match')}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-1.5 w-8" />
                      <th
                        className="px-3 py-1.5 cursor-pointer select-none"
                        onClick={() => handleSort('name')}
                      >
                        {t('bulkdelete_col_channel')}{' '}
                        {sortField === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                      </th>
                      <th className="px-3 py-1.5 hidden sm:table-cell">
                        {t('bulkdelete_col_type')}
                      </th>
                      <th
                        className="px-3 py-1.5 cursor-pointer select-none"
                        onClick={() => handleSort('key')}
                      >
                        {t('bulkdelete_col_key')}{' '}
                        {sortField === 'key' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr
                        key={c.key}
                        className="border-t border-border hover:bg-accent/50 cursor-pointer"
                        onClick={(e) => handleToggle(c.key, e.shiftKey)}
                      >
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(c.key)}
                            onChange={(e) =>
                              handleToggle(
                                c.key,
                                e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                            className="rounded border-input"
                          />
                        </td>
                        <td className="px-3 py-1.5 truncate max-w-[12rem]">{c.name}</td>
                        <td className="px-3 py-1.5 hidden sm:table-cell text-xs text-muted-foreground">
                          {typeLabel(c)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground truncate max-w-[10rem]">
                          {c.key.slice(0, 12)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={resetAndClose}>
                {t('common_cancel')}
              </Button>
              <Button
                variant="outline"
                className="border-warning text-warning hover:bg-warning/10 hover:text-warning"
                disabled={selectedKeys.size === 0}
                onClick={() => setStep('confirm')}
              >
                {t('bulkdelete_proceed_button', { count: selectedKeys.size })}
              </Button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="flex-1 overflow-y-auto min-h-0 border border-border rounded-md">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-1.5">{t('bulkdelete_col_channel')}</th>
                    <th className="px-3 py-1.5">{t('bulkdelete_col_type')}</th>
                    <th className="px-3 py-1.5">{t('bulkdelete_col_key')}</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedChannels.map((c) => (
                    <tr key={c.key} className="border-t border-border">
                      <td className="px-3 py-1.5 truncate max-w-[14rem]">{c.name}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{typeLabel(c)}</td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground truncate max-w-[10rem]">
                        {c.key.slice(0, 12)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                variant="destructive"
                className="w-full h-auto py-3 text-wrap"
                disabled={deleting}
                onClick={handleDelete}
              >
                {deleting
                  ? t('settings_db_deleting')
                  : t('bulkdelete_channels_confirm_button', { count: selectedKeys.size })}
              </Button>
              <Button variant="secondary" onClick={() => setStep('select')} disabled={deleting}>
                {t('bulkdelete_back_button')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
