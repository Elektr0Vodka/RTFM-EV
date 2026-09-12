import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Popup as MlPopup, Marker as MlMarker, type Map as MlMap } from 'maplibre-gl';
import { Zap, Clock, Globe, Radio } from 'lucide-react';
import type { Contact, ExternalMapNode, RadioConfig } from '../types';
import { api, isAbortError } from '../api';
import { formatTime } from '../utils/messageParser';
import { isValidLocation } from '../utils/pathUtils';
import {
  parsePacket,
  getPacketLabel,
  PARTICLE_COLOR_MAP,
  dedupeConsecutive,
} from '../utils/visualizerUtils';
import { getRawPacketObservationKey } from '../utils/rawPacketIdentity';
import { useRawPackets } from '../stores/rawPacketStore';
import { useIsDarkTheme } from '../hooks/useIsDarkTheme';
import { useT } from '../i18n';
import { MapSurface } from '../map/MapSurface';
import { setMapLock2D } from '../map/engine/mapLock2D';
import { setBuildings3D } from '../map/engine/buildings3D';
import { createNodesLayer } from '../map/layers/nodesLayer';
import {
  getSavedNodeRoleColors,
  saveNodeRoleColors,
  DEFAULT_NODE_ROLE_COLORS,
  type NodeRoleColors,
} from '../map/layers/nodeRoleColors';
import { createParticleOverlay, type MapParticle } from '../map/layers/particleOverlay';
import { createDeckTraces, arcRows, type DeckTracesController } from '../map/layers/tracesDeck';
import { createLinksLayer, type ResolveCoord } from '../map/layers/linksLayer';
import { createExternalNodesLayer, type ExternalNodeProps } from '../map/layers/externalNodesLayer';
import { isContactVisibleForFilters, type HeardFilterMode } from '../map/heardFilter';
import {
  buildPacketNetworkContext,
  createPacketNetworkState,
  ensureSelfNode,
  ingestPacketIntoPacketNetwork,
  projectPacketNetwork,
} from '../networkGraph/packetNetworkGraph';
import type { ExtraFab } from '../map/controls/MapControls';

/** Parse a #rrggbb (or #rgb) hex color into an [r,g,b] triple for deck.gl. */
function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || '').replace('#', '');
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface MapViewProps {
  contacts: Contact[];
  focusedKey?: string | null;
  config?: RadioConfig | null;
  blockedKeys?: string[];
  blockedNames?: string[];
  onSelectContact?: (contact: Contact) => void;
  focusedLatLon?: [number, number];
  focusedLabel?: string;
}

// --- "Heard since" filter ---
const MAP_SINCE_PRESETS = [
  { id: '1h', labelKey: 'map_lt_1h', windowLabelKey: 'map_since_window_1h', seconds: 3600 },
  { id: '1d', labelKey: 'map_lt_1d', windowLabelKey: 'map_since_window_1d', seconds: 24 * 60 * 60 },
  {
    id: '3d',
    labelKey: 'map_lt_3d',
    windowLabelKey: 'map_since_window_3d',
    seconds: 3 * 24 * 60 * 60,
  },
  {
    id: '7d',
    labelKey: 'map_preset_7d',
    windowLabelKey: 'map_since_window_7d',
    seconds: 7 * 24 * 60 * 60,
  },
  { id: 'all', labelKey: 'map_preset_all', windowLabelKey: null, seconds: null },
] as const;

type MapSinceId = (typeof MAP_SINCE_PRESETS)[number]['id'] | 'custom';
const DEFAULT_MAP_SINCE_ID: MapSinceId = '7d';
const MAP_SINCE_STORAGE_KEY = 'remoteterm-map-since';

// --- "Heard by server" filter (contacts layer only) ---
const HEARD_FILTER_MODES = ['all', 'hide', 'only'] as const satisfies readonly HeardFilterMode[];
const DEFAULT_HEARD_MODE: HeardFilterMode = 'all';
const MAP_HEARD_STORAGE_KEY = 'remoteterm-map-heard';

const MAP_NODE_SCALE_STORAGE_KEY = 'remoteterm-map-node-scale';
const MAP_SINCE_TICK_MS = 60_000;

const THREE_DAYS_SEC = 3 * 24 * 60 * 60;
const PARTICLE_LIFETIME_MS = 3000;
const MAX_MAP_PARTICLES = 200;

