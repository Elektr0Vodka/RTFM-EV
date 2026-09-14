import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { HOP_BYTE_WIDTH_BUCKETS, KNOWN_PAYLOAD_TYPES } from '../utils/rawPacketStats';
import { useT } from '../i18n';

export interface PacketFilterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabledTypes: Set<string>;
  enabledHopWidths: Set<string>;
  allTypesEnabled: boolean;
  allHopWidthsEnabled: boolean;
  groupByHash: boolean;
  onToggleAll: () => void;
  onToggleType: (type: string) => void;
  onOnlyType: (type: string) => void;
  onToggleAllHopWidths: () => void;
  onToggleHopWidth: (bucket: string) => void;
  onOnlyHopWidth: (bucket: string) => void;
  onGroupByHashChange: (value: boolean) => void;
  onReset: () => void;
  matchCount: number;
  totalCount: number;
}

export function PacketFilterModal({
  open,
  onOpenChange,
  enabledTypes,
  enabledHopWidths,
  allTypesEnabled,
  allHopWidthsEnabled,
  groupByHash,
  onToggleAll,
  onToggleType,
  onOnlyType,
  onToggleAllHopWidths,
  onToggleHopWidth,
  onOnlyHopWidth,
  onGroupByHashChange,
  onReset,
  matchCount,
  totalCount,
}: PacketFilterModalProps) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('packet_filters_modal_title')}</DialogTitle>
          <DialogDescription>
            {t('packet_filters_modal_description')} ({matchCount.toLocaleString()} /{' '}
            {totalCount.toLocaleString()})
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 rounded-md border border-border/70 bg-card/60 px-3 py-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={groupByHash}
            onChange={(e) => onGroupByHashChange(e.target.checked)}
            className="rounded"
            aria-label={t('packet_group_by_hash_label')}
          />
          <span>
            <span className="text-foreground">{t('packet_group_by_hash_label')}</span>
            <span className="block text-xs text-muted-foreground">
              {t('packet_group_by_hash_description')}
            </span>
          </span>
        </label>

        <section className="mt-2">
          <div className="flex items-center justify-between border-t border-border/60 pt-2">
            <span className="text-[0.625rem] uppercase tracking-wider font-medium text-muted-foreground">
              {t('packet_filter_types_section')}
            </span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={allTypesEnabled}
                onChange={onToggleAll}
                className="rounded"
              />
              {t('packet_filter_all_label')}
            </label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {KNOWN_PAYLOAD_TYPES.map((type) => (
              <span key={type} className="inline-flex items-center gap-1 text-xs">
                <label className="flex items-center gap-1 text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledTypes.has(type)}
                    onChange={() => onToggleType(type)}
                    className="rounded"
                  />
                  {type}
                </label>
                <button
                  type="button"
                  className="text-[0.625rem] text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => onOnlyType(type)}
                >
                  {t('packet_filter_only_button')}
                </button>
              </span>
            ))}
          </div>
        </section>

        <section className="mt-2">
          <div className="flex items-center justify-between border-t border-border/60 pt-2">
            <span className="text-[0.625rem] uppercase tracking-wider font-medium text-muted-foreground">
              {t('packet_filter_widths_section')}
            </span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={allHopWidthsEnabled}
                onChange={onToggleAllHopWidths}
                className="rounded"
              />
              {t('packet_filter_all_widths_label')}
            </label>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
            {HOP_BYTE_WIDTH_BUCKETS.map((bucket) => (
              <span key={bucket} className="inline-flex items-center gap-1 text-xs">
                <label className="flex items-center gap-1 text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enabledHopWidths.has(bucket)}
                    onChange={() => onToggleHopWidth(bucket)}
                    className="rounded"
                  />
                  {bucket}
                </label>
                <button
                  type="button"
                  className="text-[0.625rem] text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => onOnlyHopWidth(bucket)}
                >
                  {t('packet_filter_only_button')}
                </button>
              </span>
            ))}
          </div>
        </section>

        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            {t('packet_filter_reset_all')}
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {t('packet_filter_done')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
