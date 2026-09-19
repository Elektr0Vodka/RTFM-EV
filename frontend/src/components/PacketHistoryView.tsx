import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Search, X } from 'lucide-react';

import { RawPacketList } from './RawPacketList';
import { RawPacketInspectorDialog } from './RawPacketDetailModal';
import { PacketFilterModal } from './PacketFilterModal';
import { TimeRangeSelector } from './TimeRangeSelector';
import { Button } from './ui/button';
import { usePacketFilters } from '../hooks/usePacketFilters';
import { usePacketHistory } from '../hooks/usePacketHistory';
import { useRawPackets } from '../stores/rawPacketStore';
import { ALL_TIME_RANGE, CUSTOM_RANGE_ID, resolveRange } from '../utils/timeRanges';
import { loadStoredTimeRange, saveStoredTimeRange } from '../utils/timeRangePreference';
import { getRawPacketObservationKey } from '../utils/rawPacketIdentity';
import {
  PACKET_CSV_COLUMN_KEYS,
  buildPacketCsv,
  packetCsvFilename,
  type PacketCsvColumnKey,
} from '../utils/packetCsv';
import type { AppSettingsUpdate, Channel, Contact, RawPacket } from '../types';
import { useT } from '../i18n';

const WINDOW_KEY = 'rtfm-packet-history-window';
const DEFAULT_WINDOW_ID = '24h';
// "All time" is offered here (next to Custom) so search can reach the whole
// database, not just a rolling window.
const HISTORY_EXTRA_RANGES = [ALL_TIME_RANGE];

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
  // Pause snapshot: while set, the live view is frozen to this list and new
  // in-window packets are only counted until the user resumes. Session-only.
  const [pausedSnapshot, setPausedSnapshot] = useState<RawPacket[] | null>(null);
  // Observation keys of packets checked for CSV export.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());

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
    return resolveRange(windowId, {
      nowSec,
      customStartSec: cs,
      customEndSec: ce,
      extras: HISTORY_EXTRA_RANGES,
    });
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

  // Pause only applies to the live stream; a fixed historical range never
  // changes, so drop any snapshot when the view leaves live mode.
  useEffect(() => {
    if (!isLive) setPausedSnapshot(null);
  }, [isLive]);

  const paused = pausedSnapshot !== null;
  const displayedRows = paused ? pausedSnapshot : rows;
  // How many matching packets have arrived since the feed was paused.
  const pausedNewCount = useMemo(() => {
    if (!pausedSnapshot) return 0;
    const seen = new Set(pausedSnapshot.map(getRawPacketObservationKey));
    let count = 0;
    for (const packet of rows) {
      if (!seen.has(getRawPacketObservationKey(packet))) count += 1;
    }
    return count;
  }, [pausedSnapshot, rows]);
  const togglePause = () => setPausedSnapshot((prev) => (prev ? null : rows));

  // Selection is over currently-visible rows; stale keys (from an earlier fetch)
  // simply match nothing here.
  const selectedPackets = useMemo(
    () => displayedRows.filter((p) => selectedKeys.has(getRawPacketObservationKey(p))),
    [displayedRows, selectedKeys]
  );
  const selectedCount = selectedPackets.length;
  const allSelected = displayedRows.length > 0 && selectedCount === displayedRows.length;

  const toggleSelect = useCallback((packet: RawPacket) => {
    const key = getRawPacketObservationKey(packet);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedKeys((prev) =>
      displayedRows.length > 0 && prev.size >= displayedRows.length
        ? new Set()
        : new Set(displayedRows.map(getRawPacketObservationKey))
    );
  }, [displayedRows]);

  const exportCsv = useCallback(() => {
    if (selectedPackets.length === 0) return;
    const headers = Object.fromEntries(
      PACKET_CSV_COLUMN_KEYS.map((k) => [k, t(`packet_csv_${k}`)])
    ) as Record<PacketCsvColumnKey, string>;
    const csv = buildPacketCsv(selectedPackets, headers, { channels, contacts });
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = packetCsvFilename(new Date());
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedPackets, channels, contacts, t]);

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
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-2">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={toggleSelectAll}>
              {allSelected ? t('packet_deselect_all') : t('packet_select_all')}
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t('packet_selected_count', { count: selectedCount })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {nextCursor !== null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadOlder}
                disabled={loading}
              >
                {t('packet_history_load_older')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={selectedCount === 0}
            >
              <Download className="h-3.5 w-3.5" />
              {t('packet_export_csv')}
            </Button>
          </div>
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          <RawPacketList
            packets={displayedRows}
            channels={channels}
            contacts={contacts}
            onPacketClick={setSelectedPacket}
            selectable
            selectedKeys={selectedKeys}
            onToggleSelect={toggleSelect}
            autoScroll={autoScroll && !paused}
            newestFirst={packetHistorySort === 'newest'}
            groupByContent={filters.groupByHash}
            showScrollToEnds
            showDate
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
            extrasSpecial={HISTORY_EXTRA_RANGES}
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
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={filters.searchQuery}
              onChange={(event) => filters.setSearchQuery(event.target.value)}
              placeholder={t('packet_search_placeholder')}
              aria-label={t('packet_search_aria')}
              className="w-48 rounded border border-input bg-background py-0.5 pl-7 pr-6 text-xs"
            />
            {filters.searchQuery !== '' && (
              <button
                type="button"
                onClick={() => filters.setSearchQuery('')}
                aria-label={t('packet_clear_search_aria')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
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
          <Button
            type="button"
            variant={paused ? 'default' : 'outline'}
            size="sm"
            onClick={togglePause}
            aria-pressed={paused}
            disabled={!isLive}
          >
            {paused ? t('packet_resume') : t('packet_pause')}
          </Button>
          {paused && pausedNewCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[0.625rem] font-semibold text-primary-foreground tabular-nums">
              {t('packet_paused_new', { count: pausedNewCount })}
            </span>
          )}
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
