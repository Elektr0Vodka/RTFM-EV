import { useState, lazy, Suspense } from 'react';
import type { Contact, RadioConfig, MessagePath } from '../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import {
  resolvePath,
  parsePathHops,
  calculateDistance,
  isValidLocation,
  formatDistance,
  type SenderInfo,
  type ResolvedPath,
  type PathHop,
} from '../utils/pathUtils';
import { formatTime } from '../utils/messageParser';
import { getMapFocusHash } from '../utils/urlHash';
import { useDistanceUnit } from '../contexts/DistanceUnitContext';
import type { DistanceUnit } from '../utils/distanceUnits';
import { useT, type TFn } from '../i18n';

const PathRouteMap = lazy(() =>
  import('./PathRouteMap').then((m) => ({ default: m.PathRouteMap }))
);

interface PathModalProps {
  open: boolean;
  onClose: () => void;
  paths: MessagePath[];
  senderInfo: SenderInfo;
  contacts: Contact[];
  config: RadioConfig | null;
  messageId?: number;
  packetId?: number | null;
  isOutgoingChan?: boolean;
  isResendable?: boolean;
  onResend?: (messageId: number, newTimestamp?: boolean) => void;
  onAnalyzePacket?: () => void;
}

export function PathModal({
  open,
  onClose,
  paths,
  senderInfo,
  contacts,
  config,
  messageId,
  packetId,
  isOutgoingChan,
  isResendable,
  onResend,
  onAnalyzePacket,
}: PathModalProps) {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();
  const [mapModalIndex, setMapModalIndex] = useState<number | null>(null);
  const hasResendActions = isOutgoingChan && messageId !== undefined && onResend;
  const hasPaths = paths.length > 0;
  const showAnalyzePacket = hasPaths && packetId != null && onAnalyzePacket;

  // Resolve all paths
  const resolvedPaths = hasPaths
    ? paths.map((p) => ({
        ...p,
        resolved: resolvePath(p.path, senderInfo, contacts, config, p.path_len),
      }))
    : [];

  const hasSinglePath = paths.length === 1;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-xl md:max-w-2xl max-h-[85dvh] flex flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {hasPaths ? t('path_modal_title', { count: paths.length }) : t('path_modal_title_status')}
          </DialogTitle>
          <DialogDescription>
            {!hasPaths ? (
              <>{t('path_modal_no_echoes')}</>
            ) : hasSinglePath ? (
              <>
                {t('path_modal_single_route_prefix')}
                <em>{t('path_modal_single_route_emphasis')}</em>
                {t('path_modal_single_route_suffix')}
              </>
            ) : (
              <>
                {t('path_modal_multi_route_prefix')}
                <strong>{t('path_modal_multi_route_count', { count: paths.length })}</strong>
                {t('path_modal_multi_route_suffix')}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {hasPaths && (
          <div className="flex-1 overflow-y-auto py-2 space-y-4">
            {showAnalyzePacket ? (
              <Button type="button" variant="outline" className="w-full" onClick={onAnalyzePacket}>
                {t('chat_analyze_packet_title')}
              </Button>
            ) : null}

            {/* Raw path summary */}
            <div className="text-sm space-y-1">
              {paths.map((p, index) => {
                const hops = parsePathHops(p.path, p.path_len);
                const rawPath = hops.length > 0 ? hops.join('->') : t('contact_direct');
                const hasSignal = p.rssi != null || p.snr != null;
                return (
                  <div key={index}>
                    <div>
                      <span className="text-foreground/70 font-semibold">
                        {t('path_modal_path_number', { n: index + 1 })}:
                      </span>{' '}
                      <span className="font-mono text-muted-foreground">{rawPath}</span>
                    </div>
                    {hasSignal && (
                      <div className="text-[0.6875rem] text-muted-foreground ml-4">
                        {t('path_modal_last_hop_label')}{' '}
                        {/* eslint-disable-next-line i18next/no-literal-string */}
                        {p.rssi != null && <span>{p.rssi} dBm RSSI</span>}
                        {p.rssi != null && p.snr != null && <span> · </span>}
                        {/* eslint-disable-next-line i18next/no-literal-string */}
                        {p.snr != null && <span>{p.snr.toFixed(1)} dB SNR</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Straight-line distance (sender to receiver, same for all routes) */}
            {resolvedPaths.length > 0 &&
              isValidLocation(
                resolvedPaths[0].resolved.sender.lat,
                resolvedPaths[0].resolved.sender.lon
              ) &&
              isValidLocation(
                resolvedPaths[0].resolved.receiver.lat,
                resolvedPaths[0].resolved.receiver.lon
              ) && (
                <div className="text-sm pb-2 border-b border-border">
                  <span className="text-muted-foreground">
                    {t('path_modal_straight_line_distance')}{' '}
                  </span>
                  <span className="font-medium">
                    {formatDistance(
                      calculateDistance(
                        resolvedPaths[0].resolved.sender.lat,
                        resolvedPaths[0].resolved.sender.lon,
                        resolvedPaths[0].resolved.receiver.lat,
                        resolvedPaths[0].resolved.receiver.lon
                      )!,
                      distanceUnit
                    )}
                  </span>
                </div>
              )}

            {resolvedPaths.map((pathData, index) => (
              <div key={index}>
                <div className="flex items-center justify-between mb-2 pb-1 border-b border-border">
                  {!hasSinglePath ? (
                    <div className="text-sm text-foreground/70 font-semibold">
                      {t('path_modal_path_number', { n: index + 1 })}{' '}
                      <span className="font-normal text-muted-foreground">
                        {t('path_modal_received_at_suffix', {
                          time: formatTime(pathData.received_at),
                        })}
                      </span>
                    </div>
                  ) : (
                    <div />
                  )}
                  <button
                    onClick={() => setMapModalIndex(index)}
                    className="text-xs text-primary hover:underline cursor-pointer shrink-0 ml-2"
                  >
                    {t('path_modal_map_route_button')}
                  </button>
                </div>
                <PathVisualization
                  resolved={pathData.resolved}
                  senderInfo={senderInfo}
                  distanceUnit={distanceUnit}
                  t={t}
                />
              </div>
            ))}

            {/* Map modal — opens when a "Map route" button is clicked */}
            <Dialog
              open={mapModalIndex !== null}
              onOpenChange={(open) => !open && setMapModalIndex(null)}
            >
              <DialogContent className="flex flex-col w-full max-w-[95vw] sm:max-w-2xl md:max-w-4xl h-[85dvh] max-h-[85dvh] p-4 sm:p-6">
                <DialogHeader className="shrink-0">
                  <DialogTitle>
                    {mapModalIndex !== null && !hasSinglePath
                      ? t('path_modal_route_map_title_numbered', { n: mapModalIndex + 1 })
                      : t('path_modal_route_map_title')}
                  </DialogTitle>
                  <DialogDescription>{t('path_modal_route_map_dialog_description')}</DialogDescription>
                </DialogHeader>
                {mapModalIndex !== null && (
                  <div className="flex-1 min-h-0">
                    <Suspense
                      fallback={
                        <div className="h-full rounded border border-border bg-muted/30 animate-pulse" />
                      }
                    >
                      <PathRouteMap
                        resolved={resolvedPaths[mapModalIndex].resolved}
                        senderInfo={senderInfo}
                        fill
                      />
                    </Suspense>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          {hasResendActions && (
            <div className="flex gap-2">
              {isResendable && (
                <Button
                  variant="outline"
                  className="flex-1 min-w-0 h-auto py-2"
                  onClick={() => {
                    onResend(messageId);
                    onClose();
                  }}
                >
                  <span className="flex flex-col items-center leading-tight">
                    {/* eslint-disable-next-line i18next/no-literal-string */}
                    <span>↻ {t('path_modal_resend_button')}</span>
                    <span className="text-[0.625rem] font-normal opacity-80">
                      {t('path_modal_resend_hint')}
                    </span>
                  </span>
                </Button>
              )}
              <Button
                variant="destructive"
                className="flex-1 min-w-0 h-auto py-2"
                onClick={() => {
                  onResend(messageId, true);
                  onClose();
                }}
              >
                <span className="flex flex-col items-center leading-tight">
                  {/* eslint-disable-next-line i18next/no-literal-string */}
                  <span>↻ {t('path_modal_resend_as_new_button')}</span>
                  <span className="text-[0.625rem] font-normal opacity-80">
                    {t('path_modal_resend_as_new_hint')}
                  </span>
                </span>
              </Button>
            </div>
          )}
          <Button variant="secondary" className="h-auto py-2" onClick={onClose}>
            {t('common_close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PathVisualizationProps {
  resolved: ResolvedPath;
  senderInfo: SenderInfo;
  distanceUnit: DistanceUnit;
  t: TFn;
}

function PathVisualization({ resolved, senderInfo, distanceUnit, t }: PathVisualizationProps) {
  // Track previous location for each hop to calculate distances
  // Returns null if previous hop was ambiguous or has invalid location
  const getPrevLocation = (hopIndex: number): { lat: number | null; lon: number | null } | null => {
    if (hopIndex === 0) {
      // Check if sender has valid location
      if (!isValidLocation(resolved.sender.lat, resolved.sender.lon)) {
        return null;
      }
      return { lat: resolved.sender.lat, lon: resolved.sender.lon };
    }
    const prevHop = resolved.hops[hopIndex - 1];
    // If previous hop was ambiguous, we can't show meaningful distances
    if (prevHop.matches.length > 1) {
      return null;
    }
    // If previous hop was unknown, we also can't calculate
    if (prevHop.matches.length === 0) {
      return null;
    }
    // Check if previous hop has valid location
    if (isValidLocation(prevHop.matches[0].lat, prevHop.matches[0].lon)) {
      return { lat: prevHop.matches[0].lat, lon: prevHop.matches[0].lon };
    }
    return null;
  };

  return (
    <div className="space-y-0">
      {/* Sender */}
      <PathNode
        label={t('path_modal_sender_label')}
        name={resolved.sender.name}
        prefix={resolved.sender.prefix}
        distance={null}
        distanceUnit={distanceUnit}
        isFirst
        lat={resolved.sender.lat}
        lon={resolved.sender.lon}
        publicKey={senderInfo.publicKeyOrPrefix}
        t={t}
      />

      {/* Hops */}
      {resolved.hops.map((hop, index) => (
        <HopNode
          key={index}
          hop={hop}
          hopNumber={index + 1}
          prevLocation={getPrevLocation(index)}
          distanceUnit={distanceUnit}
          t={t}
        />
      ))}

      {/* Receiver */}
      <PathNode
        label={t('path_modal_receiver_label')}
        name={resolved.receiver.name}
        prefix={resolved.receiver.prefix}
        distance={calculateReceiverDistance(resolved)}
        distanceUnit={distanceUnit}
        isLast
        lat={resolved.receiver.lat}
        lon={resolved.receiver.lon}
        publicKey={resolved.receiver.publicKey ?? undefined}
        t={t}
      />

      {/* Total distance */}
      {resolved.totalDistances && resolved.totalDistances.length > 0 && (
        <div className="pt-3 mt-3 border-t border-border">
          <span className="text-sm text-muted-foreground">
            {t('path_modal_presumed_distance')}{' '}
          </span>
          <span className="text-sm font-medium">
            {resolved.hasGaps ? '>' : ''}
            {formatDistance(resolved.totalDistances[0], distanceUnit)}
          </span>
        </div>
      )}
    </div>
  );
}

interface PathNodeProps {
  label: string;
  name: string;
  prefix: string;
  distance: number | null;
  distanceUnit: DistanceUnit;
  isFirst?: boolean;
  isLast?: boolean;
  /** Optional coordinates for map link */
  lat?: number | null;
  lon?: number | null;
  /** Public key for map focus link (required if lat/lon provided) */
  publicKey?: string;
  t: TFn;
}

function PathNode({
  label,
  name,
  prefix,
  distance,
  distanceUnit,
  isFirst,
  isLast,
  lat,
  lon,
  publicKey,
  t,
}: PathNodeProps) {
  const hasLocation = isValidLocation(lat ?? null, lon ?? null) && publicKey;

  return (
    <div className="flex gap-3">
      {/* Vertical line and dot column */}
      <div className="flex flex-col items-center w-4 flex-shrink-0">
        {!isFirst && <div className="w-0.5 h-3 bg-border" />}
        <div className="w-3 h-3 rounded-full bg-primary flex-shrink-0" />
        {!isLast && <div className="w-0.5 flex-1 bg-border" />}
      </div>

      {/* Content */}
      <div className="pb-3 flex-1 min-w-0">
        <div className="text-sm font-semibold">
          <span className="text-primary">{label}:</span>{' '}
          <span className="text-primary font-mono">{prefix}</span>
        </div>
        <div className="font-medium truncate">
          {name}
          {distance !== null && (
            <span className="text-xs text-muted-foreground ml-1">
              - {formatDistance(distance, distanceUnit)}
            </span>
          )}
          {hasLocation && <CoordinateLink lat={lat!} lon={lon!} publicKey={publicKey!} t={t} />}
        </div>
      </div>
    </div>
  );
}

interface HopNodeProps {
  hop: PathHop;
  hopNumber: number;
  prevLocation: { lat: number | null; lon: number | null } | null;
  distanceUnit: DistanceUnit;
  t: TFn;
}

const AMBIGUOUS_MATCH_PREVIEW_LIMIT = 3;

function HopNode({ hop, hopNumber, prevLocation, distanceUnit, t }: HopNodeProps) {
  const isAmbiguous = hop.matches.length > 1;
  const isUnknown = hop.matches.length === 0;
  const [expanded, setExpanded] = useState(false);

  // Calculate distance from previous location for a contact
  // Returns null if prev location unknown/ambiguous or contact has no valid location
  const getDistanceForContact = (contact: {
    lat: number | null;
    lon: number | null;
  }): number | null => {
    if (!prevLocation || prevLocation.lat === null || prevLocation.lon === null) {
      return null;
    }
    // Check if contact has valid location
    if (!isValidLocation(contact.lat, contact.lon)) {
      return null;
    }
    return calculateDistance(prevLocation.lat, prevLocation.lon, contact.lat, contact.lon);
  };

  return (
    <div className="flex gap-3">
      {/* Vertical line and dot column */}
      <div className="flex flex-col items-center w-4 flex-shrink-0">
        <div className="w-0.5 h-3 bg-border" />
        <div className="w-3 h-3 rounded-full bg-primary/50 flex-shrink-0" />
        <div className="w-0.5 flex-1 bg-border" />
      </div>

      {/* Content */}
      <div className="pb-3 flex-1 min-w-0">
        <div className="text-sm font-semibold">
          <span className="text-foreground/80">{t('path_modal_hop_label', { n: hopNumber })}:</span>{' '}
          <span className="text-primary font-mono">{hop.prefix}</span>
          {isAmbiguous && (
            <span className="text-warning ml-1 font-normal">
              ({t('path_modal_ambiguous_suffix')})
            </span>
          )}
        </div>

        {isUnknown ? (
          <div className="font-medium text-muted-foreground">{t('path_modal_unknown_node')}</div>
        ) : isAmbiguous ? (
          <div>
            {(expanded ? hop.matches : hop.matches.slice(0, AMBIGUOUS_MATCH_PREVIEW_LIMIT)).map(
              (contact) => {
                const dist = getDistanceForContact(contact);
                const hasLocation = isValidLocation(contact.lat, contact.lon);
                return (
                  <div key={contact.public_key} className="font-medium truncate">
                    {contact.name || contact.public_key.slice(0, 12)}
                    {dist !== null && (
                      <span className="text-xs text-muted-foreground ml-1">
                        - {formatDistance(dist, distanceUnit)}
                      </span>
                    )}
                    {hasLocation && (
                      <CoordinateLink
                        lat={contact.lat!}
                        lon={contact.lon!}
                        publicKey={contact.public_key}
                        t={t}
                      />
                    )}
                  </div>
                );
              }
            )}
            {!expanded && hop.matches.length > AMBIGUOUS_MATCH_PREVIEW_LIMIT && (
              <button
                type="button"
                className="text-xs text-primary hover:underline cursor-pointer"
                onClick={() => setExpanded(true)}
              >
                {t('path_modal_and_more', {
                  count: hop.matches.length - AMBIGUOUS_MATCH_PREVIEW_LIMIT,
                })}
              </button>
            )}
          </div>
        ) : (
          <div className="font-medium truncate">
            {hop.matches[0].name || hop.matches[0].public_key.slice(0, 12)}
            {hop.distanceFromPrev !== null && (
              <span className="text-xs text-muted-foreground ml-1">
                - {formatDistance(hop.distanceFromPrev, distanceUnit)}
              </span>
            )}
            {isValidLocation(hop.matches[0].lat, hop.matches[0].lon) && (
              <CoordinateLink
                lat={hop.matches[0].lat!}
                lon={hop.matches[0].lon!}
                publicKey={hop.matches[0].public_key}
                t={t}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Render clickable coordinates that open the map focused on the contact
 */
function CoordinateLink({
  lat,
  lon,
  publicKey,
  t,
}: {
  lat: number;
  lon: number;
  publicKey: string;
  t: TFn;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Open map in new tab with focus on this contact
    const url = window.location.origin + window.location.pathname + getMapFocusHash(publicKey);
    window.open(url, '_blank');
  };

  return (
    <span
      className="text-xs text-muted-foreground font-mono cursor-pointer hover:text-primary hover:underline ml-1"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      }}
      onClick={handleClick}
      title={t('contact_view_on_map')}
    >
      ({lat.toFixed(4)}, {lon.toFixed(4)})
    </span>
  );
}

function calculateReceiverDistance(resolved: ResolvedPath): number | null {
  // Get last hop's location (if any)
  let prevLat: number | null = null;
  let prevLon: number | null = null;

  if (resolved.hops.length > 0) {
    const lastHop = resolved.hops[resolved.hops.length - 1];
    // Only use last hop if it's unambiguous and has valid location
    if (
      lastHop.matches.length === 1 &&
      isValidLocation(lastHop.matches[0].lat, lastHop.matches[0].lon)
    ) {
      prevLat = lastHop.matches[0].lat;
      prevLon = lastHop.matches[0].lon;
    }
  } else {
    // No hops, calculate from sender to receiver (if sender has valid location)
    if (isValidLocation(resolved.sender.lat, resolved.sender.lon)) {
      prevLat = resolved.sender.lat;
      prevLon = resolved.sender.lon;
    }
  }

  if (prevLat === null || prevLon === null) {
    return null;
  }

  // Check receiver has valid location
  if (!isValidLocation(resolved.receiver.lat, resolved.receiver.lon)) {
    return null;
  }

  return calculateDistance(prevLat, prevLon, resolved.receiver.lat, resolved.receiver.lon);
}
