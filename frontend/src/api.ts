import type {
  RelayDetailResponse,
  RelayReceptionResponse,
} from './components/MeshRelayReceptionPanel';
import type {
  AdvertLinkEdge,
  AntennaRegisterSite,
  AntennaRegisterSiteSummary,
  AntennaRegisterStatus,
  ContactLocationHistoryEntry,
  ContactRouteSuggestions,
  DeviceConfigHistoryEntry,
  LinkPacketRow,
  LinkSummary,
  LinkTimeseries,
  TrafficLinkEdge,
  AppSettings,
  BackupFilesResponse,
  BotListEntry,
  BotListPreview,
  BotListsState,
  FilterProfileChanges,
  FilterProfileKind,
  FilterProfilesState,
  RestoreStatus,
  AppSettingsUpdate,
  PacketHistoryResponse,
  PacketWhoHeard,
  UrlPreview,
  TileAreaEstimate,
  TileAreaRequest,
  TileCacheConfig,
  TileCacheConfigUpdate,
  TileCacheStats,
  TileDownloadStatus,
  ExternalMapNode,
  ExternalMapStatus,
  PartialResolutionPreview,
  PartialResolutionApplyItem,
  PartialNodeResolution,
  BulkCreateHashtagChannelsResult,
  ChannelImportResult,
  ChannelSet,
  ChannelSetApplyResult,
  Community,
  CommunityExport,
  CommunityHashtagResult,
  CommunityJoinResult,
  Channel,
  ChannelDetail,
  ChannelUnreadSummary,
  CommandResponse,
  BulkDeleteContactsResult,
  Contact,
  ContactAnalytics,
  ContactDeleteResult,
  ContactAdvertPathSummary,
  LatestTelemetry,
  ContactRadioResidency,
  ContactTelemetryPermissions,
  ContactTelemetryResponse,
  RadioCliResponse,
  RadioContactOccupancy,
  SensorMmaResponse,
  SensorPushState,
  SensorPushThreshold,
  RadioPolicy,
  FanoutConfig,
  FleetAsset,
  FleetAssetEvent,
  FleetAssetEventInput,
  FleetAssetFields,
  FleetAssetsFromContactsResponse,
  FleetAuditEntry,
  FleetConfig,
  FleetConfigExport,
  FleetConfigImportInput,
  FleetConfigImportResult,
  FleetConfigReported,
  FleetDeviceReadStep,
  FleetDeviceReadStoreResult,
  FleetDeviceReplies,
  FleetApplyCheck,
  FleetApplyLogInput,
  FleetApplyPlan,
  FleetApplyStep,
  FleetConfigSummary,
  FleetConfigTemplate,
  FleetConfigTemplateFields,
  FleetGenerateKeyResult,
  FleetSecret,
  FleetSecretKind,
  FleetSettings,
  FleetVaultSession,
  FleetVaultStatus,
  HealthStatus,
  MaintenanceResult,
  RetentionPruneResult,
  RetentionStats,
  MeshcomodConfig,
  MeshcomodConfigUpdate,
  CompanionFilterHistory,
  CompanionFilterRule,
  CompanionFilterRuleKind,
  CompanionFilterSettingsUpdate,
  CompanionFilterState,
  GpsConfig,
  GpsConfigUpdate,
  Message,
  OpenHopStatus,
  HostRepeaterSettings,
  HostRepeaterState,
  HostRepeaterStats,
  HostRepeaterValidateResult,
  SpamGuardActionResult,
  SpamGuardReplayRequest,
  SpamGuardReplayResult,
  SpamGuardMetrics,
  SpamGuardRules,
  SpamKnownList,
  SpamGuardSettings,
  SpamGuardState,
  OpenHopEnvelope,
  OpenHopGroupKind,
  OpenHopPolicyDoc,
  OpenHopPolicyEngine,
  OpenHopPlugin,
  OpenHopCatalogueEntry,
  OpenHopConfigExport,
  OpenHopValidateResult,
  OpenHopModeResult,
  OpenHopRadioResult,
  OpenHopImportResult,
  OpenHopRestartResult,
  OpenHopHardwareOption,
  OpenHopRadioPreset,
  OpenHopUpdateStatus,
  OpenHopUpdateChannels,
  OpenHopChangelog,
  OpenHopCadResult,
  OpenHopCadManualCheckParams,
  OpenHopHardwareStats,
  OpenHopAnalyticsResult,
  OpenHopTransportKeys,
  OpenHopNeighborScopes,
  OpenHopMqttStatus,
  OpenHopMqttConfigBody,
  MessagesAroundResponse,
  ReactionTargetResponse,
  SharedLocationsResponse,
  TeamBeaconsResponse,
  RawPacket,
  RadioAdvertMode,
  RadioConfig,
  RadioConfigUpdate,
  RadioDiscoveryResponse,
  RadioPresetsStore,
  RadioRegionDiscoveryResponse,
  RadioTraceHopRequest,
  RadioTraceResponse,
  RadioDiscoveryTarget,
  RadioIdentity,
  RadioIdentityList,
  RadioStatFilter,
  PathDiscoveryResponse,
  PushSubscriptionInfo,
  ResendChannelMessageResponse,
  ResendDirectMessageResponse,
  RepeaterAclResponse,
  RepeaterAdvertIntervalsResponse,
  RepeaterLoginResponse,
  RepeaterLppTelemetryResponse,
  RepeaterNeighborHistoryResponse,
  RepeaterNeighborsResponse,
  RepeaterNodeInfoResponse,
  RepeaterOwnerInfoResponse,
  ContactAnnotationsUpdate,
  ResolveNameResponse,
  ResolveNamesBulkResponse,
  RepeaterRadioSettingsResponse,
  RepeaterRegionsResponse,
  RepeaterSettingSetResponse,
  RepeaterSettingsReadResponse,
  ContactSnmpConfig,
  ContactSnmpConfigUpdate,
  SnmpPollResponse,
  SnmpHistoryEntry,
  SnmpNodeOverview,
  SnmpAgentSettings,
  SnmpAgentState,
  SnmpDiscoverAddressResponse,
  LanScanRequest,
  LanScanStatus,
  LanScanSuggestions,
  RepeaterStatusResponse,
  TelemetryHistoryEntry,
  TelemetrySchedule,
  TrackedTelemetryContactsResponse,
  TrackedTelemetryResponse,
  BatteryHistoryStats,
  AirtimeSample,
  RadioDefaultFloodScope,
  BatterySample,
  NoiseFloorSample,
  RawFeedHistoricalStats,
  StatisticsResponse,
  TraceResponse,
  UnreadCounts,
  UpdateStatus,
  WordlistMeta,
  MentionSoundMeta,
} from './types';
import { reportHttpFailure } from './utils/authRedirect';
import { fleetVaultHeaders } from './utils/fleetVault';

const API_BASE = './api';

type LinkWindow = { since?: number | null; until?: number | null };

function setWindow(qs: URLSearchParams, w: LinkWindow): void {
  if (w.since != null) qs.set('since', String(Math.floor(w.since)));
  if (w.until != null) qs.set('until', String(Math.floor(w.until)));
}

