interface RadioSettings {
  freq: number;
  bw: number;
  sf: number;
  cr: number;
}

export interface RadioConfig {
  public_key: string;
  name: string;
  lat: number;
  lon: number;
  tx_power: number;
  max_tx_power: number;
  radio: RadioSettings;
  path_hash_mode: number;
  path_hash_mode_supported: boolean;
  advert_location_source?: 'off' | 'current';
  multi_acks_enabled?: boolean;
  telemetry_mode_base?: number;
  telemetry_mode_loc?: number;
  telemetry_mode_env?: number;
}

export interface RadioConfigUpdate {
  name?: string;
  lat?: number;
  lon?: number;
  tx_power?: number;
  radio?: RadioSettings;
  path_hash_mode?: number;
  advert_location_source?: 'off' | 'current';
  multi_acks_enabled?: boolean;
  telemetry_mode_base?: number;
  telemetry_mode_loc?: number;
  telemetry_mode_env?: number;
}

export interface RadioPresetEntry {
  name: string;
  freq: number;
  bw: number;
  sf: number;
  cr: number;
}

export interface RadioPresetsStore {
  entries: RadioPresetEntry[];
  info_message: string;
  /** Unix seconds of the last successful sync, or null if never synced. */
  synced_at: number | null;
  source_url: string;
}

export interface MeshcomodConfig {
  cad_supported: boolean;
  cad_enabled: boolean | null;
  gps_supported: boolean;
  gps_enabled: boolean | null;
  gps_interval: number | null;
}

export interface MeshcomodConfigUpdate {
  cad_enabled?: boolean;
  gps_enabled?: boolean;
  gps_interval?: number;
}

export type RadioDiscoveryTarget = 'repeaters' | 'sensors' | 'all';

export interface RadioDiscoveryResult {
  public_key: string;
  name: string | null;
  node_type: 'repeater' | 'sensor';
  heard_count: number;
  local_snr: number | null;
  local_rssi: number | null;
  remote_snr: number | null;
}

export interface RadioDiscoveryResponse {
  target: RadioDiscoveryTarget;
  duration_seconds: number;
  results: RadioDiscoveryResult[];
}

export interface RadioRegionDiscoveryRepeater {
  public_key: string;
  name: string | null;
  answered: boolean;
  regions: string[];
}

export interface RadioRegionDiscoveryResponse {
  repeaters_queried: number;
  repeaters_answered: number;
  /** Deduplicated union of flood-allowed region names across all repeaters. */
  regions: string[];
  results: RadioRegionDiscoveryRepeater[];
}

export type RadioAdvertMode = 'flood' | 'zero_hop';

export interface FanoutStatusEntry {
  name: string;
  type: string;
  status: string;
  last_error?: string | null;
}

export interface AppInfo {
  version: string;
  commit_hash: string | null;
}

export interface UpdateStatus {
  check_enabled: boolean;
  update_available: boolean;
  current_commit: string | null;
  latest_commit: string | null;
  commits_behind: number;
  compare_url: string | null;
  checked_at: number;
}

export interface RadioStatsSnapshot {
  timestamp: number | null;
  battery_mv: number | null;
  uptime_secs: number | null;
  queue_len: number | null;
  errors: number | null;
  noise_floor: number | null;
  last_rssi: number | null;
  last_snr: number | null;
  tx_air_secs: number | null;
  rx_air_secs: number | null;
  packets_recv: number | null;
  packets_sent: number | null;
  flood_tx: number | null;
  direct_tx: number | null;
  flood_rx: number | null;
  direct_rx: number | null;
}

export interface HealthStatus {
  status: string;
  radio_connected: boolean;
  radio_initializing: boolean;
  radio_state?: 'connected' | 'initializing' | 'connecting' | 'disconnected' | 'paused';
  connection_info: string | null;
  app_info?: AppInfo | null;
  radio_device_info?: {
    model: string | null;
    firmware_build: string | null;
    firmware_version: string | null;
    max_contacts: number | null;
    max_channels: number | null;
    is_meshcomod: boolean;
    is_openhop: boolean;
  } | null;
  radio_stats?: RadioStatsSnapshot | null;
  database_size_mb: number;
  oldest_undecrypted_timestamp: number | null;
  fanout_statuses: Record<string, FanoutStatusEntry>;
  bots_disabled: boolean;
  bots_disabled_source?: 'env' | 'until_restart' | null;
  basic_auth_enabled?: boolean;
}

export interface FanoutConfig {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  scope: Record<string, unknown>;
  sort_order: number;
  created_at: number;
}

export interface MaintenanceResult {
  packets_deleted: number;
  vacuumed: boolean;
}

