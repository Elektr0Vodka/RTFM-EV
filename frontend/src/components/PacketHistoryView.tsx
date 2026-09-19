import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { RawPacketList } from './RawPacketList';
import { RawPacketInspectorDialog } from './RawPacketDetailModal';
import { PacketFilterModal } from './PacketFilterModal';
import { TimeRangeSelector } from './TimeRangeSelector';
import { Button } from './ui/button';
import { usePacketFilters } from '../hooks/usePacketFilters';
import { usePacketHistory } from '../hooks/usePacketHistory';
import { useRawPackets } from '../stores/rawPacketStore';
import { CUSTOM_RANGE_ID, resolveRange } from '../utils/timeRanges';
import { loadStoredTimeRange, saveStoredTimeRange } from '../utils/timeRangePreference';
import type { AppSettingsUpdate, Channel, Contact, RawPacket } from '../types';
import { useT } from '../i18n';

const WINDOW_KEY = 'rtfm-packet-history-window';
const DEFAULT_WINDOW_ID = '24h';

interface PacketHistoryViewProps {
  contacts: Contact[];
  channels: Channel[];
  /** Persisted history-view time-sort direction; defaults to oldest-first. */
  packetHistorySort?: 'oldest' | 'newest';
  /** Persist a settings change (used for the sort direction). */
  onSaveAppSettings?: (update: AppSettingsUpdate) => Promise<void> | void;
}

