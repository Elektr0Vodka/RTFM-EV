// Map node-click popup, laid out per node type (repeater, companion, room
// server, sensor). One shared header (role icon, name, recency), a chip row
// (route, distance, location source) and an action footer; the middle shows
// what matters for that type at a glance.
//
// Mounted imperatively into the MapLibre popup (MapView). It sits outside the
// app's React tree, so `t` is passed in rather than read from context.
//
// Everything is local data except the advert rate, which is one read-only
// GET /contacts/analytics when the popup opens (aborted on close). No radio.

import { useEffect, useState, type ReactNode } from 'react';
import {
  Battery,
  MessagesSquare,
  Plug,
  RadioTower,
  Smartphone,
  Star,
  Sun,
  Thermometer,
  type LucideIcon,
} from 'lucide-react';

import type { TFn } from '../i18n';
import {
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
  type Contact,
  type LatestTelemetry,
} from '../types';
import { contactTypeLabel } from '../components/ContactInfoBody';
import { TelemetryPopupChart } from '../components/TelemetryPopupChart';
import { mvToPercent } from '../utils/batteryDisplay';
import { formatCoordinates, type CoordinateFormat } from '../utils/coordinateFormat';
import type { DistanceUnit } from '../utils/distanceUnits';
import {
  calculateDistance,
  formatDistance,
  getEffectiveContactRoute,
  getEffectiveLocation,
  isValidLocation,
} from '../utils/pathUtils';
import { POWER_SOURCE_LABEL_KEY, resolvePowerSource, type PowerSource } from '../utils/powerSource';
import { cn } from '../lib/utils';
import { STALE_SEC } from './layers/telemetryLayer';
import { NODE_RECENCY_COLORS, recencyTier, type RecencyTier } from './layers/nodesLayer';

const HOUR = 3600;
const DAY = 24 * HOUR;

/** Advert rate text: per hour from 1/h up, per day below (0.04/h reads ~1/day). */
export function advertRateText(perHour: number, t: TFn): string {
  if (perHour >= 1) {
    return t('map_popup_adverts_value', { rate: perHour.toFixed(perHour < 10 ? 1 : 0) });
  }
  const perDay = perHour * 24;
  return t('map_popup_adverts_value_day', { rate: perDay.toFixed(perDay < 10 ? 1 : 0) });
}