export interface Contact {
  public_key: string;
  name: string | null;
  type: number;
  flags: number;
  direct_path: string | null;
  direct_path_len: number;
  direct_path_hash_mode: number;
  direct_path_updated_at?: number | null;
  route_override_path?: string | null;
  route_override_len?: number | null;
  route_override_hash_mode?: number | null;
  effective_route?: ContactRoute | null;
  effective_route_source?: 'override' | 'direct' | 'flood';
  direct_route?: ContactRoute | null;
  route_override?: ContactRoute | null;
  last_advert: number | null;
  lat: number | null;
  lon: number | null;
  last_seen: number | null;
  on_radio: boolean;
  favorite: boolean;
  radio_policy: RadioPolicy;
  last_contacted: number | null;
  last_read_at: number | null;
  first_seen: number | null;
  notes?: string | null;
  owner_info?: string | null;
  owner_key?: string | null;
  manual_lat?: number | null;
  manual_lon?: number | null;
}

export type RadioPolicy = 'auto' | 'pinned' | 'excluded';

export interface ContactAnnotationsUpdate {
  notes?: string | null;
  owner_info?: string | null;
  owner_key?: string | null;
  manual_lat?: number | null;
  manual_lon?: number | null;
}

export type RadioResidencyReason = 'pinned' | 'favorite' | 'recent-dm' | 'recent-advert';

export interface ContactRadioResidency {
  public_key: string;
  reason: RadioResidencyReason;
}

export interface RadioContactOccupancy {
  configured: number;
  hardware_limit: number | null;
  effective_capacity: number;
  refill_target: number;
  full_sync_trigger: number;
  selected_count: number;
}

export interface ContactRoute {
  path: string;
  path_len: number;
  path_hash_mode: number;
}

export interface ContactAdvertPath {
  path: string;
  path_len: number;
  next_hop: string | null;
  first_seen: number;
  last_seen: number;
  heard_count: number;
}

export interface ContactAdvertPathSummary {
  public_key: string;
  paths: ContactAdvertPath[];
}

export interface ContactNameHistory {
  name: string;
  first_seen: number;
  last_seen: number;
}

export interface ContactActiveRoom {
  channel_key: string;
  channel_name: string;
  message_count: number;
}

export interface NearestRepeater {
  public_key: string;
  name: string | null;
  path_len: number;
  last_seen: number;
  heard_count: number;
}

export interface ContactAnalyticsHourlyBucket {
  bucket_start: number;
  last_24h_count: number;
  last_week_average: number;
  all_time_average: number;
}

export interface ContactAnalyticsWeeklyBucket {
  bucket_start: number;
  message_count: number;
}

export interface ContactAnalytics {
  lookup_type: 'contact' | 'name';
  name: string;
  contact: Contact | null;
  name_first_seen_at: number | null;
  name_history: ContactNameHistory[];
  dm_message_count: number;
  channel_message_count: number;
  includes_direct_messages: boolean;
  most_active_rooms: ContactActiveRoom[];
  advert_paths: ContactAdvertPath[];
  advert_frequency: number | null;
  nearest_repeaters: NearestRepeater[];
  hourly_activity: ContactAnalyticsHourlyBucket[];
  weekly_activity: ContactAnalyticsWeeklyBucket[];
}

export interface Channel {
  key: string;
  name: string;
  is_hashtag: boolean;
  on_radio: boolean;
  flood_scope_override?: string | null;
  path_hash_mode_override?: number | null;
  last_read_at: number | null;
  favorite: boolean;
  muted: boolean;
}

export interface ChannelMessageCounts {
  last_1h: number;
  last_24h: number;
  last_48h: number;
  last_7d: number;
  all_time: number;
}

export interface ChannelTopSender {
  sender_name: string;
  sender_key: string | null;
  message_count: number;
}

export interface BulkCreateHashtagChannelsResult {
  created_channels: Channel[];
  existing_count: number;
  invalid_names: string[];
  decrypt_started: boolean;
  decrypt_total_packets: number;
  message: string;
}

export interface ChannelImportResult {
  imported_channels: Channel[];
  duplicate_count: number;
  invalid_lines: string[];
  decrypt_started: boolean;
  decrypt_total_packets: number;
  message: string;
}

export interface PathHashWidthStats {
  total_packets: number;
  single_byte: number;
  double_byte: number;
  triple_byte: number;
  single_byte_pct: number;
  double_byte_pct: number;
  triple_byte_pct: number;
}

export interface ChannelDetail {
  channel: Channel;
  message_counts: ChannelMessageCounts;
  first_message_at: number | null;
  unique_sender_count: number;
  top_senders_24h: ChannelTopSender[];
  path_hash_width_24h: PathHashWidthStats;
}

