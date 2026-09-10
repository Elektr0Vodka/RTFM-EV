import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { getContactDisplayName } from '../../utils/pubkey';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { toast } from '../ui/sonner';
import { useT, type TFn } from '../../i18n';
import type { Contact } from '../../types';

function contactTypeLabel(t: TFn, type: number): string {
  switch (type) {
    case 1:
      return t('common_client');
    case 2:
      return t('common_repeater');
    case 3:
      return t('common_room');
    case 4:
      return t('common_sensor');
    default:
      return t('common_unknown');
  }
}

type SortField = 'name' | 'type' | 'key' | 'first_seen' | 'last_seen';
type SortDir = 'asc' | 'desc';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString([], {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatDateISO(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function datetimeToUnix(datetimeStr: string): number {
  const d = new Date(datetimeStr);
  return Math.floor(d.getTime() / 1000);
}

function SortableHeader({
  label,
  field,
  sortField,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const active = sortField === field;
  return (
    <th
      className={`px-3 py-1.5 cursor-pointer select-none hover:text-foreground transition-colors ${className ?? ''}`}
      onClick={() => onSort(field)}
    >
      {label} {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );
}

interface BulkDeleteContactsModalProps {
  open: boolean;
  onClose: () => void;
  contacts: Contact[];
  onDeleted: (deletedKeys: string[]) => void;
}

export function BulkDeleteContactsModal({
  open,
  onClose,
  contacts,
  onDeleted,
}: BulkDeleteContactsModalProps) {
  const t = useT();
  const [step, setStep] = useState<'select' | 'confirm'>('select');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [lastHeardAfter, setLastHeardAfter] = useState('');
  const [lastHeardBefore, setLastHeardBefore] = useState('');
  const [typeFilter, setTypeFilter] = useState<number | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('first_seen');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [deleting, setDeleting] = useState(false);
  const lastClickedKeyRef = useRef<string | null>(null);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir(field === 'name' || field === 'key' ? 'asc' : 'desc');
      }
    },
    [sortField]
  );

  const resetAndClose = useCallback(() => {
    setStep('select');
    setSelectedKeys(new Set());
    setStartDate('');
    setEndDate('');
    setLastHeardAfter('');
    setLastHeardBefore('');
    setTypeFilter('all');
    setSortField('first_seen');
    setSortDir('desc');
    lastClickedKeyRef.current = null;
    onClose();
  }, [onClose]);

  const filteredContacts = useMemo(() => {
    let list = [...contacts];
    if (typeFilter !== 'all') {
      list = list.filter((c) => c.type === typeFilter);
    }
    if (startDate) {
      const start = datetimeToUnix(startDate);
      list = list.filter((c) => (c.first_seen ?? 0) >= start);
    }
    if (endDate) {
      const end = datetimeToUnix(endDate);
      list = list.filter((c) => (c.first_seen ?? 0) <= end);
    }
    if (lastHeardAfter) {
      const after = datetimeToUnix(lastHeardAfter);
      list = list.filter((c) => (c.last_seen ?? 0) >= after);
    }
    if (lastHeardBefore) {
      const before = datetimeToUnix(lastHeardBefore);
      list = list.filter((c) => (c.last_seen ?? 0) <= before);
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sortField) {
        case 'name': {
          const an = getContactDisplayName(a.name, a.public_key, a.last_advert).toLowerCase();
          const bn = getContactDisplayName(b.name, b.public_key, b.last_advert).toLowerCase();
          return an < bn ? -dir : an > bn ? dir : 0;
        }
        case 'type':
          return (a.type - b.type) * dir;
        case 'key':
          return a.public_key < b.public_key ? -dir : a.public_key > b.public_key ? dir : 0;
        case 'first_seen':
          return ((a.first_seen ?? 0) - (b.first_seen ?? 0)) * dir;
        case 'last_seen':
          return ((a.last_seen ?? 0) - (b.last_seen ?? 0)) * dir;
      }
    });
    return list;
  }, [
    contacts,
    typeFilter,
    startDate,
    endDate,
    lastHeardAfter,
    lastHeardBefore,
    sortField,
    sortDir,
  ]);

  const handleToggle = (key: string, shiftKey: boolean) => {
    if (shiftKey && lastClickedKeyRef.current && lastClickedKeyRef.current !== key) {
      const keys = filteredContacts.map((c) => c.public_key);
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

  const handleSelectAll = () => {
    setSelectedKeys(new Set(filteredContacts.map((c) => c.public_key)));
  };

  const handleSelectNone = () => {
    setSelectedKeys(new Set());
  };

  const selectedContacts = useMemo(
    () => contacts.filter((c) => selectedKeys.has(c.public_key)),
    [contacts, selectedKeys]
  );

  const contactCount = selectedContacts.filter((c) => c.type === 1 || c.type === 0).length;
  const repeaterCount = selectedContacts.filter((c) => c.type === 2).length;
  const roomCount = selectedContacts.filter((c) => c.type === 3).length;
  const sensorCount = selectedContacts.filter((c) => c.type === 4).length;

  const firstSeenDates = selectedContacts.map((c) => c.first_seen ?? 0).filter((t) => t > 0);
  const minDate =
    firstSeenDates.length > 0 ? formatDateISO(Math.min(...firstSeenDates)) : t('common_unknown');
  const maxDate =
    firstSeenDates.length > 0 ? formatDateISO(Math.max(...firstSeenDates)) : t('common_unknown');

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const keysToDelete = [...selectedKeys];
      const result = await api.bulkDeleteContacts(keysToDelete);
      toast.success(t('bulkdelete_toast_deleted', { count: result.deleted }));
      onDeleted(keysToDelete);
      resetAndClose();
    } catch (err) {
      console.error('Bulk delete failed:', err);
      toast.error(t('bulkdelete_toast_failed_title'), {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  };

  const hasFilters = startDate || endDate || lastHeardAfter || lastHeardBefore;

  const summaryParts = [
    contactCount > 0 && t('bulkdelete_summary_contacts', { count: contactCount }),
    repeaterCount > 0 && t('bulkdelete_summary_repeaters', { count: repeaterCount }),
    roomCount > 0 && t('bulkdelete_summary_rooms', { count: roomCount }),
    sensorCount > 0 && t('bulkdelete_summary_sensors', { count: sensorCount }),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && resetAndClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === 'select'
              ? t('settings_radioapp_bulk_delete_heading')
              : t('bulkdelete_confirm_deletion_title')}
          </DialogTitle>
          <DialogDescription>
            {step === 'select'
              ? t('bulkdelete_select_description')
              : t('bulkdelete_confirm_description')}
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {t('bulkdelete_filter_show_label')}
                  </label>
                  <select
                    value={typeFilter === 'all' ? 'all' : String(typeFilter)}
                    onChange={(e) =>
                      setTypeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))
                    }
                    className="block h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="all">{t('packet_filter_all_label')}</option>
                    <option value="1">{t('bulkdelete_type_clients')}</option>
                    <option value="2">{t('nav_repeaters_heading')}</option>
                    <option value="3">{t('nav_room_servers_heading')}</option>
                    <option value="4">{t('bulkdelete_type_sensors')}</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {t('bulkdelete_filter_created_after')}
                  </label>
                  <Input
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-48 h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {t('bulkdelete_filter_created_before')}
                  </label>
                  <Input
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-48 h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {t('bulkdelete_filter_last_heard_after')}
                  </label>
                  <Input
                    type="datetime-local"
                    value={lastHeardAfter}
                    onChange={(e) => setLastHeardAfter(e.target.value)}
                    className="w-48 h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {t('bulkdelete_filter_last_heard_before')}
                  </label>
                  <Input
                    type="datetime-local"
                    value={lastHeardBefore}
                    onChange={(e) => setLastHeardBefore(e.target.value)}
                    className="w-48 h-8 text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={handleSelectAll}>
                  {t('channel_io_select_all')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={handleSelectNone}>
                  {t('bulkdelete_select_none_button')}
                </Button>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              {t('bulkdelete_contacts_shown', { count: filteredContacts.length })}
              {hasFilters && ` ${t('bulkdelete_filtered_suffix')}`}
              {' · '}
              {t('bulkdelete_selected_count', { count: selectedKeys.size })}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 border border-border rounded-md">
              {filteredContacts.length === 0 ? (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {t('bulkdelete_no_contacts_match')}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-1.5 w-8" />
                      <SortableHeader
                        label={t('common_name')}
                        field="name"
                        sortField={sortField}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label={t('common_type')}
                        field="type"
                        sortField={sortField}
                        sortDir={sortDir}
                        onSort={handleSort}
                        className="hidden sm:table-cell"
                      />
                      <SortableHeader
                        label={t('bulkdelete_col_key')}
                        field="key"
                        sortField={sortField}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label={t('channel_created')}
                        field="first_seen"
                        sortField={sortField}
                        sortDir={sortDir}
                        onSort={handleSort}
                        className="hidden sm:table-cell"
                      />
                      <SortableHeader
                        label={t('channel_registry_col_last_heard')}
                        field="last_seen"
                        sortField={sortField}
                        sortDir={sortDir}
                        onSort={handleSort}
                        className="hidden sm:table-cell"
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map((c) => (
                      <tr
                        key={c.public_key}
                        className="border-t border-border hover:bg-accent/50 cursor-pointer"
                        onClick={(e) => handleToggle(c.public_key, e.shiftKey)}
                      >
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(c.public_key)}
                            onChange={(e) =>
                              handleToggle(
                                c.public_key,
                                e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey
                              )
                            }
                            onClick={(e) => e.stopPropagation()}
                            className="rounded border-input"
                          />
                        </td>
                        <td className="px-3 py-1.5 truncate max-w-[10rem]">
                          {getContactDisplayName(c.name, c.public_key, c.last_advert)}
                        </td>
                        <td className="px-3 py-1.5 hidden sm:table-cell text-xs text-muted-foreground">
                          {contactTypeLabel(t, c.type)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground truncate max-w-[8rem]">
                          {c.public_key.slice(0, 12)}
                        </td>
                        <td className="px-3 py-1.5 hidden sm:table-cell text-xs text-muted-foreground">
                          {c.first_seen ? formatDate(c.first_seen) : '—'}
                        </td>
                        <td className="px-3 py-1.5 hidden sm:table-cell text-xs text-muted-foreground">
                          {c.last_seen ? formatDate(c.last_seen) : '—'}
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
                    <th className="px-3 py-1.5">{t('common_name')}</th>
                    <th className="px-3 py-1.5">{t('common_type')}</th>
                    <th className="px-3 py-1.5">{t('bulkdelete_col_key')}</th>
                    <th className="px-3 py-1.5 hidden sm:table-cell">{t('channel_created')}</th>
                    <th className="px-3 py-1.5 hidden sm:table-cell">
                      {t('channel_registry_col_last_heard')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {selectedContacts.map((c) => (
                    <tr key={c.public_key} className="border-t border-border">
                      <td className="px-3 py-1.5 truncate max-w-[12rem]">
                        {getContactDisplayName(c.name, c.public_key, c.last_advert)}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {contactTypeLabel(t, c.type)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground truncate max-w-[8rem]">
                        {c.public_key.slice(0, 12)}
                      </td>
                      <td className="px-3 py-1.5 hidden sm:table-cell text-xs text-muted-foreground">
                        {c.first_seen ? formatDate(c.first_seen) : '—'}
                      </td>
                      <td className="px-3 py-1.5 hidden sm:table-cell text-xs text-muted-foreground">
                        {c.last_seen ? formatDate(c.last_seen) : '—'}
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
                  : t('bulkdelete_confirm_button', {
                      summary: summaryParts,
                      minDate,
                      maxDate,
                    })}
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