function getSavedSinceId(): MapSinceId {
  try {
    const stored = localStorage.getItem(MAP_SINCE_STORAGE_KEY);
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

function getSavedNodeScale(): number {
  try {
    const v = Number(localStorage.getItem(MAP_NODE_SCALE_STORAGE_KEY));
    if (Number.isFinite(v) && v >= 0.5 && v <= 2.5) return v;
  } catch {
    /* ignore */
  }
  return 1;
}

function localDateTimeToEpochSec(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms / 1000;
}

function resolveHopToGps(hopToken: string, prefixIndex: Map<string, Contact[]>): Contact | null {
  const matches = prefixIndex.get(hopToken.toLowerCase());
  if (!matches || matches.length !== 1) return null;
  const c = matches[0];
  return isValidLocation(c.lat, c.lon) ? c : null;
}

function resolveNameToGps(name: string, nameIndex: Map<string, Contact>): Contact | null {
  const c = nameIndex.get(name);
  if (!c) return null;
  return isValidLocation(c.lat, c.lon) ? c : null;
}

function resolvePacketContacts(
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
    if (matches?.length === 1 && isValidLocation(matches[0].lat, matches[0].lon)) {
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
    if (matches?.length === 1 && isValidLocation(matches[0].lat, matches[0].lon)) {
      keys.add(matches[0].public_key);
    }
  }
  if (myLatLon && config?.public_key) keys.add(config.public_key.toLowerCase());
  if (parsed.dstHash) {
    const matches = prefixIndex.get(parsed.dstHash.toLowerCase());
    if (matches?.length === 1 && isValidLocation(matches[0].lat, matches[0].lon)) {
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
  focusedLatLon,
  focusedLabel,
}: MapViewProps) {
  const t = useT();
  const dark = useIsDarkTheme();
  const rawPackets = useRawPackets();
  const [sinceId, setSinceId] = useState<MapSinceId>(getSavedSinceId);
  const [heardFilter, setHeardFilter] = useState<HeardFilterMode>(getSavedHeardMode);
  const [customSince, setCustomSince] = useState('');
  const [nowSec, setNowSec] = useState(() => Date.now() / 1000);
  const [showPackets, setShowPackets] = useState(false);
  const [discoveryMode, setDiscoveryMode] = useState(false);
  const [discoveredKeys, setDiscoveredKeys] = useState<Set<string>>(new Set());
  const [particles, setParticles] = useState<MapParticle[]>([]);
  const [tilt3D, setTilt3D] = useState(false);
  const [buildings, setBuildings] = useState(false);
  const [nodeScale, setNodeScale] = useState(getSavedNodeScale);
  const [roleColors, setRoleColors] = useState<NodeRoleColors>(getSavedNodeRoleColors);
  const [linksOn, setLinksOn] = useState(false);
  const [showExternalNodes, setShowExternalNodes] = useState(false);
  const [externalNodes, setExternalNodes] = useState<ExternalMapNode[]>([]);
  const [viewBounds, setViewBounds] = useState<{
    west: number;
    south: number;
    east: number;
    north: number;
  } | null>(null);

  const particleIdRef = useRef(0);
  const seenObservationsRef = useRef(new Set<string>());
  const mapRef = useRef<MlMap | null>(null);
  const nodesRef = useRef<ReturnType<typeof createNodesLayer> | null>(null);
  const roleColorsRef = useRef<NodeRoleColors>(roleColors);
  const overlayRef = useRef<ReturnType<typeof createParticleOverlay> | null>(null);
  const deckRef = useRef<DeckTracesController | null>(null);
  const linksLayerRef = useRef<ReturnType<typeof createLinksLayer> | null>(null);
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
  // packetNetworkGraph.ts, which keys nodes by contactIndex.byPrefix12).
  const resolveLinkCoord = useCallback<ResolveCoord>(
    (nodeId) => {
      if (nodeId === 'self') return myLatLon ? { lat: myLatLon[0], lon: myLatLon[1] } : undefined;
      const matches = prefixIndex.get(nodeId);
      const c = matches && matches.length === 1 ? matches[0] : undefined;
      return c && c.lat != null && c.lon != null && isValidLocation(c.lat, c.lon)
        ? { lat: c.lat, lon: c.lon }
        : undefined;
    },
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
      if (sinceId === 'custom') return;
      localStorage.setItem(MAP_SINCE_STORAGE_KEY, sinceId);
    } catch {
      /* ignore */
    }
  }, [sinceId]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_HEARD_STORAGE_KEY, heardFilter);
    } catch {
      /* ignore */
    }
  }, [heardFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(MAP_NODE_SCALE_STORAGE_KEY, String(nodeScale));
    } catch {
      /* ignore */
    }
  }, [nodeScale]);

  // Persist per-role node colours and push them to the live layer + legend.
  useEffect(() => {
    roleColorsRef.current = roleColors;
    saveNodeRoleColors(roleColors);
    nodesRef.current?.setRoleColors(roleColors);
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

  const isWithinSinceWindow = useCallback(
    (lastSeen: number | null | undefined) => {
      if (sinceCutoffSec == null) return true;
      return lastSeen != null && lastSeen > sinceCutoffSec;
    },
    [sinceCutoffSec]
  );

  const mappableContacts = useMemo(() => {
    const isBlocked = (c: Contact) =>
      (blockedKeys?.length && blockedKeys.includes(c.public_key.toLowerCase())) ||
      (blockedNames?.length && c.name != null && blockedNames.includes(c.name));
    if (showPackets && discoveryMode) {
      return contacts.filter(
        (c) => isValidLocation(c.lat, c.lon) && discoveredKeys.has(c.public_key) && !isBlocked(c)
      );
    }
    return contacts.filter(
      (c) =>
        isValidLocation(c.lat, c.lon) &&
        !isBlocked(c) &&
        isContactVisibleForFilters({
          lastSeen: c.last_seen,
          mode: heardFilter,
          isFocused: c.public_key === focusedKey,
          isWithinSinceWindow: isWithinSinceWindow(c.last_seen),
        })
    );
  }, [
    contacts,
    focusedKey,
    heardFilter,
    isWithinSinceWindow,
    showPackets,
    discoveryMode,
    discoveredKeys,
    blockedKeys,
    blockedNames,
  ]);

  const contactByKey = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of contacts) m.set(c.public_key, c);
    return m;
  }, [contacts]);

  const resolvePacketPath = useCallback(
    (parsed: ReturnType<typeof parsePacket>): [number, number][] | null => {
      if (!parsed) return null;
      const waypoints: [number, number][] = []; // [lat, lon]
      let sourceContact: Contact | null = null;
      if (parsed.advertPubkey) {
        const prefix = parsed.advertPubkey.slice(0, 12).toLowerCase();
        const matches = prefixIndex.get(prefix);
        if (matches?.length === 1 && isValidLocation(matches[0].lat, matches[0].lon))
          sourceContact = matches[0];
      } else if (parsed.srcHash) {
        sourceContact = resolveHopToGps(parsed.srcHash, prefixIndex);
      } else if (parsed.groupTextSender) {
        sourceContact = resolveNameToGps(parsed.groupTextSender, nameIndex);
      }
      if (sourceContact) waypoints.push([sourceContact.lat!, sourceContact.lon!]);
      for (const hop of parsed.pathBytes) {
        if (hop.length < 4) continue;
        const contact = resolveHopToGps(hop, prefixIndex);
        if (contact) waypoints.push([contact.lat!, contact.lon!]);
      }
      if (myLatLon) waypoints.push(myLatLon);
      else if (parsed.dstHash) {
        const dest = resolveHopToGps(parsed.dstHash, prefixIndex);
        if (dest) waypoints.push([dest.lat!, dest.lon!]);
      }
      const deduped = dedupeConsecutive(waypoints.map((w) => `${w[0]},${w[1]}`));
      if (deduped.length < 2) return null;
      // Convert to [lng, lat] for MapLibre.
      return deduped.map((s) => {
        const [lat, lon] = s.split(',').map(Number);
        return [lon, lat] as [number, number];
      });
    },
    [prefixIndex, nameIndex, myLatLon]
  );

  // Process new packets into particles and track discovered contacts.
  useEffect(() => {
    if (!showPackets || !rawPackets?.length) return;
    const now = Date.now();
    const newParticles: MapParticle[] = [];
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
      const path = resolvePacketPath(parsed);
      if (resolvedContacts.size === 0 && !path) continue;
      seenObservationsRef.current.add(obsKey);
      for (const key of resolvedContacts) newDiscovered.add(key);
      if (path) {
        newParticles.push({
          id: particleIdRef.current++,
          path,
          color: PARTICLE_COLOR_MAP[getPacketLabel(parsed.payloadType)],
          startedAt: now,
        });
      }
    }
    if (newDiscovered.size > 0) {
      setDiscoveredKeys((prev) => {
        const next = new Set(prev);
        for (const k of newDiscovered) next.add(k);
        return next.size !== prev.size ? next : prev;
      });
    }
    if (newParticles.length === 0) return;
    setParticles((prev) => {
      const combined = [...prev, ...newParticles];
      const alive = combined.filter((p) => now - p.startedAt < PARTICLE_LIFETIME_MS);
      return alive.slice(-MAX_MAP_PARTICLES);
    });
  }, [
    rawPackets,
    showPackets,
    resolvePacketPath,
    threeDaysAgoSec,
    prefixIndex,
    nameIndex,
    myLatLon,
    config,
  ]);

  useEffect(() => {
    if (!showPackets) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setParticles((prev) => prev.filter((p) => now - p.startedAt < PARTICLE_LIFETIME_MS));
    }, 1000);
    return () => clearInterval(interval);
  }, [showPackets]);

  useEffect(() => {
    if (!discoveryMode) setDiscoveredKeys(new Set());
  }, [discoveryMode]);

  useEffect(() => {
    if (!showPackets) {
      setParticles([]);
      setDiscoveredKeys(new Set());
      setDiscoveryMode(false);
      seenObservationsRef.current.clear();
    }
  }, [showPackets]);

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
      const coords = document.createElement('div');
      coords.className = 'text-xs text-muted-foreground mt-1 font-mono';
      coords.textContent = `${contact.lat!.toFixed(5)}, ${contact.lon!.toFixed(5)}`;
      root.append(nameRow, heard, coords);
      return root;
    },
    [onSelectContact, t]
  );

  const openContactPopup = useCallback(
    (id: string) => {
      const map = mapRef.current;
      const contact = contactByKey.get(id);
      if (!map || !contact || contact.lat == null || contact.lon == null) return;
      popupRef.current?.remove();
      popupRef.current = new MlPopup({ closeButton: true, offset: 12 })
        .setLngLat([contact.lon, contact.lat])
        .setDOMContent(buildContactPopup(contact))
        .addTo(map);
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
      nodes.setData(mappableContacts, nowSec);
      nodesRef.current = nodes;
      // Report the viewport so the external overlay can fetch just what's shown.
      onViewBounds(map.getBounds());
      map.on('moveend', () => {
        if (showExternalRef.current) onViewBounds(map.getBounds());
      });
      const overlay = createParticleOverlay(map);
      overlayRef.current = overlay;
      if (showPackets) overlay.start();
      const links = createLinksLayer(map);
      links.ensure();
      linksLayerRef.current = links;
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
    }
    // A basemap setStyle drops custom sources/layers; re-add and re-feed links.
    linksLayerRef.current?.reattach();
    refreshLinks();
    externalRef.current?.reattach();
    externalRef.current?.setData(visibleExternalRef.current);
  }, [mappableContacts, nowSec, nodeScale, refreshLinks]);

  // Keep node data in sync.
  useEffect(() => {
    nodesRef.current?.setData(mappableContacts, nowSec);
  }, [mappableContacts, nowSec]);

  useEffect(() => {
    nodesRef.current?.setNodeScale(nodeScale);
  }, [nodeScale]);

  // Keep the external overlay layer + refs in sync with fetched/visible nodes.
  useEffect(() => {
    showExternalRef.current = showExternalNodes;
  }, [showExternalNodes]);

  useEffect(() => {
    visibleExternalRef.current = visibleExternalNodes;
    externalRef.current?.setData(visibleExternalNodes);
  }, [visibleExternalNodes]);

  // Packet replay: the reprojected canvas overlay in 2D, deck.gl arc traces in
  // 3D. The 2D/3D toggle swaps which one draws the same resolved hop paths.
  useEffect(() => {
    const overlay = overlayRef.current;
    const map = mapRef.current;
    if (!overlay) return;
    if (tilt3D && map) {
      overlay.stop();
      if (!deckRef.current) deckRef.current = createDeckTraces(map);
      if (showPackets) {
        const rows = particles.flatMap((p) =>
          arcRows(
            p.path.map(([lon, lat]) => ({ lon, lat })),
            hexToRgb(p.color)
          )
        );
        deckRef.current.setArcs(rows);
      } else {
        deckRef.current.clear();
      }
    } else {
      deckRef.current?.clear();
      overlay.setParticles(particles);
      if (showPackets) overlay.start();
      else overlay.stop();
    }
  }, [particles, showPackets, tilt3D]);

  useEffect(() => {
    return () => {
      overlayRef.current?.destroy();
      deckRef.current?.destroy();
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
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t('map_custom_button')}
          <input
            type="datetime-local"
            value={customSince}
            aria-label={t('map_since_custom_input_aria')}
            onChange={(e) => {
              setCustomSince(e.target.value);
              setSinceId('custom');
            }}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
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
    // Show the active timeframe on the Since FAB itself (compact preset code
    // like "7d"/"All", or a clock icon for a custom range).
    const sinceValueText =
      sinceId === 'custom'
        ? t('map_custom_button')
        : t(MAP_SINCE_PRESETS.find((p) => p.id === sinceId)?.labelKey ?? 'map_preset_all');
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
    ];
  }, [t, sinceId, heardFilter, customSince, showPackets, discoveryMode, showExternalNodes]);

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
        roleColors={roleColors}
        onRoleColorChange={handleRoleColorChange}
        onResetRoleColors={handleResetRoleColors}
        linksOn={linksOn}
        onToggleLinks={(on) => {
          setLinksOn(on);
          const layer = linksLayerRef.current;
          if (!layer) return;
          if (on) layer.show();
          else layer.hide();
        }}
        onSearch={handleSearch}
        extraFabs={extraFabs}
      />
    </div>
  );
}