/** A single path that a message took to reach us */
export interface MessagePath {
  /** Hex-encoded routing path */
  path: string;
  /** Unix timestamp when this path was received */
  received_at: number;
  /** Hop count (number of intermediate nodes). Null for legacy data (infer as len(path)/2). */
  path_len?: number | null;
  /** Last-hop RSSI in dBm (null if not available, e.g. older data) */
  rssi?: number | null;
  /** Last-hop SNR in dB (null if not available, e.g. older data) */
  snr?: number | null;
}

export interface Message {
  id: number;
  type: 'PRIV' | 'CHAN';
  /** For PRIV: sender's PublicKey (or prefix). For CHAN: ChannelKey */
  conversation_key: string;
  text: string;
  sender_timestamp: number | null;
  received_at: number;
  /** List of routing paths this message arrived via. Null for outgoing messages. */
  paths: MessagePath[] | null;
  txt_type: number;
  signature: string | null;
  sender_key: string | null;
  outgoing: boolean;
  /** ACK count: 0 = not acked, 1+ = number of acks/flood echoes received */
  acked: number;
  sender_name: string | null;
  channel_name?: string | null;
  packet_id?: number | null;
  /** Region scope transport code (uint16) when this arrived via a transport-routed packet. */
  transport_code?: number | null;
  /** Resolved region name for the transport code, if it matched a known region. */
  region?: string | null;
}

export interface MessagesAroundResponse {
  messages: Message[];
  has_older: boolean;
  has_newer: boolean;
}

export interface ResendChannelMessageResponse {
  status: string;
  message_id: number;
  message?: Message;
}

type ConversationType =
  | 'contact'
  | 'channel'
  | 'raw'
  | 'map'
  | 'visualizer'
  | 'search'
  | 'trace'
  | 'channel-registry'
  | 'node'
  | 'mesh-health';

export interface Conversation {
  type: ConversationType;
  /** PublicKey for contacts, ChannelKey for channels, 'raw'/'map' for special views */
  id: string;
  name: string;
  /** For map view: public key prefix to focus on */
  mapFocusKey?: string;
  /** For map view: an arbitrary point to focus on */
  mapFocusLatLon?: [number, number];
  /** For map view: label to show on the focused point's popup */
  mapFocusLabel?: string;
}

export interface RawPacket {
  id: number;
  /** Per-observation WS identity (unique per RF arrival, may be absent in older payloads) */
  observation_id?: number;
  timestamp: number;
  data: string; // hex
  payload_type: string;
  snr: number | null; // Signal-to-noise ratio in dB
  rssi: number | null; // Received signal strength in dBm
  decrypted: boolean;
  decrypted_info: {
    channel_name: string | null;
    sender: string | null;
    channel_key: string | null;
    contact_key: string | null;
    sender_timestamp: number | null;
    message: string | null;
  } | null;
  /** Region scope transport code (uint16) for TransportFlood/TransportDirect packets. */
  transport_code?: number | null;
  /** Resolved region name for the transport code, if it matched a known region. */
  region?: string | null;
}

/** OpenGraph-style link preview returned by the /unfurl endpoint. */
export interface UrlPreview {
  url: string;
  title?: string | null;
  description?: string | null;
  image?: string | null;
  site_name?: string | null;
}

/** A user-configured external analyzer site for client-side node/packet lookups. */
export interface AnalyzerSite {
  name: string;
  /** URL template with a {pubkey} placeholder. */
  node_url_template: string;
  /** Optional URL template with a {hash} placeholder for packet lookups. */
  packet_url_template?: string | null;
  /**
   * Optional URL template for channel lookups. Supports a {name} placeholder
   * (channel display name, incl. leading # for hashtag channels) and/or a
   * {channel} placeholder (channel key). Every built-in analyzer uses {name}.
   */
  channel_url_template?: string | null;
}

export interface MentionSoundMeta {
  filename: string;
  content_type: string;
  size_bytes: number;
  updated_at: number;
}

/** Group of a Handy Info entry; decides its tab (links => Links, else Configure). */
export type HandyGroup = 'analyzers' | 'sync' | 'links';
/** Sub-heading category for open-only link entries in the Links tab. */
export type HandyLinkCategory = 'community' | 'monitoring' | 'tools' | 'technical' | 'fun';
/** Apply action of an apply-capable entry. */
export type HandyApplyKind = 'analyzer' | 'region_sync' | 'registry_sync';

