import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Popup as MlPopup, Marker as MlMarker, type Map as MlMap } from 'maplibre-gl';
import { Zap, Clock, Globe, Radio, MapPinOff, Boxes } from 'lucide-react';
import type {
  AdvertLinkEdge,
  Contact,
  ExternalMapNode,
  LatestTelemetry,
  RadioConfig,
} from '../types';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../types';
import { api, isAbortError } from '../api';
import { formatTime } from '../utils/messageParser';
import {
  isValidLocation,
  getEffectiveLocation,
  resolveNodeCoord,
  hasEffectiveLocation,
} from '../utils/pathUtils';
import { parsePacket } from '../utils/visualizerUtils';
import { getRawPacketObservationKey } from '../utils/rawPacketIdentity';
import { BASE_TIME_RANGES } from '../utils/timeRanges';
import { useRawPackets } from '../stores/rawPacketStore';
import { useIsDarkTheme } from '../hooks/useIsDarkTheme';
import { useT } from '../i18n';
import { MapSurface } from '../map/MapSurface';
import { setMapLock2D } from '../map/engine/mapLock2D';
import { setBuildings3D } from '../map/engine/buildings3D';
import { createNodesLayer } from '../map/layers/nodesLayer';
import { createNeonNodesOverlay, type NeonNodesOverlay } from '../map/layers/neonNodesLayer';
import { createTelemetryLayer, telemetryPopupParts } from '../map/layers/telemetryLayer';
import { TelemetryPopupChart } from './TelemetryPopupChart';
import { DateTimeField } from './DateTimeField';
import {
  getSavedNodeRoleColors,
  saveNodeRoleColors,
  DEFAULT_NODE_ROLE_COLORS,
  type NodeRoleColors,
} from '../map/layers/nodeRoleColors';
import { createPacketDeckOverlay, type PacketDeckOverlay } from '../map/layers/packetDeckOverlay';
import { createPacketTimeline, type PacketTimeline } from '../map/packets/packetTimeline';
import {
  createPlaybackController,
  type PlaybackController,
  type PlaybackSnapshot,
} from '../map/packets/playbackController';
import { LOOKBACK_OPTIONS, PlaybackBar } from '../map/controls/PlaybackBar';
import { isBool, isNumberIn, isOneOf, usePersistedMapSetting } from '../map/usePersistedMapSetting';
import {
  ARC_FADE_PRESETS_MS,
  BUFFER_MAX_MS,
  DEFAULT_ARC_FADE_MS,
} from '../map/packets/packetAnimMath';
import { MapLegend } from '../map/controls/legend/MapLegend';
import { PacketLegend } from '../map/controls/legend/PacketLegend';
import { createClickAudio, type ClickAudio } from '../map/packets/clickAudio';
import { createLinksLayer, type ResolveCoord } from '../map/layers/linksLayer';
import { createAdvertLinksLayer } from '../map/layers/advertLinksLayer';
import { createExternalNodesLayer, type ExternalNodeProps } from '../map/layers/externalNodesLayer';
import { isContactVisibleForFilters, type HeardFilterMode } from '../map/heardFilter';
import {
  ROLE_FILTER_TYPES,
  isRoleVisibleForFilter,
  parseHiddenRoles,
  serializeHiddenRoles,
} from '../map/roleFilter';
import { computeWrongLocationKeys } from '../map/wrongLocation';
import {
  resolveHomeView,
  readLastView,
  writeLastView,
  type MapHomeMode,
  type MapHomeSettings,
} from '../map/homeView';
import {
  buildPacketNetworkContext,
  createPacketNetworkState,
  ensureSelfNode,
  ingestPacketIntoPacketNetwork,
  projectPacketNetwork,
} from '../networkGraph/packetNetworkGraph';
import type { ExtraFab } from '../map/controls/MapControls';

interface MapViewProps {
  contacts: Contact[];
  focusedKey?: string | null;
  config?: RadioConfig | null;
  blockedKeys?: string[];
  blockedNames?: string[];
  onSelectContact?: (contact: Contact) => void;
  onOpenContactInfo?: (publicKey: string) => void;
  focusedLatLon?: [number, number];
  focusedLabel?: string;
  sidebarOpen?: boolean;
  /** Map startup camera mode (server-side app setting). Defaults to 'auto'. */
  mapHomeMode?: MapHomeMode;
  mapHomeLat?: number | null;
  mapHomeLon?: number | null;
  mapHomeZoom?: number | null;
}

// --- "Heard since" filter ---
// Map adopts the shared base ranges (single source of truth) and keeps its own
// "All" extra. Custom stays a single "heard since <datetime>" input, which fits
// the map better than a From/To range.
type SincePreset = { id: string; labelKey: string; seconds: number | null };
const MAP_SINCE_PRESETS: SincePreset[] = [
  ...BASE_TIME_RANGES.map((r) => ({ id: r.id, labelKey: r.labelKey, seconds: r.seconds })),
  { id: 'all', labelKey: 'time_range_all', seconds: null },
];

type MapSinceId = string;
const DEFAULT_MAP_SINCE_ID: MapSinceId = '7d';
const MAP_SINCE_STORAGE_KEY = 'remoteterm-map-since';
const MAP_SINCE_CUSTOM_KEY = 'remoteterm-map-since-custom';
// Optional upper bound for the custom range ("To"); empty = up to now.
const MAP_SINCE_CUSTOM_UNTIL_KEY = 'remoteterm-map-since-custom-until';

// --- "Heard by server" filter (contacts layer only) ---
const HEARD_FILTER_MODES = ['all', 'hide', 'only'] as const satisfies readonly HeardFilterMode[];
const DEFAULT_HEARD_MODE: HeardFilterMode = 'all';
const MAP_HEARD_STORAGE_KEY = 'remoteterm-map-heard';

// --- Node role filter (repeater / room / companion / sensor toggles) ---
const MAP_HIDDEN_ROLES_STORAGE_KEY = 'remoteterm-map-hidden-roles';

const MAP_NODE_SCALE_STORAGE_KEY = 'remoteterm-map-node-scale';

// --- Line / arc thickness (multipliers, 0.5-4x) ---
const MAP_ARC_WIDTH_STORAGE_KEY = 'remoteterm-map-arc-width';
const MAP_ARC_FADE_STORAGE_KEY = 'remoteterm-map-arc-fade';
const MAP_LINK_WIDTH_STORAGE_KEY = 'remoteterm-map-link-width';

// --- Neon node rendering (deck.gl halo+core nodes vs the flat GL circles) ---
const MAP_NEON_NODES_STORAGE_KEY = 'remoteterm-map-neon-nodes';

// --- Node labels (off / advert name / observed-width ID tag) ---
const MAP_LABEL_MODE_STORAGE_KEY = 'remoteterm-map-label-mode';
const NODE_LABEL_MODES = ['off', 'name', 'tag'] as const;
type NodeLabelMode = (typeof NODE_LABEL_MODES)[number];

// --- Telemetry overlay (opt-in, off by default) ---
const MAP_TELEMETRY_STORAGE_KEY = 'remoteterm-map-telemetry';
const TELEMETRY_REFRESH_MS = 60_000;

// --- Hide nodes reporting wrong location (opt-in, off by default) ---
const MAP_HIDE_WRONG_LOCATION_STORAGE_KEY = 'remoteterm-map-hide-wrong-location';

