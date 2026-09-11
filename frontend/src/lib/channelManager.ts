// Channel registry for discovered MeshCore channels.
// Stores enriched metadata in localStorage, separate from the radio channel list.
// Schema is compatible with meshcore-nl-discovered-channels/docs/data/channels.json
// and extends it with automation metadata (firstSeen, lastHeard, packets, source).

export interface RegistryChannel {
  // Core fields — compatible with meshcore-nl-discovered-channels schema
  channel: string; // Always starts with #, e.g. "#amsterdam"
  category: string;
  subcategory: string;
  region: string;
  language: string[];
  status: 'active' | 'inactive' | 'dormant' | 'experimental';
  verified: boolean;
  recommended: boolean;
  alias_of: string | null;
  notes: string;
  tags: string[];
  scopes: string[];
  country: string;
  // Extended metadata added by Project B (not in the base Project A schema)
  firstSeen: string | null; // ISO datetime — when first discovered by the channel finder
  lastHeard: string | null; // ISO datetime — most recent activity from finder
  added: string | null; // ISO date — when this entry was added to the registry
  packets: number; // Cumulative packet count from finder observations
  source: 'finder' | 'manual' | 'imported' | 'radio'; // 'radio' = seeded from existing DB channel
  private?: boolean; // When true, this entry is excluded from all exports
}

const STORAGE_KEY = 'meshcore-channel-registry';

function normalizeChannelName(name: string): string {
  const n = name.trim();
  return n.startsWith('#') ? n : `#${n}`;
}

function emptyEntry(name: string, source: RegistryChannel['source'], now: string): RegistryChannel {
  const isLive = source === 'finder';
  return {
    channel: name,
    category: '',
    subcategory: '',
    region: '',
    language: [],
    status: 'active',
    verified: false,
    recommended: false,
    alias_of: null,
    notes: '',
    tags: [],
    scopes: [],
    country: '',
    firstSeen: isLive ? now : null,
    lastHeard: isLive ? now : null,
    added: isLive ? now : now.slice(0, 10),
    packets: isLive ? 1 : 0,
    source,
  };
}

export function loadRegistry(): RegistryChannel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RegistryChannel[]) : [];
  } catch {
    return [];
  }
}