/** Per-user override of a built-in Handy Info entry, keyed by the built-in id. */
export interface HandyInfoOverride {
  hidden?: boolean;
  label?: string | null;
  url?: string | null;
  category?: string | null;
  node_url_template?: string | null;
  packet_url_template?: string | null;
  channel_url_template?: string | null;
}

/** A user-created Handy Info entry (link or apply-capable preset). */
export interface HandyInfoCustomEntry {
  id: string;
  group: HandyGroup;
  category?: string | null;
  label: string;
  url: string;
  apply_kind?: HandyApplyKind | null;
  node_url_template?: string | null;
  packet_url_template?: string | null;
  channel_url_template?: string | null;
}

/** Persisted overlay for the Handy Info section. */
export interface HandyInfoSettings {
  overrides: Record<string, HandyInfoOverride>;
  custom: HandyInfoCustomEntry[];
}

export interface SidebarHidden {
  sections: string[];
  tools: string[];
  favorites: string[];
}

export interface AppSettings {
  max_radio_contacts: number;
  auto_decrypt_dm_on_advert: boolean;
  advert_retention_days: number;
  last_message_times: Record<string, number>;
  advert_interval: number;
  last_advert_time: number;
  flood_scope: string;
  known_regions: string[];
  blocked_keys: string[];
  blocked_names: string[];
  sidebar_section_order: string[];
  sidebar_tool_order: string[];
  sidebar_favorites_order: string[];
  sidebar_hidden: SidebarHidden;
  discovery_blocked_types: number[];
  tracked_telemetry_repeaters: string[];
  tracked_telemetry_contacts: string[];
  auto_resend_channel: boolean;
  telemetry_interval_hours: number;
  telemetry_routed_hourly: boolean;
  show_mention_ticker: boolean;
  mention_sound_enabled: boolean;
  mention_sound_choice: string;
  mention_sound_volume: number;
  mention_sound_custom: MentionSoundMeta | null;
  auto_add_mentioned_channels: boolean;
  chat_parse_pubkeys: boolean;
  chat_parse_coordinates: boolean;
  chat_url_previews: boolean;
  chat_linkify_urls: boolean;
  registry_sync_url: string;
  region_sync_url: string;
  wordlist_sync_url: string;
  analyzer_sites: AnalyzerSite[];
  handy_info: HandyInfoSettings;
  external_map_enabled: boolean;
  external_map_sync_url: string;
  external_map_sync_interval_hours: number;
  backup_to_path_enabled: boolean;
  backup_destination_path: string;
  brand_name: string;
  brand_hidden: boolean;
  brand_icon: string;
  openhop_api_url: string | null;
  openhop_api_token: string | null;
  openhop_api_token_set?: boolean;
}

/** Availability of the opt-in OpenHop REST management surface (never carries the token). */
export interface OpenHopStatus {
  configured: boolean;
  is_openhop: boolean;
  base_url: string | null;
}

export type OpenHopAction = 'allow' | 'drop' | 'log_only';
export type OpenHopOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'contains'
  | 'in'
  | 'starts_with';
export type OpenHopGroupKind = 'channel_hashes' | 'pubkeys';

export interface OpenHopSimpleCondition {
  field: string;
  op: OpenHopOperator;
  value: string;
}
export type OpenHopCondition =
  | OpenHopSimpleCondition
  | { all: OpenHopCondition[] }
  | { any: OpenHopCondition[] }
  | Record<string, never>;

export interface OpenHopRule {
  id: string;
  name: string;
  enabled: boolean;
  if: OpenHopCondition;
  then: { action: OpenHopAction };
}
export interface OpenHopPolicyEngine {
  enabled: boolean;
  default_action: OpenHopAction;
  rules: OpenHopRule[];
  objects: {
    channel_hash_groups: Record<string, string[]>;
    pubkey_groups: Record<string, string[]>;
  };
}
export interface OpenHopGroupEntry {
  id: string;
  friendly_name: string;
  value: string;
}
export interface OpenHopGroup {
  id: string;
  friendly_name: string;
  description: string;
  entries: OpenHopGroupEntry[];
}
export interface OpenHopPolicyDoc {
  policy_file: string;
  exists: boolean;
  policy_engine: OpenHopPolicyEngine;
  groups: {
    channel_hashes: OpenHopGroup[];
    pubkeys: OpenHopGroup[];
  };
}
/** Loose envelope for OpenHop replies: validate ({valid, normalized, effective}) or generic {success}. */
export interface OpenHopEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** An installed OpenHop plugin. Fields are permissive; the pane reads only what it renders. */
export interface OpenHopPlugin {
  id: string;
  name?: string;
  version?: string;
  enabled?: boolean;
  state?: string;
  running?: boolean;
  update_available?: boolean;
  latest_version?: string;
  [k: string]: unknown;
}

