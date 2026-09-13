import type {
  AdvertLinkEdge,
  AppSettings,
  AppSettingsUpdate,
  UrlPreview,
  ExternalMapNode,
  ExternalMapStatus,
  BulkCreateHashtagChannelsResult,
  ChannelImportResult,
  Channel,
  ChannelDetail,
  CommandResponse,
  Contact,
  ContactAnalytics,
  ContactAdvertPathSummary,
  LatestTelemetry,
  ContactRadioResidency,
  ContactTelemetryResponse,
  RadioContactOccupancy,
  RadioPolicy,
  FanoutConfig,
  HealthStatus,
  MaintenanceResult,
  MeshcomodConfig,
  MeshcomodConfigUpdate,
  Message,
  OpenHopStatus,
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
  PathDiscoveryResponse,
  PushSubscriptionInfo,
  ResendChannelMessageResponse,
  RepeaterAclResponse,
  RepeaterAdvertIntervalsResponse,
  RepeaterLoginResponse,
  RepeaterLppTelemetryResponse,
  RepeaterNeighborHistoryResponse,
  RepeaterNeighborsResponse,
  RepeaterNodeInfoResponse,
  RepeaterOwnerInfoResponse,
  ContactAnnotationsUpdate,
  RepeaterRadioSettingsResponse,
  RepeaterRegionsResponse,
  RepeaterStatusResponse,
  TelemetryHistoryEntry,
  TelemetrySchedule,
  TrackedTelemetryContactsResponse,
  TrackedTelemetryResponse,
  BatteryHistoryStats,
  AirtimeSample,
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

const API_BASE = './api';

/** Error thrown by API calls, carrying the HTTP status so callers can tell
 * retryable failures from ones the mesh already answered (e.g. 422 timeouts). */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
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
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.detail) {
        errorMessage = errorJson.detail;
      }
    } catch {
      // Not JSON, use raw text
    }
    throw new ApiError(errorMessage, res.status);
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

interface BackupSaveResult {
  path: string;
  size_bytes: number;
  timestamp: string;
}

export const api = {
  // Health
  getHealth: () => fetchJson<HealthStatus>('/health'),

  // Update check
  getUpdateStatus: () => fetchJson<UpdateStatus>('/update-status'),

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
  getAdvertLinks: (signal?: AbortSignal) =>
    fetchJson<AdvertLinkEdge[]>('/packets/advert-links', { signal }),
  getContactAnalytics: (params: { publicKey?: string; name?: string }, signal?: AbortSignal) => {
    const searchParams = new URLSearchParams();
    if (params.publicKey) searchParams.set('public_key', params.publicKey);
    if (params.name) searchParams.set('name', params.name);
    return fetchJson<ContactAnalytics>(`/contacts/analytics?${searchParams.toString()}`, {
      signal,
    });
  },
  deleteContact: (publicKey: string) =>
    fetchJson<{ status: string }>(`/contacts/${publicKey}`, {
      method: 'DELETE',
    }),
  bulkDeleteContacts: (publicKeys: string[]) =>
    fetchJson<{ deleted: number }>('/contacts/bulk-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_keys: publicKeys }),
    }),
  createContact: (publicKey: string, name?: string, tryHistorical?: boolean, type?: number) =>
    fetchJson<Contact>('/contacts', {
      method: 'POST',
      body: JSON.stringify({ public_key: publicKey, name, type, try_historical: tryHistorical }),
    }),
  markContactRead: (publicKey: string) =>
    fetchJson<{ status: string; public_key: string }>(`/contacts/${publicKey}/mark-read`, {
      method: 'POST',
    }),
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
  markChannelRead: (key: string) =>
    fetchJson<{ status: string; key: string }>(`/channels/${key}/mark-read`, {
      method: 'POST',
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

  // Packets
  getRecentPackets: (params?: { afterTs?: number; beforeTs?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.afterTs !== undefined) qs.set('after_ts', String(params.afterTs));
    if (params?.beforeTs !== undefined) qs.set('before_ts', String(params.beforeTs));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const query = qs.toString();
    return fetchJson<RawPacket[]>(`/packets/recent${query ? `?${query}` : ''}`);
  },
  getPacket: (packetId: number) => fetchJson<RawPacket>(`/packets/${packetId}`),
  getUndecryptedPacketCount: () => fetchJson<{ count: number }>('/packets/undecrypted/count'),
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

  // Backup
  downloadBackupUrl: () => `${API_BASE}/backup/download`,
  saveBackup: () =>
    fetchJson<BackupSaveResult>('/backup/save', {
      method: 'POST',
    }),

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

  // Chat link preview (unfurl)
  unfurl: (url: string, signal?: AbortSignal) =>
    fetchJson<UrlPreview>(`/unfurl?url=${encodeURIComponent(url)}`, { signal }),

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
  disableBotsUntilRestart: () =>
    fetchJson<{
      status: string;
      bots_disabled: boolean;
      bots_disabled_source: 'env' | 'until_restart';
    }>('/fanout/bots/disable-until-restart', {
      method: 'POST',
    }),

  // Statistics
  getStatistics: () => fetchJson<StatisticsResponse>('/statistics'),
  getNoiseFloorHistory: (startTs: number, endTs: number) =>
    fetchJson<NoiseFloorSample[]>(`/statistics/noise-floor?start_ts=${startTs}&end_ts=${endTs}`),
  getBatteryHistory: () => fetchJson<BatteryHistoryStats>('/statistics/battery'),
  getBatteryRange: (startTs: number, endTs: number) =>
    fetchJson<BatterySample[]>(`/statistics/battery/range?start_ts=${startTs}&end_ts=${endTs}`),
  getAirtimeRange: (startTs: number, endTs: number, binCount = 40) =>
    fetchJson<AirtimeSample[]>(
      `/statistics/airtime/range?start_ts=${startTs}&end_ts=${endTs}&bin_count=${binCount}`
    ),
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
  repeaterAdvertIntervals: (publicKey: string) =>
    fetchJson<RepeaterAdvertIntervalsResponse>(`/contacts/${publicKey}/repeater/advert-intervals`, {
      method: 'POST',
    }),
  repeaterOwnerInfo: (publicKey: string) =>
    fetchJson<RepeaterOwnerInfoResponse>(`/contacts/${publicKey}/repeater/owner-info`, {
      method: 'POST',
    }),
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
  // Contact telemetry (universal, any contact type)
  requestContactTelemetry: (publicKey: string) =>
    fetchJson<ContactTelemetryResponse>(`/contacts/${publicKey}/telemetry`, {
      method: 'POST',
    }),
  contactTelemetryHistory: (publicKey: string) =>
    fetchJson<TelemetryHistoryEntry[]>(`/contacts/${publicKey}/telemetry-history`),
  roomLogin: (publicKey: string, password: string) =>
    fetchJson<RepeaterLoginResponse>(`/contacts/${publicKey}/room/login`, {
      method: 'POST',
      body: JSON.stringify({ password }),
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
