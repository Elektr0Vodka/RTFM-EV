import { useEffect, useRef, useMemo, useState } from 'react';
import { ChevronsDown, ChevronsUp } from 'lucide-react';
import type { Channel, Contact, RawPacket } from '../types';
import { getRawPacketObservationKey } from '../utils/rawPacketIdentity';
import { createDecoderOptions, decodePacketSummary } from '../utils/rawPacketInspector';
import { resolvePathHopNames } from '../utils/pathHopNames';
import { cn } from '@/lib/utils';
import { useT } from '../i18n';

interface RawPacketListProps {
  packets: RawPacket[];
  channels?: Channel[];
  /** Known contacts, used to resolve path-hop hex prefixes to names. */
  contacts?: Contact[];
  onPacketClick?: (packet: RawPacket) => void;
  /** When true (default), the feed sticks to the newest packet. */
  autoScroll?: boolean;
  /**
   * When true, order newest packet first (top). Default false = oldest first
   * (bottom), the historical behavior.
   */
  newestFirst?: boolean;
  /**
   * Observation keys (see getRawPacketObservationKey) of packets heard directly
   * (decoded, 0 hops). Rendered with a "Direct" marker to flag a nearby sender.
   */
  directPacketKeys?: Set<string>;
  /**
   * When true, render floating "scroll to top / bottom" buttons over the list,
   * shown only while the list overflows. Off by default so other consumers
   * (e.g. the live feed) are unaffected.
   */
  showScrollToEnds?: boolean;
  /**
   * When true, show the calendar date alongside the time on each row. Off by
   * default (the live feed is "now"-oriented); the history view sets it because
   * it can span days.
   */
  showDate?: boolean;
  /** When true, render a selection checkbox on each row (for CSV export). */
  selectable?: boolean;
  /** Observation keys of currently-selected packets. */
  selectedKeys?: Set<string>;
  /** Toggle selection for a packet (required when selectable). */
  onToggleSelect?: (packet: RawPacket) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatSignalInfo(packet: RawPacket): string {
  const parts: string[] = [];
  if (packet.snr !== null && packet.snr !== undefined) {
    parts.push(`SNR: ${packet.snr.toFixed(1)} dB`);
  }
  if (packet.rssi !== null && packet.rssi !== undefined) {
    parts.push(`RSSI: ${packet.rssi} dBm`);
  }
  return parts.join(' | ');
}

// Get route type badge color
function getRouteTypeColor(routeType: string): string {
  switch (routeType) {
    case 'Flood':
      return 'bg-info/20 text-info';
    case 'Direct':
      return 'bg-success/20 text-success';
    case 'TransportFlood':
      return 'bg-purple-500/20 text-purple-400';
    case 'TransportDirect':
      return 'bg-orange-500/20 text-orange-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

// Get short route type label
function getRouteTypeLabel(routeType: string): string {
  switch (routeType) {
    case 'Flood':
      return 'F';
    case 'Direct':
      return 'D';
    case 'TransportFlood':
      return 'TF';
    case 'TransportDirect':
      return 'TD';
    default:
      return '?';
  }
}

export function RawPacketList({
  packets,
  channels,
  contacts,
  onPacketClick,
  autoScroll = true,
  newestFirst = false,
  directPacketKeys,
  showScrollToEnds = false,
  showDate = false,
  selectable = false,
  selectedKeys,
  onToggleSelect,
}: RawPacketListProps) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const decoderOptions = useMemo(() => createDecoderOptions(channels), [channels]);

  // Decode all packets (memoized to avoid re-decoding on every render)
  const decodedPackets = useMemo(() => {
    return packets.map((packet) => ({
      packet,
      decoded: decodePacketSummary(packet, decoderOptions),
    }));
  }, [decoderOptions, packets]);

  // Sort packets by timestamp: ascending (oldest first) by default, descending
  // (newest first) when newestFirst is set.
  const sortedPackets = useMemo(
    () =>
      [...decodedPackets].sort((a, b) =>
        newestFirst
          ? b.packet.timestamp - a.packet.timestamp
          : a.packet.timestamp - b.packet.timestamp
      ),
    [decodedPackets, newestFirst]
  );

  // Stick to the newest packet while autoscroll is on. The newest packet is at
  // the bottom for oldest-first and at the top for newest-first, so scroll to
  // the matching edge. Toggling autoscroll or direction re-runs this effect.
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = newestFirst ? 0 : listRef.current.scrollHeight;
    }
  }, [packets, autoScroll, newestFirst]);

  // Track whether the list overflows and where the viewport sits, so the
  // floating scroll buttons appear only when useful (and each end hides when
  // already there). Recomputes on scroll, on resize, and when rows change.
  useEffect(() => {
    if (!showScrollToEnds) return;
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      const overflow = el.scrollHeight > el.clientHeight + 1;
      setCanScrollUp(overflow && el.scrollTop > 1);
      setCanScrollDown(overflow && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [showScrollToEnds, sortedPackets]);

  const scrollToTop = () => {
    if (listRef.current) listRef.current.scrollTop = 0;
  };
  const scrollToBottom = () => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  };

  if (packets.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-5 text-center text-muted-foreground [contain:layout_paint]">
        {t('packet_list_empty')}
      </div>
    );
  }

  const listEl = (
    <div
      className="h-full overflow-y-auto p-4 flex flex-col gap-2 [contain:layout_paint]"
      ref={listRef}
    >
      {sortedPackets.map(({ packet, decoded }) => {
        const isDirect = directPacketKeys?.has(getRawPacketObservationKey(packet)) ?? false;
        const cardContent = (
          <>
            <div className="flex items-center gap-2">
              {/* Route type badge */}
              <span
                className={`text-[0.625rem] font-mono px-1.5 py-0.5 rounded ${getRouteTypeColor(decoded.routeType)}`}
                title={decoded.routeType}
              >
                {getRouteTypeLabel(decoded.routeType)}
              </span>

              {/* Direct (0-hop) marker: sender is within direct radio range */}
              {isDirect && (
                <span
                  className="text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-status-connected/15 text-status-connected"
                  title={t('chat_scope_direct_title')}
                >
                  {t('chat_scope_direct')}
                </span>
              )}

              {/* Encryption status */}
              {!packet.decrypted && (
                <>
                  <span aria-hidden="true">🔒</span>
                  <span className="sr-only">{t('packet_status_encrypted')}</span>
                </>
              )}

              {/* Summary */}
              <span
                className={cn(
                  'text-[0.8125rem]',
                  packet.decrypted ? 'text-primary' : 'text-foreground'
                )}
              >
                {decoded.summary}
              </span>

              {/* Time (with date in the history view, which can span days) */}
              <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                {showDate
                  ? `${formatDate(packet.timestamp)} ${formatTime(packet.timestamp)}`
                  : formatTime(packet.timestamp)}
              </span>
            </div>

            {/* Signal info */}
            {(packet.snr !== null || packet.rssi !== null) && (
              <div className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">
                {formatSignalInfo(packet)}
              </div>
            )}

            {/* Resolved path: hop hex prefixes with known contacts named. */}
            {decoded.pathTokens && decoded.pathTokens.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[0.625rem]">
                {resolvePathHopNames(decoded.pathTokens, contacts ?? []).map((hop, i) => (
                  <span
                    key={`${hop.hex}-${i}`}
                    title={hop.resolved ? hop.hex : undefined}
                    className={cn(
                      'max-w-[10rem] truncate rounded px-1 py-0.5 font-mono',
                      hop.resolved
                        ? 'bg-primary/15 text-primary'
                        : 'bg-background/60 text-muted-foreground'
                    )}
                  >
                    {hop.resolved ? hop.name : hop.hex.toUpperCase()}
                  </span>
                ))}
              </div>
            )}

            {/* Raw hex data (always visible) */}
            <div className="font-mono text-[0.625rem] break-all text-muted-foreground mt-1.5 p-1.5 bg-background/60 rounded">
              {packet.data.toUpperCase()}
            </div>
          </>
        );

        const key = getRawPacketObservationKey(packet);
        const className = cn(
          'rounded-md border border-border/50 bg-card px-3 py-2 text-left',
          selectable && 'min-w-0 flex-1',
          onPacketClick &&
            'cursor-pointer transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        );

        const cardEl = onPacketClick ? (
          <button
            key={key}
            type="button"
            onClick={() => onPacketClick(packet)}
            className={className}
          >
            {cardContent}
          </button>
        ) : (
          <div key={key} className={className}>
            {cardContent}
          </div>
        );

        // The checkbox is a sibling of the card (not nested in the button) so
        // toggling selection never triggers the row's open-detail click.
        if (selectable) {
          return (
            <div key={key} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={selectedKeys?.has(key) ?? false}
                onChange={() => onToggleSelect?.(packet)}
                aria-label={t('packet_select_row_aria')}
                className="mt-2.5 shrink-0 rounded"
              />
              {cardEl}
            </div>
          );
        }

        return cardEl;
      })}
    </div>
  );

  if (!showScrollToEnds) return listEl;

  const buttonClass =
    'pointer-events-auto rounded-full border border-border bg-card/90 p-1.5 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="relative h-full min-h-0">
      {listEl}
      {(canScrollUp || canScrollDown) && (
        <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-1.5">
          {canScrollUp && (
            <button
              type="button"
              onClick={scrollToTop}
              aria-label={t('packet_scroll_top_aria')}
              className={buttonClass}
            >
              <ChevronsUp className="h-4 w-4" />
            </button>
          )}
          {canScrollDown && (
            <button
              type="button"
              onClick={scrollToBottom}
              aria-label={t('packet_scroll_bottom_aria')}
              className={buttonClass}
            >
              <ChevronsDown className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