/** A curated catalogue entry available to install. */
export interface OpenHopCatalogueEntry {
  id: string;
  name?: string;
  description?: string;
  repository?: string;
  category?: string;
  version?: string;
  installed?: boolean;
  update_available?: boolean;
  [k: string]: unknown;
}

/** An event from the plugin install/update progress SSE stream. */
export type OpenHopPluginProgressEvent =
  | { type: 'connected'; id: string }
  | { type: 'line'; line: string }
  | { type: 'status'; state: string; operation?: string | null; started?: number | null }
  | { type: 'done'; state: string; error?: string | null; started?: number | null }
  | { type: 'keepalive' };

/** A located node synced from an external map/analyzer directory. */
export interface WordlistMeta {
  id: number;
  name: string;
  entry_count: number;
  size_bytes: number;
  created_at: number;
}

export interface ExternalMapNode {
  pubkey: string;
  name: string;
  role: string;
  lat: number;
  lon: number;
  last_seen: number | null;
  advert_count: number;
  mobile: boolean;
}

export interface AdvertLinkNode {
  pubkey: string;
  lat: number;
  lon: number;
  kind: 'self' | 'contact' | 'external';
}

export interface AdvertLinkEdge {
  a: AdvertLinkNode;
  b: AdvertLinkNode;
  hop_width: number;
  count: number;
  last_seen: number;
  ambiguous: boolean;
}

export interface ExternalMapStatus {
  enabled: boolean;
  count: number;
  last_synced_at: number | null;
  interval_hours: number;
}

export interface AppSettingsUpdate {
  max_radio_contacts?: number;
  auto_decrypt_dm_on_advert?: boolean;
  advert_retention_days?: number;
  advert_interval?: number;
  auto_resend_channel?: boolean;
  flood_scope?: string;
  known_regions?: string[];
  blocked_keys?: string[];
  blocked_names?: string[];
  sidebar_section_order?: string[];
  sidebar_tool_order?: string[];
  sidebar_favorites_order?: string[];
  sidebar_hidden?: SidebarHidden;
  discovery_blocked_types?: number[];
  telemetry_interval_hours?: number;
  telemetry_routed_hourly?: boolean;
  show_mention_ticker?: boolean;
  mention_sound_enabled?: boolean;
  mention_sound_choice?: string;
  mention_sound_volume?: number;
  auto_add_mentioned_channels?: boolean;
  chat_parse_pubkeys?: boolean;
  chat_parse_coordinates?: boolean;
  chat_url_previews?: boolean;
  chat_linkify_urls?: boolean;
  registry_sync_url?: string;
  region_sync_url?: string;
  wordlist_sync_url?: string;
  analyzer_sites?: AnalyzerSite[];
  handy_info?: HandyInfoSettings;
  external_map_enabled?: boolean;
  external_map_sync_url?: string;
  external_map_sync_interval_hours?: number;
  backup_to_path_enabled?: boolean;
  backup_destination_path?: string;
  brand_name?: string;
  brand_hidden?: boolean;
  brand_icon?: string;
  openhop_api_url?: string | null;
  openhop_api_token?: string | null;
}

export interface TelemetrySchedule {
  preferred_hours: number;
  effective_hours: number;
  options: number[];
  tracked_count: number;
  max_tracked: number;
  next_run_at: number | null;
  routed_hourly: boolean;
  next_routed_run_at: number | null;
}

export interface TrackedTelemetryResponse {
  tracked_telemetry_repeaters: string[];
  names: Record<string, string>;
  schedule: TelemetrySchedule;
}

/** Contact type constants (canonical table in AGENTS.md "Contact Types") */
export const CONTACT_TYPE_CLIENT = 1;
export const CONTACT_TYPE_REPEATER = 2;
export const CONTACT_TYPE_ROOM = 3;
export const CONTACT_TYPE_SENSOR = 4;

export interface NeighborInfo {
  pubkey_prefix: string;
  name: string | null;
  snr: number;
  last_heard_seconds: number;
}

export interface AclEntry {
  pubkey_prefix: string;
  name: string | null;
  permission: number;
  permission_name: string;
}

export interface CommandResponse {
  command: string;
  response: string;
  sender_timestamp: number | null;
}

// --- Granular repeater endpoint types ---

export interface RepeaterLoginResponse {
  status: string;
  authenticated: boolean;
  message: string | null;
}