/** Localised "x ago" for an age in seconds. */
export function relativeAge(ageSec: number, t: TFn): string {
  const sec = Math.max(0, Math.round(ageSec));
  if (sec < 90) return t('map_popup_age_now');
  if (sec < HOUR) return t('map_popup_age_min', { count: Math.round(sec / 60) });
  if (sec < DAY) return t('map_popup_age_hour', { count: Math.round(sec / HOUR) });
  return t('map_popup_age_day', { count: Math.round(sec / DAY) });
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** 8-point compass direction of the initial great-circle bearing from a to b. */
export function compassBearing(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): (typeof COMPASS)[number] {
  const rad = Math.PI / 180;
  const dLon = (toLon - fromLon) * rad;
  const y = Math.sin(dLon) * Math.cos(toLat * rad);
  const x =
    Math.cos(fromLat * rad) * Math.sin(toLat * rad) -
    Math.sin(fromLat * rad) * Math.cos(toLat * rad) * Math.cos(dLon);
  const deg = (Math.atan2(y, x) / rad + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

const TYPE_ICON: Record<number, LucideIcon> = {
  [CONTACT_TYPE_REPEATER]: RadioTower,
  [CONTACT_TYPE_ROOM]: MessagesSquare,
  [CONTACT_TYPE_SENSOR]: Thermometer,
};

const POWER_ICON: Partial<Record<PowerSource, LucideIcon>> = {
  Mains: Plug,
  Battery: Battery,
  Solar: Sun,
  SolarBattery: Sun,
};

function batteryTone(pct: number): string {
  if (pct > 50) return 'bg-success';
  if (pct > 20) return 'bg-warning';
  return 'bg-destructive';
}

export interface NodeMapPopupProps {
  t: TFn;
  contact: Contact;
  nowSec: number;
  /** Marker ring (role) colour, drawn as the icon's ring like on the map. */
  roleColor: string;
  /** Marker fill per recency tier as drawn (colourblind palette when on). */
  recencyColors?: Record<RecencyTier, string>;
  selfLatLon: [number, number] | null;
  distanceUnit: DistanceUnit;
  coordinateFormat: CoordinateFormat;
  telemetry?: LatestTelemetry;
  /** Neighbours on the links layer currently drawn; null hides the row. */
  linkCount: number | null;
  triangulateUrl: string | null;
  onOpenChat?: () => void;
  onOpenDetails?: () => void;
  onOpenOwner?: () => void;
  /** Advert copies heard per hour (contact analytics); omitted = row hidden. */
  loadAdvertRate?: (signal: AbortSignal) => Promise<number | null>;
}

function Row({
  label,
  children,
  valueClassName,
}: {
  label: ReactNode;
  children: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 text-xs">
      <span className="text-muted-foreground flex items-center gap-1">{label}</span>
      <span className={cn('text-right', valueClassName)}>{children}</span>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="rounded border border-border bg-transparent px-2 py-0.5 text-xs text-foreground hover:bg-accent cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function NodeMapPopup(props: NodeMapPopupProps) {
  const {
    t,
    contact,
    nowSec,
    roleColor,
    recencyColors,
    selfLatLon,
    distanceUnit,
    coordinateFormat,
    telemetry,
    linkCount,
    triangulateUrl,
    onOpenChat,
    onOpenDetails,
    onOpenOwner,
    loadAdvertRate,
  } = props;
  const [advertRate, setAdvertRate] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!loadAdvertRate) return;
    const controller = new AbortController();
    loadAdvertRate(controller.signal)
      .then((rate) => {
        if (!controller.signal.aborted) setAdvertRate(rate);
      })
      .catch(() => {
        /* optional row: stays hidden */
      });
    return () => controller.abort();
  }, [loadAdvertRate]);

  const type = contact.type;
  const isRepeater = type === CONTACT_TYPE_REPEATER;
  const isRoom = type === CONTACT_TYPE_ROOM;
  const isSensor = type === CONTACT_TYPE_SENSOR;
  const isCompanion = !isRepeater && !isRoom && !isSensor;
  const TypeIcon = TYPE_ICON[type] ?? Smartphone;
  const displayName = contact.name || contact.public_key.slice(0, 12);

  // Same tier and colour as the marker fill, so dot and marker agree.
  const recencyColor = (recencyColors ?? NODE_RECENCY_COLORS)[
    recencyTier(contact.last_seen, nowSec)
  ];
  const heard =
    contact.last_seen != null
      ? t('map_popup_heard', { age: relativeAge(nowSec - contact.last_seen, t) })
      : t('map_never_heard');

  const route = getEffectiveContactRoute(contact);
  const routeChip =
    route.pathLen < 0
      ? t('map_popup_route_flood')
      : route.pathLen === 0
        ? t('map_popup_route_direct')
        : t('map_popup_route_hops', { count: route.pathLen });

  const loc = getEffectiveLocation(contact);
  const manualLocation = loc != null && !isValidLocation(contact.lat, contact.lon);
  let distanceChip: string | null = null;
  if (loc && selfLatLon) {
    const km = calculateDistance(selfLatLon[0], selfLatLon[1], loc.lat, loc.lon);
    if (km != null) {
      const dir = compassBearing(selfLatLon[0], selfLatLon[1], loc.lat, loc.lon);
      distanceChip = t('map_popup_distance', {
        distance: formatDistance(km, distanceUnit),
        direction: t(`map_popup_dir_${dir.toLowerCase()}`),
      });
    }
  }

  const power = resolvePowerSource(contact);
  const PowerIcon = POWER_ICON[power];
  const volts = telemetry?.battery_volts ?? null;
  const batteryPct = volts != null ? mvToPercent(volts * 1000, contact.battery_chemistry) : null;
  const temperature = telemetry?.temperature ?? null;
  const hasTelemetry = volts != null || temperature != null;
  const telemetryAgeSec = telemetry ? nowSec - telemetry.timestamp : null;
  const telemetryStale = telemetryAgeSec != null && telemetryAgeSec > STALE_SEC;
  // Readings older than a day are dimmed, as the map's telemetry badges are.
  const staleCls = telemetryStale ? 'opacity-60' : undefined;
  const batteryText =
    batteryPct != null && volts != null
      ? t('map_popup_battery_value', { pct: batteryPct, volts: volts.toFixed(2) })
      : null;
  const temperatureText =
    temperature != null
      ? t('map_popup_temperature_value', { value: temperature.toFixed(1) })
      : null;

  // Nothing known (no power source, no battery reading): leave the row out.
  const powerRow = (isRepeater || isRoom) && (power !== 'Unknown' || batteryText) && (
    <>
      <Row
        valueClassName={batteryText ? staleCls : undefined}
        label={
          <>
            {PowerIcon && <PowerIcon className="h-3.5 w-3.5" aria-hidden="true" />}
            {t(POWER_SOURCE_LABEL_KEY[power])}
          </>
        }
      >
        {batteryText ?? <span className="text-muted-foreground">{t('map_popup_no_battery')}</span>}
      </Row>
      {batteryPct != null && (
        <div
          className={cn('my-1 h-1.5 overflow-hidden rounded bg-muted', staleCls)}
          aria-hidden="true"
        >
          <div
            className={cn('h-full', batteryTone(batteryPct))}
            style={{ width: `${Math.min(100, Math.max(0, batteryPct))}%` }}
          />
        </div>
      )}
    </>
  );

  const historyToggle = hasTelemetry && (
    <>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {telemetryAgeSec != null &&
          t('map_popup_reading_age', { age: relativeAge(telemetryAgeSec, t) })}
        {' · '}
        <button
          type="button"
          className="bg-transparent border-0 p-0 text-primary underline cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            setShowHistory((v) => !v);
          }}
        >
          {showHistory ? t('map_telemetry_hide_history') : t('map_telemetry_show_history')}
        </button>
      </div>
      {showHistory && <TelemetryPopupChart publicKey={contact.public_key} />}
    </>
  );

  const linksRow = (isRepeater || isRoom) && linkCount != null && (
    <Row label={t('map_popup_links')}>{t('map_popup_links_value', { count: linkCount })}</Row>
  );

  const advertRow = advertRate != null && (
    <Row label={t('map_popup_adverts')}>
      <span title={t('map_popup_adverts_title')}>{advertRateText(advertRate, t)}</span>
    </Row>
  );

  const routeSourceKey =
    route.source === 'override'
      ? 'map_popup_route_source_override'
      : 'map_popup_route_source_direct';

  return (
    <div className="text-sm min-w-[230px]" data-node-popup={isCompanion ? 'companion' : type}>
      <div className="flex items-center gap-2.5 pr-4">
        <div
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 bg-muted text-foreground"
          style={{ borderColor: roleColor }}
        >
          <TypeIcon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          {onOpenChat ? (
            <button
              type="button"
              className="block max-w-full truncate bg-transparent border-0 p-0 text-left font-medium text-primary underline cursor-pointer"
              title={t('map_open_conversation_title', { name: displayName })}
              onClick={(e) => {
                e.stopPropagation();
                onOpenChat();
              }}
            >
              {displayName}
            </button>
          ) : (
            <div className="truncate font-medium">{displayName}</div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{contactTypeLabel(type, t)}</span>
            <span aria-hidden="true">·</span>
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: recencyColor }}
              aria-hidden="true"
            />
            <span>{heard}</span>
          </div>
        </div>
        {contact.favorite && (
          <Star className="h-4 w-4 flex-none text-favorite" aria-label={t('map_popup_favorite')} />
        )}
      </div>

      <div className="mt-2.5 mb-2 flex flex-wrap gap-1">
        <Chip>{routeChip}</Chip>
        {distanceChip && <Chip>{distanceChip}</Chip>}
        {loc && (
          <Chip>
            {manualLocation ? t('map_popup_location_manual') : t('map_popup_location_reported')}
          </Chip>
        )}
      </div>

      {isSensor ? (
        <>
          {hasTelemetry ? (
            <div className={cn('grid grid-cols-2 gap-2', staleCls)}>
              <div className="rounded bg-muted/50 px-2 py-1.5">
                <div className="text-[11px] text-muted-foreground">
                  {t('map_popup_temperature')}
                </div>
                <div className="text-lg font-medium">{temperatureText ?? '–'}</div>
              </div>
              <div className="rounded bg-muted/50 px-2 py-1.5">
                <div className="text-[11px] text-muted-foreground">{t('map_popup_battery')}</div>
                <div className="text-lg font-medium">
                  {batteryPct != null ? `${batteryPct}%` : '–'}
                </div>
                {volts != null && (
                  <div className="text-[11px] text-muted-foreground">{volts.toFixed(2)} V</div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">{t('map_popup_no_readings')}</div>
          )}
          {historyToggle}
          {advertRow}
        </>
      ) : (
        <>
          {isRoom && (
            <Row label={t('map_popup_last_visited')}>
              {contact.last_read_at != null
                ? relativeAge(nowSec - contact.last_read_at, t)
                : t('map_popup_never')}
            </Row>
          )}
          {isCompanion && (
            <>
              <Row label={t('map_popup_last_dm')}>
                {contact.last_contacted != null
                  ? relativeAge(nowSec - contact.last_contacted, t)
                  : t('map_popup_never')}
              </Row>
              {/* Flood is already the route chip; the row only adds learned vs set. */}
              {route.source !== 'flood' && (
                <Row label={t('map_popup_route')}>{t(routeSourceKey)}</Row>
              )}
            </>
          )}
          {powerRow}
          {isCompanion && batteryText && (
            <Row label={t('map_popup_battery')} valueClassName={staleCls}>
              {batteryText}
            </Row>
          )}
          {temperatureText && (
            <Row label={t('map_popup_temperature')} valueClassName={staleCls}>
              {temperatureText}
            </Row>
          )}
          {linksRow}
          {advertRow}
          {historyToggle}
        </>
      )}

      {contact.notes && (
        <div className="mt-1.5 text-[11px] text-muted-foreground whitespace-pre-wrap wrap-break-word">
          {contact.notes.length > 140 ? contact.notes.slice(0, 140) + '…' : contact.notes}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
        {onOpenChat && (isCompanion || isRoom) && (
          <ActionButton onClick={onOpenChat}>
            {isRoom ? t('map_popup_open_room') : t('map_popup_message')}
          </ActionButton>
        )}
        {onOpenDetails && (
          <ActionButton onClick={onOpenDetails}>{t('map_node_details')}</ActionButton>
        )}
        {onOpenOwner && <ActionButton onClick={onOpenOwner}>{t('map_owner_link')}</ActionButton>}
        {triangulateUrl && (
          <a
            href={triangulateUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={t('contact_triangulate_title')}
            className="rounded border border-border px-2 py-0.5 text-xs text-foreground no-underline hover:bg-accent"
            onClick={(e) => e.stopPropagation()}
          >
            {t('map_triangulate_link')}
          </a>
        )}
        {loc && (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {formatCoordinates(loc.lat, loc.lon, coordinateFormat, 5)}
          </span>
        )}
      </div>
    </div>
  );
}