function withQuery(path: string, qs: URLSearchParams): string {
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

/** Error thrown by API calls, carrying the HTTP status so callers can tell
 * retryable failures from ones the mesh already answered (e.g. 422 timeouts). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** The parsed FastAPI `detail` when it was a structured object (e.g. `{message, blockers}`). */
    public readonly detail?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Query suffix selecting whose samples a My Node stat read returns (plan 18). */
function radioStatQuery(filter?: RadioStatFilter): string {
  if (!filter) return '';
  if ('unassigned' in filter) return '&unassigned=true';
  return `&radio_id=${filter.radioId}`;
}

/**
 * A FastAPI validation error as one line: each problem as "field: message".
 * The field is the last name in `loc`; "body" and list indexes say little.
 */
function validationText(detail: unknown[]): string {
  return detail
    .map((item) => {
      if (typeof item === 'string') return item;
      const { loc, msg } = (item ?? {}) as { loc?: unknown; msg?: unknown };
      if (typeof msg !== 'string') return JSON.stringify(item);
      const text = msg.replace(/^Value error, /, '');
      const field = Array.isArray(loc)
        ? [...loc].reverse().find((part) => typeof part === 'string' && part !== 'body')
        : undefined;
      return typeof field === 'string' ? `${field}: ${text}` : text;
    })
    .join('; ');
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body !== undefined;
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      ...(hasBody && { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const errorText = await res.text();
    // FastAPI returns errors as {"detail": "message"}, extract the message
    let errorMessage = errorText || res.statusText;
    let errorDetail: Record<string, unknown> | undefined;
    try {
      const errorJson = JSON.parse(errorText);
      if (typeof errorJson.detail?.message === 'string') {
        // Structured detail, e.g. {"detail": {"message": "...", ...}}
        errorMessage = errorJson.detail.message;
        errorDetail = errorJson.detail;
      } else if (Array.isArray(errorJson.detail)) {
        // A validation error (422) is a list of {loc, msg}.
        errorMessage = validationText(errorJson.detail) || errorMessage;
      } else if (typeof errorJson.detail === 'string') {
        if (errorJson.detail) errorMessage = errorJson.detail;
      } else if (errorJson.detail) {
        // Never let an object reach a toast as "[object Object]".
        errorMessage = JSON.stringify(errorJson.detail);
      }
    } catch {
      // Not JSON, use raw text
    }
    // A reverse proxy whose session ran out answers instead of the backend.
    reportHttpFailure(res.status, errorText);
    throw new ApiError(errorMessage, res.status, errorDetail);
  }
  return res.json();
}

/** Check if an error is an AbortError (request was cancelled) */
export function isAbortError(err: unknown): boolean {
  // DOMException is thrown by fetch when aborted, and it's not an Error subclass
  if (err instanceof DOMException && err.name === 'AbortError') {
    return true;
  }
  // Also check for Error with AbortError name (for compatibility)
  return err instanceof Error && err.name === 'AbortError';
}

interface DecryptResult {
  started: boolean;
  total_packets: number;
  message: string;
}

/** meshcore:// contact link exported from the radio. */
export interface ContactUriResult {
  uri: string;
  public_key: string;
}

/** meshcore:// links built from stored raw adverts (no radio command). */
export interface ContactUriBatchResult {
  links: Record<string, string>;
}

interface BackupSaveResult {
  path: string;
  size_bytes: number;
  timestamp: string;
}

export const api = {
  // Health
  getHealth: () => fetchJson<HealthStatus>('/health'),

  // Update check
  getUpdateStatus: (force = false) =>
    fetchJson<UpdateStatus>(`/update-status${force ? '?force=true' : ''}`),

  // Radio config
  getRadioConfig: () => fetchJson<RadioConfig>('/radio/config'),
  updateRadioConfig: (config: RadioConfigUpdate) =>
    fetchJson<RadioConfig>('/radio/config', {
      method: 'PATCH',
      body: JSON.stringify(config),
    }),
  // Radio region presets (official MeshCore presets API sync)
  getRadioPresets: () => fetchJson<RadioPresetsStore>('/radio/presets'),
  syncRadioPresets: () =>
    fetchJson<RadioPresetsStore>('/radio/presets/sync', {
      method: 'POST',
    }),
  resetRadioPresets: () =>
    fetchJson<RadioPresetsStore>('/radio/presets', {
      method: 'DELETE',
    }),
  getMeshcomodConfig: () => fetchJson<MeshcomodConfig>('/radio/meshcomod'),
  updateMeshcomodConfig: (update: MeshcomodConfigUpdate) =>
    fetchJson<MeshcomodConfig>('/radio/meshcomod', {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  // meshcomod companion receive filter: every call runs `filter ...` on the
  // radio's own command line (never transmits) and returns the state read back.
  getCompanionFilter: () => fetchJson<CompanionFilterState>('/radio/meshcomod/filter'),
  updateCompanionFilter: (update: CompanionFilterSettingsUpdate) =>
    fetchJson<CompanionFilterState>('/radio/meshcomod/filter', {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  addCompanionFilterPath: (prefix: string) =>
    fetchJson<CompanionFilterState>('/radio/meshcomod/filter/paths', {
      method: 'POST',
      body: JSON.stringify({ prefix }),
    }),
  removeCompanionFilterPath: (prefix: string) =>
    fetchJson<CompanionFilterState>('/radio/meshcomod/filter/paths/remove', {
      method: 'POST',
      body: JSON.stringify({ prefix }),
    }),
  addCompanionFilterRule: (kind: CompanionFilterRuleKind, rule: CompanionFilterRule) =>
    fetchJson<CompanionFilterState>(`/radio/meshcomod/filter/rules/${kind}`, {
      method: 'POST',
      body: JSON.stringify(rule),
    }),
  removeCompanionFilterRule: (kind: CompanionFilterRuleKind, pattern: string) =>
    fetchJson<CompanionFilterState>(`/radio/meshcomod/filter/rules/${kind}/remove`, {
      method: 'POST',
      body: JSON.stringify({ pattern }),
    }),
  saveCompanionFilterBackup: () =>
    fetchJson<CompanionFilterState>('/radio/meshcomod/filter/backup', { method: 'POST' }),
  restoreCompanionFilter: () =>
    fetchJson<CompanionFilterState>('/radio/meshcomod/filter/restore', { method: 'POST' }),
  getCompanionFilterHistory: (startTs: number, endTs: number, binCount = 48) =>
    fetchJson<CompanionFilterHistory>(
      `/radio/meshcomod/filter/history?start_ts=${startTs}&end_ts=${endTs}&bin_count=${binCount}`
    ),
  // Host repeater (plan 29): settings are versioned, a stale save answers 409.
  getHostRepeater: () => fetchJson<HostRepeaterState>('/radio/host-repeater'),
  saveHostRepeaterSettings: (version: number, settings: HostRepeaterSettings) =>
    fetchJson<HostRepeaterState>('/radio/host-repeater/settings', {
      method: 'PUT',
      body: JSON.stringify({ version, settings }),
    }),
  validateHostRepeaterSettings: (settings: HostRepeaterSettings) =>
    fetchJson<HostRepeaterValidateResult>('/radio/host-repeater/validate', {
      method: 'POST',
      body: JSON.stringify({ settings }),
    }),
  getHostRepeaterStats: () => fetchJson<HostRepeaterStats>('/radio/host-repeater/stats'),
  // Armed mode (plan 29 Phase 3): 'armed' needs confirm=true and answers 409 with
  // {message, blockers} when a precondition fails; 'shadow'/'off' just disarm.
  setHostRepeaterMode: (mode: 'off' | 'shadow' | 'armed', confirm = false) =>
    fetchJson<HostRepeaterState>('/radio/host-repeater/mode', {
      method: 'POST',
      body: JSON.stringify({ mode, confirm }),
    }),
  disarmHostRepeater: () =>
    fetchJson<HostRepeaterState>('/radio/host-repeater/disarm', { method: 'POST' }),
  resetHostRepeaterStats: (lifetime = false) =>
    fetchJson<{ status: string }>(
      `/radio/host-repeater/stats/reset${lifetime ? '?lifetime=true' : ''}`,
      { method: 'POST' }
    ),
  // Spam Guard: settings are versioned like the host repeater's (409 when stale).
  getSpamGuard: () => fetchJson<SpamGuardState>('/spam-guard'),
  saveSpamGuardSettings: (version: number, settings: SpamGuardSettings) =>
    fetchJson<SpamGuardState>('/spam-guard/settings', {
      method: 'PUT',
      body: JSON.stringify({ version, settings }),
    }),
  spamGuardAction: (op: string, args: Record<string, unknown> = {}, messageId?: number | null) =>
    fetchJson<SpamGuardActionResult>('/spam-guard/action', {
      method: 'POST',
      body: JSON.stringify({ op, args, message_id: messageId ?? null }),
    }),
  /** Overview numbers with the graphs for one channel. */
  getSpamGuardMetrics: (channel: string) =>
    fetchJson<SpamGuardMetrics>(`/spam-guard/metrics?channel=${encodeURIComponent(channel)}`),
  /** Airtime Spam Guard saved in a window (all channels, kept 8 days; share card 5c). */
  getSpamGuardAirtime: (startTs: number, endTs: number) =>
    fetchJson<{ airtime_ms: number; from_ts: number; to_ts: number; partial: boolean }>(
      `/spam-guard/airtime?start_ts=${startTs}&end_ts=${endTs}`
    ),
  /** Known people, newest heard first; `query` is part of a name. */
  getSpamGuardKnown: (query: string, limit: number, offset = 0) =>
    fetchJson<SpamKnownList>(
      `/spam-guard/known?${new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) })}`
    ),
  getSpamGuardRules: (preview = false) =>
    fetchJson<SpamGuardRules>(`/spam-guard/rules${preview ? '?preview=true' : ''}`),
  /** Where the browser downloads the evidence log from (JSON Lines). */
  spamGuardEvidenceUrl: (days: number, scramble: boolean) =>
    `${API_BASE}/spam-guard/evidence?days=${days}&scramble=${scramble}`,
  replaySpamGuard: (body: SpamGuardReplayRequest) =>
    fetchJson<SpamGuardReplayResult>('/spam-guard/replay', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  // Bot lists: every change answers with the new state.
  getBotLists: () => fetchJson<BotListsState>('/bot-lists'),
  createBotList: (name: string, description = '') =>
    fetchJson<BotListsState & { created_id: number }>('/bot-lists', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  updateBotList: (
    id: number,
    patch: { name?: string; description?: string; enabled?: boolean; block_forward?: boolean }
  ) =>
    fetchJson<BotListsState>(`/bot-lists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteBotList: (id: number) => fetchJson<BotListsState>(`/bot-lists/${id}`, { method: 'DELETE' }),
  getBotListEntries: (id: number) => fetchJson<BotListEntry[]>(`/bot-lists/${id}/entries`),
  setBotListEntries: (id: number, entries: BotListEntry[]) =>
    fetchJson<BotListsState>(`/bot-lists/${id}/entries`, {
      method: 'PUT',
      body: JSON.stringify({ entries }),
    }),
  addBotListEntry: (id: number, entry: BotListEntry) =>
    fetchJson<BotListsState>(`/bot-lists/${id}/entries`, {
      method: 'POST',
      body: JSON.stringify(entry),
    }),
  /** `text` is the content of a bot list file, sent as it is. */
  importBotList: (text: string) =>
    fetchJson<BotListsState>('/bot-lists/import', { method: 'POST', body: text }),
  /** Where the browser downloads a list from, in the bot list file format. */
  botListExportUrl: (id: number) => `${API_BASE}/bot-lists/${id}/export`,
  setBotListExceptions: (names: string[]) =>
    fetchJson<BotListsState>('/bot-lists/exceptions', {
      method: 'PUT',
      body: JSON.stringify({ names }),
    }),
  previewBotListUrl: (url: string) =>
    fetchJson<BotListPreview>('/bot-lists/preview-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  subscribeBotList: (url: string) =>
    fetchJson<BotListsState & { created_id: number }>('/bot-lists/subscribe', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  refreshBotList: (id: number) =>
    fetchJson<BotListsState>(`/bot-lists/${id}/refresh`, { method: 'POST' }),
  /** Confirm names a refresh added, so Block forwards covers them too. */
  reviewBotList: (id: number, names: string[]) =>
    fetchJson<BotListsState>(`/bot-lists/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ names }),
    }),
  getFilterProfiles: (kind: FilterProfileKind) =>
    fetchJson<FilterProfilesState>(`/filter-profiles?kind=${kind}`),
  createFilterProfile: (kind: FilterProfileKind, name: string, description = '') =>
    fetchJson<FilterProfilesState>('/filter-profiles', {
      method: 'POST',
      body: JSON.stringify({ kind, name, description }),
    }),
  updateFilterProfile: (
    id: number,
    patch: { name?: string; description?: string; capture?: boolean }
  ) =>
    fetchJson<FilterProfilesState>(`/filter-profiles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteFilterProfile: (id: number) =>
    fetchJson<FilterProfilesState>(`/filter-profiles/${id}`, { method: 'DELETE' }),
  /** The body is the file's text as it is; the server parses and validates it. */
  importFilterProfile: (text: string) =>
    fetchJson<FilterProfilesState>('/filter-profiles/import', { method: 'POST', body: text }),
  filterProfileExportUrl: (id: number) => `${API_BASE}/filter-profiles/${id}/export`,
  getFilterProfileChanges: (id: number) =>
    fetchJson<FilterProfileChanges>(`/filter-profiles/${id}/changes`),
  applyFilterProfile: (id: number, confirmProtect: boolean) =>
    fetchJson<FilterProfilesState>(`/filter-profiles/${id}/apply`, {
      method: 'POST',
      body: JSON.stringify({ confirm_protect: confirmProtect }),
    }),
  getGpsConfig: () => fetchJson<GpsConfig>('/radio/gps'),
  getRadioDefaultFloodScope: (signal?: AbortSignal) =>
    fetchJson<RadioDefaultFloodScope>('/radio/default-flood-scope', { signal }),
  updateGpsConfig: (update: GpsConfigUpdate) =>
    fetchJson<GpsConfig>('/radio/gps', {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  getPrivateKey: () => fetchJson<{ private_key: string }>('/radio/private-key'),
  setPrivateKey: (privateKey: string) =>
    fetchJson<{ status: string }>('/radio/private-key', {
      method: 'PUT',
      body: JSON.stringify({ private_key: privateKey }),
    }),
  sendAdvertisement: (mode: RadioAdvertMode = 'flood') =>
    fetchJson<{ status: string }>('/radio/advertise', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  discoverMesh: (target: RadioDiscoveryTarget) =>
    fetchJson<RadioDiscoveryResponse>('/radio/discover', {
      method: 'POST',
      body: JSON.stringify({ target }),
    }),
  discoverRegions: (publicKeys?: string[]) =>
    fetchJson<RadioRegionDiscoveryResponse>('/radio/discover-regions', {
      method: 'POST',
      body: JSON.stringify(publicKeys && publicKeys.length > 0 ? { public_keys: publicKeys } : {}),
    }),
  requestRadioTrace: (hopHashBytes: 1 | 2 | 4, hops: RadioTraceHopRequest[]) =>
    fetchJson<RadioTraceResponse>('/radio/trace', {
      method: 'POST',
      body: JSON.stringify({ hop_hash_bytes: hopHashBytes, hops }),
    }),
  rebootRadio: () =>
    fetchJson<{ status: string; message: string }>('/radio/reboot', {
      method: 'POST',
    }),
  disconnectRadio: () =>
    fetchJson<{ status: string; message: string; connected: boolean; paused: boolean }>(
      '/radio/disconnect',
      {
        method: 'POST',
      }
    ),
  reconnectRadio: () =>
    fetchJson<{ status: string; message: string; connected: boolean }>('/radio/reconnect', {
      method: 'POST',
    }),
  getRadioContactOccupancy: (signal?: AbortSignal) =>
    fetchJson<RadioContactOccupancy>('/radio/contact-occupancy', { signal }),

  // Contacts
  getContacts: (limit = 100, offset = 0) =>
    fetchJson<Contact[]>(`/contacts?limit=${limit}&offset=${offset}`),
  getLatestTelemetry: (signal?: AbortSignal) =>
    fetchJson<Record<string, LatestTelemetry>>('/contacts/telemetry/latest', { signal }),
  getRadioResidency: (signal?: AbortSignal) =>
    fetchJson<ContactRadioResidency[]>('/contacts/radio-residency', { signal }),
  getRepeaterAdvertPaths: (limitPerRepeater = 10) =>
    fetchJson<ContactAdvertPathSummary[]>(
      `/contacts/repeaters/advert-paths?limit_per_repeater=${limitPerRepeater}`
    ),
  /** Resolved advert-path edges. `heardOnly` resolves hops only against
   *  contacts this server has heard; `maxKm` (> 0) drops longer edges;
   *  `since`/`until` limit the adverts used (unix seconds). */
  getAdvertLinks: (
    signal?: AbortSignal,
    opts: { heardOnly?: boolean; maxKm?: number } & LinkWindow = {}
  ) => {
    const qs = new URLSearchParams();
    if (opts.heardOnly) qs.set('heard_only', 'true');
    if (opts.maxKm != null && opts.maxKm > 0) qs.set('max_km', String(opts.maxKm));
    setWindow(qs, opts);
    return fetchJson<AdvertLinkEdge[]>(withQuery('/packets/advert-links', qs), { signal });
  },
  /** Links from all flood traffic (edge log), aggregated over the window. */
  getTrafficLinks: (
    signal?: AbortSignal,
    opts: { heardOnly?: boolean; maxKm?: number } & LinkWindow = {}
  ) => {
    const qs = new URLSearchParams();
    if (opts.heardOnly) qs.set('heard_only', 'true');
    if (opts.maxKm != null && opts.maxKm > 0) qs.set('max_km', String(opts.maxKm));
    setWindow(qs, opts);
    return fetchJson<TrafficLinkEdge[]>(withQuery('/packets/traffic-links', qs), { signal });
  },
  getLinkSummary: (a: string, b: string, w: LinkWindow = {}, signal?: AbortSignal) => {
    const qs = new URLSearchParams();
    setWindow(qs, w);
    return fetchJson<LinkSummary>(withQuery(`/links/${a}/${b}/summary`, qs), { signal });
  },
  getLinkTimeseries: (
    a: string,
    b: string,
    w: LinkWindow & { bucket?: 'hour' | 'day' } = {},
    signal?: AbortSignal
  ) => {
    const qs = new URLSearchParams();
    setWindow(qs, w);
    if (w.bucket) qs.set('bucket', w.bucket);
    return fetchJson<LinkTimeseries>(withQuery(`/links/${a}/${b}/timeseries`, qs), { signal });
  },
  getLinkPackets: (
    a: string,
    b: string,
    opts: { limit?: number; before?: number | null } = {},
    signal?: AbortSignal
  ) => {
    const qs = new URLSearchParams();
    if (opts.limit != null) qs.set('limit', String(opts.limit));
    if (opts.before != null) qs.set('before', String(opts.before));
    return fetchJson<LinkPacketRow[]>(withQuery(`/links/${a}/${b}/packets`, qs), { signal });
  },
  getContactAnalytics: (params: { publicKey?: string; name?: string }, signal?: AbortSignal) => {
    const searchParams = new URLSearchParams();
    if (params.publicKey) searchParams.set('public_key', params.publicKey);
    if (params.name) searchParams.set('name', params.name);
    return fetchJson<ContactAnalytics>(`/contacts/analytics?${searchParams.toString()}`, {
      signal,
    });
  },
  deleteContact: (publicKey: string) =>
    fetchJson<ContactDeleteResult>(`/contacts/${publicKey}`, {
      method: 'DELETE',
    }),
  bulkDeleteContacts: (publicKeys: string[]) =>
    fetchJson<BulkDeleteContactsResult>('/contacts/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_keys: publicKeys }),
    }),
  createContact: (publicKey: string, name?: string, tryHistorical?: boolean, type?: number) =>
    fetchJson<Contact>('/contacts', {
      method: 'POST',
      body: JSON.stringify({ public_key: publicKey, name, type, try_historical: tryHistorical }),
    }),
  getOwnContactUri: () => fetchJson<ContactUriResult>('/radio/contact-uri'),
  getContactUri: (publicKey: string) =>
    fetchJson<ContactUriResult>(`/contacts/${publicKey}/contact-uri`),
  bulkContactUris: (publicKeys: string[]) =>
    fetchJson<ContactUriBatchResult>('/contacts/bulk-contact-uris', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_keys: publicKeys }),
    }),
  importContactUri: (uri: string) =>
    fetchJson<Contact>('/contacts/import-uri', {
      method: 'POST',
      body: JSON.stringify({ uri }),
    }),
  markContactRead: (publicKey: string, messageId?: number) =>
    fetchJson<{ status: string; public_key: string }>(
      `/contacts/${publicKey}/mark-read${messageId === undefined ? '' : `?message_id=${messageId}`}`,
      { method: 'POST' }
    ),
  markContactUnread: (publicKey: string, messageId: number) =>
    fetchJson<{ status: string; public_key: string; message_id: number; last_read_at: number }>(
      `/contacts/${publicKey}/mark-unread`,
      {
        method: 'POST',
        body: JSON.stringify({ message_id: messageId }),
      }
    ),
  sendRepeaterCommand: (publicKey: string, command: string) =>
    fetchJson<CommandResponse>(`/contacts/${publicKey}/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),
  requestTrace: (publicKey: string) =>
    fetchJson<TraceResponse>(`/contacts/${publicKey}/trace`, {
      method: 'POST',
    }),
  requestPathDiscovery: (publicKey: string) =>
    fetchJson<PathDiscoveryResponse>(`/contacts/${publicKey}/path-discovery`, {
      method: 'POST',
    }),
  setContactRoutingOverride: (publicKey: string, route: string) =>
    fetchJson<{ status: string; public_key: string }>(`/contacts/${publicKey}/routing-override`, {
      method: 'POST',
      body: JSON.stringify({ route }),
    }),
  setContactRadioPolicy: (publicKey: string, policy: RadioPolicy) =>
    fetchJson<{ status: string; public_key: string; radio_policy: string }>(
      `/contacts/${publicKey}/radio-policy`,
      {
        method: 'POST',
        body: JSON.stringify({ policy }),
      }
    ),
  setContactTelemetryPermissions: (publicKey: string, perms: ContactTelemetryPermissions) =>
    fetchJson<{
      status: string;
      public_key: string;
      telemetry_perms: number;
      applied_to_radio: boolean;
    }>(`/contacts/${publicKey}/telemetry-permissions`, {
      method: 'POST',
      body: JSON.stringify(perms),
    }),
  // Companion firmware 1.18+: the radio's own command line (never transmits).
  runRadioCli: (command: string) =>
    fetchJson<RadioCliResponse>('/radio/cli', {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),
  // Companion firmware 1.18+: let a contact run commands on our radio (flags bit 0x10).
  setContactRemoteCli: (publicKey: string, enabled: boolean) =>
    fetchJson<{
      status: string;
      public_key: string;
      remote_cli: boolean;
      applied_to_radio: boolean;
    }>(`/contacts/${publicKey}/remote-cli`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  // Sensor nodes: min/max/average, and MeshCore 1.18 telemetry push.
  sensorMma: (publicKey: string, hours = 24) =>
    fetchJson<SensorMmaResponse>(`/contacts/${publicKey}/sensor/mma?hours=${hours}`, {
      method: 'POST',
    }),
  getSensorPush: (publicKey: string) =>
    fetchJson<SensorPushState>(`/contacts/${publicKey}/sensor-push`),
  saveSensorPush: (publicKey: string, thresholds: SensorPushThreshold[]) =>
    fetchJson<SensorPushState>(`/contacts/${publicKey}/sensor-push`, {
      method: 'PUT',
      body: JSON.stringify({ thresholds }),
    }),
  subscribeSensorPush: (publicKey: string) =>
    fetchJson<SensorPushState>(`/contacts/${publicKey}/sensor-push/subscribe`, {
      method: 'POST',
    }),
  unsubscribeSensorPush: (publicKey: string) =>
    fetchJson<SensorPushState>(`/contacts/${publicKey}/sensor-push/unsubscribe`, {
      method: 'POST',
    }),

  // Channels
  getChannels: () => fetchJson<Channel[]>('/channels'),
  createChannel: (name: string, key?: string) =>
    fetchJson<Channel>('/channels', {
      method: 'POST',
      body: JSON.stringify({ name, key }),
    }),
  bulkCreateHashtagChannels: (channelNames: string[], tryHistorical?: boolean) =>
    fetchJson<BulkCreateHashtagChannelsResult>('/channels/bulk-hashtag', {
      method: 'POST',
      body: JSON.stringify({ channel_names: channelNames, try_historical: tryHistorical }),
    }),
  deleteChannel: (key: string) =>
    fetchJson<{ status: string }>(`/channels/${key}`, { method: 'DELETE' }),
  bulkDeleteChannels: (keys: string[]) =>
    fetchJson<{ deleted: number; skipped: string[] }>('/channels/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ keys }),
    }),
  importChannels: async (file: File, tryHistorical: boolean): Promise<ChannelImportResult> => {
    const form = new FormData();
    form.append('file', file);
    // Use fetch directly so the browser sets the multipart/form-data
    // Content-Type (with boundary) rather than fetchJson's application/json.
    const res = await fetch(`${API_BASE}/channels/import?try_historical=${tryHistorical}`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j.detail) msg = j.detail;
      } catch {
        /* raw text */
      }
      throw new Error(msg);
    }
    return res.json() as Promise<ChannelImportResult>;
  },
  getChannelDetail: (key: string) => fetchJson<ChannelDetail>(`/channels/${key}/detail`),

  // Channel sets ("loadouts", plan 08): channels + contacts loaded onto the radio in one action
  getChannelSets: () => fetchJson<ChannelSet[]>('/channel-sets'),
  createChannelSet: (name: string, channelKeys: string[], contactKeys: string[] = []) =>
    fetchJson<ChannelSet>('/channel-sets', {
      method: 'POST',
      body: JSON.stringify({ name, channel_keys: channelKeys, contact_keys: contactKeys }),
    }),
  updateChannelSet: (
    setId: string,
    update: { name?: string; channel_keys?: string[]; contact_keys?: string[] }
  ) =>
    fetchJson<ChannelSet>(`/channel-sets/${setId}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  deleteChannelSet: (setId: string) =>
    fetchJson<{ deleted: string }>(`/channel-sets/${setId}`, { method: 'DELETE' }),
  applyChannelSet: (setId: string) =>
    fetchJson<ChannelSetApplyResult>(`/channel-sets/${setId}/apply`, { method: 'POST' }),

  // Communities (meshcore-open shared-secret channels)
  getCommunities: () => fetchJson<Community[]>('/communities'),
  joinCommunity: (payload: string, addPublicChannel: boolean, tryHistorical: boolean) =>
    fetchJson<CommunityJoinResult>('/communities/join', {
      method: 'POST',
      body: JSON.stringify({
        payload,
        add_public_channel: addPublicChannel,
        try_historical: tryHistorical,
      }),
    }),
  addCommunityHashtag: (communityId: string, hashtag: string, tryHistorical: boolean) =>
    fetchJson<CommunityHashtagResult>(`/communities/${communityId}/hashtags`, {
      method: 'POST',
      body: JSON.stringify({ hashtag, try_historical: tryHistorical }),
    }),
  exportCommunity: (communityId: string) =>
    fetchJson<CommunityExport>(`/communities/${communityId}/export`, { cache: 'no-store' }),
  deleteCommunity: (communityId: string) =>
    fetchJson<{ status: string }>(`/communities/${communityId}`, { method: 'DELETE' }),
  markChannelRead: (key: string, messageId?: number) =>
    fetchJson<{ status: string; key: string }>(
      `/channels/${key}/mark-read${messageId === undefined ? '' : `?message_id=${messageId}`}`,
      { method: 'POST' }
    ),
  summarizeChannelUnread: (key: string, after: number) =>
    fetchJson<ChannelUnreadSummary>(`/channels/${key}/summarize-unread?after=${after}`, {
      method: 'POST',
    }),
  markChannelUnread: (key: string, messageId: number) =>
    fetchJson<{ status: string; key: string; message_id: number; last_read_at: number }>(
      `/channels/${key}/mark-unread`,
      {
        method: 'POST',
        body: JSON.stringify({ message_id: messageId }),
      }
    ),
  setContactFloodScopeOverride: (publicKey: string, floodScopeOverride: string) =>
    fetchJson<Contact>(`/contacts/${publicKey}/flood-scope-override`, {
      method: 'POST',
      body: JSON.stringify({ flood_scope_override: floodScopeOverride }),
    }),
  setChannelFloodScopeOverride: (key: string, floodScopeOverride: string) =>
    fetchJson<Channel>(`/channels/${key}/flood-scope-override`, {
      method: 'POST',
      body: JSON.stringify({ flood_scope_override: floodScopeOverride }),
    }),

  setChannelPathHashModeOverride: (key: string, pathHashModeOverride: number | null) =>
    fetchJson<Channel>(`/channels/${key}/path-hash-mode-override`, {
      method: 'POST',
      body: JSON.stringify({ path_hash_mode_override: pathHashModeOverride }),
    }),

  // Messages
  getMessages: (
    params?: {
      limit?: number;
      offset?: number;
      type?: 'PRIV' | 'CHAN';
      conversation_key?: string;
      before?: number;
      before_id?: number;
      after?: number;
      after_id?: number;
      q?: string;
    },
    signal?: AbortSignal
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());
    if (params?.type) searchParams.set('type', params.type);
    if (params?.conversation_key) searchParams.set('conversation_key', params.conversation_key);
    if (params?.before !== undefined) searchParams.set('before', params.before.toString());
    if (params?.before_id !== undefined) searchParams.set('before_id', params.before_id.toString());
    if (params?.after !== undefined) searchParams.set('after', params.after.toString());
    if (params?.after_id !== undefined) searchParams.set('after_id', params.after_id.toString());
    if (params?.q) searchParams.set('q', params.q);
    const query = searchParams.toString();
    return fetchJson<Message[]>(`/messages${query ? `?${query}` : ''}`, { signal });
  },
  reactToMessage: (messageId: number, emoji: string) =>
    fetchJson<Message>(`/messages/${messageId}/react`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),
  deleteMessage: (messageId: number) =>
    fetchJson<{ status: string; deleted: number }>(`/messages/${messageId}`, {
      method: 'DELETE',
    }),
  getReactionTarget: (messageId: number) =>
    fetchJson<ReactionTargetResponse>(`/messages/${messageId}/reaction-target`),
  /** Location shares in chat messages received in (since, until]; newest first. */
  /** Per-relay reception summary (plan 21 S1); `limit` caps only the packet list. */
  getRelayReception: (startTs: number, endTs: number, limit = 1, signal?: AbortSignal) =>
    fetchJson<RelayReceptionResponse>(
      `/packets/relay-reception?start_ts=${startTs}&end_ts=${endTs}&limit=${limit}`,
      { signal }
    ),
  getRelayReceptionDetail: (
    startTs: number,
    endTs: number,
    relayHexes: string[],
    signal?: AbortSignal
  ) => {
    const qs = new URLSearchParams({ start_ts: String(startTs), end_ts: String(endTs) });
    for (const hex of relayHexes) qs.append('relay', hex);
    return fetchJson<RelayDetailResponse>(`/packets/relay-reception/relay?${qs}`, { signal });
  },
  getSharedLocations: (
    params: { since?: number; until?: number; latestPerSender?: boolean },
    signal?: AbortSignal
  ) => {
    const qs = new URLSearchParams();
    if (params.since !== undefined) qs.set('since', String(params.since));
    if (params.until !== undefined) qs.set('until', String(params.until));
    if (params.latestPerSender !== undefined) {
      qs.set('latest_per_sender', String(params.latestPerSender));
    }
    const query = qs.toString();
    return fetchJson<SharedLocationsResponse>(`/messages/locations${query ? `?${query}` : ''}`, {
      signal,
    });
  },
  getTeamBeacons: (
    params: { since?: number; until?: number; latestPerSender?: boolean; senderKey?: string },
    signal?: AbortSignal
  ) => {
    const qs = new URLSearchParams();
    if (params.since !== undefined) qs.set('since', String(params.since));
    if (params.until !== undefined) qs.set('until', String(params.until));
    if (params.latestPerSender !== undefined) {
      qs.set('latest_per_sender', String(params.latestPerSender));
    }
    if (params.senderKey !== undefined) qs.set('sender_key', params.senderKey);
    const query = qs.toString();
    return fetchJson<TeamBeaconsResponse>(`/messages/beacons${query ? `?${query}` : ''}`, {
      signal,
    });
  },
  getMessagesAround: (
    messageId: number,
    type?: 'PRIV' | 'CHAN',
    conversationKey?: string,
    signal?: AbortSignal
  ) => {
    const searchParams = new URLSearchParams();
    if (type) searchParams.set('type', type);
    if (conversationKey) searchParams.set('conversation_key', conversationKey);
    const query = searchParams.toString();
    return fetchJson<MessagesAroundResponse>(
      `/messages/around/${messageId}${query ? `?${query}` : ''}`,
      { signal }
    );
  },
  sendDirectMessage: (destination: string, text: string) =>
    fetchJson<Message>('/messages/direct', {
      method: 'POST',
      body: JSON.stringify({ destination, text }),
    }),
  sendChannelMessage: (channelKey: string, text: string) =>
    fetchJson<Message>('/messages/channel', {
      method: 'POST',
      body: JSON.stringify({ channel_key: channelKey, text }),
    }),
  resendChannelMessage: (messageId: number, newTimestamp?: boolean) =>
    fetchJson<ResendChannelMessageResponse>(
      `/messages/channel/${messageId}/resend${newTimestamp ? '?new_timestamp=true' : ''}`,
      { method: 'POST' }
    ),
  resendDirectMessage: (messageId: number) =>
    fetchJson<ResendDirectMessageResponse>(`/messages/direct/${messageId}/resend`, {
      method: 'POST',
    }),

  // Packets
  getRecentPackets: (params?: { afterTs?: number; beforeTs?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.afterTs !== undefined) qs.set('after_ts', String(params.afterTs));
    if (params?.beforeTs !== undefined) qs.set('before_ts', String(params.beforeTs));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return fetchJson<RawPacket[]>(`/packets/recent${query ? `?${query}` : ''}`);
  },
  getPacketHistory: (params: URLSearchParams) =>
    fetchJson<PacketHistoryResponse>(`/packets/history?${params.toString()}`),
  getPacket: (packetId: number) => fetchJson<RawPacket>(`/packets/${packetId}`),
  getUndecryptedPacketCount: () => fetchJson<{ count: number }>('/packets/undecrypted/count'),
  // lookup=false only hashes the packet locally; lookup=true also sends that
  // hash to the external analyzer to ask which of its observers heard it.
  packetWhoHeard: (data: string, lookup = false) =>
    fetchJson<PacketWhoHeard>('/packets/who-heard', {
      method: 'POST',
      body: JSON.stringify({ data, lookup }),
    }),
  decryptHistoricalPackets: (params: {
    key_type: 'channel' | 'contact';
    channel_key?: string;
    channel_name?: string;
  }) =>
    fetchJson<DecryptResult>('/packets/decrypt/historical', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  runMaintenance: (options: { pruneUndecryptedDays?: number; purgeLinkedRawPackets?: boolean }) =>
    fetchJson<MaintenanceResult>('/packets/maintenance', {
      method: 'POST',
      body: JSON.stringify({
        ...(options.pruneUndecryptedDays !== undefined && {
          prune_undecrypted_days: options.pruneUndecryptedDays,
        }),
        ...(options.purgeLinkedRawPackets !== undefined && {
          purge_linked_raw_packets: options.purgeLinkedRawPackets,
        }),
      }),
    }),

  // Retention
  getRetentionStats: (messagesDays?: number) =>
    fetchJson<RetentionStats>(
      `/retention/stats${messagesDays !== undefined ? `?messages_days=${messagesDays}` : ''}`
    ),
  runRetentionPrune: () => fetchJson<RetentionPruneResult>('/retention/prune', { method: 'POST' }),

  // Backup
  downloadBackupUrl: () => `${API_BASE}/backup/download`,
  saveBackup: () =>
    fetchJson<BackupSaveResult>('/backup/save', {
      method: 'POST',
    }),
  listBackupFiles: () => fetchJson<BackupFilesResponse>('/backup/files'),
  getRestoreStatus: () => fetchJson<RestoreStatus>('/backup/restore'),
  restoreFromServer: (filename: string) =>
    fetchJson<RestoreStatus>('/backup/restore/server', {
      method: 'POST',
      body: JSON.stringify({ filename }),
    }),
  restoreFromUpload: async (file: File): Promise<RestoreStatus> => {
    const form = new FormData();
    form.append('file', file);
    // Raw fetch so the browser sets multipart/form-data (not application/json).
    const res = await fetch(`${API_BASE}/backup/restore/upload`, { method: 'POST', body: form });
    if (!res.ok) {
      const text = await res.text();
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j.detail) msg = j.detail;
      } catch {
        /* raw text */
      }
      throw new ApiError(msg, res.status);
    }
    return res.json() as Promise<RestoreStatus>;
  },
  cancelRestore: () => fetchJson<RestoreStatus>('/backup/restore', { method: 'DELETE' }),
  dismissRestoreResult: () =>
    fetchJson<RestoreStatus>('/backup/restore/result', { method: 'DELETE' }),

  // Read State
  getUnreads: () => fetchJson<UnreadCounts>('/read-state/unreads'),
  markAllRead: () =>
    fetchJson<{ status: string; timestamp: number }>('/read-state/mark-all-read', {
      method: 'POST',
    }),

  // Channel Registry
  syncRegistry: () => fetchJson<{ channels: { name: string; key: string }[] }>('/registry/sync'),

  // Region sync (analyzer regions endpoint -> known_regions)
  syncRegions: () => fetchJson<{ regions: string[] }>('/regions/sync'),

  // Re-resolve region scope for stored channel messages against known_regions.
  backfillRegions: () =>
    fetchJson<{ scanned: number; scoped: number; named: number }>('/packets/region-backfill', {
      method: 'POST',
    }),

  // Wordlist sync (candidate channel names -> channel finder wordlist)
  syncWordlist: () => fetchJson<{ words: string[] }>('/registry/wordlist-sync'),

  // External analyzer node overlay
  syncExternalMap: () =>
    fetchJson<{ count: number; synced_at: number }>('/external-map/sync', { method: 'POST' }),
  getExternalMapStatus: () => fetchJson<ExternalMapStatus>('/external-map/status'),
  getExternalMapNodes: (
    bbox: { west: number; south: number; east: number; north: number },
    signal?: AbortSignal
  ) => {
    const qs = new URLSearchParams({
      west: String(bbox.west),
      south: String(bbox.south),
      east: String(bbox.east),
      north: String(bbox.north),
    });
    return fetchJson<ExternalMapNode[]>(`/external-map/nodes?${qs.toString()}`, { signal });
  },

  // Dutch Antenneregister layer (masts in the bands next to 868 MHz)
  syncAntennaRegister: () =>
    fetchJson<AntennaRegisterStatus>('/antenna-register/sync', { method: 'POST' }),
  getAntennaRegisterStatus: () => fetchJson<AntennaRegisterStatus>('/antenna-register/status'),
  getAntennaRegisterSites: (signal?: AbortSignal) => {
    // The whole cache (~18k sites) in one go; MapLibre handles the rest.
    const qs = new URLSearchParams({
      west: '-180',
      south: '-90',
      east: '180',
      north: '90',
      limit: '20000',
    });
    return fetchJson<{ sites: AntennaRegisterSiteSummary[]; truncated: boolean }>(
      `/antenna-register/sites?${qs.toString()}`,
      { signal }
    );
  },
  getAntennaRegisterSite: (id: number, signal?: AbortSignal) =>
    fetchJson<AntennaRegisterSite>(`/antenna-register/sites/${id}`, { signal }),

  // Partial-node resolution (soft prefix -> full-pubkey links from the external map)
  previewPartialResolutions: () =>
    fetchJson<PartialResolutionPreview>('/partial-resolutions/preview'),
  applyPartialResolutions: (selections: PartialResolutionApplyItem[]) =>
    fetchJson<{ applied: number; promoted: number }>('/partial-resolutions/apply', {
      method: 'POST',
      body: JSON.stringify({ selections }),
    }),
  listPartialResolutions: () => fetchJson<PartialNodeResolution[]>('/partial-resolutions'),
  deletePartialResolution: (prefixHex: string) =>
    fetchJson<{ deleted: boolean }>(`/partial-resolutions/${encodeURIComponent(prefixHex)}`, {
      method: 'DELETE',
    }),

  // Chat link preview (unfurl)
  unfurl: (url: string, signal?: AbortSignal) =>
    fetchJson<UrlPreview>(`/unfurl?url=${encodeURIComponent(url)}`, { signal }),

  // Backend map tile cache (Settings > Map)
  getTileCacheConfig: () => fetchJson<TileCacheConfig>('/tiles/config'),
  updateTileCacheConfig: (update: TileCacheConfigUpdate) =>
    fetchJson<TileCacheConfig>('/tiles/config', {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  getTileCacheStats: () => fetchJson<TileCacheStats>('/tiles/stats'),
  clearTileCache: () => fetchJson<TileCacheStats>('/tiles/cache', { method: 'DELETE' }),
  estimateTileDownload: (area: TileAreaRequest) =>
    fetchJson<TileAreaEstimate>('/tiles/download/estimate', {
      method: 'POST',
      body: JSON.stringify(area),
    }),
  startTileDownload: (area: TileAreaRequest) =>
    fetchJson<TileDownloadStatus>('/tiles/download', {
      method: 'POST',
      body: JSON.stringify(area),
    }),
  getTileDownload: () => fetchJson<TileDownloadStatus>('/tiles/download'),
  cancelTileDownload: () => fetchJson<TileDownloadStatus>('/tiles/download', { method: 'DELETE' }),

  // App Settings
  getSettings: () => fetchJson<AppSettings>('/settings'),
  updateSettings: (settings: AppSettingsUpdate) =>
    fetchJson<AppSettings>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),
  uploadMentionSound: async (file: File): Promise<MentionSoundMeta> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/settings/mention-sound`, { method: 'POST', body: form });
    if (!res.ok) {
      const text = await res.text();
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j.detail) msg = j.detail;
      } catch {
        /* raw text */
      }
      throw new Error(msg);
    }
    return res.json() as Promise<MentionSoundMeta>;
  },
  deleteMentionSound: async (): Promise<void> => {
    const res = await fetch(`${API_BASE}/settings/mention-sound`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      throw new ApiError('Failed to delete mention sound', res.status);
    }
  },

  // OpenHop management (Surface B, opt-in; only meaningful when is_openhop)
  getOpenHopStatus: () => fetchJson<OpenHopStatus>('/openhop/status'),
  getOpenHopPolicy: () => fetchJson<OpenHopEnvelope<OpenHopPolicyDoc>>('/openhop/policy'),
  validateOpenHopPolicy: (policy: OpenHopPolicyEngine) =>
    fetchJson<OpenHopEnvelope<{ valid: boolean; normalized?: unknown; effective?: unknown }>>(
      '/openhop/policy/validate',
      { method: 'POST', body: JSON.stringify({ policy }) }
    ),
  updateOpenHopPolicy: (policy: OpenHopPolicyEngine) =>
    fetchJson<OpenHopEnvelope>('/openhop/policy', {
      method: 'POST',
      body: JSON.stringify({ policy }),
    }),
  createOpenHopGroup: (
    kind: OpenHopGroupKind,
    group_id: string,
    friendly_name = '',
    description = ''
  ) =>
    fetchJson<OpenHopEnvelope>('/openhop/policy/groups', {
      method: 'POST',
      body: JSON.stringify({ kind, group_id, friendly_name, description }),
    }),
  deleteOpenHopGroup: (kind: OpenHopGroupKind, group_id: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/policy/groups', {
      method: 'DELETE',
      body: JSON.stringify({ kind, group_id }),
    }),
  addOpenHopGroupEntry: (kind: OpenHopGroupKind, group_id: string, value: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/policy/groups/entries', {
      method: 'POST',
      body: JSON.stringify({ kind, group_id, value }),
    }),
  deleteOpenHopGroupEntry: (kind: OpenHopGroupKind, group_id: string, value: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/policy/groups/entries', {
      method: 'DELETE',
      body: JSON.stringify({ kind, group_id, value }),
    }),

  // OpenHop plugins (Surface B; only meaningful when is_openhop AND configured)
  listOpenHopPlugins: () =>
    fetchJson<OpenHopEnvelope<never> & { plugins: OpenHopPlugin[] }>('/openhop/plugins'),
  // OpenHop's plugin endpoints use a FLAT envelope ({success, <fields>...}), unlike
  // the policy endpoints which nest under {data}. Read fields at the top level.
  getOpenHopPluginStatus: (id: string) =>
    fetchJson<OpenHopEnvelope<never> & OpenHopPlugin>(
      `/openhop/plugins/status?id=${encodeURIComponent(id)}`
    ),
  getOpenHopPluginCatalogue: (refresh = false) =>
    fetchJson<OpenHopEnvelope<never> & { plugins: OpenHopCatalogueEntry[] }>(
      `/openhop/plugins/catalogue${refresh ? '?refresh=true' : ''}`
    ),
  getOpenHopPluginLogs: (id: string, tail = 200) =>
    fetchJson<OpenHopEnvelope<never> & { lines?: string[]; log?: string; tail?: number }>(
      `/openhop/plugins/logs?id=${encodeURIComponent(id)}&tail=${tail}`
    ),
  getOpenHopPluginConfig: (id: string) =>
    fetchJson<OpenHopEnvelope<never> & { config?: Record<string, unknown> }>(
      `/openhop/plugins/settings?id=${encodeURIComponent(id)}`
    ),
  checkOpenHopPluginUpdate: (id: string, refresh = false) =>
    fetchJson<OpenHopEnvelope<never> & { updateAvailable?: boolean; latestVersion?: string }>(
      `/openhop/plugins/updates?id=${encodeURIComponent(id)}${refresh ? '&refresh=true' : ''}`
    ),
  openHopPluginLifecycle: (verb: 'enable' | 'disable' | 'start' | 'stop' | 'restart', id: string) =>
    fetchJson<OpenHopEnvelope>(`/openhop/plugins/${verb}`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
  installOpenHopCataloguePlugin: (id: string, version?: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/plugins/catalogue_install', {
      method: 'POST',
      body: JSON.stringify(version ? { id, version } : { id }),
    }),
  updateOpenHopPlugin: (id: string, version?: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/plugins/update', {
      method: 'POST',
      body: JSON.stringify(version ? { id, version } : { id }),
    }),
  setOpenHopPluginConfig: (id: string, config: Record<string, unknown>, restart = false) =>
    fetchJson<OpenHopEnvelope>('/openhop/plugins/settings', {
      method: 'POST',
      body: JSON.stringify({ id, config, restart }),
    }),
  uninstallOpenHopPlugin: (id: string, delete_data = false) =>
    fetchJson<OpenHopEnvelope>('/openhop/plugins/uninstall', {
      method: 'POST',
      body: JSON.stringify({ id, delete_data }),
    }),
  openHopPluginProgressUrl: (id: string, since = 0, fresh = true) =>
    `./api/openhop/plugins/progress?id=${encodeURIComponent(id)}&since=${since}&fresh=${fresh}`,

  // OpenHop config (Surface B; only meaningful when is_openhop AND configured)
  getOpenHopConfigExport: (includeSecrets = false) =>
    fetchJson<OpenHopConfigExport>(
      `/openhop/config/export${includeSecrets ? '?include_secrets=true' : ''}`
    ),
  validateOpenHopConfig: () => fetchJson<OpenHopValidateResult>('/openhop/config/validate'),
  getOpenHopHardwareOptions: () =>
    fetchJson<{ hardware: OpenHopHardwareOption[] }>('/openhop/config/hardware_options'),
  getOpenHopPresets: () =>
    fetchJson<{ presets: OpenHopRadioPreset[]; source?: string }>('/openhop/config/presets'),
  setOpenHopMode: (mode: string) =>
    fetchJson<OpenHopModeResult>('/openhop/config/mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  updateOpenHopRadio: (params: Record<string, number | string>) =>
    fetchJson<OpenHopRadioResult>('/openhop/config/radio', {
      method: 'POST',
      body: JSON.stringify({ params }),
    }),
  importOpenHopConfig: (config: Record<string, unknown>, restartAfter = false) =>
    fetchJson<OpenHopImportResult>('/openhop/config/import', {
      method: 'POST',
      body: JSON.stringify({ config, restart_after: restartAfter }),
    }),
  restartOpenHopService: () =>
    fetchJson<OpenHopRestartResult>('/openhop/config/restart', { method: 'POST' }),

  // OpenHop OTA update (Surface B; only meaningful when is_openhop AND configured)
  getOpenHopUpdateStatus: () => fetchJson<OpenHopUpdateStatus>('/openhop/update/status'),
  openHopUpdateCheck: (force = false) =>
    fetchJson<OpenHopUpdateStatus>('/openhop/update/check', {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
  openHopUpdateInstall: (force = false) =>
    fetchJson<OpenHopUpdateStatus>('/openhop/update/install', {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
  getOpenHopUpdateChannels: () => fetchJson<OpenHopUpdateChannels>('/openhop/update/channels'),
  openHopUpdateSetChannel: (channel: string) =>
    fetchJson<OpenHopUpdateStatus>('/openhop/update/set_channel', {
      method: 'POST',
      body: JSON.stringify({ channel }),
    }),
  getOpenHopUpdateChangelog: (channel?: string, max = 40) =>
    fetchJson<OpenHopChangelog>(
      `/openhop/update/changelog?max=${max}${channel ? `&channel=${encodeURIComponent(channel)}` : ''}`
    ),
  openHopUpdateProgressUrl: () => `./api/openhop/update/progress`,

  // OpenHop CAD calibration (Surface B; real metrics need RF hardware)
  openHopCadStart: (samples = 8, delay = 100) =>
    fetchJson<OpenHopEnvelope>('/openhop/cad/start', {
      method: 'POST',
      body: JSON.stringify({ samples, delay }),
    }),
  openHopCadStop: () => fetchJson<OpenHopEnvelope>('/openhop/cad/stop', { method: 'POST' }),
  openHopCadManualCheck: (params: OpenHopCadManualCheckParams) =>
    fetchJson<OpenHopCadResult>('/openhop/cad/manual_check', {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  openHopCadSave: (peak: number, min_val: number, cad_symbol_num = 2) =>
    fetchJson<OpenHopEnvelope>('/openhop/cad/save', {
      method: 'POST',
      body: JSON.stringify({ peak, min_val, cad_symbol_num }),
    }),
  openHopCadStreamUrl: () => `./api/openhop/cad/stream`,

  // OpenHop system / hardware + read-only analytics (Surface B)
  getOpenHopHardware: () => fetchJson<OpenHopHardwareStats>('/openhop/system/hardware'),
  getOpenHopProcesses: () => fetchJson<OpenHopAnalyticsResult>('/openhop/system/processes'),
  getOpenHopNodeStats: () => fetchJson<Record<string, unknown>>('/openhop/system/stats'),
  getOpenHopSiteInfo: () =>
    fetchJson<OpenHopEnvelope & { site_name?: string }>('/openhop/system/site_info'),
  getOpenHopPacketStats: (hours = 24) =>
    fetchJson<OpenHopAnalyticsResult>(`/openhop/analytics/packet_stats?hours=${hours}`),
  getOpenHopPacketTypeStats: (hours = 24) =>
    fetchJson<OpenHopAnalyticsResult>(`/openhop/analytics/packet_type_stats?hours=${hours}`),
  getOpenHopNoiseFloorStats: (hours = 24) =>
    fetchJson<OpenHopAnalyticsResult>(`/openhop/analytics/noise_floor_stats?hours=${hours}`),

  // OpenHop transport keys + neighbor scopes (Surface B)
  getOpenHopTransportKeys: () => fetchJson<OpenHopTransportKeys>('/openhop/transport/keys'),
  openHopCreateTransportKey: (name: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/transport/keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  openHopDeleteTransportKey: (keyId: string) =>
    fetchJson<OpenHopEnvelope>(`/openhop/transport/key?key_id=${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
    }),
  getOpenHopNeighborScopes: () => fetchJson<OpenHopNeighborScopes>('/openhop/scopes/neighbors'),
  openHopQueryNeighborScopes: (pubkey: string) =>
    fetchJson<OpenHopEnvelope>('/openhop/scopes/query', {
      method: 'POST',
      body: JSON.stringify({ pubkey }),
    }),

  // OpenHop MQTT config (Surface B)
  getOpenHopMqttStatus: () => fetchJson<OpenHopMqttStatus>('/openhop/mqtt/status'),
  getOpenHopMqttPresets: () => fetchJson<OpenHopMqttStatus>('/openhop/mqtt/presets'),
  openHopUpdateMqttConfig: (body: OpenHopMqttConfigBody) =>
    fetchJson<OpenHopEnvelope>('/openhop/mqtt/config', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  openHopPublishNeighbors: () =>
    fetchJson<OpenHopEnvelope>('/openhop/mqtt/publish_neighbors', { method: 'POST' }),

  // Block lists
  toggleBlockedKey: (key: string) =>
    fetchJson<AppSettings>('/settings/blocked-keys/toggle', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),
  toggleBlockedName: (name: string) =>
    fetchJson<AppSettings>('/settings/blocked-names/toggle', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  // Tracked telemetry
  toggleTrackedTelemetry: (publicKey: string) =>
    fetchJson<TrackedTelemetryResponse>('/settings/tracked-telemetry/toggle', {
      method: 'POST',
      body: JSON.stringify({ public_key: publicKey }),
    }),

  getTelemetrySchedule: () => fetchJson<TelemetrySchedule>('/settings/tracked-telemetry/schedule'),

  // Clock sync for a tracked repeater (rides on the telemetry cycle)
  toggleClockSyncRepeater: (publicKey: string) =>
    fetchJson<{ clock_sync_repeaters: string[] }>('/settings/clock-sync-repeaters/toggle', {
      method: 'POST',
      body: JSON.stringify({ public_key: publicKey }),
    }),

  // Tracked contact telemetry
  toggleTrackedTelemetryContact: (publicKey: string) =>
    fetchJson<TrackedTelemetryContactsResponse>('/settings/tracked-telemetry-contacts/toggle', {
      method: 'POST',
      body: JSON.stringify({ public_key: publicKey }),
    }),

  getContactTelemetrySchedule: () =>
    fetchJson<TelemetrySchedule>('/settings/tracked-telemetry-contacts/schedule'),

  // Favorites
  toggleFavorite: (type: 'channel' | 'contact', id: string) =>
    fetchJson<{ type: string; id: string; favorite: boolean }>('/settings/favorites/toggle', {
      method: 'POST',
      body: JSON.stringify({ type, id }),
    }),

  toggleChannelMute: (key: string) =>
    fetchJson<{ key: string; muted: boolean }>('/settings/muted-channels/toggle', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  // Fanout
  getFanoutConfigs: () => fetchJson<FanoutConfig[]>('/fanout'),
  createFanoutConfig: (config: {
    type: string;
    name: string;
    config: Record<string, unknown>;
    scope: Record<string, unknown>;
    enabled?: boolean;
  }) =>
    fetchJson<FanoutConfig>('/fanout', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  updateFanoutConfig: (
    id: string,
    update: {
      name?: string;
      config?: Record<string, unknown>;
      scope?: Record<string, unknown>;
      enabled?: boolean;
    }
  ) =>
    fetchJson<FanoutConfig>(`/fanout/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    }),
  deleteFanoutConfig: (id: string) =>
    fetchJson<{ deleted: boolean }>(`/fanout/${id}`, {
      method: 'DELETE',
    }),

  // Statistics
  getStatistics: () => fetchJson<StatisticsResponse>('/statistics'),
  getNoiseFloorHistory: (startTs: number, endTs: number, radio?: RadioStatFilter) =>
    fetchJson<NoiseFloorSample[]>(
      `/statistics/noise-floor?start_ts=${startTs}&end_ts=${endTs}${radioStatQuery(radio)}`
    ),
  getBatteryHistory: (radio?: RadioStatFilter) =>
    fetchJson<BatteryHistoryStats>(
      radio ? `/statistics/battery?${radioStatQuery(radio).slice(1)}` : '/statistics/battery'
    ),
  getBatteryRange: (startTs: number, endTs: number, radio?: RadioStatFilter) =>
    fetchJson<BatterySample[]>(
      `/statistics/battery/range?start_ts=${startTs}&end_ts=${endTs}${radioStatQuery(radio)}`
    ),
  getAirtimeRange: (startTs: number, endTs: number, binCount = 40, radio?: RadioStatFilter) =>
    fetchJson<AirtimeSample[]>(
      `/statistics/airtime/range?start_ts=${startTs}&end_ts=${endTs}&bin_count=${binCount}${radioStatQuery(radio)}`
    ),
  /** Which contacts were heard (by advert) in each bin of the window (share card 4). */
  getMeshHealthHeardBins: (startTs: number, endTs: number, binCount: number) =>
    fetchJson<{
      start_ts: number;
      end_ts: number;
      bin_seconds: number;
      bins: { start_ts: number; keys: string[] }[];
    }>(`/packets/mesh-health/heard-bins?start_ts=${startTs}&end_ts=${endTs}&bin_count=${binCount}`),

  // Radio identities (plan 18)
  getRadioIdentities: () => fetchJson<RadioIdentityList>('/radio-identities'),
  confirmNewRadio: (id: number) =>
    fetchJson<RadioIdentity>(`/radio-identities/${id}/confirm-new`, { method: 'POST' }),
  replaceRadio: (
    id: number,
    body: { old_id: number; carry_stats: boolean; carry_owned: boolean; carry_note: boolean }
  ) =>
    fetchJson<RadioIdentity>(`/radio-identities/${id}/replace`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  answerLegacyHistory: (id: number, adopt: boolean) =>
    fetchJson<RadioIdentity>(`/radio-identities/${id}/legacy-history`, {
      method: 'POST',
      body: JSON.stringify({ adopt }),
    }),
  updateRadioLink: (oldId: number, body: { carry_stats: boolean; carry_owned: boolean }) =>
    fetchJson<RadioIdentity>(`/radio-identities/${oldId}/link`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  removeRadioLink: (oldId: number) =>
    fetchJson<RadioIdentity>(`/radio-identities/${oldId}/link`, { method: 'DELETE' }),
  updateRadioNotes: (id: number, notes: string | null) =>
    fetchJson<RadioIdentity>(`/radio-identities/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    }),
  removeRadio: (id: number, deleteStats: boolean) =>
    fetchJson<{ status: string }>(`/radio-identities/${id}?delete_stats=${deleteStats}`, {
      method: 'DELETE',
    }),
  getRawFeedStats: (startTs: number, endTs: number) =>
    fetchJson<RawFeedHistoricalStats>(
      `/packets/raw-feed-stats?start_ts=${startTs}&end_ts=${endTs}`
    ),

  // Granular repeater endpoints
  repeaterLogin: (publicKey: string, password: string) =>
    fetchJson<RepeaterLoginResponse>(`/contacts/${publicKey}/repeater/login`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  repeaterStatus: (publicKey: string) =>
    fetchJson<RepeaterStatusResponse>(`/contacts/${publicKey}/repeater/status`, {
      method: 'POST',
    }),
  repeaterNeighbors: (publicKey: string) =>
    fetchJson<RepeaterNeighborsResponse>(`/contacts/${publicKey}/repeater/neighbors`, {
      method: 'POST',
    }),
  repeaterNeighborHistory: (publicKey: string, sinceHours?: number) =>
    fetchJson<RepeaterNeighborHistoryResponse>(
      `/contacts/${publicKey}/repeater/neighbors/history` +
        (sinceHours ? `?since_hours=${sinceHours}` : '')
    ),
  repeaterNodeInfo: (publicKey: string) =>
    fetchJson<RepeaterNodeInfoResponse>(`/contacts/${publicKey}/repeater/node-info`, {
      method: 'POST',
    }),
  repeaterAcl: (publicKey: string) =>
    fetchJson<RepeaterAclResponse>(`/contacts/${publicKey}/repeater/acl`, {
      method: 'POST',
    }),
  repeaterRadioSettings: (publicKey: string) =>
    fetchJson<RepeaterRadioSettingsResponse>(`/contacts/${publicKey}/repeater/radio-settings`, {
      method: 'POST',
    }),
  // Structured settings editor. Each set is ONE CLI message over RF; the
  // server validates against an allow-list and reads the value back.
  repeaterSettingsRead: (publicKey: string, settings?: string[]) =>
    fetchJson<RepeaterSettingsReadResponse>(`/contacts/${publicKey}/repeater/settings/read`, {
      method: 'POST',
      body: JSON.stringify({ settings: settings ?? null }),
    }),
  repeaterSettingSet: (publicKey: string, setting: string, value: string) =>
    fetchJson<RepeaterSettingSetResponse>(`/contacts/${publicKey}/repeater/settings/set`, {
      method: 'POST',
      body: JSON.stringify({ setting, value }),
    }),
  // SNMP polling of observer firmware nodes. LAN only (UDP), no radio access,
  // except discoverSnmpAddress, which sends ONE CLI command over RF.
  getSnmpConfig: (publicKey: string, signal?: AbortSignal) =>
    fetchJson<ContactSnmpConfig | null>(`/contacts/${publicKey}/snmp/config`, { signal }),
  saveSnmpConfig: (publicKey: string, update: ContactSnmpConfigUpdate) =>
    fetchJson<ContactSnmpConfig>(`/contacts/${publicKey}/snmp/config`, {
      method: 'PUT',
      body: JSON.stringify(update),
    }),
  deleteSnmpConfig: (publicKey: string) =>
    fetchJson<{ status: string; deleted: boolean }>(`/contacts/${publicKey}/snmp/config`, {
      method: 'DELETE',
    }),
  pollSnmp: (publicKey: string) =>
    fetchJson<SnmpPollResponse>(`/contacts/${publicKey}/snmp/poll`, { method: 'POST' }),
  snmpHistory: (publicKey: string, hours: number, signal?: AbortSignal) =>
    fetchJson<SnmpHistoryEntry[]>(`/contacts/${publicKey}/snmp/history?hours=${hours}`, { signal }),
  // Stored polls from startTs up to endTs (now when left out), oldest first.
  snmpHistoryRange: (publicKey: string, startTs: number, endTs?: number, signal?: AbortSignal) =>
    fetchJson<SnmpHistoryEntry[]>(
      `/contacts/${publicKey}/snmp/history?start=${startTs}${endTs === undefined ? '' : `&end=${endTs}`}`,
      { signal }
    ),
  // Every contact with SNMP set up, with its newest stored poll (read-only).
  snmpNodes: (signal?: AbortSignal) => fetchJson<SnmpNodeOverview[]>('/snmp/nodes', { signal }),
  // LAN discovery (Tools > Network scan): LAN traffic from the server, never RF.
  lanScanSuggestions: (signal?: AbortSignal) =>
    fetchJson<LanScanSuggestions>('/lan-discovery/suggestions', { signal }),
  lanScanStatus: (signal?: AbortSignal) =>
    fetchJson<LanScanStatus | null>('/lan-discovery/scan', { signal }),
  startLanScan: (request: LanScanRequest) =>
    fetchJson<LanScanStatus>('/lan-discovery/scan', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  cancelLanScan: () =>
    fetchJson<LanScanStatus | null>('/lan-discovery/scan/cancel', { method: 'POST' }),
  // Fleet asset register (Tools > Fleet). Stored data only: nothing here uses the radio.
  fleetAssets: (signal?: AbortSignal) => fetchJson<FleetAsset[]>('/fleet/assets', { signal }),
  fleetAssetForKey: (publicKey: string, signal?: AbortSignal) =>
    fetchJson<FleetAsset[]>(`/fleet/assets?public_key=${encodeURIComponent(publicKey)}`, {
      signal,
    }).then((assets) => assets[0] ?? null),
  fleetAsset: (id: number, signal?: AbortSignal) =>
    fetchJson<FleetAsset>(`/fleet/assets/${id}`, { signal }),
  createFleetAsset: (fields: Partial<FleetAssetFields>) =>
    fetchJson<FleetAsset>('/fleet/assets', { method: 'POST', body: JSON.stringify(fields) }),
  updateFleetAsset: (id: number, changes: Partial<FleetAssetFields>) =>
    fetchJson<FleetAsset>(`/fleet/assets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
  deleteFleetAsset: (id: number) =>
    fetchJson<{ status: string }>(`/fleet/assets/${id}`, { method: 'DELETE' }),
  addFleetAssetsFromContacts: (publicKeys: string[]) =>
    fetchJson<FleetAssetsFromContactsResponse>('/fleet/assets/from-contacts', {
      method: 'POST',
      body: JSON.stringify({ public_keys: publicKeys }),
    }),
  fleetAssetEvents: (id: number, signal?: AbortSignal) =>
    fetchJson<FleetAssetEvent[]>(`/fleet/assets/${id}/events`, { signal }),
  addFleetAssetEvent: (id: number, event: FleetAssetEventInput) =>
    fetchJson<FleetAssetEvent>(`/fleet/assets/${id}/events`, {
      method: 'POST',
      body: JSON.stringify(event),
    }),
  deleteFleetAssetEvent: (id: number, eventId: number) =>
    fetchJson<{ status: string }>(`/fleet/assets/${id}/events/${eventId}`, { method: 'DELETE' }),
  fleetSettings: (signal?: AbortSignal) => fetchJson<FleetSettings>('/fleet/settings', { signal }),
  saveFleetSettings: (settings: FleetSettings) =>
    fetchJson<FleetSettings>('/fleet/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  // Fleet key vault. The session token travels in a header and is never stored.
  fleetVaultStatus: (signal?: AbortSignal) =>
    fetchJson<FleetVaultStatus>('/fleet/vault', { signal, headers: fleetVaultHeaders() }),
  initFleetVault: (passphrase: string) =>
    fetchJson<FleetVaultSession>('/fleet/vault/init', {
      method: 'POST',
      body: JSON.stringify({ passphrase }),
    }),
  unlockFleetVault: (passphrase: string) =>
    fetchJson<FleetVaultSession>('/fleet/vault/unlock', {
      method: 'POST',
      body: JSON.stringify({ passphrase }),
    }),
  lockFleetVault: () =>
    fetchJson<{ status: string }>('/fleet/vault/lock', {
      method: 'POST',
      headers: fleetVaultHeaders(),
    }),
  changeFleetVaultPassphrase: (current: string, next: string) =>
    fetchJson<FleetVaultSession>('/fleet/vault/passphrase', {
      method: 'POST',
      body: JSON.stringify({ current, new: next }),
      headers: fleetVaultHeaders(),
    }),
  fleetVaultAudit: (signal?: AbortSignal) =>
    fetchJson<FleetAuditEntry[]>('/fleet/vault/audit', { signal, headers: fleetVaultHeaders() }),
  exportFleetVault: (passphrase: string) =>
    fetchJson<Record<string, unknown>>('/fleet/vault/export', {
      method: 'POST',
      body: JSON.stringify({ passphrase }),
      headers: fleetVaultHeaders(),
    }),
  importFleetVault: (passphrase: string, document: unknown) =>
    fetchJson<{ imported: number; skipped: number }>('/fleet/vault/import', {
      method: 'POST',
      body: JSON.stringify({ passphrase, document }),
      headers: fleetVaultHeaders(),
    }),
  fleetSecrets: (assetId: number, signal?: AbortSignal) =>
    fetchJson<FleetSecret[]>(`/fleet/assets/${assetId}/secrets`, {
      signal,
      headers: fleetVaultHeaders(),
    }),
  addFleetSecret: (assetId: number, kind: FleetSecretKind, label: string | null, value: string) =>
    fetchJson<FleetSecret>(`/fleet/assets/${assetId}/secrets`, {
      method: 'POST',
      body: JSON.stringify({ kind, label, value }),
      headers: fleetVaultHeaders(),
    }),
  revealFleetSecret: (secretId: number) =>
    fetchJson<{ value: string }>(`/fleet/secrets/${secretId}/reveal`, {
      method: 'POST',
      headers: fleetVaultHeaders(),
    }),
  deleteFleetSecret: (secretId: number) =>
    fetchJson<{ status: string }>(`/fleet/secrets/${secretId}`, {
      method: 'DELETE',
      headers: fleetVaultHeaders(),
    }),
  generateFleetKey: (assetId: number, prefix: string, freeBytes: 0 | 1 | 2) =>
    fetchJson<FleetGenerateKeyResult>(`/fleet/assets/${assetId}/generate-key`, {
      method: 'POST',
      body: JSON.stringify({ prefix, free_bytes: freeBytes }),
      headers: fleetVaultHeaders(),
    }),
  // Fleet config library. Stored files only: nothing here reaches a device.
  fleetConfigs: (assetId: number, signal?: AbortSignal) =>
    fetchJson<FleetConfigSummary[]>(`/fleet/assets/${assetId}/configs`, { signal }),
  // The vault token goes along: with the vault unlocked the file's secrets are kept.
  importFleetConfig: (assetId: number, input: FleetConfigImportInput) =>
    fetchJson<FleetConfigImportResult>(`/fleet/assets/${assetId}/configs/import`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: fleetVaultHeaders(),
    }),
  fleetConfig: (configId: number, signal?: AbortSignal) =>
    fetchJson<FleetConfig>(`/fleet/configs/${configId}`, { signal }),
  updateFleetConfig: (
    configId: number,
    changes: Partial<Pick<FleetConfig, 'profile' | 'role' | 'firmware_version' | 'label'>>
  ) =>
    fetchJson<FleetConfig>(`/fleet/configs/${configId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),
  deleteFleetConfig: (configId: number) =>
    fetchJson<{ status: string }>(`/fleet/configs/${configId}`, { method: 'DELETE' }),
  exportFleetConfig: (configId: number, includeSecrets: boolean) =>
    fetchJson<FleetConfigExport>(`/fleet/configs/${configId}/export`, {
      method: 'POST',
      body: JSON.stringify({ include_secrets: includeSecrets }),
      headers: includeSecrets ? fleetVaultHeaders() : {},
    }),
  // Stored pane snapshots and SNMP polls only: this never asks the node.
  fleetConfigReported: (configId: number, signal?: AbortSignal) =>
    fetchJson<FleetConfigReported>(`/fleet/configs/${configId}/reported`, { signal }),
  saveFleetConfigAsTemplate: (configId: number, name: string, description: string | null) =>
    fetchJson<FleetConfigTemplate>(`/fleet/configs/${configId}/template`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  // templateId null with includePrivateKey: a config holding only the asset's
  // own private key (as its vault id), for onboarding with a new key.
  createFleetConfigFromTemplate: (
    assetId: number,
    templateId: number | null,
    values: Record<string, string>,
    label: string | null,
    includePrivateKey = false
  ) =>
    fetchJson<FleetConfig>(`/fleet/assets/${assetId}/configs/from-template`, {
      method: 'POST',
      body: JSON.stringify({
        template_id: templateId,
        values,
        label,
        include_private_key: includePrivateKey,
      }),
      headers: includePrivateKey ? fleetVaultHeaders() : {},
    }),
  fleetConfigTemplates: (signal?: AbortSignal) =>
    fetchJson<FleetConfigTemplate[]>('/fleet/config-templates', { signal }),
  createFleetConfigTemplate: (template: FleetConfigTemplateFields) =>
    fetchJson<FleetConfigTemplate>('/fleet/config-templates', {
      method: 'POST',
      body: JSON.stringify(template),
    }),
  updateFleetConfigTemplate: (templateId: number, template: FleetConfigTemplateFields) =>
    fetchJson<FleetConfigTemplate>(`/fleet/config-templates/${templateId}`, {
      method: 'PATCH',
      body: JSON.stringify(template),
    }),
  deleteFleetConfigTemplate: (templateId: number) =>
    fetchJson<{ status: string }>(`/fleet/config-templates/${templateId}`, { method: 'DELETE' }),
  // Plan 32 Phase 3: a device on a USB cable in this browser. The server never
  // opens a port: it gets the replies and answers with commands or a file.
  fleetDeviceReadStep: (replies: FleetDeviceReplies) =>
    fetchJson<FleetDeviceReadStep>('/fleet/device/read-step', {
      method: 'POST',
      body: JSON.stringify({ replies }),
    }),
  storeFleetDeviceRead: (
    assetId: number,
    replies: FleetDeviceReplies,
    label: string | null,
    setPublicKey: boolean
  ) =>
    fetchJson<FleetDeviceReadStoreResult>(`/fleet/assets/${assetId}/configs/read`, {
      method: 'POST',
      body: JSON.stringify({ replies, label, set_public_key: setPublicKey }),
      headers: fleetVaultHeaders(),
    }),
  fleetConfigApplyPlan: (
    configId: number,
    replies: FleetDeviceReplies,
    allowPrivateKey: boolean,
    allowRadio: boolean
  ) =>
    fetchJson<FleetApplyPlan>(`/fleet/configs/${configId}/apply-plan`, {
      method: 'POST',
      body: JSON.stringify({
        replies,
        allow_private_key: allowPrivateKey,
        allow_radio: allowRadio,
      }),
      headers: fleetVaultHeaders(),
    }),
  checkFleetApplyStep: (step: FleetApplyStep, reply: string | null, readback: FleetDeviceReplies) =>
    fetchJson<FleetApplyCheck>('/fleet/device/check', {
      method: 'POST',
      body: JSON.stringify({ step, reply, readback }),
    }),
  logFleetConfigApply: (configId: number, input: FleetApplyLogInput) =>
    fetchJson<FleetAssetEvent>(`/fleet/configs/${configId}/apply-log`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getSnmpAgent: (signal?: AbortSignal) => fetchJson<SnmpAgentState>('/snmp-agent', { signal }),
  saveSnmpAgent: (settings: SnmpAgentSettings) =>
    fetchJson<SnmpAgentState>('/snmp-agent', { method: 'PUT', body: JSON.stringify(settings) }),
  discoverSnmpAddress: (publicKey: string) =>
    fetchJson<SnmpDiscoverAddressResponse>(`/contacts/${publicKey}/snmp/discover-address`, {
      method: 'POST',
    }),
  repeaterAdvertIntervals: (publicKey: string) =>
    fetchJson<RepeaterAdvertIntervalsResponse>(`/contacts/${publicKey}/repeater/advert-intervals`, {
      method: 'POST',
    }),
  repeaterOwnerInfo: (publicKey: string) =>
    fetchJson<RepeaterOwnerInfoResponse>(`/contacts/${publicKey}/repeater/owner-info`, {
      method: 'POST',
    }),
  resolveContactName: (publicKey: string, force = false) =>
    fetchJson<ResolveNameResponse>(
      `/contacts/${publicKey}/resolve-name${force ? '?force=true' : ''}`,
      { method: 'POST' }
    ),
  resolveContactNames: () =>
    fetchJson<ResolveNamesBulkResponse>('/contacts/resolve-names', { method: 'POST' }),
  updateContactAnnotations: (publicKey: string, update: ContactAnnotationsUpdate) =>
    fetchJson<{ status: string; public_key: string }>(`/contacts/${publicKey}/annotations`, {
      method: 'POST',
      body: JSON.stringify(update),
    }),
  repeaterRegions: (publicKey: string) =>
    fetchJson<RepeaterRegionsResponse>(`/contacts/${publicKey}/repeater/regions`, {
      method: 'POST',
    }),
  repeaterLppTelemetry: (publicKey: string) =>
    fetchJson<RepeaterLppTelemetryResponse>(`/contacts/${publicKey}/repeater/lpp-telemetry`, {
      method: 'POST',
    }),
  repeaterTelemetryHistory: (publicKey: string) =>
    fetchJson<TelemetryHistoryEntry[]>(`/contacts/${publicKey}/repeater/telemetry-history`),
  // Stored pane snapshots (plan 14), read-only: no radio access.
  repeaterConfigHistory: (publicKey: string) =>
    fetchJson<DeviceConfigHistoryEntry[]>(`/contacts/${publicKey}/repeater/config-history`),
  roomConfigHistory: (publicKey: string) =>
    fetchJson<DeviceConfigHistoryEntry[]>(`/contacts/${publicKey}/room/config-history`),
  contactLocationHistory: (publicKey: string) =>
    fetchJson<ContactLocationHistoryEntry[]>(`/contacts/${publicKey}/location-history`),
  contactRouteSuggestions: (publicKey: string, validate = false) =>
    fetchJson<ContactRouteSuggestions>(
      `/contacts/${publicKey}/route-suggestions${validate ? '?validate=true' : ''}`
    ),
  // Contact telemetry (universal, any contact type)
  requestContactTelemetry: (publicKey: string) =>
    fetchJson<ContactTelemetryResponse>(`/contacts/${publicKey}/telemetry`, {
      method: 'POST',
    }),
  contactTelemetryHistory: (publicKey: string) =>
    fetchJson<TelemetryHistoryEntry[]>(`/contacts/${publicKey}/telemetry-history`),
  // resyncHistory makes the room server send every post it still holds again
  // (up to 32, over RF). Leave it off for a normal login.
  roomLogin: (publicKey: string, password: string, resyncHistory = false) =>
    fetchJson<RepeaterLoginResponse>(`/contacts/${publicKey}/room/login`, {
      method: 'POST',
      body: JSON.stringify(resyncHistory ? { password, resync_history: true } : { password }),
    }),
  roomStatus: (publicKey: string) =>
    fetchJson<RepeaterStatusResponse>(`/contacts/${publicKey}/room/status`, {
      method: 'POST',
    }),
  roomAcl: (publicKey: string) =>
    fetchJson<RepeaterAclResponse>(`/contacts/${publicKey}/room/acl`, {
      method: 'POST',
    }),
  roomLppTelemetry: (publicKey: string) =>
    fetchJson<RepeaterLppTelemetryResponse>(`/contacts/${publicKey}/room/lpp-telemetry`, {
      method: 'POST',
    }),

  // Push Notifications
  getVapidPublicKey: () => fetchJson<{ public_key: string }>('/push/vapid-public-key'),
  pushSubscribe: (subscription: {
    endpoint: string;
    p256dh: string;
    auth: string;
    label?: string;
  }) =>
    fetchJson<PushSubscriptionInfo>('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),
  getPushSubscriptions: () => fetchJson<PushSubscriptionInfo[]>('/push/subscriptions'),
  deletePushSubscription: (id: string) =>
    fetchJson<{ deleted: boolean }>(`/push/subscriptions/${id}`, { method: 'DELETE' }),
  testPushSubscription: (id: string) =>
    fetchJson<{ status: string }>(`/push/subscriptions/${id}/test`, { method: 'POST' }),
  getPushConversations: () => fetchJson<string[]>('/push/conversations'),
  togglePushConversation: (key: string) =>
    fetchJson<string[]>('/push/conversations/toggle', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  // Custom wordlists (channel finder)
  listWordlists: () => fetchJson<{ wordlists: WordlistMeta[] }>('/wordlists'),
  getWordlistWords: (id: number) => fetchJson<{ words: string[] }>(`/wordlists/${id}/words`),
  uploadWordlist: async (name: string, file: File): Promise<WordlistMeta> => {
    const form = new FormData();
    form.append('name', name);
    form.append('file', file);
    // Raw fetch so the browser sets multipart/form-data (not application/json).
    const res = await fetch(`${API_BASE}/wordlists`, { method: 'POST', body: form });
    if (!res.ok) {
      const text = await res.text();
      let msg = text || res.statusText;
      try {
        const j = JSON.parse(text);
        if (j.detail) msg = j.detail;
      } catch {
        /* raw text */
      }
      throw new Error(msg);
    }
    return res.json() as Promise<WordlistMeta>;
  },
  deleteWordlist: async (id: number): Promise<void> => {
    // DELETE returns 204 (no body), so avoid fetchJson's res.json().
    const res = await fetch(`${API_BASE}/wordlists/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      throw new ApiError('Failed to delete wordlist', res.status);
    }
  },
};