export interface RepeaterStatusResponse {
  battery_volts: number;
  tx_queue_len: number;
  noise_floor_dbm: number;
  last_rssi_dbm: number;
  last_snr_db: number;
  packets_received: number;
  packets_sent: number;
  airtime_seconds: number;
  rx_airtime_seconds: number;
  uptime_seconds: number;
  sent_flood: number;
  sent_direct: number;
  recv_flood: number;
  recv_direct: number;
  flood_dups: number;
  direct_dups: number;
  full_events: number;
  recv_errors: number | null;
  telemetry_history: TelemetryHistoryEntry[];
}

export interface RepeaterNeighborsResponse {
  neighbors: NeighborInfo[];
  // Total neighbor count reported by the repeater firmware, independent of how many
  // entries were actually returned. Exceeds neighbors.length when a multi-chunk fetch
  // is incomplete. Null on older firmware / failed fetches.
  reported_count?: number | null;
}

export interface RepeaterSignalSample {
  observed_at: number;
  snr: number;
  secs_ago: number | null;
}

export interface SelfSignalSample {
  observed_at: number;
  snr: number;
  rssi: number | null;
}

export interface NeighborHistoryEntry {
  neighbor_pubkey: string;
  repeater_samples: RepeaterSignalSample[];
  self_samples: SelfSignalSample[];
}

export interface RepeaterNeighborHistoryResponse {
  neighbors: NeighborHistoryEntry[];
}

export interface RepeaterAclResponse {
  acl: AclEntry[];
}

export interface RepeaterNodeInfoResponse {
  name: string | null;
  lat: string | null;
  lon: string | null;
  clock_utc: string | null;
}

export interface RepeaterRadioSettingsResponse {
  firmware_version: string | null;
  radio: string | null;
  tx_power: string | null;
  airtime_factor: string | null;
  // Configured duty-cycle limit (e.g. "25.0%"), firmware-derived from airtime_factor.
  // Only present on firmware >= 1.15; null on older nodes.
  duty_cycle_limit: string | null;
  repeat_enabled: string | null;
  flood_max: string | null;
}

export interface RepeaterAdvertIntervalsResponse {
  advert_interval: string | null;
  flood_advert_interval: string | null;
}

export interface RepeaterOwnerInfoResponse {
  owner_info: string | null;
  firmware_version: string | null;
  name: string | null;
  guest_password: string | null;
  stored_owner_info?: string | null;
  owner_info_updated?: boolean;
}

export interface RepeaterRegionEntry {
  name: string;
  depth: number;
  flood_allowed: boolean;
  is_home: boolean;
}

export interface RepeaterRegionsResponse {
  regions: RepeaterRegionEntry[];
  raw: string | null;
  truncated: boolean;
  /** 'cli' = full admin hierarchy; 'anon' = guest flood-allowed names only. */
  source: 'cli' | 'anon' | null;
}

export interface LppSensor {
  channel: number;
  type_name: string;
  value: number | Record<string, number>;
}

export interface RepeaterLppTelemetryResponse {
  sensors: LppSensor[];
}

export interface ContactTelemetryResponse {
  sensors: LppSensor[];
  fetched_at: number;
  telemetry_history: TelemetryHistoryEntry[];
}

/** Compact latest-telemetry snapshot per node for the map overlay. */
export interface LatestTelemetry {
  timestamp: number;
  battery_volts?: number | null;
  temperature?: number | null;
  source: 'repeater' | 'contact';
}

export interface TrackedTelemetryContactsResponse {
  tracked_telemetry_contacts: string[];
  names: Record<string, string>;
  schedule: TelemetrySchedule;
}

export type PaneName =
  | 'status'
  | 'nodeInfo'
  | 'neighbors'
  | 'acl'
  | 'radioSettings'
  | 'advertIntervals'
  | 'ownerInfo'
  | 'lppTelemetry'
  | 'regions';

export interface PaneState {
  loading: boolean;
  attempt: number;
  error: string | null;
  fetched_at?: number | null;
}

export interface TelemetryLppSensor {
  channel: number;
  type_name: string;
  value: number;
}

export interface TelemetryHistoryEntry {
  timestamp: number;
  data: Record<string, number> & { lpp_sensors?: TelemetryLppSensor[] };
}

export interface PushSubscriptionInfo {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
  created_at: number;
  last_success_at: number | null;
  failure_count: number;
}

export interface TraceResponse {
  remote_snr: number | null;
  local_snr: number | null;
  path_len: number;
}

export interface RadioTraceNode {
  role: 'repeater' | 'custom' | 'local';
  public_key: string | null;
  name: string | null;
  observed_hash: string | null;
  snr: number | null;
}

export interface RadioTraceHopRequest {
  public_key?: string | null;
  hop_hex?: string | null;
}

export interface RadioTraceResponse {
  path_len: number;
  timeout_seconds: number;
  nodes: RadioTraceNode[];
}

