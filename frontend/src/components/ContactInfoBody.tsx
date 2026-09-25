import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Ban, ChevronDown, ChevronRight, ExternalLink, Search, Star } from 'lucide-react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Marker as MlMarker, Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';
import { MiniMap } from '../map/MiniMap';
import { api } from '../api';
import { formatTime } from '../utils/messageParser';
import {
  getContactDisplayName,
  isPrefixOnlyContact,
  isUnknownFullKeyContact,
} from '../utils/pubkey';
import {
  isValidLocation,
  calculateDistance,
  formatDistance,
  formatRouteLabel,
  getDirectContactRoute,
  getEffectiveContactRoute,
  getEffectiveLocation,
  hasRoutingOverride,
  parsePathHops,
} from '../utils/pathUtils';
import { isPublicChannelKey } from '../utils/publicChannel';
import { buildNodeLookupUrl } from '../utils/analyzerLink';
import { buildTriangulatorUrl } from '../utils/triangulatorLink';
import { getMapFocusHash } from '../utils/urlHash';
import { formatDateTime } from '../utils/dateTimeFormat';
import { handleKeyboardActivate } from '../utils/a11y';
import { useT, type TFn } from '../i18n';
import { ZoomableChart } from './charts/ZoomableChart';
import type { ChartWindow } from '../lib/chartZoom';
import { ContactAvatar } from './ContactAvatar';
import { ContactRadioResidencyControl } from './ContactRadioResidencyControl';
import { ContactTelemetryPermissionsControl } from './ContactTelemetryPermissionsControl';
import { ContactLinkShare } from './ContactLinkShare';
import { formatContactShare } from '../utils/chatEntities';
import { LppSensorRow, formatLppLabel } from './repeater/repeaterPaneShared';
import { toast } from './ui/sonner';
import { useDistanceUnit } from '../contexts/DistanceUnitContext';
import { formatCoordinates, useCoordinateFormat } from '../utils/coordinateFormat';
import { createContactGroup, toggleGroupMember } from '../utils/sidebarLayout';
import { CONTACT_TYPE_REPEATER } from '../types';
import type {
  AnalyzerSite,
  Contact,
  ContactAnnotationsUpdate,
  ContactActiveRoom,
  ContactAnalytics,
  ContactAnalyticsHourlyBucket,
  ContactAnalyticsWeeklyBucket,
  ContactGroup,
  LppSensor,
  PartialNodeResolution,
  RadioConfig,
  TelemetryHistoryEntry,
  TelemetryLppSensor,
} from '../types';

/** GPS mini-map for a contact: a single blue marker over a MapSurface with the
 *  Layers FAB. A DOM Marker survives basemap switches, so no re-attach needed. */