function getSavedHideWrongLocation(): boolean {
  try {
    return localStorage.getItem(MAP_HIDE_WRONG_LOCATION_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

const MAP_SINCE_TICK_MS = 60_000;

const THREE_DAYS_SEC = 3 * 24 * 60 * 60;
const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000; // 1h replay look-back

function getSavedSinceId(): MapSinceId {
  try {
    const stored = localStorage.getItem(MAP_SINCE_STORAGE_KEY);
    if (stored === 'custom') return 'custom';
    if (stored && MAP_SINCE_PRESETS.some((p) => p.id === stored)) return stored as MapSinceId;
  } catch {
    /* ignore */
  }
  return DEFAULT_MAP_SINCE_ID;
}

function getSavedHeardMode(): HeardFilterMode {
  try {
    const stored = localStorage.getItem(MAP_HEARD_STORAGE_KEY);
    if (stored && (HEARD_FILTER_MODES as readonly string[]).includes(stored)) {
      return stored as HeardFilterMode;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_HEARD_MODE;
}

function getSavedHiddenRoles(): Set<number> {
  try {
    return parseHiddenRoles(localStorage.getItem(MAP_HIDDEN_ROLES_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

function getSavedNodeScale(): number {
  try {
    const v = Number(localStorage.getItem(MAP_NODE_SCALE_STORAGE_KEY));
    if (Number.isFinite(v) && v >= 0.5 && v <= 2.5) return v;
  } catch {
    /* ignore */
  }
  return 1;
}

/** Width multiplier (arcs / links), clamped to the slider's 0.5-4x range. */
function getSavedWidthScale(key: string): number {
  try {
    const v = Number(localStorage.getItem(key));
    if (Number.isFinite(v) && v >= 0.5 && v <= 4) return v;
  } catch {
    /* ignore */
  }
  return 1;
}

/** Packet-arc lifetime, restricted to the offered presets. */
function getSavedArcFadeMs(): number {
  try {
    const v = Number(localStorage.getItem(MAP_ARC_FADE_STORAGE_KEY));
    if ((ARC_FADE_PRESETS_MS as readonly number[]).includes(v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_ARC_FADE_MS;
}

function getSavedNeonOn(): boolean {
  try {
    return localStorage.getItem(MAP_NEON_NODES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function getSavedLabelMode(): NodeLabelMode {
  try {
    const stored = localStorage.getItem(MAP_LABEL_MODE_STORAGE_KEY);
    if (stored && (NODE_LABEL_MODES as readonly string[]).includes(stored)) {
      return stored as NodeLabelMode;
    }
  } catch {
    /* ignore */
  }
  return 'off';
}

function getSavedTelemetryOn(): boolean {
  try {
    return localStorage.getItem(MAP_TELEMETRY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function localDateTimeToEpochSec(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms / 1000;
}

function resolveNameToGps(name: string, nameIndex: Map<string, Contact>): Contact | null {
  const c = nameIndex.get(name);
  if (!c) return null;
  return hasEffectiveLocation(c) ? c : null;
}

// Which contacts a packet reveals in discovery mode. A contact is revealed only
// when it can be placed on the map, using the effective location
// (advertised-wins, manual-fallback) so a manual-only node is discoverable too.
// Exported for unit testing.
export function resolvePacketContacts(
  parsed: ReturnType<typeof parsePacket>,
  prefixIndex: Map<string, Contact[]>,
  nameIndex: Map<string, Contact>,
  myLatLon: [number, number] | null,
  config?: RadioConfig | null
): Set<string> {
  const keys = new Set<string>();
  if (!parsed) return keys;
  const sourcePrefixes = parsed.advertPubkey
    ? [parsed.advertPubkey.slice(0, 12).toLowerCase()]
    : parsed.srcHash
      ? [parsed.srcHash.toLowerCase()]
      : [];
  for (const prefix of sourcePrefixes) {
    const matches = prefixIndex.get(prefix);
    if (matches?.length === 1 && hasEffectiveLocation(matches[0])) {
      keys.add(matches[0].public_key);
    }
  }
  if (parsed.groupTextSender) {
    const c = resolveNameToGps(parsed.groupTextSender, nameIndex);
    if (c) keys.add(c.public_key);
  }
  for (const hop of parsed.pathBytes) {
    if (hop.length < 4) continue;
    const matches = prefixIndex.get(hop.toLowerCase());
    if (matches?.length === 1 && hasEffectiveLocation(matches[0])) {
      keys.add(matches[0].public_key);
    }
  }
  if (myLatLon && config?.public_key) keys.add(config.public_key.toLowerCase());
  if (parsed.dstHash) {
    const matches = prefixIndex.get(parsed.dstHash.toLowerCase());
    if (matches?.length === 1 && hasEffectiveLocation(matches[0])) {
      keys.add(matches[0].public_key);
    }
  }
  return keys;
}

export function MapView({
  contacts,
  focusedKey,
  config,
  blockedKeys,
  blockedNames,
  onSelectContact,
  onOpenContactInfo,
  focusedLatLon,
  focusedLabel,
  sidebarOpen,
  mapHomeMode,
  mapHomeLat,
  mapHomeLon,
  mapHomeZoom,
}: MapViewProps) {
  const t = useT();
  const dark = useIsDarkTheme();
  const rawPackets = useRawPackets();
  const [sinceId, setSinceId] = useState<MapSinceId>(getSavedSinceId);
  const [heardFilter, setHeardFilter] = useState<HeardFilterMode>(getSavedHeardMode);
  const [hiddenRoles, setHiddenRoles] = useState<Set<number>>(getSavedHiddenRoles);
  const [hideWrongLocation, setHideWrongLocation] = useState<boolean>(getSavedHideWrongLocation);
  const [customSince, setCustomSince] = useState(() => {
    try {
      return localStorage.getItem(MAP_SINCE_CUSTOM_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [customUntil, setCustomUntil] = useState(() => {
    try {
      return localStorage.getItem(MAP_SINCE_CUSTOM_UNTIL_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  const [showPackets, setShowPackets] = usePersistedMapSetting(
    'remoteterm-map-show-packets',
    false,
    isBool
  );
  const [discoveryMode, setDiscoveryMode] = usePersistedMapSetting(
    'remoteterm-map-discovery',
    false,
    isBool
  );
  const [discoveredKeys, setDiscoveredKeys] = useState<Set<string>>(new Set());
  const [pulsesOn, setPulsesOn] = usePersistedMapSetting('remoteterm-map-pulses', true, isBool);
  const [glowOn, setGlowOn] = usePersistedMapSetting('remoteterm-map-glow', true, isBool);
  const [bufferMs, setBufferMs] = usePersistedMapSetting(
    'remoteterm-map-packet-buffer',
    0,
    isNumberIn(0, BUFFER_MAX_MS)
  );
  const [lookbackMs, setLookbackMs] = usePersistedMapSetting(
    'remoteterm-map-lookback',
    DEFAULT_LOOKBACK_MS,
    isOneOf(LOOKBACK_OPTIONS.map((o) => o.ms))
  );
  const [soundOn, setSoundOn] = usePersistedMapSetting('remoteterm-map-sound', false, isBool);
  const [volume, setVolume] = usePersistedMapSetting(
    'remoteterm-map-volume',
    0.3,
    isNumberIn(0, 1)
  );
  const [playSnap, setPlaySnap] = useState<PlaybackSnapshot>({
    mode: 'live',
    currentMs: 0,
    rate: 1,
    playing: true,
  });
  const [playRange, setPlayRange] = useState<{ minMs: number; maxMs: number }>({
    minMs: 0,
    maxMs: 0,
  });
  const [tilt3D, setTilt3D] = usePersistedMapSetting('remoteterm-map-tilt-3d', false, isBool);
  const [buildings, setBuildings] = usePersistedMapSetting(
    'remoteterm-map-buildings',
    false,
    isBool
  );
  const [nodeScale, setNodeScale] = useState(getSavedNodeScale);
  const [arcFadeMs, setArcFadeMs] = useState(getSavedArcFadeMs);
  const [arcWidthScale, setArcWidthScale] = useState(() =>
    getSavedWidthScale(MAP_ARC_WIDTH_STORAGE_KEY)
  );
  const [linkWidthScale, setLinkWidthScale] = useState(() =>
    getSavedWidthScale(MAP_LINK_WIDTH_STORAGE_KEY)
  );
  const [neonNodes, setNeonNodes] = useState(getSavedNeonOn);
  const [roleColors, setRoleColors] = useState<NodeRoleColors>(getSavedNodeRoleColors);
  const [labelMode, setLabelMode] = useState<NodeLabelMode>(getSavedLabelMode);
  const [telemetryOn, setTelemetryOn] = useState<boolean>(getSavedTelemetryOn);
  const [latestTelemetry, setLatestTelemetry] = useState<Record<string, LatestTelemetry>>({});
  const [linksOn, setLinksOn] = usePersistedMapSetting('remoteterm-map-links', false, isBool);
  const [linkMode, setLinkMode] = usePersistedMapSetting<'liveness' | 'advert'>(
    'remoteterm-map-link-mode',
    'liveness',
    isOneOf(['liveness', 'advert'] as const)
  );
  const [linkConfidence, setLinkConfidence] = usePersistedMapSetting<1 | 2 | 3>(
    'remoteterm-map-link-confidence',
    2,
    isOneOf([1, 2, 3] as const)
  );
  const [advertEdges, setAdvertEdges] = useState<AdvertLinkEdge[]>([]);
  const [showExternalNodes, setShowExternalNodes] = usePersistedMapSetting(
    'remoteterm-map-external-nodes',
    false,
    isBool
  );
  const [externalNodes, setExternalNodes] = useState<ExternalMapNode[]>([]);
  const [viewBounds, setViewBounds] = useState<{
    west: number;
    south: number;
    east: number;
    north: number;
  } | null>(null);

  const seenObservationsRef = useRef(new Set<string>());
  const pulsesOnRef = useRef(pulsesOn);
  const glowOnRef = useRef(glowOn);
  const arcFadeMsRef = useRef(arcFadeMs);
  const mapRef = useRef<MlMap | null>(null);
  const nodesRef = useRef<ReturnType<typeof createNodesLayer> | null>(null);
  const neonOverlayRef = useRef<NeonNodesOverlay | null>(null);
  const telemetryRef = useRef<ReturnType<typeof createTelemetryLayer> | null>(null);
  // Mirror of latestTelemetry so the node-click popup can read the latest known
  // battery/temperature without rebuilding its callback on every refresh.
  const latestTelemetryRef = useRef<Record<string, LatestTelemetry>>({});
  // React roots mounted into the current contact popup (telemetry history chart);
  // unmounted when the popup is replaced or closed.
  const popupChartRootsRef = useRef<Root[]>([]);
  const roleColorsRef = useRef<NodeRoleColors>(roleColors);
  const packetOverlayRef = useRef<PacketDeckOverlay | null>(null);
  const timelineRef = useRef<PacketTimeline | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  if (!controllerRef.current) controllerRef.current = createPlaybackController();
  const resolveCoordRef = useRef<ResolveCoord | null>(null);
  const linkContextRef = useRef<ReturnType<typeof buildPacketNetworkContext> | null>(null);
  const snapPushRef = useRef(0);
  const clickAudioRef = useRef<ClickAudio | null>(null);
  if (!clickAudioRef.current) clickAudioRef.current = createClickAudio();
  const linksLayerRef = useRef<ReturnType<typeof createLinksLayer> | null>(null);
  const advertLinksLayerRef = useRef<ReturnType<typeof createAdvertLinksLayer> | null>(null);
  const linkStateRef = useRef(createPacketNetworkState(config?.name || 'Me'));
  const linkProcessedRef = useRef(new Set<string>());
  const popupRef = useRef<MlPopup | null>(null);
  const externalRef = useRef<ReturnType<typeof createExternalNodesLayer> | null>(null);
  const externalPopupRef = useRef<MlPopup | null>(null);
  // Latest visible external nodes, so a basemap restyle can re-feed the layer.
  const visibleExternalRef = useRef<ExternalMapNode[]>([]);
  // Latest "external overlay on" flag for the map's moveend listener (bound once).
  const showExternalRef = useRef(false);
  const focusMarkerRef = useRef<MlMarker | null>(null);

  const { prefixIndex, nameIndex } = useMemo(() => {
    const prefix = new Map<string, Contact[]>();
    const name = new Map<string, Contact>();
    for (const c of contacts) {
      const pubkey = c.public_key.toLowerCase();
      for (let len = 1; len <= 12 && len <= pubkey.length; len++) {
        const p = pubkey.slice(0, len);
        const arr = prefix.get(p);
        if (arr) arr.push(c);
        else prefix.set(p, [c]);
      }
      if (c.name && !name.has(c.name)) name.set(c.name, c);
    }
    return { prefixIndex: prefix, nameIndex: name };
  }, [contacts]);

  // External analyzer node overlay: track the viewport, fetch nodes for it, and
  // hide any node we already track locally (or our own radio) so the overlay
  // only adds nodes the mesh has not surfaced to us.
  const onViewBounds = useCallback(
    (bounds: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }) => {
      const next = {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      };
      // Keep the previous reference when the box has not moved so React bails out
      // of the re-render (and we skip a redundant viewport fetch).
      setViewBounds((prev) =>
        prev &&
        prev.west === next.west &&
        prev.south === next.south &&
        prev.east === next.east &&
        prev.north === next.north
          ? prev
          : next
      );
    },
    []
  );

  const localPubkeys = useMemo(() => {
    const set = new Set(contacts.map((c) => c.public_key.toLowerCase()));
    if (config?.public_key) set.add(config.public_key.toLowerCase());
    return set;
  }, [contacts, config?.public_key]);

  useEffect(() => {
    if (!showExternalNodes) {
      setExternalNodes([]);
      return;
    }
    if (!viewBounds) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .getExternalMapNodes(viewBounds, controller.signal)
        .then(setExternalNodes)
        .catch((err) => {
          if (!isAbortError(err)) console.error('External node fetch failed', err);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [showExternalNodes, viewBounds]);

  const visibleExternalNodes = useMemo(
    () => externalNodes.filter((n) => !localPubkeys.has(n.pubkey.toLowerCase())),
    [externalNodes, localPubkeys]
  );

  const myLatLon = useMemo<[number, number] | null>(() => {
    if (!config || !isValidLocation(config.lat, config.lon)) return null;
    return [config.lat, config.lon];
  }, [config]);

  // Per-link layer: derive edges client-side from the packet network graph.
  // (No advert-path hints here; links are liveness-only, a Tertiary overlay.)
  const linkContext = useMemo(
    () =>
      buildPacketNetworkContext({
        contacts,
        config: config ?? null,
        repeaterAdvertPaths: [],
        splitAmbiguousByTraffic: false,
        useAdvertPathHints: false,
      }),
    [contacts, config]
  );

  // Resolve a graph node id to coordinates: 'self' is my node, otherwise a
  // 12-char public-key prefix matched to a single contact (see resolveNode in
  // packetNetworkGraph.ts, which keys nodes by contactIndex.byPrefix12). Uses
  // the effective location so a node placed only by a manual override is still
  // drawn into links and packet paths.
  const resolveLinkCoord = useCallback<ResolveCoord>(
    (nodeId) =>
      resolveNodeCoord(
        nodeId,
        myLatLon ? { lat: myLatLon[0], lon: myLatLon[1] } : null,
        prefixIndex
      ),
    [prefixIndex, myLatLon]
  );

  const refreshLinks = useCallback(() => {
    const layer = linksLayerRef.current;
    if (!layer || !linksOn) return;
    const projection = projectPacketNetwork(linkStateRef.current, {
      showAmbiguousNodes: false,
      showAmbiguousPaths: false,
      collapseLikelyKnownSiblingRepeaters: false,
    });
    layer.setData(Array.from(projection.links.values()), resolveLinkCoord);
  }, [linksOn, resolveLinkCoord]);

  // Keep refs in sync so the packet timeline (created once) always resolves with
  // the latest coordinate resolver and network context without being rebuilt.
  useEffect(() => {
    resolveCoordRef.current = resolveLinkCoord;
  }, [resolveLinkCoord]);
  useEffect(() => {
    linkContextRef.current = linkContext;
  }, [linkContext]);
  useEffect(() => {
    pulsesOnRef.current = pulsesOn;
  }, [pulsesOn]);
  useEffect(() => {
    glowOnRef.current = glowOn;
  }, [glowOn]);
  // Persist the packet-arc lifetime; the animation loop reads it via the ref.
  useEffect(() => {
    arcFadeMsRef.current = arcFadeMs;
    try {
      localStorage.setItem(MAP_ARC_FADE_STORAGE_KEY, String(arcFadeMs));
    } catch {
      /* ignore */
    }
  }, [arcFadeMs]);
  useEffect(() => {
    clickAudioRef.current?.setEnabled(soundOn);
  }, [soundOn]);
  useEffect(() => {
    clickAudioRef.current?.setVolume(volume);
  }, [volume]);

  const ensureTimeline = useCallback((): PacketTimeline => {
    if (!timelineRef.current) {
      timelineRef.current = createPacketTimeline({
        resolveCoord: (id) => resolveCoordRef.current?.(id),
        getContext: () => linkContextRef.current ?? linkContext,
        state: createPacketNetworkState(config?.name || 'Me'),
      });
    }
    return timelineRef.current;
  }, [config?.name, linkContext]);

  // Ingest packets into the link graph and refresh the layer while links are on.
  useEffect(() => {
    if (!linksOn) return;
    const state = linkStateRef.current;
    ensureSelfNode(state, config?.name || 'Me');
    for (const pkt of rawPackets ?? []) {
      const key = getRawPacketObservationKey(pkt);
      if (linkProcessedRef.current.has(key)) continue;
      linkProcessedRef.current.add(key);
      ingestPacketIntoPacketNetwork(state, linkContext, pkt);
    }
    if (linkProcessedRef.current.size > 2000) {
      linkProcessedRef.current = new Set(Array.from(linkProcessedRef.current).slice(-1000));
    }
    refreshLinks();
  }, [rawPackets, linksOn, linkContext, refreshLinks, config]);

  // Fetch resolved advert-truth edges when links are shown in advert mode, or
  // when the wrong-location filter needs them to measure neighbour distances.
  useEffect(() => {
    const needEdges = (linksOn && linkMode === 'advert') || hideWrongLocation;
    if (!needEdges) return;
    const controller = new AbortController();
    api
      .getAdvertLinks(controller.signal)
      .then(setAdvertEdges)
      .catch((err) => {
        if (!isAbortError(err)) console.error('Advert links fetch failed', err);
      });
    return () => controller.abort();
  }, [linksOn, linkMode, hideWrongLocation]);

  // Pubkeys hidden by the wrong-location filter (empty unless the toggle is on).
  const wrongLocationKeys = useMemo(
    () => (hideWrongLocation ? computeWrongLocationKeys(advertEdges) : new Set<string>()),
    [hideWrongLocation, advertEdges]
  );

  // Paint advert edges (filtered by the confidence selector) and switch which
  // links layer is visible based on the mode.
  useEffect(() => {
    const liveness = linksLayerRef.current;
    const advert = advertLinksLayerRef.current;
    if (!linksOn) {
      liveness?.hide();
      advert?.hide();
      return;
    }
    if (linkMode === 'advert') {
      liveness?.hide();
      advert?.setData(
        advertEdges.filter(
          (e) =>
            e.hop_width >= linkConfidence &&
            !wrongLocationKeys.has(e.a.pubkey.toLowerCase()) &&
            !wrongLocationKeys.has(e.b.pubkey.toLowerCase())
        )
      );
      advert?.show();
    } else {
      advert?.hide();
      liveness?.show();
      refreshLinks();
    }
  }, [linksOn, linkMode, linkConfidence, advertEdges, refreshLinks, wrongLocationKeys]);

  const threeDaysAgoSec = useMemo(() => Date.now() / 1000 - THREE_DAYS_SEC, []);
  const activeSincePreset = MAP_SINCE_PRESETS.find((p) => p.id === sinceId) ?? null;
  const sinceIsRelative = activeSincePreset != null && activeSincePreset.seconds != null;

  useEffect(() => {
    if (!sinceIsRelative) return;
    const timer = setInterval(() => setNowSec(Date.now() / 1000), MAP_SINCE_TICK_MS);
    return () => clearInterval(timer);
  }, [sinceIsRelative]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_SINCE_STORAGE_KEY, sinceId);
      localStorage.setItem(MAP_SINCE_CUSTOM_KEY, customSince);
      localStorage.setItem(MAP_SINCE_CUSTOM_UNTIL_KEY, customUntil);
    } catch {
      /* ignore */
    }
  }, [sinceId, customSince, customUntil]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_HEARD_STORAGE_KEY, heardFilter);
    } catch {
      /* ignore */
    }
  }, [heardFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_HIDDEN_ROLES_STORAGE_KEY, serializeHiddenRoles(hiddenRoles));
    } catch {
      /* ignore */
    }
  }, [hiddenRoles]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_HIDE_WRONG_LOCATION_STORAGE_KEY, hideWrongLocation ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [hideWrongLocation]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_NODE_SCALE_STORAGE_KEY, String(nodeScale));
    } catch {
      /* ignore */
    }
  }, [nodeScale]);

  // Persist + apply the packet-arc width multiplier.
  useEffect(() => {
    try {
      localStorage.setItem(MAP_ARC_WIDTH_STORAGE_KEY, String(arcWidthScale));
    } catch {
      /* ignore */
    }
    packetOverlayRef.current?.setArcWidthScale(arcWidthScale);
  }, [arcWidthScale]);

  // Persist + apply the link-line width multiplier (liveness + advert layers).
  useEffect(() => {
    try {
      localStorage.setItem(MAP_LINK_WIDTH_STORAGE_KEY, String(linkWidthScale));
    } catch {
      /* ignore */
    }
    linksLayerRef.current?.setWidthScale(linkWidthScale);
    advertLinksLayerRef.current?.setWidthScale(linkWidthScale);
  }, [linkWidthScale]);

  // Persist the label mode and push it to the live layer.
  useEffect(() => {
    try {
      localStorage.setItem(MAP_LABEL_MODE_STORAGE_KEY, labelMode);
    } catch {
      /* ignore */
    }
    nodesRef.current?.setLabelMode(labelMode);
  }, [labelMode]);

  // Telemetry: persist the overlay toggle and show/hide the layer. Latest
  // readings are fetched once on mount (so the node-click popup can show known
  // battery/temperature even when the overlay is off) and refreshed on an
  // interval only while the overlay is on, to avoid constant polling.
  useEffect(() => {
    try {
      localStorage.setItem(MAP_TELEMETRY_STORAGE_KEY, telemetryOn ? '1' : '0');
    } catch {
      /* ignore */
    }
    telemetryRef.current?.setVisible(telemetryOn);

    const controller = new AbortController();
    let active = true;
    const load = async () => {
      try {
        const data = await api.getLatestTelemetry(controller.signal);
        if (active) setLatestTelemetry(data);
      } catch (err) {
        if (!isAbortError(err)) {
          // Non-fatal: keep the last values; the next tick retries.
          console.warn('telemetry fetch failed', err);
        }
      }
    };
    void load();
    if (!telemetryOn) {
      return () => {
        active = false;
        controller.abort();
      };
    }
    const id = window.setInterval(load, TELEMETRY_REFRESH_MS);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(id);
    };
  }, [telemetryOn]);

  // Keep a ref of the latest telemetry for the (imperatively built) popup.
  useEffect(() => {
    latestTelemetryRef.current = latestTelemetry;
  }, [latestTelemetry]);

  // Persist per-role node colours and push them to the live layer + legend.
  useEffect(() => {
    roleColorsRef.current = roleColors;
    saveNodeRoleColors(roleColors);
    nodesRef.current?.setRoleColors(roleColors);
    neonOverlayRef.current?.setRoleColors(roleColors);
  }, [roleColors]);

  const handleRoleColorChange = useCallback((type: number, color: string) => {
    setRoleColors((prev) => ({ ...prev, [type]: color }));
  }, []);
  const handleResetRoleColors = useCallback(() => {
    setRoleColors({ ...DEFAULT_NODE_ROLE_COLORS });
  }, []);

  const sinceCutoffSec = useMemo(() => {
    if (sinceId === 'custom') return localDateTimeToEpochSec(customSince);
    if (!activeSincePreset || activeSincePreset.seconds == null) return null;
    return nowSec - activeSincePreset.seconds;
  }, [sinceId, customSince, activeSincePreset, nowSec]);

  // Optional upper bound for the custom range ("To"). Only custom mode has an
  // end; presets are always open-ended (heard since ...). Empty = up to now.
  const sinceUntilSec = useMemo(
    () => (sinceId === 'custom' ? localDateTimeToEpochSec(customUntil) : null),
    [sinceId, customUntil]
  );

  const isWithinSinceWindow = useCallback(
    (lastSeen: number | null | undefined) => {
      // Lower bound (From / preset): heard strictly after the cutoff.
      if (sinceCutoffSec != null && !(lastSeen != null && lastSeen > sinceCutoffSec)) {
        return false;
      }
      // Upper bound (To): heard at or before the end.
      if (sinceUntilSec != null && !(lastSeen != null && lastSeen <= sinceUntilSec)) {
        return false;
      }
      return true;
    },
    [sinceCutoffSec, sinceUntilSec]
  );

  const mappableContacts = useMemo(() => {
    const isBlocked = (c: Contact) =>
      (blockedKeys?.length && blockedKeys.includes(c.public_key.toLowerCase())) ||
      (blockedNames?.length && c.name != null && blockedNames.includes(c.name));
    // Hide nodes whose advertised location is implausible (nearest heard
    // neighbour > 300km). The focused node is always exempt, like the heard
    // filter, so a searched/selected node is never silently removed.
    const isHiddenForWrongLocation = (c: Contact) =>
      hideWrongLocation &&
      c.public_key !== focusedKey &&
      wrongLocationKeys.has(c.public_key.toLowerCase());
    // Role toggles hide whole node roles (repeater/room/companion/sensor). The
    // focused node is exempt, like the heard filter, so a searched/selected node
    // is never silently removed by a role being switched off.
    const isRoleVisible = (c: Contact) =>
      c.public_key === focusedKey || isRoleVisibleForFilter(c.type, hiddenRoles);
    // Project the effective location (advertised-wins, manual-fallback) onto
    // lat/lon so a node with only manual coordinates is placed and rendered by
    // the standard downstream consumers that read c.lat / c.lon.
    const withEffectiveCoords = (c: Contact): Contact | null => {
      const loc = getEffectiveLocation(c);
      if (!loc) return null;
      return c.lat === loc.lat && c.lon === loc.lon ? c : { ...c, lat: loc.lat, lon: loc.lon };
    };
    if (showPackets && discoveryMode) {
      return contacts
        .filter(
          (c) =>
            discoveredKeys.has(c.public_key) &&
            !isBlocked(c) &&
            !isHiddenForWrongLocation(c) &&
            isRoleVisible(c)
        )
        .map(withEffectiveCoords)
        .filter((c): c is Contact => c !== null);
    }
    return contacts
      .filter(
        (c) =>
          !isBlocked(c) &&
          isContactVisibleForFilters({
            lastSeen: c.last_seen,
            mode: heardFilter,
            isFocused: c.public_key === focusedKey,
            isWithinSinceWindow: isWithinSinceWindow(c.last_seen),
          }) &&
          !isHiddenForWrongLocation(c) &&
          isRoleVisible(c)
      )
      .map(withEffectiveCoords)
      .filter((c): c is Contact => c !== null);
  }, [
    contacts,
    focusedKey,
    heardFilter,
    hiddenRoles,
    isWithinSinceWindow,
    showPackets,
    discoveryMode,
    discoveredKeys,
    blockedKeys,
    blockedNames,
    hideWrongLocation,
    wrongLocationKeys,
  ]);

  const contactByKey = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.public_key, c);
    return m;
  }, [contacts]);

  // Ingest packets into the timeline (path/visual resolution) and advance the
  // playback clock; separately track contacts discovered from packets so
  // discovery mode can filter the node layer. Path accuracy comes entirely from
  // the canonical packetNetworkGraph inside the timeline (single authority).
  useEffect(() => {
    if (!showPackets || !rawPackets?.length) return;
    const tl = ensureTimeline();
    const added = tl.ingest(rawPackets);
    tl.prune(lookbackMs);
    const controller = controllerRef.current;
    const { minMs, maxMs } = tl.range();
    if (controller && maxMs) {
      controller.setRange(minMs, maxMs);
      controller.setNewest(maxMs);
      setPlayRange((prev) =>
        prev.minMs === minMs && prev.maxMs === maxMs ? prev : { minMs, maxMs }
      );
    }
    if (soundOn && added > 0 && controller?.snapshot().mode === 'live') {
      clickAudioRef.current?.play();
    }
    const newDiscovered = new Set<string>();
    for (const pkt of rawPackets) {
      if (pkt.timestamp < threeDaysAgoSec) continue;
      const obsKey = getRawPacketObservationKey(pkt);
      if (seenObservationsRef.current.has(obsKey)) continue;
      const parsed = parsePacket(pkt.data);
      if (!parsed) continue;
      const resolvedContacts = resolvePacketContacts(
        parsed,
        prefixIndex,
        nameIndex,
        myLatLon,
        config
      );
      if (resolvedContacts.size === 0) continue;
      seenObservationsRef.current.add(obsKey);
      for (const key of resolvedContacts) newDiscovered.add(key);
    }
    if (newDiscovered.size > 0) {
      setDiscoveredKeys((prev) => {
        const next = new Set(prev);
        for (const k of newDiscovered) next.add(k);
        return next.size !== prev.size ? next : prev;
      });
    }
  }, [
    rawPackets,
    showPackets,
    ensureTimeline,
    lookbackMs,
    soundOn,
    threeDaysAgoSec,
    prefixIndex,
    nameIndex,
    myLatLon,
    config,
  ]);

  useEffect(() => {
    if (!discoveryMode) setDiscoveredKeys(new Set());
  }, [discoveryMode]);

  useEffect(() => {
    if (!showPackets) {
      setDiscoveredKeys(new Set());
      setDiscoveryMode(false);
      seenObservationsRef.current.clear();
      timelineRef.current?.reset();
      controllerRef.current?.goLive();
    }
  }, [showPackets, setDiscoveryMode]);

  // Build a themed popup DOM node for a contact.
  const buildContactPopup = useCallback(
    (contact: Contact): HTMLElement => {
      const root = document.createElement('div');
      root.className = 'text-sm';
      const nameRow = document.createElement('div');
      nameRow.className = 'font-medium';
      if (onSelectContact) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'p-0 bg-transparent border-0 text-primary underline cursor-pointer';
        btn.textContent = contact.name || contact.public_key.slice(0, 12);
        btn.title = t('map_open_conversation_title', {
          name: contact.name || contact.public_key.slice(0, 12),
        });
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectContact(contact);
        });
        nameRow.appendChild(btn);
      } else {
        nameRow.textContent = contact.name || contact.public_key.slice(0, 12);
      }
      const heard = document.createElement('div');
      heard.className = 'text-xs text-muted-foreground mt-1';
      heard.textContent = t('map_last_heard', {
        label: contact.last_seen != null ? formatTime(contact.last_seen) : t('map_never_heard'),
      });
      const loc = getEffectiveLocation(contact);
      const coords = document.createElement('div');
      coords.className = 'text-xs text-muted-foreground mt-1 font-mono';
      coords.textContent = loc ? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}` : '';
      root.append(nameRow, heard, coords);

      // Latest known battery/temperature as a small block, only when a reading
      // exists for this node. Battery and temperature stack on their own lines;
      // a toggle reveals the telemetry history line chart.
      const latest = latestTelemetryRef.current[contact.public_key];
      if (latest && (latest.battery_volts != null || latest.temperature != null)) {
        const parts = telemetryPopupParts(latest, Date.now() / 1000);
        const block = document.createElement('div');
        block.className = 'mt-2 rounded border border-border/60 bg-muted/30 px-2 py-1.5 text-xs';
        if (parts.stale) block.className += ' opacity-70';
        if (parts.battery) {
          const row = document.createElement('div');
          row.textContent = t('map_telemetry_battery', { value: parts.battery });
          block.appendChild(row);
        }
        if (parts.temperature) {
          const row = document.createElement('div');
          row.textContent = t('map_telemetry_temperature', { value: parts.temperature });
          block.appendChild(row);
        }
        const age = document.createElement('div');
        age.className = 'text-muted-foreground';
        age.textContent = t('map_telemetry_age', { age: parts.age });
        block.appendChild(age);

        // History toggle: lazily mounts the telemetry history chart on first open.
        const chartHost = document.createElement('div');
        chartHost.style.display = 'none';
        let chartRoot: Root | null = null;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className =
          'mt-1 text-primary underline bg-transparent border-0 p-0 cursor-pointer block';
        toggle.textContent = t('map_telemetry_show_history');
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const willShow = chartHost.style.display === 'none';
          chartHost.style.display = willShow ? '' : 'none';
          toggle.textContent = willShow
            ? t('map_telemetry_hide_history')
            : t('map_telemetry_show_history');
          if (willShow && !chartRoot) {
            chartRoot = createRoot(chartHost);
            chartRoot.render(<TelemetryPopupChart publicKey={contact.public_key} />);
            popupChartRootsRef.current.push(chartRoot);
          }
        });
        block.append(toggle, chartHost);
        root.appendChild(block);
      }

      if (contact.notes) {
        const notes = document.createElement('div');
        notes.className = 'text-xs mt-1 whitespace-pre-wrap break-words';
        notes.textContent =
          contact.notes.length > 140 ? contact.notes.slice(0, 140) + '…' : contact.notes;
        root.appendChild(notes);
      }
      if (contact.owner_key && onSelectContact) {
        const ownerLink = document.createElement('button');
        ownerLink.type = 'button';
        ownerLink.className =
          'text-xs text-primary underline mt-1 block bg-transparent border-0 p-0 cursor-pointer';
        ownerLink.textContent = t('map_owner_link');
        ownerLink.addEventListener('click', (e) => {
          e.stopPropagation();
          const owner = contactByKey.get(contact.owner_key!);
          if (owner) onSelectContact(owner);
        });
        root.appendChild(ownerLink);
      }
      if (onOpenContactInfo) {
        const details = document.createElement('button');
        details.type = 'button';
        details.className =
          'text-xs text-primary underline mt-1 block bg-transparent border-0 p-0 cursor-pointer';
        details.textContent = t('map_node_details');
        details.addEventListener('click', (e) => {
          e.stopPropagation();
          onOpenContactInfo(contact.public_key);
        });
        root.appendChild(details);
      }
      return root;
    },
    [onSelectContact, onOpenContactInfo, contactByKey, t]
  );

  const openContactPopup = useCallback(
    (id: string) => {
      const map = mapRef.current;
      const contact = contactByKey.get(id);
      const loc = contact ? getEffectiveLocation(contact) : null;
      if (!map || !contact || !loc) return;
      popupRef.current?.remove();
      const popup = new MlPopup({ closeButton: true, offset: 12, maxWidth: '300px' })
        .setLngLat([loc.lon, loc.lat])
        .setDOMContent(buildContactPopup(contact))
        .addTo(map);
      // Unmount the popup's telemetry-history chart(s) when it closes. Deferred
      // so the unmount never runs during React's render/commit phase.
      popup.on('close', () => {
        const roots = popupChartRootsRef.current;
        popupChartRootsRef.current = [];
        roots.forEach((r) => setTimeout(() => r.unmount(), 0));
      });
      popupRef.current = popup;
    },
    [contactByKey, buildContactPopup]
  );

  const openExternalPopup = useCallback(
    (props: ExternalNodeProps) => {
      const map = mapRef.current;
      if (!map) return;
      const el = document.createElement('div');
      el.className = 'text-sm';
      const name = document.createElement('div');
      name.className = 'font-medium';
      name.textContent = props.name;
      const source = document.createElement('div');
      source.className = 'text-xs text-muted-foreground mt-1';
      source.textContent = t('map_external_node_source', {
        role: props.role || t('map_external_node'),
      });
      const heard = document.createElement('div');
      heard.className = 'text-xs text-muted-foreground';
      heard.textContent = t('map_last_heard', {
        label: props.last_seen != null ? formatTime(props.last_seen) : t('map_never_heard'),
      });
      const coords = document.createElement('div');
      coords.className = 'text-xs text-muted-foreground/80 mt-1 font-mono';
      coords.textContent = `${props.lat.toFixed(5)}, ${props.lon.toFixed(5)}`;
      el.append(name, source, heard, coords);
      externalPopupRef.current?.remove();
      externalPopupRef.current = new MlPopup({ closeButton: true, offset: 10 })
        .setLngLat([props.lon, props.lat])
        .setDOMContent(el)
        .addTo(map);
    },
    [t]
  );

  // Latest map "home view" preference, read at fit time via a ref so the
  // once-on-ready fit sees current values even though appSettings load async.
  const homeSettingsRef = useRef<MapHomeSettings>({
    mode: 'auto',
    lat: null,
    lon: null,
    zoom: null,
  });
  useEffect(() => {
    homeSettingsRef.current = {
      mode: mapHomeMode ?? 'auto',
      lat: mapHomeLat ?? null,
      lon: mapHomeLon ?? null,
      zoom: mapHomeZoom ?? null,
    };
  }, [mapHomeMode, mapHomeLat, mapHomeLon, mapHomeZoom]);

  // Initial camera fit / geolocate / focus (port of MapBoundsHandler).
  const fitInitialView = useCallback(
    (map: MlMap) => {
      if (focusedLatLon) {
        map.flyTo({ center: [focusedLatLon[1], focusedLatLon[0]], zoom: 15, duration: 0 });
        return;
      }
      const focused = focusedKey ? contactByKey.get(focusedKey) : null;
      if (focused && focused.lat != null && focused.lon != null) {
        map.flyTo({ center: [focused.lon, focused.lat], zoom: 12, duration: 0 });
        return;
      }
      // Home-view preference (fixed home or remember-last-position). Explicit
      // node/coordinate focuses above still win; this sits above the geolocate
      // + fit-all fallback below. Returns null in 'auto' mode or when its data
      // is missing/invalid, in which case we fall through to the default fit.
      const home = resolveHomeView(homeSettingsRef.current, readLastView());
      if (home) {
        map.flyTo({ center: home.center, zoom: home.zoom, duration: 0 });
        return;
      }
      const pts = mappableContacts.filter((c) => c.lat != null && c.lon != null);
      const doFit = () => {
        if (pts.length === 0) {
          map.flyTo({ center: [0, 20], zoom: 2, duration: 0 });
        } else if (pts.length === 1) {
          map.flyTo({ center: [pts[0].lon!, pts[0].lat!], zoom: 10, duration: 0 });
        } else {
          let minLng = Infinity,
            minLat = Infinity,
            maxLng = -Infinity,
            maxLat = -Infinity;
          for (const c of pts) {
            minLng = Math.min(minLng, c.lon!);
            maxLng = Math.max(maxLng, c.lon!);
            minLat = Math.min(minLat, c.lat!);
            maxLat = Math.max(maxLat, c.lat!);
          }
          map.fitBounds(
            [
              [minLng, minLat],
              [maxLng, maxLat],
            ],
            { padding: 50, maxZoom: 12, duration: 0 }
          );
        }
      };
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) =>
            map.flyTo({
              center: [position.coords.longitude, position.coords.latitude],
              zoom: 8,
              duration: 0,
            }),
          () => doFit(),
          { timeout: 5000, maximumAge: 300000 }
        );
      } else {
        doFit();
      }
    },
    // Intentionally read latest via refs at call time; fit runs once on ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const handleReady = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      // Analyzer/external overlay under the local nodes so local contacts win.
      const external = createExternalNodesLayer(map, { onClick: openExternalPopup });
      external.ensure();
      external.setData(visibleExternalRef.current);
      externalRef.current = external;
      const nodes = createNodesLayer(map, {
        onClick: openContactPopup,
        roleColors: roleColorsRef.current,
      });
      nodes.ensure();
      nodes.setNodeScale(nodeScale);
      nodes.setLabelMode(labelMode);
      nodes.setData(mappableContacts, nowSec);
      // Neon nodes: a deck.gl halo+core overlay that replaces the flat circles
      // when enabled. The flat circle layer is hidden while neon is on; labels
      // stay on the GL layer either way.
      nodes.setCirclesVisible(!neonNodes);
      nodesRef.current = nodes;
      const neon = createNeonNodesOverlay(map);
      neon.setNodeScale(nodeScale);
      neon.setRoleColors(roleColorsRef.current);
      neon.setData(mappableContacts, nowSec);
      neon.setVisible(neonNodes);
      neonOverlayRef.current = neon;
      const telemetry = createTelemetryLayer(map);
      telemetry.ensure();
      telemetry.setData(mappableContacts, latestTelemetry, nowSec);
      telemetry.setVisible(telemetryOn);
      telemetryRef.current = telemetry;
      // Report the viewport so the external overlay can fetch just what's shown.
      onViewBounds(map.getBounds());
      map.on('moveend', () => {
        if (showExternalRef.current) onViewBounds(map.getBounds());
        // Remember the camera for the "remember last position" startup mode.
        // moveend fires once per gesture (not continuously), so a direct write
        // is cheap and needs no debounce.
        const c = map.getCenter();
        writeLastView({ center: [c.lng, c.lat], zoom: map.getZoom() });
      });
      packetOverlayRef.current = createPacketDeckOverlay(map);
      packetOverlayRef.current.setArcWidthScale(arcWidthScale);
      const links = createLinksLayer(map);
      links.ensure();
      links.setWidthScale(linkWidthScale);
      linksLayerRef.current = links;
      const advertLinks = createAdvertLinksLayer(map);
      advertLinks.ensure();
      advertLinks.setWidthScale(linkWidthScale);
      advertLinksLayerRef.current = advertLinks;
      fitInitialView(map);
      if (focusedLatLon) {
        const el = document.createElement('div');
        el.className = 'text-sm';
        const title = document.createElement('div');
        title.className = 'font-medium';
        title.textContent = focusedLabel || t('map_shared_location');
        const coords = document.createElement('div');
        coords.className = 'text-xs text-muted-foreground mt-1 font-mono';
        coords.textContent = `${focusedLatLon[0].toFixed(6)}, ${focusedLatLon[1].toFixed(6)}`;
        el.append(title, coords);
        const popup = new MlPopup({ offset: 12 }).setDOMContent(el);
        focusMarkerRef.current = new MlMarker({ color: '#ef4444' })
          .setLngLat([focusedLatLon[1], focusedLatLon[0]])
          .setPopup(popup)
          .addTo(map);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openContactPopup]
  );

  const handleBasemapReapply = useCallback(() => {
    const nodes = nodesRef.current;
    if (nodes) {
      nodes.reattach();
      nodes.setData(mappableContacts, nowSec);
      nodes.setNodeScale(nodeScale);
      nodes.setLabelMode(labelMode);
    }
    const telemetry = telemetryRef.current;
    if (telemetry) {
      telemetry.reattach();
      telemetry.setData(mappableContacts, latestTelemetry, nowSec);
      telemetry.setVisible(telemetryOn);
    }
    // A basemap setStyle drops custom sources/layers; re-add and re-feed links.
    linksLayerRef.current?.reattach();
    advertLinksLayerRef.current?.reattach();
    refreshLinks();
    externalRef.current?.reattach();
    externalRef.current?.setData(visibleExternalRef.current);
  }, [mappableContacts, nowSec, nodeScale, labelMode, telemetryOn, latestTelemetry, refreshLinks]);

  // Keep node data in sync.
  useEffect(() => {
    nodesRef.current?.setData(mappableContacts, nowSec);
    neonOverlayRef.current?.setData(mappableContacts, nowSec);
  }, [mappableContacts, nowSec]);

  // Toggle between the flat GL circle nodes and the deck.gl neon overlay.
  useEffect(() => {
    try {
      localStorage.setItem(MAP_NEON_NODES_STORAGE_KEY, neonNodes ? '1' : '0');
    } catch {
      /* ignore */
    }
    nodesRef.current?.setCirclesVisible(!neonNodes);
    neonOverlayRef.current?.setVisible(neonNodes);
  }, [neonNodes]);

  // Keep the telemetry overlay data in sync with contacts + latest readings.
  useEffect(() => {
    telemetryRef.current?.setData(mappableContacts, latestTelemetry, nowSec);
  }, [mappableContacts, latestTelemetry, nowSec]);

  useEffect(() => {
    nodesRef.current?.setNodeScale(nodeScale);
    neonOverlayRef.current?.setNodeScale(nodeScale);
  }, [nodeScale]);

  // Keep the external overlay layer + refs in sync with fetched/visible nodes.
  useEffect(() => {
    showExternalRef.current = showExternalNodes;
  }, [showExternalNodes]);

  useEffect(() => {
    visibleExternalRef.current = visibleExternalNodes;
    externalRef.current?.setData(visibleExternalNodes);
  }, [visibleExternalNodes]);

  // Packet animation loop: drive the virtual clock and paint the deck.gl overlay
  // (arcs + pulses + glow) as a pure function of the displayed time. One overlay
  // serves both flat 2D and tilted 3D. Runs only while packets are shown.
  useEffect(() => {
    if (!showPackets) {
      packetOverlayRef.current?.clear();
      return;
    }
    controllerRef.current?.setBufferMs(bufferMs);
    let raf = 0;
    const frame = () => {
      const controller = controllerRef.current;
      const tl = timelineRef.current;
      if (controller && tl) {
        controller.tick(Date.now());
        const snap = controller.snapshot();
        packetOverlayRef.current?.setModel(
          tl.stateAsOf(snap.currentMs, {
            pulses: pulsesOnRef.current,
            glows: glowOnRef.current,
            fadeMs: arcFadeMsRef.current,
          })
        );
        // Mirror the snapshot to React for the PlaybackBar, throttled so the
        // 60fps clock does not re-render the tree every frame.
        const now = performance.now();
        if (now - snapPushRef.current > 150) {
          snapPushRef.current = now;
          setPlaySnap((prev) =>
            prev.mode === snap.mode &&
            prev.currentMs === snap.currentMs &&
            prev.rate === snap.rate &&
            prev.playing === snap.playing
              ? prev
              : snap
          );
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [showPackets, bufferMs]);

  useEffect(() => {
    return () => {
      packetOverlayRef.current?.destroy();
      neonOverlayRef.current?.destroy();
      clickAudioRef.current?.destroy();
      popupRef.current?.remove();
      externalPopupRef.current?.remove();
      focusMarkerRef.current?.remove();
    };
  }, []);

  // Focus popup open on focus change.
  useEffect(() => {
    if (!focusedKey) return;
    const timer = setTimeout(() => openContactPopup(focusedKey), 150);
    return () => clearTimeout(timer);
  }, [focusedKey, openContactPopup]);

  const handleSearch = useCallback(
    (query: string) => {
      const map = mapRef.current;
      if (!map || !query.trim()) return;
      const q = query.trim().toLowerCase();
      const match = mappableContacts.find(
        (c) =>
          (c.name && c.name.toLowerCase().includes(q)) || c.public_key.toLowerCase().startsWith(q)
      );
      if (match && match.lat != null && match.lon != null) {
        map.flyTo({ center: [match.lon, match.lat], zoom: 13 });
        openContactPopup(match.public_key);
      }
    },
    [mappableContacts, openContactPopup]
  );

  // Since-filter + packet toggles as extra FAB panels.
  const extraFabs: ExtraFab[] = useMemo(() => {
    const sincePanel = (
      <div className="space-y-2">
        <div role="group" aria-label={t('map_since_label')} className="flex flex-wrap gap-1">
          {MAP_SINCE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={sinceId === p.id}
              className={
                'rounded px-2 py-1 text-xs ' +
                (sinceId === p.id
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground')
              }
              onClick={() => setSinceId(p.id)}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
        {/* A <div>, not a <label>: wrapping the composite DateTimeField (text
            field + calendar button + hidden native input) in a <label> mis-routes
            clicks to the first input and breaks picking a date. Each field carries
            its own aria-label. Both bounds are optional: empty From = no lower
            bound, empty To = up to now. */}
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <span>{t('map_custom_button')}</span>
          <div className="flex flex-col gap-1">
            <span>{t('time_range_from')}</span>
            <DateTimeField
              mode="datetime"
              fullWidth
              value={customSince}
              aria-label={t('map_since_custom_input_aria')}
              onChange={(v) => {
                setCustomSince(v);
                setSinceId('custom');
              }}
              className="rounded border border-border bg-background px-2 py-1 pr-7 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span>{t('time_range_to')}</span>
            <DateTimeField
              mode="datetime"
              fullWidth
              value={customUntil}
              aria-label={t('map_since_custom_until_input_aria')}
              onChange={(v) => {
                setCustomUntil(v);
                setSinceId('custom');
              }}
              className="rounded border border-border bg-background px-2 py-1 pr-7 text-sm"
            />
          </div>
        </div>
      </div>
    );
    const packetsPanel = (
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showPackets}
            onChange={(e) => setShowPackets(e.target.checked)}
          />
          {t('map_visualize_packets_label')}
        </label>
        {showPackets && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pulsesOn}
                onChange={(e) => setPulsesOn(e.target.checked)}
              />
              {t('map_packets_pulses_label')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={glowOn}
                onChange={(e) => setGlowOn(e.target.checked)}
              />
              {t('map_packets_glow_label')}
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              <span>
                {t('map_packets_buffer_label')}:{' '}
                {t('map_packets_buffer_value', { seconds: Math.round(bufferMs / 1000) })}
              </span>
              <input
                type="range"
                min={0}
                max={BUFFER_MAX_MS}
                step={500}
                value={bufferMs}
                aria-label={t('map_packets_buffer_label')}
                onChange={(e) => setBufferMs(Number(e.target.value))}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={soundOn}
                onChange={(e) => setSoundOn(e.target.checked)}
              />
              {t('map_packets_sound_label')}
            </label>
            {soundOn && (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span>{t('map_packets_volume_label')}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  aria-label={t('map_packets_volume_label')}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
              </label>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={discoveryMode}
                onChange={(e) => setDiscoveryMode(e.target.checked)}
              />
              {t('map_discover_nodes_label')}
            </label>
            <p className="text-xs text-muted-foreground">{t('map_discover_nodes_help')}</p>
          </>
        )}
      </div>
    );
    const heardOptions: { id: HeardFilterMode; labelKey: string }[] = [
      { id: 'all', labelKey: 'map_heard_all' },
      { id: 'hide', labelKey: 'map_heard_hide' },
      { id: 'only', labelKey: 'map_heard_only' },
    ];
    const heardPanel = (
      <div className="space-y-2">
        <div role="group" aria-label={t('map_heard_label')} className="flex flex-wrap gap-1">
          {heardOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={heardFilter === o.id}
              className={
                'rounded px-2 py-1 text-xs ' +
                (heardFilter === o.id
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-muted text-muted-foreground')
              }
              onClick={() => setHeardFilter(o.id)}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('map_heard_help')}</p>
      </div>
    );
    const roleOptions: { type: number; labelKey: string }[] = [
      { type: CONTACT_TYPE_REPEATER, labelKey: 'map_type_repeater' },
      { type: CONTACT_TYPE_ROOM, labelKey: 'map_type_room' },
      { type: CONTACT_TYPE_CLIENT, labelKey: 'map_type_client' },
      { type: CONTACT_TYPE_SENSOR, labelKey: 'map_type_sensor' },
    ];
    const toggleRole = (type: number) =>
      setHiddenRoles((prev) => {
        const next = new Set(prev);
        if (next.has(type)) next.delete(type);
        else next.add(type);
        return next;
      });
    const hiddenRoleCount = ROLE_FILTER_TYPES.filter((type) => hiddenRoles.has(type)).length;
    const rolesPanel = (
      <div className="space-y-2">
        <div role="group" aria-label={t('map_roles_label')} className="flex flex-col gap-1">
          {roleOptions.map((o) => (
            <label key={o.type} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!hiddenRoles.has(o.type)}
                onChange={() => toggleRole(o.type)}
              />
              {t(o.labelKey)}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('map_roles_help')}</p>
      </div>
    );
    // Show the active timeframe on the Since FAB itself (compact preset code
    // like "7d"/"All", or a clock icon for a custom range).
    const sinceValueText =
      sinceId === 'custom'
        ? t('map_custom_button')
        : t(MAP_SINCE_PRESETS.find((p) => p.id === sinceId)?.labelKey ?? 'time_range_all');
    const sinceIcon =
      sinceId === 'custom' ? (
        <Clock size={18} aria-hidden />
      ) : (
        <span className="text-xs font-semibold leading-none" aria-hidden>
          {sinceValueText}
        </span>
      );
    return [
      {
        id: 'since',
        label: `${t('map_since_label')}: ${sinceValueText}`,
        icon: sinceIcon,
        panel: sincePanel,
      },
      {
        id: 'packets',
        label: t('map_visualize_packets_label'),
        icon: <Zap size={20} aria-hidden />,
        panel: packetsPanel,
      },
      {
        id: 'heard',
        label: `${t('map_heard_label')}: ${t(
          heardOptions.find((o) => o.id === heardFilter)?.labelKey ?? 'map_heard_all'
        )}`,
        icon: <Radio size={20} aria-hidden />,
        panel: heardPanel,
      },
      {
        id: 'roles',
        label:
          hiddenRoleCount > 0
            ? `${t('map_roles_label')} (${ROLE_FILTER_TYPES.length - hiddenRoleCount}/${ROLE_FILTER_TYPES.length})`
            : t('map_roles_label'),
        icon: <Boxes size={20} aria-hidden />,
        panel: rolesPanel,
      },
      {
        id: 'external',
        label: t('map_external_nodes_label'),
        icon: <Globe size={20} aria-hidden />,
        panel: (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showExternalNodes}
              onChange={(e) => setShowExternalNodes(e.target.checked)}
            />
            {t('map_external_nodes_label')}
          </label>
        ),
      },
      {
        id: 'wrong-location',
        label: t('map_hide_wrong_location_label'),
        icon: <MapPinOff size={20} aria-hidden />,
        panel: (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideWrongLocation}
                onChange={(e) => setHideWrongLocation(e.target.checked)}
              />
              {t('map_hide_wrong_location_label')}
            </label>
            <p className="text-xs text-muted-foreground">{t('map_hide_wrong_location_help')}</p>
          </div>
        ),
      },
    ];
  }, [
    t,
    sinceId,
    heardFilter,
    hiddenRoles,
    customSince,
    customUntil,
    showPackets,
    discoveryMode,
    showExternalNodes,
    pulsesOn,
    glowOn,
    bufferMs,
    soundOn,
    volume,
    hideWrongLocation,
    setBufferMs,
    setDiscoveryMode,
    setGlowOn,
    setPulsesOn,
    setShowExternalNodes,
    setShowPackets,
    setSoundOn,
    setVolume,
  ]);

  const theme: 'light' | 'dark' = dark ? 'dark' : 'light';

  return (
    <div className="h-full w-full">
      <MapSurface
        fabs={{
          layers: true,
          legend: true,
          search: true,
          tilt: true,
          buildings: true,
          nodeSize: true,
          links: true,
          labelMode: true,
          telemetry: true,
        }}
        onReady={handleReady}
        onBasemapReapply={handleBasemapReapply}
        tilt3D={tilt3D}
        onToggleTilt={(on) => {
          setTilt3D(on);
          const map = mapRef.current;
          if (map) setMapLock2D(map, !on);
        }}
        buildings={buildings}
        onToggleBuildings={(on) => {
          setBuildings(on);
          const map = mapRef.current;
          if (map) void setBuildings3D(map, on, theme);
        }}
        nodeScale={nodeScale}
        onNodeScale={setNodeScale}
        arcWidthScale={arcWidthScale}
        onArcWidthScale={setArcWidthScale}
        arcFadeMs={arcFadeMs}
        onArcFadeMs={setArcFadeMs}
        linkWidthScale={linkWidthScale}
        onLinkWidthScale={setLinkWidthScale}
        neonNodes={neonNodes}
        onToggleNeon={setNeonNodes}
        roleColors={roleColors}
        onRoleColorChange={handleRoleColorChange}
        onResetRoleColors={handleResetRoleColors}
        labelMode={labelMode}
        onLabelMode={setLabelMode}
        linksOn={linksOn}
        onToggleLinks={(on) => setLinksOn(on)}
        linkMode={linkMode}
        onLinkMode={setLinkMode}
        linkConfidence={linkConfidence}
        onLinkConfidence={setLinkConfidence}
        telemetryOn={telemetryOn}
        onToggleTelemetry={setTelemetryOn}
        sidebarOpen={sidebarOpen}
        onSearch={handleSearch}
        extraFabs={extraFabs}
        legendContent={
          showPackets ? <MapLegend roleColors={roleColors} extra={<PacketLegend />} /> : undefined
        }
      >
        {showPackets && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[500] flex justify-center px-2">
            <PlaybackBar
              snapshot={playSnap}
              range={playRange}
              lookbackMs={lookbackMs}
              onLookback={setLookbackMs}
              onPlay={() => {
                const c = controllerRef.current;
                if (c) {
                  c.play();
                  setPlaySnap(c.snapshot());
                }
              }}
              onPause={() => {
                const c = controllerRef.current;
                if (c) {
                  c.pause();
                  setPlaySnap(c.snapshot());
                }
              }}
              onSeek={(ms) => {
                const c = controllerRef.current;
                if (c) {
                  c.seek(ms);
                  setPlaySnap(c.snapshot());
                }
              }}
              onRate={(r) => {
                const c = controllerRef.current;
                if (c) {
                  c.setRate(r);
                  setPlaySnap(c.snapshot());
                }
              }}
              onLive={() => {
                const c = controllerRef.current;
                if (c) {
                  c.goLive();
                  setPlaySnap(c.snapshot());
                }
              }}
            />
          </div>
        )}
      </MapSurface>
    </div>
  );
}