export interface PathDiscoveryRoute {
  path: string;
  path_len: number;
  path_hash_mode: number;
}

export interface PathDiscoveryResponse {
  contact: Contact;
  forward_path: PathDiscoveryRoute;
  return_path: PathDiscoveryRoute;
}

export interface UnreadCounts {
  counts: Record<string, number>;
  mentions: Record<string, boolean>;
  last_message_times: Record<string, number>;
  last_read_ats: Record<string, number | null>;
  /** stateKey -> id of the oldest unread message. Locates the unread divider. */
  first_unread_ids: Record<string, number | null>;
}

interface BusyChannel {
  channel_key: string;
  channel_name: string;
  message_count: number;
}

interface ContactActivityCounts {
  last_hour: number;
  last_24_hours: number;
  last_week: number;
}

export interface NoiseFloorSample {
  timestamp: number;
  noise_floor_dbm: number;
}

export interface NoiseFloorHistoryStats {
  sample_interval_seconds: number;
  coverage_seconds: number;
  latest_noise_floor_dbm: number | null;
  latest_timestamp: number | null;
  samples: NoiseFloorSample[];
}

export interface BatterySample {
  timestamp: number;
  battery_mv: number;
}

export interface AirtimeSample {
  timestamp: number;
  tx_pct: number;
  rx_pct: number;
}

export interface RawFeedStatItem {
  label: string;
  count: number;
  share: number;
}

export interface RawFeedHistoricalStats {
  packet_count: number;
  decrypted_count: number;
  undecrypted_count: number;
  decrypt_rate: number;
  path_bearing_count: number;
  path_bearing_rate: number;
  distinct_paths: number;
  average_rssi: number | null;
  best_rssi: number | null;
  payload_breakdown: RawFeedStatItem[];
  route_breakdown: RawFeedStatItem[];
  hop_profile: RawFeedStatItem[];
  hop_byte_width_profile: RawFeedStatItem[];
  rssi_buckets: RawFeedStatItem[];
}

export interface BatteryHistoryStats {
  sample_interval_seconds: number;
  coverage_seconds: number;
  latest_battery_mv: number | null;
  latest_timestamp: number | null;
  samples: BatterySample[];
}

interface PacketsPerHourBucket {
  timestamp: number;
  count: number;
}

/**
 * Regional flood-scope adoption over the last 24h. Two views with different
 * denominators that will not agree - traffic spans all channels including
 * undecryptable ones (so it carries a false-positive floor from corrupt RF
 * captures), while senders requires decryption and is therefore noise-free but
 * limited to channels we hold keys for.
 */
export interface RegionScopeStats {
  total_messages: number;
  scoped_messages: number;
  scoped_pct: number;
  /** Estimated false positives in scoped_messages. At or below this = not adoption. */
  false_positive_floor: number;
  total_senders: number;
  scoped_senders: number;
  scoped_senders_pct: number;
}

export interface MqttBrokerStats {
  config_id: string;
  name: string;
  /** mqtt_private | mqtt_community | mqtt_ha */
  type: string;
  /** connected | disconnected | error */
  status: string;
  last_error: string | null;
  messages_published: number;
  publish_failures: number;
  reconnects: number;
}

export interface StatisticsResponse {
  busiest_channels_24h: BusyChannel[];
  contact_count: number;
  repeater_count: number;
  channel_count: number;
  total_packets: number;
  decrypted_packets: number;
  undecrypted_packets: number;
  total_dms: number;
  total_channel_messages: number;
  total_outgoing: number;
  contacts_heard: ContactActivityCounts;
  repeaters_heard: ContactActivityCounts;
  known_channels_active: ContactActivityCounts;
  path_hash_width_24h: {
    total_packets: number;
    single_byte: number;
    double_byte: number;
    triple_byte: number;
    single_byte_pct: number;
    double_byte_pct: number;
    triple_byte_pct: number;
  };
  region_scope_24h: RegionScopeStats;
  packets_per_hour_72h: PacketsPerHourBucket[];
  noise_floor_24h: NoiseFloorHistoryStats;
  mqtt_brokers: MqttBrokerStats[];
}