function ContactGpsMap({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const onReady = useCallback(
    (map: MlMap) => {
      const el = document.createElement('div');
      el.style.cssText =
        'width:14px;height:14px;border-radius:9999px;background:#3b82f6;border:2px solid #1d4ed8;box-shadow:0 0 0 1px rgba(0,0,0,0.3)';
      new MlMarker({ element: el })
        .setLngLat([lon, lat])
        .setPopup(new MlPopup({ offset: 12 }).setText(label))
        .addTo(map);
    },
    [lat, lon, label]
  );
  return <MiniMap center={[lon, lat]} zoom={13} onReady={onReady} />;
}

export function contactTypeLabel(type: number, t: TFn): string {
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

function formatPathHashMode(mode: number, t: TFn): string | null {
  if (mode < 0 || mode > 2) {
    return null;
  }
  return t('contact_hop_width_byte_ids', { n: mode + 1 });
}

/** Which curated region a section belongs to on the full-page desktop view. */
export type ContactInfoRegion = 'all' | 'identity' | 'data' | 'network';

export interface ContactInfoBodyProps {
  contact: Contact;
  contacts: Contact[];
  analytics: ContactAnalytics | null;
  config: RadioConfig | null;
  chartsReady: boolean;
  telemetryLoading: boolean;
  telemetryHistory: TelemetryHistoryEntry[];
  onFetchTelemetry: () => void;
  fromChannel?: boolean;
  onToggleFavorite: (type: 'channel' | 'contact', id: string) => void;
  onNavigateToChannel?: (channelKey: string) => void;
  onSearchMessagesByKey?: (publicKey: string) => void;
  onToggleBlockedKey?: (key: string) => void;
  onToggleBlockedName?: (name: string) => void;
  blockedKeys?: string[];
  blockedNames?: string[];
  trackedTelemetryContacts?: string[];
  onToggleTrackedTelemetryContact?: (publicKey: string) => Promise<void>;
  analyzerSites?: AnalyzerSite[];
  onOpenContactInfo?: (publicKey: string) => void;
  onOpenConversation?: (publicKey: string) => void;
  /** User-defined contact/channel groups (server-persisted); omit to hide the
   *  Groups section entirely (e.g. when the caller has no settings loaded). */
  contactGroups?: ContactGroup[];
  onUpdateContactGroups?: (next: ContactGroup[]) => void | Promise<void>;
  /** Which region to render. 'all' = the full single-column stack (mobile Sheet);
   *  'identity' | 'data' | 'network' = only that column's sections (desktop). */
  region?: ContactInfoRegion;
  /** When true, render the contact header (avatar/name/key/type). The desktop
   *  full-page view supplies its own top bar and sets this false. */
  showHeader?: boolean;
}

/**
 * Renders the contact info section stack shared by the mobile Sheet
 * (`ContactInfoPane`) and the desktop full-page view (`ContactInfoView`).
 * With `region="all"` it emits every section in the original order (identical
 * DOM to the legacy pane). With a specific region it emits only that group's
 * sections so the full-page view can lay them out in columns.
 */
export function ContactInfoBody({
  contact,
  contacts,
  analytics,
  config,
  chartsReady,
  telemetryLoading,
  telemetryHistory,
  onFetchTelemetry,
  fromChannel = false,
  onToggleFavorite,
  onNavigateToChannel,
  onSearchMessagesByKey,
  onToggleBlockedKey,
  onToggleBlockedName,
  blockedKeys = [],
  blockedNames = [],
  trackedTelemetryContacts = [],
  onToggleTrackedTelemetryContact,
  analyzerSites = [],
  onOpenContactInfo,
  onOpenConversation,
  contactGroups,
  onUpdateContactGroups,
  region = 'all',
  showHeader = true,
}: ContactInfoBodyProps) {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();
  const coordinateFormat = useCoordinateFormat();

  const show = (group: 'identity' | 'data' | 'network') => region === 'all' || region === group;

  // For a prefix-only contact, look up any soft resolution (a reversible link to a
  // full pubkey matched from the external map). It enriches the display without
  // ever having been written into the contact itself.
  const [softResolution, setSoftResolution] = useState<PartialNodeResolution | null>(null);
  const contactKey = contact.public_key;
  const contactIsPrefixOnly = isPrefixOnlyContact(contactKey);
  useEffect(() => {
    if (!contactIsPrefixOnly) {
      setSoftResolution(null);
      return;
    }
    let cancelled = false;
    const prefix = contactKey.toLowerCase();
    api
      .listPartialResolutions()
      .then((rows) => {
        if (!cancelled) setSoftResolution(rows.find((r) => r.prefix_hex === prefix) ?? null);
      })
      .catch(() => {
        if (!cancelled) setSoftResolution(null);
      });
    return () => {
      cancelled = true;
    };
  }, [contactKey, contactIsPrefixOnly]);

  const handleClearSoftResolution = useCallback(async () => {
    if (!softResolution) return;
    try {
      await api.deletePartialResolution(softResolution.prefix_hex);
      setSoftResolution(null);
      toast.success(t('partial_sync_resolved_cleared'));
    } catch (err) {
      toast.error(t('partial_sync_toast_failed'), {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }, [softResolution, t]);

  const effectiveLocation = getEffectiveLocation(contact);
  const distFromUs =
    effectiveLocation && config && isValidLocation(config.lat, config.lon)
      ? calculateDistance(config.lat, config.lon, effectiveLocation.lat, effectiveLocation.lon)
      : null;
  const effectiveRoute = getEffectiveContactRoute(contact);
  const directRoute = getDirectContactRoute(contact);
  const pathHashModeLabel =
    effectiveRoute && effectiveRoute.pathLen >= 0
      ? formatPathHashMode(effectiveRoute.pathHashMode, t)
      : null;
  const learnedRouteLabel = directRoute ? formatRouteLabel(directRoute.path_len, true) : null;
  const isPrefixOnlyResolvedContact = contactIsPrefixOnly;
  // The pubkey to hand an analyzer lookup: the contact's own full key, or, for a
  // prefix-only contact, the soft-resolved full key (when one exists).
  const analyzerLookupKey = isPrefixOnlyResolvedContact
    ? (softResolution?.resolved_pubkey ?? null)
    : contact.public_key;
  const isUnknownFullKeyResolvedContact =
    !isPrefixOnlyResolvedContact &&
    isUnknownFullKeyContact(contact.public_key, contact.last_advert);
  const isRepeater = contact.type === CONTACT_TYPE_REPEATER;

  return (
    <>
      {showHeader && region === 'all' && (
        <div className="px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-start gap-4">
            <ContactAvatar
              name={contact.name}
              publicKey={contact.public_key}
              size={56}
              contactType={contact.type}
            />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold truncate">
                {getContactDisplayName(contact.name, contact.public_key, contact.last_advert)}
              </h2>
              <span
                className="text-xs font-mono text-muted-foreground cursor-pointer hover:text-primary transition-colors block truncate"
                role="button"
                tabIndex={0}
                onKeyDown={handleKeyboardActivate}
                onClick={() => {
                  navigator.clipboard.writeText(contact.public_key);
                  toast.success(t('toast_public_key_copied'));
                }}
                title={t('a11y_click_to_copy')}
              >
                {contact.public_key}
              </span>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                  {contactTypeLabel(contact.type, t)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {show('identity') && isPrefixOnlyResolvedContact && (
        <div className="mx-5 mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t('contact_prefix_only_banner')}
        </div>
      )}

      {show('identity') && isUnknownFullKeyResolvedContact && (
        <div className="mx-5 mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {t('contact_unknown_full_key_banner')}
        </div>
      )}

      {show('identity') && (
        <div className="px-5 py-3 border-b border-border">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {contact.last_seen && (
              <InfoItem label={t('contact_last_seen')} value={formatTime(contact.last_seen)} />
            )}
            {contact.first_seen && (
              <InfoItem label={t('contact_first_heard')} value={formatTime(contact.first_seen)} />
            )}
            {contact.last_contacted && (
              <InfoItem
                label={t('contact_last_contacted')}
                value={formatTime(contact.last_contacted)}
              />
            )}
            {distFromUs !== null && (
              <InfoItem
                label={t('contact_distance')}
                value={formatDistance(distFromUs, distanceUnit)}
              />
            )}
            {effectiveRoute && (
              <InfoItem
                label={t('contact_routing')}
                value={
                  effectiveRoute.forced ? (
                    <span>
                      {formatRouteLabel(effectiveRoute.pathLen, true)}{' '}
                      <span className="text-destructive">{t('contact_forced_suffix')}</span>
                    </span>
                  ) : (
                    formatRouteLabel(effectiveRoute.pathLen, true)
                  )
                }
              />
            )}
            {hasRoutingOverride(contact) && learnedRouteLabel && (
              <InfoItem label={t('contact_learned_route')} value={learnedRouteLabel} />
            )}
            {pathHashModeLabel && (
              <InfoItem label={t('contact_hop_width')} value={pathHashModeLabel} />
            )}
          </div>
        </div>
      )}

      {show('identity') && effectiveLocation && (
        <div className="px-5 py-3 border-b border-border">
          <SectionLabel>{t('contact_location')}</SectionLabel>
          <span
            className="text-sm font-mono cursor-pointer hover:text-primary hover:underline transition-colors"
            role="button"
            tabIndex={0}
            onKeyDown={handleKeyboardActivate}
            onClick={() => {
              const url =
                window.location.origin +
                window.location.pathname +
                getMapFocusHash(contact.public_key);
              window.open(url, '_blank');
            }}
            title={t('contact_view_on_map')}
          >
            {formatCoordinates(effectiveLocation.lat, effectiveLocation.lon, coordinateFormat)}
          </span>
        </div>
      )}

      {show('data') && (
        <ContactTelemetrySection
          t={t}
          contact={contact}
          loading={telemetryLoading}
          onFetch={onFetchTelemetry}
          telemetryHistory={telemetryHistory}
          isTracked={trackedTelemetryContacts.includes(contact.public_key)}
          onToggleTracked={onToggleTrackedTelemetryContact}
        />
      )}

      {show('identity') && (
        <div className="px-5 py-3 border-b border-border">
          <button
            type="button"
            className="text-sm flex items-center gap-2 hover:text-primary transition-colors"
            onClick={() => onToggleFavorite('contact', contact.public_key)}
            title={t('contact_favorite_ack_hint')}
          >
            {contact.favorite ? (
              <>
                <Star className="h-4.5 w-4.5 fill-current text-favorite" aria-hidden="true" />
                <span>{t('common_remove_from_favorites')}</span>
              </>
            ) : (
              <>
                <Star className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
                <span>{t('common_add_to_favorites')}</span>
              </>
            )}
          </button>
        </div>
      )}

      {show('identity') && contactGroups && onUpdateContactGroups && (
        <ContactGroupsSection
          t={t}
          contactKey={contact.public_key}
          contactGroups={contactGroups}
          onUpdateContactGroups={onUpdateContactGroups}
        />
      )}

      {show('data') && (
        <ContactAnnotations
          contact={contact}
          contacts={contacts}
          ownPublicKey={config?.public_key ?? null}
          t={t}
          onOpenContact={onOpenContactInfo}
          onOpenConversation={onOpenConversation}
        />
      )}

      {show('identity') && !isPrefixOnlyResolvedContact && (
        <ContactRadioResidencyControl contact={contact} />
      )}

      {show('identity') && !isPrefixOnlyResolvedContact && (
        <ContactTelemetryPermissionsControl contact={contact} />
      )}

      {show('identity') && !isPrefixOnlyResolvedContact && (
        <ContactLinkShare
          key={contact.public_key}
          load={() => api.getContactUri(contact.public_key)}
          hint={t('contact_link_contact_hint')}
          className="px-5 py-3 border-b border-border"
          shareTag={formatContactShare(
            contact.public_key,
            contact.type,
            contact.name || contact.public_key.slice(0, 8)
          )}
        />
      )}

      {show('identity') && (onToggleBlockedKey || onToggleBlockedName) && (
        <div className="px-5 py-3 border-b border-border space-y-2">
          {onToggleBlockedKey && (
            <button
              type="button"
              className="text-sm flex items-center gap-2 hover:text-primary transition-colors"
              onClick={() => onToggleBlockedKey(contact.public_key)}
            >
              {blockedKeys.includes(contact.public_key.toLowerCase()) ? (
                <>
                  <Ban className="h-4.5 w-4.5 text-destructive" aria-hidden="true" />
                  <span>{t('contact_unblock_key')}</span>
                </>
              ) : (
                <>
                  <Ban className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
                  <span>{t('contact_block_key')}</span>
                </>
              )}
            </button>
          )}
          {onToggleBlockedName && contact.name && (
            <button
              type="button"
              className="text-sm flex items-center gap-2 hover:text-primary transition-colors"
              onClick={() => onToggleBlockedName(contact.name!)}
            >
              {blockedNames.includes(contact.name) ? (
                <>
                  <Ban className="h-4.5 w-4.5 text-destructive" aria-hidden="true" />
                  <span>{t('contact_unblock_name_named', { name: contact.name })}</span>
                </>
              ) : (
                <>
                  <Ban className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
                  <span>{t('contact_block_name_named', { name: contact.name })}</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {show('identity') && !isRepeater && onSearchMessagesByKey && (
        <div className="px-5 py-3 border-b border-border">
          <button
            type="button"
            className="text-sm flex items-center gap-2 hover:text-primary transition-colors"
            onClick={() => onSearchMessagesByKey(contact.public_key)}
          >
            <Search className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
            <span>{t('contact_search_messages_by_key')}</span>
          </button>
        </div>
      )}

      {show('identity') && isPrefixOnlyResolvedContact && softResolution && (
        <div className="px-5 py-3 border-b border-border space-y-1">
          <div className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
            {t('partial_sync_resolved_label')}
          </div>
          <div className="text-sm">
            <span className="font-medium">
              {softResolution.resolved_name || softResolution.resolved_pubkey.slice(0, 12)}
            </span>
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {softResolution.resolved_pubkey.slice(0, 16)}
            </span>
          </div>
          <div className="text-[0.6875rem] text-muted-foreground">
            {t('partial_sync_resolved_soft_note')}
          </div>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-primary underline"
            onClick={handleClearSoftResolution}
          >
            {t('partial_sync_resolved_clear')}
          </button>
        </div>
      )}

      {show('identity') &&
        analyzerLookupKey &&
        (() => {
          const url = buildTriangulatorUrl(analyzerLookupKey);
          if (!url) return null;
          return (
            <div className="px-5 py-3 border-b border-border">
              <button
                type="button"
                className="text-sm flex items-center gap-2 hover:text-primary transition-colors"
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                title={t('contact_triangulate_title')}
              >
                <ExternalLink className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
                <span>{t('contact_triangulate_label')}</span>
              </button>
            </div>
          );
        })()}

      {show('identity') && analyzerLookupKey && analyzerSites.length > 0 && (
        <div className="px-5 py-3 border-b border-border space-y-2">
          {analyzerSites.map((site) => {
            const url = buildNodeLookupUrl(site, analyzerLookupKey);
            if (!url) return null;
            return (
              <button
                key={site.name}
                type="button"
                className="text-sm flex items-center gap-2 hover:text-primary transition-colors"
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                title={t('contact_analyzer_lookup_title', { name: site.name })}
              >
                <ExternalLink className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
                <span>{t('contact_analyzer_lookup_label', { name: site.name })}</span>
              </button>
            );
          })}
        </div>
      )}

      {show('identity') &&
        !isPrefixOnlyResolvedContact &&
        contact.public_key.length === 64 &&
        !contact.name && <ResolveNameButton publicKey={contact.public_key} t={t} />}

      {show('network') &&
        analytics &&
        (() => {
          const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
          const recent = analytics.nearest_repeaters.filter((r) => r.last_seen >= sevenDaysAgo);
          if (recent.length === 0) return null;
          return (
            <div className="px-5 py-3 border-b border-border">
              <SectionLabel>{t('contact_nearest_repeaters_hops')}</SectionLabel>
              <div className="space-y-1">
                {recent.map((r) => (
                  <div key={r.public_key} className="flex justify-between items-center text-sm">
                    <span className="truncate">{r.name || r.public_key.slice(0, 12)}</span>
                    {/* eslint-disable i18next/no-literal-string */}
                    <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                      {r.path_len === 0
                        ? t('contact_direct')
                        : t('contact_hop_count', { count: r.path_len })}{' '}
                      · {r.heard_count}x
                    </span>
                    {/* eslint-enable i18next/no-literal-string */}
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

      {show('network') && isRepeater && isValidLocation(contact.lat, contact.lon) && (
        <NearbyRepeatersSection
          t={t}
          contact={contact}
          contacts={contacts}
          distanceUnit={distanceUnit}
        />
      )}

      {show('network') && analytics && analytics.advert_paths.length > 0 && (
        <div className="px-5 py-3 border-b border-border">
          <SectionLabel>{t('contact_recent_advert_paths')}</SectionLabel>
          <div className="space-y-1.5">
            {analytics.advert_paths.map((p) => (
              <div
                key={p.path + p.first_seen}
                className="flex justify-between items-start gap-2 text-sm"
              >
                <span className="font-mono text-xs break-all">
                  {p.path
                    ? parsePathHops(p.path, p.path_len).join(' → ')
                    : t('contact_direct_path')}
                </span>
                {/* eslint-disable i18next/no-literal-string */}
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {p.heard_count}x · {formatTime(p.last_seen)}
                </span>
                {/* eslint-enable i18next/no-literal-string */}
              </div>
            ))}
          </div>
        </div>
      )}

      {show('network') && analytics && analytics.path_scores.length > 0 && (
        <div className="px-5 py-3 border-b border-border">
          <SectionLabel>{t('contact_path_scores')}</SectionLabel>
          <p className="text-xs text-muted-foreground mb-1.5">{t('contact_path_scores_hint')}</p>
          <div className="space-y-1.5">
            {analytics.path_scores.map((p) => (
              <div
                key={`${p.path_len}:${p.path}`}
                className="flex justify-between items-start gap-2 text-sm"
                data-testid="contact-path-score"
              >
                <span className="font-mono text-xs break-all">
                  {p.path_len < 0
                    ? t('contact_path_score_flood')
                    : p.path
                      ? parsePathHops(p.path, p.path_len).join(' → ')
                      : t('contact_direct_path')}
                </span>
                <span className="text-xs text-muted-foreground flex-shrink-0 text-right">
                  {t('contact_path_score_detail', {
                    score: Math.round(p.score * 100),
                    ok: p.success_count,
                    attempts: p.attempt_count,
                    trip: p.last_trip_ms != null ? `${(p.last_trip_ms / 1000).toFixed(1)} s` : '-',
                  })}
                  {' · '}
                  {formatTime(p.last_used)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {show('network') && fromChannel && (
        <ChannelAttributionWarning
          t={t}
          includeAliasNote={Boolean(analytics && analytics.name_history.length > 1)}
        />
      )}

      {show('network') && analytics && analytics.name_history.length > 1 && (
        <div className="px-5 py-3 border-b border-border">
          <SectionLabel>{t('contact_also_known_as')}</SectionLabel>
          <div className="space-y-1">
            {analytics.name_history.map((h) => (
              <div key={h.name} className="flex justify-between items-center text-sm">
                <span className="font-medium truncate">{h.name}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                  {formatTime(h.first_seen)} &ndash; {formatTime(h.last_seen)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {show('network') && !isRepeater && (
        <>
          <MessageStatsSection
            t={t}
            dmMessageCount={analytics?.dm_message_count ?? 0}
            channelMessageCount={analytics?.channel_message_count ?? 0}
          />

          <ActivityChartsSection analytics={analytics} ready={chartsReady} t={t} />

          <MostActiveChannelsSection
            t={t}
            channels={analytics?.most_active_rooms ?? []}
            onNavigateToChannel={onNavigateToChannel}
          />
        </>
      )}
    </>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
      {children}
    </h3>
  );
}

export function ChannelAttributionWarning({
  t,
  includeAliasNote = false,
  nameOnly = false,
  className = 'mx-5 my-3 px-3 py-2 rounded-md bg-warning/10 border border-warning/20',
}: {
  t: TFn;
  includeAliasNote?: boolean;
  nameOnly?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs text-warning">
        {nameOnly ? t('contact_attribution_warning_named') : t('contact_attribution_warning_keyed')}
        {includeAliasNote && t('contact_attribution_alias_note')}
      </p>
    </div>
  );
}

export function MessageStatsSection({
  t,
  dmMessageCount,
  channelMessageCount,
  showDirectMessages = true,
}: {
  t: TFn;
  dmMessageCount: number;
  channelMessageCount: number;
  showDirectMessages?: boolean;
}) {
  if ((showDirectMessages ? dmMessageCount : 0) <= 0 && channelMessageCount <= 0) {
    return null;
  }

  return (
    <div className="px-5 py-3 border-b border-border">
      <SectionLabel>{t('contact_messages')}</SectionLabel>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {showDirectMessages && dmMessageCount > 0 && (
          <InfoItem label={t('contact_direct_messages')} value={dmMessageCount.toLocaleString()} />
        )}
        {channelMessageCount > 0 && (
          <InfoItem
            label={t('contact_channel_messages')}
            value={channelMessageCount.toLocaleString()}
          />
        )}
      </div>
    </div>
  );
}

export function MostActiveChannelsSection({
  t,
  channels,
  onNavigateToChannel,
}: {
  t: TFn;
  channels: ContactActiveRoom[];
  onNavigateToChannel?: (channelKey: string) => void;
}) {
  if (channels.length === 0) {
    return null;
  }

  return (
    <div className="px-5 py-3 border-b border-border">
      <SectionLabel>{t('contact_most_active_channels')}</SectionLabel>
      <div className="space-y-1">
        {channels.map((channel) => (
          <div key={channel.channel_key} className="flex justify-between items-center text-sm">
            <span
              className={
                onNavigateToChannel
                  ? 'cursor-pointer hover:text-primary transition-colors truncate'
                  : 'truncate'
              }
              role={onNavigateToChannel ? 'button' : undefined}
              tabIndex={onNavigateToChannel ? 0 : undefined}
              onKeyDown={onNavigateToChannel ? handleKeyboardActivate : undefined}
              onClick={() => onNavigateToChannel?.(channel.channel_key)}
            >
              {channel.channel_name.startsWith('#') || isPublicChannelKey(channel.channel_key)
                ? channel.channel_name
                : `#${channel.channel_name}`}
            </span>
            <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
              {t('common_msg_count', {
                count: channel.message_count,
                n: channel.message_count.toLocaleString(),
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityChartsSection({
  analytics,
  ready,
  t,
}: {
  analytics: ContactAnalytics | null;
  ready: boolean;
  t: TFn;
}) {
  if (!analytics) {
    return null;
  }

  const hasHourlyActivity = analytics.hourly_activity.some(
    (bucket) =>
      bucket.last_24h_count > 0 || bucket.last_week_average > 0 || bucket.all_time_average > 0
  );
  const hasWeeklyActivity = analytics.weekly_activity.some((bucket) => bucket.message_count > 0);
  if (!hasHourlyActivity && !hasWeeklyActivity) {
    return null;
  }

  return (
    <div className="px-5 py-3 border-b border-border space-y-4">
      {hasHourlyActivity && (
        <div>
          <SectionLabel>{t('contact_messages_per_hour')}</SectionLabel>
          <ActivityLineChart
            ready={ready}
            ariaLabel={t('a11y_messages_per_hour')}
            points={analytics.hourly_activity}
            series={[
              { key: 'last_24h_count', color: '#2563eb', label: t('common_last_24h') },
              { key: 'last_week_average', color: '#ea580c', label: t('contact_7_day_avg') },
              { key: 'all_time_average', color: '#64748b', label: t('contact_all_time_avg') },
            ]}
            legendItems={[
              { label: t('common_last_24h'), color: '#2563eb' },
              { label: t('contact_7_day_avg'), color: '#ea580c' },
              { label: t('contact_all_time_avg'), color: '#64748b' },
            ]}
            valueFormatter={(value) => value.toFixed(value % 1 === 0 ? 0 : 1)}
            tickFormatter={(bucket) =>
              formatDateTime(new Date(bucket.bucket_start * 1000), {
                hour: '2-digit',
                minute: '2-digit',
              })
            }
          />
        </div>
      )}

      {hasWeeklyActivity && (
        <div>
          <SectionLabel>{t('contact_messages_per_week')}</SectionLabel>
          <ActivityLineChart
            ready={ready}
            ariaLabel={t('a11y_messages_per_week')}
            points={analytics.weekly_activity}
            series={[{ key: 'message_count', color: '#16a34a', label: t('contact_messages') }]}
            valueFormatter={(value) => value.toFixed(0)}
            tickFormatter={(bucket) =>
              formatDateTime(new Date(bucket.bucket_start * 1000), {
                month: 'short',
                day: 'numeric',
              })
            }
          />
        </div>
      )}

      <p className="text-[0.6875rem] text-muted-foreground">
        {t('contact_hourly_lines_help')}
        {!analytics.includes_direct_messages && t('contact_name_only_note')}
      </p>
    </div>
  );
}

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '6px',
    fontSize: '11px',
    color: 'hsl(var(--popover-foreground))',
  },
  itemStyle: { color: 'hsl(var(--popover-foreground))' },
  labelStyle: { color: 'hsl(var(--muted-foreground))' },
} as const;

const ACTIVITY_CHART_HEIGHT = 140;
const INDEX_MIN_SPAN = 2; // smallest zoom window, in buckets
const TIME_MIN_SPAN = 30; // smallest zoom window, in seconds

function ActivityLineChart<T extends ContactAnalyticsHourlyBucket | ContactAnalyticsWeeklyBucket>({
  ready,
  ariaLabel,
  points,
  series,
  legendItems,
  tickFormatter,
  valueFormatter,
}: {
  ready: boolean;
  ariaLabel: string;
  points: T[];
  series: Array<{ key: keyof T; color: string; label?: string }>;
  legendItems?: Array<{ label: string; color: string }>;
  tickFormatter: (point: T) => string;
  valueFormatter: (value: number) => string;
}) {
  // Reserve the chart's height while the pane animates in (see #317).
  if (!ready) {
    return <div role="img" aria-label={ariaLabel} style={{ height: ACTIVITY_CHART_HEIGHT }} />;
  }

  const data = points.map((point, i) => {
    const entry: Record<string, string | number> = { idx: i, tick: tickFormatter(point) };
    for (const s of series) {
      const raw = point[s.key];
      entry[String(s.key)] = typeof raw === 'number' ? raw : 0;
    }
    return entry;
  });

  const tickCount = Math.min(5, points.length);
  const tickIndices: number[] = [];
  if (points.length > 1) {
    for (let i = 0; i < tickCount; i++) {
      tickIndices.push(Math.round((i / (tickCount - 1)) * (points.length - 1)));
    }
  }

  return (
    <div role="img" aria-label={ariaLabel}>
      <ZoomableChart
        full={[0, Math.max(1, points.length - 1)]}
        minSpan={INDEX_MIN_SPAN}
        disabled={points.length < 2}
        inset={{ left: 24, right: 4 }}
      >
        {({ domain, isPanning }) => (
          <ResponsiveContainer width="100%" height={ACTIVITY_CHART_HEIGHT}>
            <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="idx"
                type="number"
                allowDataOverflow
                domain={domain}
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                ticks={tickIndices}
                tickFormatter={(idx) => String(data[idx]?.tick ?? '')}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => valueFormatter(v)}
                width={40}
              />
              {!isPanning && (
                <RechartsTooltip
                  {...TOOLTIP_STYLE}
                  cursor={{
                    stroke: 'hsl(var(--muted-foreground))',
                    strokeWidth: 1,
                    strokeDasharray: '3 3',
                  }}
                  labelFormatter={(idx) => String(data[Number(idx)]?.tick ?? '')}
                  formatter={(value, name) => {
                    const match = series.find((s) => String(s.key) === name);
                    return [valueFormatter(Number(value)), match?.label ?? String(name)];
                  }}
                />
              )}
              {legendItems && (
                <Legend
                  content={() => (
                    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-1 text-[0.6875rem] text-muted-foreground">
                      {legendItems.map((item) => (
                        <span key={item.label} className="inline-flex items-center gap-1.5">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                          {item.label}
                        </span>
                      ))}
                    </div>
                  )}
                />
              )}
              {series.map((entry) => (
                <Line
                  key={String(entry.key)}
                  type="linear"
                  dataKey={String(entry.key)}
                  stroke={entry.color}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--popover))' }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ZoomableChart>
    </div>
  );
}

function NearbyRepeatersSection({
  t,
  contact,
  contacts,
  distanceUnit,
}: {
  t: TFn;
  contact: Contact;
  contacts: Contact[];
  distanceUnit: import('../utils/distanceUnits').DistanceUnit;
}) {
  const nearby = useMemo(() => {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    const results: Array<{ name: string; publicKey: string; distance: number }> = [];
    for (const other of contacts) {
      const heardAt = Math.max(other.last_seen ?? 0, other.last_advert ?? 0);
      if (
        other.public_key === contact.public_key ||
        other.type !== CONTACT_TYPE_REPEATER ||
        !isValidLocation(other.lat, other.lon) ||
        heardAt < sevenDaysAgo
      ) {
        continue;
      }
      const dist = calculateDistance(contact.lat, contact.lon, other.lat, other.lon);
      if (dist !== null) {
        results.push({
          name: getContactDisplayName(other.name, other.public_key, other.last_advert),
          publicKey: other.public_key,
          distance: dist,
        });
      }
    }
    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, 5);
  }, [contact.public_key, contact.lat, contact.lon, contacts]);

  if (nearby.length === 0) return null;

  return (
    <div className="px-5 py-3 border-b border-border">
      <SectionLabel>{t('contact_nearest_repeaters_geo')}</SectionLabel>
      <div className="space-y-1">
        {nearby.map((r) => (
          <div key={r.publicKey} className="flex justify-between items-center text-sm">
            <span className="truncate">{r.name}</span>
            <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
              {formatDistance(r.distance, distanceUnit)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Group membership editor shared by contact info (here) and channel info
 * (ChannelInfoPane): a checkbox per existing group plus an inline "create a
 * new group and add this item" row. Membership is a full-list toggle (see
 * utils/sidebarLayout toggleGroupMember) handed to the caller, which persists
 * it server-side (app_settings.contact_groups).
 */
function ContactGroupsSection({
  t,
  contactKey,
  contactGroups,
  onUpdateContactGroups,
}: {
  t: TFn;
  contactKey: string;
  contactGroups: ContactGroup[];
  onUpdateContactGroups: (next: ContactGroup[]) => void | Promise<void>;
}) {
  const [newGroupName, setNewGroupName] = useState('');
  const normalizedKey = contactKey.toLowerCase();

  const createAndAdd = () => {
    const name = newGroupName.trim();
    if (!name) return;
    const group = createContactGroup(name);
    void onUpdateContactGroups(
      toggleGroupMember([...contactGroups, group], group.id, 'contact', contactKey)
    );
    setNewGroupName('');
  };

  return (
    <div className="px-5 py-3 border-b border-border">
      <SectionLabel>{t('contact_groups_heading')}</SectionLabel>
      {contactGroups.length === 0 ? (
        <p className="text-xs text-muted-foreground mb-2">{t('nav_contact_groups_empty')}</p>
      ) : (
        <div className="space-y-1.5 mb-2">
          {contactGroups.map((group) => (
            <label key={group.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={group.contact_keys.includes(normalizedKey)}
                onChange={() =>
                  void onUpdateContactGroups(
                    toggleGroupMember(contactGroups, group.id, 'contact', contactKey)
                  )
                }
                className="h-4 w-4 rounded border-input"
              />
              <span className="truncate">{group.name}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') createAndAdd();
          }}
          placeholder={t('nav_group_name_placeholder')}
          aria-label={t('nav_group_name_placeholder')}
          className="w-full text-sm rounded border border-border bg-background px-2 py-1"
        />
        <button
          type="button"
          className="text-xs px-2 py-1 rounded border border-border hover:bg-accent transition-colors whitespace-nowrap disabled:opacity-50"
          disabled={!newGroupName.trim()}
          onClick={createAndAdd}
        >
          {t('contact_group_create_and_add')}
        </button>
      </div>
    </div>
  );
}

/**
 * "Resolve name from analyzer" (plan 16 case (a)): for a contact known only by
 * its full public key. The server checks the synced external map first, then
 * the analyzer sites that opted in to name resolution, and applies the name.
 */
function ResolveNameButton({ publicKey, t }: { publicKey: string; t: TFn }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const result = await api.resolveContactName(publicKey);
      const source = result.source ?? '';
      if (result.status === 'resolved') {
        toast.success(t('contact_resolve_name_resolved', { name: result.name ?? '', source }));
      } else if (result.status === 'not_found') {
        toast.info(t('contact_resolve_name_not_found', { source }));
      } else if (result.status === 'no_sources') {
        toast.info(t('contact_resolve_name_no_sources'));
      } else {
        toast.info(t('contact_resolve_name_already_named'));
      }
    } catch {
      toast.error(t('contact_resolve_name_failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-5 py-3 border-b border-border">
      <button
        type="button"
        className="text-sm flex items-center gap-2 hover:text-primary transition-colors disabled:opacity-50"
        disabled={busy}
        onClick={() => void run()}
        title={t('contact_resolve_name_hint')}
      >
        <Search className="h-4.5 w-4.5 text-muted-foreground" aria-hidden="true" />
        <span>{busy ? t('contact_resolve_name_busy') : t('contact_resolve_name_button')}</span>
      </button>
    </div>
  );
}

function ContactAnnotations({
  contact,
  contacts,
  ownPublicKey = null,
  t,
  onOpenContact,
  onOpenConversation,
}: {
  contact: Contact;
  contacts: Contact[];
  /** The connected radio's public key: allowed as owner (sidebar "Owned" section). */
  ownPublicKey?: string | null;
  t: TFn;
  onOpenContact?: (publicKey: string) => void;
  onOpenConversation?: (publicKey: string) => void;
}) {
  const [notes, setNotes] = useState(contact.notes ?? '');
  const [ownerInfo, setOwnerInfo] = useState(contact.owner_info ?? '');
  const [ownerKey, setOwnerKey] = useState(contact.owner_key ?? '');
  const [manualLat, setManualLat] = useState(
    contact.manual_lat != null ? String(contact.manual_lat) : ''
  );
  const [manualLon, setManualLon] = useState(
    contact.manual_lon != null ? String(contact.manual_lon) : ''
  );
  const [batteryChemistry, setBatteryChemistry] = useState(contact.battery_chemistry ?? '');

  // Re-seed local state when the pane switches contact or the row updates over WS.
  useEffect(() => {
    setNotes(contact.notes ?? '');
    setOwnerInfo(contact.owner_info ?? '');
    setOwnerKey(contact.owner_key ?? '');
    setManualLat(contact.manual_lat != null ? String(contact.manual_lat) : '');
    setManualLon(contact.manual_lon != null ? String(contact.manual_lon) : '');
    setBatteryChemistry(contact.battery_chemistry ?? '');
  }, [
    contact.public_key,
    contact.notes,
    contact.owner_info,
    contact.owner_key,
    contact.manual_lat,
    contact.manual_lon,
    contact.battery_chemistry,
  ]);

  const ownerContact = ownerKey ? (contacts.find((c) => c.public_key === ownerKey) ?? null) : null;
  const ownedNodes = useMemo(
    () => contacts.filter((c) => c.owner_key === contact.public_key),
    [contacts, contact.public_key]
  );
  const ownKey = ownPublicKey ? ownPublicKey.toLowerCase() : null;
  const ownerIsOwnRadio = ownKey !== null && ownerKey === ownKey;
  const ownerKnown =
    ownerKey === '' || ownerIsOwnRadio || contacts.some((c) => c.public_key === ownerKey);
  const canUseOwnKey = ownKey !== null && ownKey !== contact.public_key && ownerKey !== ownKey;

  const save = async (update: ContactAnnotationsUpdate) => {
    try {
      await api.updateContactAnnotations(contact.public_key, update);
      toast.success(t('contact_annotations_saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('contact_annotations_save_failed'));
    }
  };

  return (
    <div className="px-5 py-3 border-b border-border space-y-4">
      {/* Notes */}
      <div>
        <label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
          {t('contact_notes_label')}
        </label>
        <textarea
          aria-label={t('contact_notes_label')}
          className="w-full text-sm rounded border border-border bg-background p-2 min-h-16"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <button
          type="button"
          className="mt-1 text-xs px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors"
          onClick={() => save({ notes: notes.trim() === '' ? null : notes })}
        >
          {t('contact_notes_save')}
        </button>
      </div>

      {/* Owner info (free text; may be auto-filled from CLI) */}
      <div>
        <label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
          {t('contact_owner_info_label')}
        </label>
        <input
          type="text"
          aria-label={t('contact_owner_info_label')}
          className="w-full text-sm rounded border border-border bg-background p-2"
          value={ownerInfo}
          onChange={(e) => setOwnerInfo(e.target.value)}
        />
        <button
          type="button"
          className="mt-1 text-xs px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors"
          onClick={() => save({ owner_info: ownerInfo.trim() === '' ? null : ownerInfo })}
        >
          {t('contact_owner_info_save')}
        </button>
      </div>

      {/* Owner pubkey (existing contact); link opens the DM conversation */}
      <div>
        <label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
          {t('contact_owner_label')}
        </label>
        {ownerContact && onOpenConversation ? (
          <button
            type="button"
            className="text-sm text-primary underline"
            onClick={() => onOpenConversation(ownerContact.public_key)}
            title={t('contact_owner_open_dm')}
          >
            {getContactDisplayName(
              ownerContact.name,
              ownerContact.public_key,
              ownerContact.last_advert
            )}
          </button>
        ) : ownerIsOwnRadio ? (
          <span className="text-sm">{t('contact_owner_own_radio')}</span>
        ) : ownerKey ? (
          <span className="text-sm font-mono break-all">{ownerKey}</span>
        ) : null}
        <input
          type="text"
          placeholder={t('contact_owner_placeholder')}
          className="w-full text-sm rounded border border-border bg-background p-2 mt-1 font-mono"
          value={ownerKey}
          onChange={(e) => setOwnerKey(e.target.value.trim().toLowerCase())}
        />
        {!ownerKnown && (
          <p className="text-xs text-destructive mt-0.5">{t('contact_owner_unknown')}</p>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors disabled:opacity-50"
            disabled={!ownerKnown}
            onClick={() => save({ owner_key: ownerKey === '' ? null : ownerKey })}
          >
            {t('contact_owner_save')}
          </button>
          {canUseOwnKey && (
            <button
              type="button"
              className="text-xs px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors"
              onClick={() => setOwnerKey(ownKey)}
              title={t('contact_owner_use_own_radio_hint')}
            >
              {t('contact_owner_use_own_radio')}
            </button>
          )}
        </div>
      </div>

      {/* Owned nodes (reverse link) */}
      {ownedNodes.length > 0 && (
        <div>
          <SectionLabel>{t('contact_owned_nodes')}</SectionLabel>
          <div className="space-y-1">
            {ownedNodes.map((n) => (
              <button
                key={n.public_key}
                type="button"
                className="block text-sm text-primary hover:underline truncate"
                onClick={() => onOpenContact?.(n.public_key)}
              >
                {getContactDisplayName(n.name, n.public_key, n.last_advert)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Manual location (fallback) */}
      <div>
        <label className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium block mb-1">
          {t('contact_manual_location_label')}
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            step="any"
            placeholder={t('contact_manual_lat')}
            className="w-full text-sm rounded border border-border bg-background p-2"
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
          />
          <input
            type="number"
            step="any"
            placeholder={t('contact_manual_lon')}
            className="w-full text-sm rounded border border-border bg-background p-2"
            value={manualLon}
            onChange={(e) => setManualLon(e.target.value)}
          />
        </div>
        <div className="flex gap-2 mt-1">
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors"
            onClick={() =>
              save({
                manual_lat: manualLat.trim() === '' ? null : Number(manualLat),
                manual_lon: manualLon.trim() === '' ? null : Number(manualLon),
              })
            }
          >
            {t('contact_manual_location_save')}
          </button>
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors"
            onClick={() => {
              setManualLat('');
              setManualLon('');
              save({ manual_lat: null, manual_lon: null });
            }}
          >
            {t('common_clear')}
          </button>
        </div>
      </div>

      {/* Battery chemistry override (null = use the global default in Settings) */}
      <div>
        <label
          htmlFor={`battery-chemistry-${contact.public_key}`}
          className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium block mb-1"
        >
          {t('contact_battery_chemistry_label')}
        </label>
        <select
          id={`battery-chemistry-${contact.public_key}`}
          className="w-full text-sm rounded border border-border bg-background p-2"
          value={batteryChemistry}
          onChange={(e) => {
            const value = e.target.value as '' | 'lipo' | 'lifepo4' | 'lipo_hv' | 'nmc';
            setBatteryChemistry(value);
            save({ battery_chemistry: value === '' ? null : value });
          }}
        >
          <option value="">{t('contact_battery_chemistry_global_default')}</option>
          <option value="lipo">{t('settings_battery_chemistry_lipo')}</option>
          <option value="lifepo4">{t('settings_battery_chemistry_lifepo4')}</option>
          <option value="lipo_hv">{t('settings_battery_chemistry_lipo_hv')}</option>
          <option value="nmc">{t('settings_battery_chemistry_nmc')}</option>
        </select>
        <p className="text-xs text-muted-foreground mt-1">
          {t('contact_battery_chemistry_description')}
        </p>
      </div>
    </div>
  );
}

export function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground text-xs">{label}</span>
      <p className="font-medium text-sm leading-tight">{value}</p>
    </div>
  );
}

// Stable color rotation for dynamic LPP sensors in the history chart
const LPP_CHART_COLORS = ['#22c55e', '#8b5cf6', '#0ea5e9', '#ef4444', '#f59e0b', '#ec4899'];

function ContactTelemetrySection({
  t,
  contact,
  loading,
  onFetch,
  telemetryHistory,
  isTracked,
  onToggleTracked,
}: {
  t: TFn;
  contact: Contact;
  loading: boolean;
  onFetch: () => void;
  telemetryHistory: TelemetryHistoryEntry[];
  isTracked: boolean;
  onToggleTracked?: (publicKey: string) => Promise<void>;
}) {
  const { distanceUnit } = useDistanceUnit();
  const coordinateFormat = useCoordinateFormat();
  const [expanded, setExpanded] = useState(true);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Latest telemetry snapshot from history
  const latestEntry =
    telemetryHistory.length > 0 ? telemetryHistory[telemetryHistory.length - 1] : null;
  const sensors: LppSensor[] = useMemo(() => {
    if (!latestEntry?.data?.lpp_sensors) return [];
    return latestEntry.data.lpp_sensors.map((s: TelemetryLppSensor) => ({
      channel: s.channel,
      type_name: s.type_name,
      value: s.value,
    }));
  }, [latestEntry]);
  const fetchedAt = latestEntry?.timestamp ?? null;

  // Extract GPS from sensors
  const gpsSensor = sensors.find(
    (s) => s.type_name === 'gps' && typeof s.value === 'object' && s.value !== null
  );
  const gpsValue = gpsSensor?.value as Record<string, number> | undefined;
  const hasGps =
    gpsValue != null &&
    typeof gpsValue.latitude === 'number' &&
    typeof gpsValue.longitude === 'number';

  // Non-GPS sensors for display
  const displaySensors = sensors.filter((s) => s.type_name !== 'gps');

  // Build disambiguated labels
  const labels = useMemo(() => {
    const counts = new Map<string, number>();
    return displaySensors.map((s) => {
      const base = `${s.type_name}_${s.channel}`;
      const n = (counts.get(base) ?? 0) + 1;
      counts.set(base, n);
      return formatLppLabel(s.type_name) + (n > 1 ? ` (${n})` : '');
    });
  }, [displaySensors]);

  // Discover unique LPP sensor series from history for charting
  const sensorSeries = useMemo(() => {
    const seen = new Map<string, { type_name: string; channel: number }>();
    for (const entry of telemetryHistory) {
      for (const s of entry.data?.lpp_sensors ?? []) {
        if (typeof s.value !== 'number') continue;
        const key = `${s.type_name}_ch${s.channel}`;
        if (!seen.has(key)) seen.set(key, { type_name: s.type_name, channel: s.channel });
      }
    }
    return Array.from(seen.entries()).map(([key, info], i) => ({
      key,
      label: formatLppLabel(info.type_name),
      color: LPP_CHART_COLORS[i % LPP_CHART_COLORS.length],
      ...info,
    }));
  }, [telemetryHistory]);

  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
  const activeMetric = selectedMetric ?? (sensorSeries.length > 0 ? sensorSeries[0].key : null);

  // Build chart data for selected metric
  const chartData = useMemo(() => {
    if (!activeMetric) return [];
    const series = sensorSeries.find((s) => s.key === activeMetric);
    if (!series) return [];
    return telemetryHistory
      .filter((e) => e.data?.lpp_sensors)
      .map((e) => {
        const sensor = (e.data.lpp_sensors ?? []).find(
          (s: TelemetryLppSensor) =>
            s.type_name === series.type_name && s.channel === series.channel
        );
        return {
          time: e.timestamp,
          value: sensor && typeof sensor.value === 'number' ? sensor.value : null,
        };
      })
      .filter((d) => d.value !== null);
  }, [telemetryHistory, activeMetric, sensorSeries]);

  const activeSeries = sensorSeries.find((s) => s.key === activeMetric);

  const telemetryFull = useMemo<ChartWindow>(() => {
    if (chartData.length === 0) return [0, 0];
    let lo = chartData[0].time;
    let hi = chartData[0].time;
    for (const d of chartData) {
      if (d.time < lo) lo = d.time;
      if (d.time > hi) hi = d.time;
    }
    return [lo, hi];
  }, [chartData]);

  return (
    <div className="px-5 py-3 border-b border-border">
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-1.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t('contact_telemetry')}
        </button>
        <button
          type="button"
          onClick={onFetch}
          disabled={loading}
          className="text-xs px-2 py-0.5 rounded border border-border hover:bg-accent disabled:opacity-50 transition-colors flex items-center gap-1"
        >
          <Activity className="h-3 w-3" />
          {loading ? t('contact_fetching') : t('contact_request')}
        </button>
      </div>

      {expanded && (
        <div className="mt-2">
          {sensors.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">
              {fetchedAt ? t('contact_no_sensor_data') : t('contact_not_yet_fetched')}
            </p>
          ) : (
            <>
              <div className="space-y-0.5">
                {displaySensors.map((sensor, i) => (
                  <LppSensorRow
                    key={`${sensor.type_name}-${sensor.channel}-${i}`}
                    sensor={sensor}
                    unitPref={distanceUnit}
                    label={labels[i]}
                  />
                ))}
              </div>

              {hasGps && (
                <div className="mt-2">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                    onClick={() => setMapExpanded(!mapExpanded)}
                  >
                    {mapExpanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {t('contact_gps_position', {
                      position: formatCoordinates(
                        gpsValue!.latitude,
                        gpsValue!.longitude,
                        coordinateFormat
                      ),
                    })}
                  </button>
                  {mapExpanded && (
                    <div className="mt-1 h-48 overflow-hidden rounded border border-border">
                      <ContactGpsMap
                        lat={gpsValue!.latitude}
                        lon={gpsValue!.longitude}
                        label={contact.name ?? contact.public_key.slice(0, 12)}
                      />
                    </div>
                  )}
                </div>
              )}

              {fetchedAt && (
                <p className="text-[0.6875rem] text-muted-foreground mt-1.5">
                  {t('contact_fetched_at', { time: formatTime(fetchedAt) })}
                </p>
              )}
            </>
          )}

          {/* History chart */}
          {telemetryHistory.length > 1 && sensorSeries.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                onClick={() => setChartExpanded(!chartExpanded)}
              >
                {chartExpanded ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {t('contact_telemetry_history_samples', { count: telemetryHistory.length })}
              </button>
              {chartExpanded && (
                <div className="mt-1">
                  <div className="flex flex-wrap gap-1 mb-2">
                    {sensorSeries.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setSelectedMetric(s.key)}
                        className={`text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors ${
                          activeMetric === s.key
                            ? 'bg-primary/10 text-primary'
                            : 'bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {chartData.length > 1 && activeSeries && (
                    <ZoomableChart
                      full={telemetryFull}
                      minSpan={TIME_MIN_SPAN}
                      inset={{ left: 40, right: 4 }}
                    >
                      {({ domain, isPanning }) => (
                        <ResponsiveContainer width="100%" height={120}>
                          <AreaChart data={chartData}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke="hsl(var(--border))"
                              vertical={false}
                            />
                            <XAxis
                              dataKey="time"
                              type="number"
                              allowDataOverflow
                              domain={domain}
                              tickFormatter={(timestamp: number) => {
                                const d = new Date(timestamp * 1000);
                                return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
                              }}
                              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                              tickLine={false}
                              axisLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                              tickLine={false}
                              axisLine={false}
                              width={40}
                            />
                            {!isPanning && (
                              <RechartsTooltip
                                {...TOOLTIP_STYLE}
                                labelFormatter={(timestamp) =>
                                  formatDateTime(new Date(Number(timestamp) * 1000), {
                                    year: 'numeric',
                                    month: 'numeric',
                                    day: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                    second: '2-digit',
                                  })
                                }
                              />
                            )}
                            <Area
                              type="monotone"
                              dataKey="value"
                              name={activeSeries.label}
                              stroke={activeSeries.color}
                              fill={activeSeries.color}
                              fillOpacity={0.15}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </ZoomableChart>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tracking toggle */}
          {onToggleTracked && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <button
                type="button"
                disabled={toggling}
                onClick={async () => {
                  setToggling(true);
                  try {
                    await onToggleTracked(contact.public_key);
                  } finally {
                    setToggling(false);
                  }
                }}
                className={`text-xs px-2 py-1 rounded border transition-colors w-full ${
                  isTracked
                    ? 'border-destructive/50 text-destructive hover:bg-destructive/10'
                    : 'border-green-600/50 text-green-600 hover:bg-green-600/10'
                } disabled:opacity-50`}
              >
                {toggling
                  ? t('contact_updating')
                  : isTracked
                    ? t('contact_stop_tracking_telemetry')
                    : t('contact_track_telemetry_interval')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