export function saveRegistry(entries: RegistryChannel[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/**
 * Channel names from the registry that can be added to the app's channel list
 * via the bulk-hashtag creation path. The registry stores names only (no keys),
 * so a key is derived server-side as SHA256(name); that only makes sense for
 * hashtag channels. Private-flagged entries and non-hashtag entries (e.g. a
 * radio-seeded "Public" channel) are excluded. Order is preserved.
 */
export function addableRegistryChannelNames(entries: RegistryChannel[]): string[] {
  return entries
    .filter((e) => !e.private && e.channel.startsWith('#'))
    .map((e) => e.channel);
}

/**
 * Called when the channel finder discovers a channel.
 * If new: creates entry with firstSeen = lastHeard = now, packets = 1.
 * If existing: updates lastHeard = now, increments packets.
 * Returns the updated registry (caller must persist with saveRegistry).
 */
export function recordFinderDiscovery(
  channelName: string,
  existing: RegistryChannel[]
): RegistryChannel[] {
  const name = normalizeChannelName(channelName);
  const now = new Date().toISOString();
  const idx = existing.findIndex((e) => e.channel.toLowerCase() === name.toLowerCase());

  if (idx === -1) {
    return [...existing, emptyEntry(name, 'finder', now)];
  }

  return existing.map((e, i) =>
    i !== idx ? e : { ...e, lastHeard: now, packets: (e.packets ?? 0) + 1 }
  );
}

/**
 * Add a channel manually (e.g. from the Add Channel form).
 * If the channel already exists, merges the provided metadata.
 * Returns the updated registry (caller must persist with saveRegistry).
 */
export function addManualChannel(
  channelName: string,
  meta: Partial<
    Omit<RegistryChannel, 'channel' | 'firstSeen' | 'lastHeard' | 'packets' | 'source'>
  >,
  existing: RegistryChannel[]
): RegistryChannel[] {
  const name = normalizeChannelName(channelName);
  const now = new Date().toISOString();
  const idx = existing.findIndex((e) => e.channel.toLowerCase() === name.toLowerCase());

  if (idx !== -1) {
    return existing.map((e, i) => (i === idx ? { ...e, ...meta } : e));
  }

  return [
    ...existing,
    {
      ...emptyEntry(name, 'manual', now),
      ...meta,
      channel: name,
      firstSeen: null,
      lastHeard: null,
      added: meta.added ?? now.slice(0, 10),
      packets: 0,
      source: 'manual' as const,
    },
  ];
}

interface MergeResult {
  result: RegistryChannel[];
  added: number;
  updated: number;
}

/**
 * Merge imported channels into the existing registry.
 * Import rules:
 *   - Do NOT overwrite existing firstSeen
 *   - Use the newest lastHeard between existing and incoming
 *   - Accumulate packets (sum them)
 *   - Fill in missing metadata fields from the import without clobbering existing data
 *   - New entries get source = 'imported'
 *
 * Accepts partial entries so it can handle both the full Project B schema and
 * the base Project A schema (which has last_seen instead of lastHeard).
 */
export function mergeImport(
  incoming: (Partial<RegistryChannel> & { last_seen?: string })[],
  existing: RegistryChannel[]
): MergeResult {
  const byName = new Map(existing.map((e) => [e.channel.toLowerCase(), { ...e }]));
  let added = 0;
  let updated = 0;

  for (const raw of incoming) {
    if (!raw.channel) continue;
    const name = normalizeChannelName(raw.channel);
    const key = name.toLowerCase();
    // Accept lastHeard from the full schema or last_seen from the Project A schema
    const incomingLastHeard = raw.lastHeard ?? raw.last_seen ?? null;
    const now = new Date().toISOString();
    const current = byName.get(key);

    if (!current) {
      byName.set(key, {
        channel: name,
        category: raw.category ?? '',
        subcategory: raw.subcategory ?? '',
        region: raw.region ?? '',
        language: raw.language ?? [],
        status: raw.status ?? 'active',
        verified: raw.verified ?? false,
        recommended: raw.recommended ?? false,
        alias_of: raw.alias_of ?? null,
        notes: raw.notes ?? '',
        tags: raw.tags ?? [],
        scopes: raw.scopes ?? [],
        country: raw.country ?? '',
        firstSeen: raw.firstSeen ?? incomingLastHeard,
        lastHeard: incomingLastHeard,
        added: raw.added ?? now,
        packets: raw.packets ?? 0,
        source: 'imported',
      });
      added++;
    } else {
      // Preserve firstSeen, use newest lastHeard, sum packets
      const newerLastHeard = pickNewer(current.lastHeard, incomingLastHeard);
      byName.set(key, {
        ...current,
        // Fill gaps with imported data without overwriting existing non-empty values
        category: current.category || raw.category || '',
        subcategory: current.subcategory || raw.subcategory || '',
        region: current.region || raw.region || '',
        language: current.language.length > 0 ? current.language : (raw.language ?? []),
        verified: current.verified || (raw.verified ?? false),
        recommended: current.recommended || (raw.recommended ?? false),
        notes: current.notes || raw.notes || '',
        tags: dedupeArray([...current.tags, ...(raw.tags ?? [])]),
        scopes: dedupeArray([...current.scopes, ...(raw.scopes ?? [])]),
        country: current.country || raw.country || '',
        // Preserve firstSeen; use newest lastHeard; accumulate packets
        lastHeard: newerLastHeard,
        packets: (current.packets ?? 0) + (raw.packets ?? 0),
      });
      updated++;
    }
  }

  return { result: Array.from(byName.values()), added, updated };
}

/**
 * Add channels from a remote sync payload that are not already in the registry.
 * Never modifies existing entries — pure add-missing-only semantics.
 * New entries get source = 'imported', firstSeen = null, lastHeard = null, packets = 0.
 * Returns { result, added }. Caller must persist with saveRegistry.
 */
export function addMissingFromSync(
  channels: { name: string; key: string }[],
  existing: RegistryChannel[]
): { result: RegistryChannel[]; added: number } {
  const byName = new Map(existing.map((e) => [e.channel.toLowerCase(), e]));
  let added = 0;
  const now = new Date().toISOString();

  for (const { name } of channels) {
    const normalized = normalizeChannelName(name);
    const key = normalized.toLowerCase();
    if (byName.has(key)) continue;

    byName.set(key, {
      ...emptyEntry(normalized, 'imported', now),
      firstSeen: null,
      lastHeard: null,
      added: now.slice(0, 10),
      packets: 0,
    });
    added++;
  }

  return { result: Array.from(byName.values()), added };
}

/**
 * Minimal shape of a Project B radio Channel needed for seeding.
 * Matches the Channel interface in types.ts without importing it (avoids a
 * circular dep between lib/ and types.ts).
 */
export interface RadioChannelSeed {
  name: string;
  key: string;
  is_hashtag?: boolean; // When false (e.g. the default "Public" channel), skip registry seeding
  created_at?: number; // Unix timestamp (seconds) — optional, falls back to today
}

/**
 * One-way seed: adds any radio channel that is not already in the registry.
 * Never overwrites an existing registry entry.
 * New entries get source = 'radio' and added = the channel's created_at date.
 * Returns { result, added } — caller must persist with saveRegistry if added > 0.
 */
export function seedFromRadioChannels(
  radioChannels: RadioChannelSeed[],
  existing: RegistryChannel[]
): { result: RegistryChannel[]; added: number } {
  const byName = new Map(existing.map((e) => [e.channel.toLowerCase(), e]));
  let added = 0;

  for (const rc of radioChannels) {
    // Hashtag channels get the # prefix normalised in; non-hashtag channels
    // (e.g. the default "Public" channel) keep their original name as-is.
    const name = rc.is_hashtag === false ? rc.name.trim() : normalizeChannelName(rc.name);
    const key = name.toLowerCase();
    if (byName.has(key)) continue;

    const createdDate = rc.created_at
      ? new Date(rc.created_at * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    byName.set(key, {
      channel: name,
      category: '',
      subcategory: '',
      region: '',
      language: [],
      status: 'active',
      verified: false,
      recommended: false,
      alias_of: null,
      notes: '',
      tags: [],
      scopes: [],
      country: '',
      firstSeen: null,
      lastHeard: null,
      added: createdDate,
      packets: 0,
      source: 'radio',
    });
    added++;
  }

  return { result: Array.from(byName.values()), added };
}

/**
 * Update an existing registry entry by merging a patch into it.
 * If the channel is not found the registry is returned unchanged.
 */
export interface ChannelBulkStats {
  count: number;
  first_at: number | null; // Unix seconds
  last_at: number | null; // Unix seconds
}

/**
 * Apply bulk DB stats (count, first_at, last_at) to the registry.
 * - firstSeen: set from first_at if currently null or if DB is earlier
 * - added:     set from first_at date if currently null
 * - lastHeard: set from last_at if DB is newer than stored value
 * - packets:   replaced with DB count (authoritative)
 *
 * keyed by channel hex key, with a nameByKey map to resolve to registry entries.
 * Returns the updated array and how many entries were changed.
 */
export function applyChannelStats(
  stats: Record<string, ChannelBulkStats>,
  nameByKey: Map<string, string>, // hex key (uppercase) → channel name (with #)
  existing: RegistryChannel[]
): { result: RegistryChannel[]; changed: number } {
  let changed = 0;
  const result = existing.map((e) => {
    // Find the hex key for this registry entry
    const normalizedName = e.channel.toLowerCase();
    let hexKey: string | undefined;
    for (const [k, n] of nameByKey) {
      if (n.toLowerCase() === normalizedName) {
        hexKey = k;
        break;
      }
    }
    if (!hexKey) return e;

    const stat = stats[hexKey] ?? stats[hexKey.toLowerCase()];
    if (!stat) return e;

    const dbFirstIso = stat.first_at ? new Date(stat.first_at * 1000).toISOString() : null;
    const dbLastIso = stat.last_at ? new Date(stat.last_at * 1000).toISOString() : null;
    const dbFirstDate = dbFirstIso ? dbFirstIso.slice(0, 10) : null;

    const updatedFirstSeen =
      pickNewer(dbFirstIso, null) === dbFirstIso
        ? pickEarlier(e.firstSeen, dbFirstIso)
        : e.firstSeen;
    const updatedAdded = e.added ?? dbFirstDate;
    const updatedLastHeard = pickNewer(e.lastHeard, dbLastIso);
    const updatedPackets = stat.count;

    const dirty =
      updatedFirstSeen !== e.firstSeen ||
      updatedAdded !== e.added ||
      updatedLastHeard !== e.lastHeard ||
      updatedPackets !== e.packets;

    if (!dirty) return e;
    changed++;
    return {
      ...e,
      firstSeen: updatedFirstSeen,
      added: updatedAdded,
      lastHeard: updatedLastHeard,
      packets: updatedPackets,
    };
  });
  return { result, changed };
}

export function updateChannel(
  channelName: string,
  patch: Partial<Omit<RegistryChannel, 'channel'>>,
  existing: RegistryChannel[]
): RegistryChannel[] {
  const key = channelName.toLowerCase();
  return existing.map((e) => (e.channel.toLowerCase() === key ? { ...e, ...patch } : e));
}

/**
 * Convert registry entries to the Project A channels.json schema.
 * Includes all registry fields plus:
 *   - channel_hash: the hex key from the radio channel list (if keyByName is provided)
 *   - message_amount: the packet/message count from the registry
 *   - first_seen: mapped from firstSeen
 *   - last_seen: mapped from lastHeard (or firstSeen as fallback)
 *
 * @param entries  The registry entries to export.
 * @param keyByName  Optional map from lowercase channel name (with #) → hex key.
 *                   When provided, channel_hash is populated from this map.
 */
export function toProjectAFormat(
  entries: RegistryChannel[],
  keyByName?: Map<string, string>
): Array<{
  channel: string;
  channel_hash: string | null;
  category: string;
  subcategory: string;
  region: string;
  language: string[];
  status: string;
  verified: boolean;
  recommended: boolean;
  alias_of: string | null;
  notes: string;
  tags: string[];
  scopes: string[];
  country: string;
  first_seen: string | null;
  last_seen: string | null;
  added: string | null;
  message_amount: number;
  source: string;
}> {
  return entries.map((e) => ({
    channel: e.channel,
    channel_hash: keyByName?.get(e.channel.toLowerCase()) ?? null,
    category: e.category,
    subcategory: e.subcategory,
    region: e.region,
    language: e.language,
    status: e.status,
    verified: e.verified,
    recommended: e.recommended,
    alias_of: e.alias_of,
    notes: e.notes,
    tags: e.tags,
    scopes: e.scopes,
    country: e.country,
    first_seen: e.firstSeen ?? null,
    last_seen: e.lastHeard ?? e.firstSeen ?? null,
    added: e.added,
    message_amount: e.packets,
    source: e.source,
  }));
}

function pickNewer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function pickEarlier(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function dedupeArray<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