// --- OpenHop config pane (Surface B) ---
export interface OpenHopConfigExport {
  success: boolean;
  data?: { meta?: Record<string, unknown>; config?: Record<string, unknown> };
  error?: string;
}
export interface OpenHopValidateResult {
  success: boolean;
  data?: {
    valid: boolean;
    blocked_restart?: boolean;
    errors: { path: string; message: string }[];
    warnings: { path: string; message: string }[];
    summary?: { error_count: number; warning_count: number };
    message?: string;
  };
  error?: string;
}
export interface OpenHopModeResult {
  success: boolean;
  mode?: string;
  persisted?: boolean;
  error?: string;
}
export interface OpenHopRadioResult {
  success: boolean;
  data?: {
    applied?: string[];
    live_update?: boolean;
    restart_required?: boolean;
    message?: string;
  };
  error?: string;
}
export interface OpenHopImportResult {
  success: boolean;
  message?: string;
  sections_updated?: string[];
  saved?: boolean;
  restart_required?: boolean;
  error?: string;
}
export interface OpenHopRestartResult {
  success: boolean;
  message?: string;
  error?: string;
}
export interface OpenHopHardwareOption {
  key: string;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
}
export interface OpenHopRadioPreset {
  title: string;
  description?: string;
  frequency?: string;
  spreading_factor?: string;
  bandwidth?: string;
  coding_rate?: string;
}

// OpenHop OTA update (Surface B). Status is a FLAT envelope (fields at top level).
export interface OpenHopUpdateStatus {
  success: boolean;
  current_version?: string;
  latest_version?: string | null;
  has_update?: boolean;
  channel?: string;
  last_checked?: string | null;
  state?: 'idle' | 'checking' | 'installing' | 'complete' | 'error';
  error?: string | null;
  rate_limit_until?: string | null;
  message?: string;
}
export interface OpenHopUpdateChannels {
  success: boolean;
  channels: string[];
  current_channel: string;
}
export interface OpenHopChangelogCommit {
  sha: string;
  short_sha: string;
  title: string;
  body: string;
  author: string;
  date: string;
  url: string;
}
export interface OpenHopChangelog {
  success: boolean;
  channel: string;
  installed: string;
  latest: string;
  commits: OpenHopChangelogCommit[];
}
/** An event from the OTA install-progress SSE stream. */
export type OpenHopUpdateEvent =
  | { type: 'connected'; message: string }
  | { type: 'line'; line: string }
  | { type: 'status'; state: string }
  | { type: 'done'; state: string; error?: string | null }
  | { type: 'keepalive' };

// OpenHop CAD calibration (Surface B). Meaningful metrics require real RF hardware.
export interface OpenHopCadResult {
  success: boolean;
  data?: {
    det_peak?: number;
    det_min?: number;
    cad_symbol_num?: number;
    cad_timeout_ms?: number;
    apply_live?: boolean;
    samples?: number;
    attempts?: number;
    detections?: number;
    non_detections?: number;
    timeouts?: number;
    errors?: number;
    cad_done_count?: number;
    detection_rate?: number;
    detected?: boolean;
  };
  error?: string;
}
export interface OpenHopCadManualCheckParams {
  samples?: number;
  det_peak?: number;
  det_min?: number;
  cad_symbol_num?: number;
  cad_timeout_ms?: number;
  apply_live?: boolean;
}

// OpenHop system/hardware (Surface B). psutil-nested; every field optional.
export interface OpenHopHardwareData {
  cpu?: {
    usage_percent?: number;
    count?: number;
    frequency?: number;
    load_avg?: { '1min'?: number; '5min'?: number; '15min'?: number };
  };
  memory?: { total?: number; available?: number; used?: number; usage_percent?: number };
  disk?: { total?: number; used?: number; free?: number; usage_percent?: number };
  system?: { uptime?: number; boot_time?: number; os?: string; kernel?: string };
  [k: string]: unknown;
}
export interface OpenHopHardwareStats {
  success: boolean;
  data?: OpenHopHardwareData;
  error?: string;
}
export interface OpenHopAnalyticsResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

// OpenHop transport keys + neighbor scopes (Surface B).
export interface OpenHopTransportKey {
  id?: string | number;
  name?: string;
  flood_policy?: string;
  [k: string]: unknown;
}
export interface OpenHopTransportKeys {
  success: boolean;
  data?: OpenHopTransportKey[] | Record<string, OpenHopTransportKey>;
  count?: number;
  error?: string;
}
export interface OpenHopNeighborScopeRecord {
  scopes?: string;
  status?: string;
  queried_at?: number | null;
  responded_at?: number | null;
}
export interface OpenHopNeighborScopes {
  success: boolean;
  count?: number;
  served?: { scopes?: string };
  data?: Record<string, OpenHopNeighborScopeRecord>;
  error?: string;
}

// OpenHop MQTT config (Surface B). update forwards only the fields the user sets.
export interface OpenHopMqttConfigBody {
  iata_code?: string;
  status_interval?: number;
  owner?: string;
  email?: string;
  neighbors?: Record<string, unknown>;
  brokers?: Record<string, unknown>[];
}
export interface OpenHopMqttStatus {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}