export function PacketHistoryView({
  contacts,
  channels,
  packetHistorySort = 'oldest',
  onSaveAppSettings,
}: PacketHistoryViewProps) {
  const t = useT();
  const filters = usePacketFilters();
  const livePackets = useRawPackets();

  const [selectedPacket, setSelectedPacket] = useState<RawPacket | null>(null);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // Persisted time-range selection (window id + custom range), per page.
  const stored = useMemo(() => loadStoredTimeRange(WINDOW_KEY, DEFAULT_WINDOW_ID), []);
  const [windowId, setWindowId] = useState(stored.id);
  const [customStart, setCustomStart] = useState(stored.customStart);
  const [customEnd, setCustomEnd] = useState(stored.customEnd);

  useEffect(() => {
    saveStoredTimeRange(WINDOW_KEY, { id: windowId, customStart, customEnd });
  }, [windowId, customStart, customEnd]);

  // Presets track "now" (live); a custom range is a fixed historical window.
  const isLive = windowId !== CUSTOM_RANGE_ID;

  const range = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const cs = customStart ? Math.floor(new Date(customStart).getTime() / 1000) : null;
    const ce = customEnd ? Math.floor(new Date(customEnd).getTime() / 1000) : null;
    return resolveRange(windowId, { nowSec, customStartSec: cs, customEndSec: ce });
  }, [windowId, customStart, customEnd]);

  const enabled = range !== null;
  const startTs = range?.startTs ?? 0;
  // For live presets the upper bound is open-ended so incoming packets are not
  // clipped; historical custom ranges use their fixed end.
  const endTs = isLive ? Number.MAX_SAFE_INTEGER : (range?.endTs ?? 0);

  const { rows, loading, error, nextCursor, loadOlder } = usePacketHistory({
    startTs,
    endTs,
    filters,
    isLive,
    livePackets,
    channels,
    enabled,
  });

  const renderBody = () => {
    if (!enabled) {
      return (
        <div className="h-full overflow-y-auto p-5 text-center text-muted-foreground">
          {t('packet_history_pick_range')}
        </div>
      );
    }
    if (error) {
      return (
        <div className="h-full overflow-y-auto p-5 text-center text-destructive">
          {t('packet_history_error')}
        </div>
      );
    }
    if (loading && rows.length === 0) {
      return (
        <div className="h-full overflow-y-auto p-5 text-center text-muted-foreground">
          {t('packet_history_loading')}
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div className="h-full overflow-y-auto p-5 text-center text-muted-foreground">
          {t('packet_history_empty')}
        </div>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {nextCursor !== null && (
          <div className="border-b border-border p-2 text-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadOlder}
              disabled={loading}
            >
              {t('packet_history_load_older')}
            </Button>
          </div>
        )}
        <div className="min-h-0 min-w-0 flex-1">
          <RawPacketList
            packets={rows}
            channels={channels}
            contacts={contacts}
            onPacketClick={setSelectedPacket}
            autoScroll={autoScroll}
            newestFirst={packetHistorySort === 'newest'}
          />
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-base text-foreground">{t('nav_packet_history')}</h2>
          <span
            className={
              isLive
                ? 'text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-status-connected/15 text-status-connected'
                : 'text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground'
            }
          >
            {isLive ? t('packet_history_live') : t('packet_history_historical')}
          </span>
        </div>

        <div className="mt-2">
          <TimeRangeSelector
            value={windowId}
            onChange={setWindowId}
            showCustom
            customStart={customStart}
            customEnd={customEnd}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
            onApplyCustom={() => {
              /* range recomputes from customStart/customEnd state */
            }}
          />
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="relative">
            <input
              type="text"
              value={filters.hexFilter}
              onChange={(event) => filters.setHexFilter(event.target.value)}
              placeholder={t('packet_filter_hex_placeholder')}
              aria-label={t('packet_filter_hex_aria')}
              className="w-44 rounded border border-input bg-background px-2 py-0.5 pr-6 text-xs"
            />
            {filters.hexFilter !== '' && (
              <button
                type="button"
                onClick={() => filters.setHexFilter('')}
                aria-label={t('packet_clear_hex_filter_aria')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {filters.hexFilter.trim() !== '' && filters.hexInvalid && (
            <span className="text-[0.6875rem] text-warning">{t('packet_hex_filter_invalid')}</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFilterModalOpen(true)}
            aria-expanded={filterModalOpen}
          >
            {t('packet_filters_button')}
            {filters.activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold text-primary-foreground tabular-nums">
                {filters.activeFilterCount}
              </span>
            )}
          </Button>
          <select
            value={packetHistorySort}
            onChange={(event) =>
              onSaveAppSettings?.({
                packet_history_sort: event.target.value as 'oldest' | 'newest',
              })
            }
            aria-label={t('packet_sort_label')}
            className="ml-auto h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            <option value="oldest">{t('packet_sort_oldest')}</option>
            <option value="newest">{t('packet_sort_newest')}</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
              className="rounded"
            />
            {t('packet_autoscroll_label')}
          </label>
        </div>
      </div>

      {renderBody()}

      <RawPacketInspectorDialog
        open={selectedPacket !== null}
        onOpenChange={(isOpen) => !isOpen && setSelectedPacket(null)}
        channels={channels}
        contacts={contacts}
        source={
          selectedPacket
            ? { kind: 'packet', packet: selectedPacket }
            : { kind: 'loading', message: t('packet_loading_message') }
        }
        title={t('packet_details_title')}
        description={t('packet_details_description')}
      />

      <PacketFilterModal
        open={filterModalOpen}
        onOpenChange={setFilterModalOpen}
        enabledTypes={filters.enabledTypes}
        enabledHopWidths={filters.enabledHopWidths}
        allTypesEnabled={filters.allTypesEnabled}
        allHopWidthsEnabled={filters.allHopWidthsEnabled}
        groupByHash={filters.groupByHash}
        onToggleAll={filters.toggleAll}
        onToggleType={filters.toggleType}
        onOnlyType={filters.onlyType}
        onToggleAllHopWidths={filters.toggleAllHopWidths}
        onToggleHopWidth={filters.toggleHopWidth}
        onOnlyHopWidth={filters.onlyHopWidth}
        onGroupByHashChange={filters.setGroupByHash}
        onReset={filters.reset}
        matchCount={rows.length}
        totalCount={rows.length}
      />
    </>
  );
}
