// The coverage map (map.mesh-hunter.eu parity): where the drivers heard what,
// and how well, over RTFM-EV's stored receptions. Shared by Tools > Wardrive
// (the owner, admin API) and the wardrive page (a driver, their visibility).
// Owns the state (in the URL and the browser), the loading (debounced, the
// newest request wins, refreshed while the range ends now) and the controls;
// CoverageMapGL draws.
import { Box, Compass, Download, List, MapPin, Minus, Plus, Settings } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { useLocale, useT } from '../../i18n';
import { loadCardBrand, type CardBrand } from '../../share/brand';
import { shareFilename } from '../../share/filename';
import { ShareCardDialog, type ShareBuildOptions } from '../../share/ShareCardDialog';
import { getSavedDistanceUnit } from '../../utils/distanceUnits';
import { formatDistance } from '../../utils/pathUtils';
import { formatWhen } from '../reports/format';
import { nodeHues } from '../map/nodeLayer';
import { tierColor } from '../signal';
import { POINTS_CAP, fetchAllPoints, type CoverageApi } from './api';
import { REACH_CAP_KM, padBounds, type RegistryNode } from './attribution';
import { heatImage } from './heat';
import { locate, type LocateResult } from './locate';
import {
  FAR_KM,
  heardModel,
  mappedCells,
  renderHeardCard,
  routeSegments,
  type HeardModel,
} from './heardCard';
import { buildLocateLayer, buildNodeOverlays, starsFor, toRegistry } from './overlays';
import { CellCard, LocateBox, NodeCard, ReceptionCard } from './Cards';
import {
  CoverageMapGL,
  type CoverageCells,
  type CoverageMapHandle,
  type CoverageOverlays,
  type CoverageView,
  type LocateLayer,
} from './CoverageMapGL';
import { FilterPanel } from './FilterPanel';
import { DriverPicker, TargetPicker, senderRows, type SenderRow } from './Pickers';
import { pointBounds } from './features';
import {
  DEFAULT_STATE,
  STORE_KEY,
  decodeState,
  encodeState,
  isLive,
  loadIgnore,
  loadStored,
  queryParams,
  store,
  storeIgnore,
  type CoverageState,
  type NodePosStop,
  type QueryParams,
} from './state';
import { LIST_CAP, ReceptionList, pointInRing, receptionKey } from './ReceptionList';
import { TimeRange } from './TimeRange';
import { BAR_BUTTON, Dropdown } from './Dropdown';
import { IntroCard } from './Intro';
import { EXAGGERATION_STEPS } from '../map/terrain';
import type { MapCell, MapDriver, MapPoint } from './types';
import { cellSizes, hexShare, pointShare } from './zoomFade';
import { hexResForZoom } from '../map/hexgrid';
import { DEFAULT_EXAGGERATION } from '../map/terrain';

export interface UrlState {
  read(): URLSearchParams;
  write(p: URLSearchParams): void;
  /** A link to this map with these parameters (Copy absolute link). */
  link?(p: URLSearchParams): string;
}

const NO_CELLS: CoverageCells = { a: [], b: [], resA: null, resB: null };
const LIVE_TICK_MS = 10000;
const NO_LIVE: { lat: number; lon: number; label: string }[] = [];
const NO_EXTRA: QueryParams = {};
const STOPS: NodePosStop[] = ['off', 'positions', 'reach'];
/** The node list answers a box of at most 4 x 6 degrees (app/wardrive/nodes.py). */
const MAX_BOX_LAT = 4;
const MAX_BOX_LON = 6;
const LOCATE_MAX = 100000;
const LOCATE_POLL_MS = 5000;
/** The window's receptions are fetched again at most this often. */
const WINDOW_CACHE_MS = 9000;
const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };
const EMPTY_LOCATE: LocateLayer = {
  inliers: EMPTY_FC,
  outliers: EMPTY_FC,
  centroid: EMPTY_FC,
  strongest: EMPTY_FC,
  heat: null,
};
const HASH_KINDS = ['path_hash', 'direct_hash'];
const LIST_POLL_MS = 5000;

const defaultBrand = () => loadCardBrand(null);

interface HeardExport {
  model: HeardModel;
  routes: [number, number][][];
  cells: [number, number][][];
  colorOf: (id: string) => string;
  notes: string[];
  drivers: number;
  since: number;
  until: number;
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Storage blocked: lasts for this page load.
  }
}

interface Status {
  kind: 'points' | 'cells';
  count: number;
  truncated: boolean;
  coversFrom: string | null;
}

function initialState(url: UrlState | undefined, storeKey: string): CoverageState {
  const fromUrl = url?.read();
  if (fromUrl && [...fromUrl.keys()].length > 0) return decodeState(fromUrl);
  const stored = loadStored(storeKey);
  return stored ? decodeState(stored) : { ...DEFAULT_STATE };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface CoverageMapProps {
  api: CoverageApi;
  urlState?: UrlState;
  storeKey?: string;
  /** Drivers on the road now (the owner's map). */
  live?: { lat: number; lon: number; label: string }[];
  focus?: { lat: number; lon: number; nonce: number } | null;
  /** Above the map (the owner's view-as line). */
  banner?: ReactNode;
  /** More controls at the end of the bar. */
  extraBar?: ReactNode;
  exaggeration?: number;
  /** Filters of the surface itself (the owner's group and radio). */
  extraParams?: QueryParams;
  debounceMs?: number;
  now?: () => number;
  /** The brand drawn in the share card footer. */
  brand?: () => Promise<CardBrand>;
  /** Show the walkthrough on the first visit (tests turn it off). */
  showIntro?: boolean;
}

export function CoverageMap({
  api,
  urlState,
  storeKey = STORE_KEY,
  live = NO_LIVE,
  focus = null,
  banner,
  extraBar,
  exaggeration = DEFAULT_EXAGGERATION,
  extraParams = NO_EXTRA,
  debounceMs = 250,
  now = Date.now,
  brand = defaultBrand,
  showIntro = true,
}: CoverageMapProps) {
  const t = useT();
  const { locale } = useLocale();
  const [state, setState] = useState<CoverageState>(() => initialState(urlState, storeKey));
  const [ignore, setIgnore] = useState<string[]>(() => loadIgnore(`${storeKey}-ignore`));
  const [view, setView] = useState<CoverageView | null>(null);
  const [nowMs, setNowMs] = useState(now);
  const [drivers, setDrivers] = useState<MapDriver[]>([]);
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [cells, setCells] = useState<CoverageCells>(NO_CELLS);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [pickedCell, setPickedCell] = useState<MapCell | null>(null);
  const [fit, setFit] = useState<{
    bounds: [[number, number], [number, number]];
    nonce: number;
  } | null>(null);
  const [pin, setPin] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [targets, setTargets] = useState<SenderRow[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [registry, setRegistry] = useState<{ nodes: RegistryNode[]; failed: boolean } | null>(null);
  const [windowPts, setWindowPts] = useState<MapPoint[]>([]);
  const [nodesTooWide, setNodesTooWide] = useState(false);
  const [reachSel, setReachSel] = useState<Set<string>>(() => new Set());
  const [pickedNode, setPickedNode] = useState<string | null>(null);
  const [locateResult, setLocateResult] = useState<LocateResult | null>(null);
  const [locateFailed, setLocateFailed] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [listOpen, setListOpen] = useState(() => readFlag(`${storeKey}-list`));
  const [listRows, setListRows] = useState<MapPoint[]>([]);
  const [listTruncated, setListTruncated] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; nonce: number } | null>(null);
  const [listCurrent, setListCurrent] = useState<string | null>(null);
  const [heard, setHeard] = useState<HeardExport | null>(null);
  const [heardMsg, setHeardMsg] = useState<string | null>(null);
  const [introOpen, setIntroOpen] = useState(() => showIntro && !readFlag(`${storeKey}-intro`));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exag, setExag] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem(`${storeKey}-exag`));
      return EXAGGERATION_STEPS.includes(v) ? v : exaggeration;
    } catch {
      return exaggeration;
    }
  });
  const windowCache = useRef<{ key: string; at: number; points: Promise<MapPoint[]> } | null>(null);
  const cvdMode = useCvdMode();
  const cvd = cvdMode !== 'off';
  const mapHandle = useRef<CoverageMapHandle | null>(null);
  const loadSeq = useRef(0);
  const initial = useRef(
    state.lat !== null && state.lon !== null
      ? {
          lat: state.lat,
          lon: state.lon,
          z: state.z ?? 11,
          pitch: state.pitch,
          bearing: state.bearing,
        }
      : null
  );

  // The state goes to the URL and to this browser.
  const urlRef = useRef(urlState);
  urlRef.current = urlState;
  useEffect(() => {
    urlRef.current?.write(encodeState(state));
    store(state, storeKey);
  }, [state, storeKey]);
  useEffect(() => storeIgnore(ignore, `${storeKey}-ignore`), [ignore, storeKey]);

  const patch = useCallback((p: Partial<CoverageState>) => setState((s) => ({ ...s, ...p })), []);

  // A range that ends now moves on every tick.
  useEffect(() => {
    setNowMs(now());
    if (!isLive(state.to)) return;
    const timer = setInterval(() => setNowMs(now()), LIVE_TICK_MS);
    return () => clearInterval(timer);
  }, [state.from, state.to, now]);

  const extraKey = JSON.stringify(extraParams);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extra = useMemo(() => extraParams, [extraKey]);
  const ask = useCallback(
    (
      s: CoverageState,
      known: number[] | null,
      ign: string[],
      bbox: [number, number, number, number] | null
    ) => ({
      ...queryParams(s, known, ign, bbox, nowMs),
      ...extra,
    }),
    [extra, nowMs]
  );

  const knownIds = useMemo(
    () => (drivers.length ? drivers.map((d) => d.user_id) : null),
    [drivers]
  );
  const windowParams = useMemo(() => ask({ ...state, drivers: [] }, null, [], null), [state, ask]);

  // The drivers in the window, for the picker.
  const windowKey = `${windowParams.since}:${windowParams.until}:${extraKey}`;
  useEffect(() => {
    let cancelled = false;
    api
      .drivers({ since: windowParams.since, until: windowParams.until, ...extra })
      .then((r) => {
        if (!cancelled) setDrivers(r.drivers);
      })
      .catch(() => {
        // The picker keeps the last list.
      });
    return () => {
      cancelled = true;
    };
    // windowKey stands for since/until.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, windowKey]);

  const z = view?.z ?? 0;
  const showPoints = view !== null && pointShare(z, state.mode, state.view3d) > 0;
  const showCells = view !== null && hexShare(z, state.mode, state.view3d) > 0;
  const sizes = useMemo(() => (showCells ? cellSizes(z) : { a: null, b: null }), [showCells, z]);
  // Locate is a focus view: the coverage layers wait while it is on.
  const params = useMemo(
    () => (view && !state.locate ? ask(state, knownIds, ignore, view.bbox) : null),
    [view, state, knownIds, ignore, ask]
  );
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!params) return;
    const token = ++loadSeq.current;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      Promise.all([
        showPoints ? fetchAllPoints(api, params, POINTS_CAP, ctrl.signal) : null,
        sizes.a !== null ? api.cells(params, sizes.a, ctrl.signal) : null,
        sizes.b !== null ? api.cells(params, sizes.b, ctrl.signal) : null,
      ]).then(
        ([pts, a, b]) => {
          if (token !== loadSeq.current) return;
          setError(null);
          setPoints(pts?.points ?? []);
          setCells({ a: a?.cells ?? [], b: b?.cells ?? [], resA: sizes.a, resB: sizes.b });
          if (pts) {
            setStatus({
              kind: 'points',
              count: pts.points.length,
              truncated: pts.truncated,
              coversFrom: pts.covers_from,
            });
          } else {
            const own = hexResForZoom(z);
            const shown = own === sizes.a ? a : own === sizes.b ? b : (a ?? b);
            setStatus({
              kind: 'cells',
              count: shown?.cells.length ?? 0,
              truncated: !!shown?.truncated,
              coversFrom: shown?.covers_from ?? null,
            });
          }
        },
        (e) => {
          if (token !== loadSeq.current) return;
          setPoints([]);
          setCells(NO_CELLS);
          setStatus(null);
          setError(errorText(e));
        }
      );
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // paramsKey stands for params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, paramsKey, showPoints, sizes.a, sizes.b, debounceMs]);

  // The window's receptions without the sender narrowing: what the node
  // estimates and the stars are made of, whatever the view (their #664).
  const windowPoints = useCallback(() => {
    const p = ask({ ...state, senders: [], senderPrefix: '' }, knownIds, ignore, null);
    const key = JSON.stringify(p);
    const hit = windowCache.current;
    if (hit && hit.key === key && Date.now() - hit.at < WINDOW_CACHE_MS) return hit.points;
    const points = fetchAllPoints(api, p).then((r) => r.points);
    windowCache.current = { key, at: Date.now(), points };
    points.catch(() => {
      if (windowCache.current?.points === points) windowCache.current = null;
    });
    return points;
  }, [api, ask, state, knownIds, ignore]);

  const nodesOn = state.nodepos !== 'off' && view !== null && !state.locate;
  const nodeKey = nodesOn ? JSON.stringify([view!.bbox, windowParams, ignore, knownIds]) : null;
  useEffect(() => {
    if (!nodeKey || !view) {
      setRegistry(null);
      setNodesTooWide(false);
      return;
    }
    const [south, west, north, east] = view.bbox;
    const box = padBounds({ south, west, north, east }, REACH_CAP_KM);
    if (box.north - box.south > MAX_BOX_LAT || box.east - box.west > MAX_BOX_LON) {
      setNodesTooWide(true);
      setRegistry(null);
      return;
    }
    setNodesTooWide(false);
    let cancelled = false;
    const timer = setTimeout(() => {
      const clamp = {
        south: Math.max(-90, box.south),
        west: Math.max(-180, box.west),
        north: Math.min(90, box.north),
        east: Math.min(180, box.east),
      };
      Promise.all([
        api.nodes(clamp).then(
          (r) => ({ nodes: toRegistry(r.nodes), failed: false }),
          () => ({ nodes: [] as RegistryNode[], failed: true })
        ),
        windowPoints().catch(() => [] as MapPoint[]),
      ]).then(([reg, pts]) => {
        if (cancelled) return;
        setRegistry(reg);
        setWindowPts(pts);
      });
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // nodeKey stands for the view and the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeKey, api, debounceMs]);

  const selectedStars = useMemo(
    () => new Set([...reachSel, ...state.senders.map((x) => x.toLowerCase())]),
    [reachSel, state.senders]
  );
  const nodeOverlay = useMemo(() => {
    if (!registry || !view || state.nodepos === 'off') return null;
    return buildNodeOverlays({
      registry: registry.nodes,
      points: windowPts,
      bbox: view.bbox,
      stop: state.nodepos,
      selected: selectedStars,
      palette: nodeHues(cvdMode, 'dark'),
    });
  }, [registry, view, state.nodepos, windowPts, selectedStars, cvdMode]);

  // Locate: one sender (a picked id or a typed prefix) over the window and
  // nothing else, or with no single sender whatever the filters leave.
  const locateParams = useMemo(() => {
    if (!state.locate) return null;
    const time = ask({ ...DEFAULT_STATE, from: state.from, to: state.to }, null, [], null);
    if (state.senders.length === 1) return { ...time, sender: [state.senders[0]] };
    if (state.senders.length === 0 && state.senderPrefix) {
      return { ...time, sender_prefix: state.senderPrefix };
    }
    return ask(state, knownIds, ignore, null);
  }, [state, ask, knownIds, ignore]);
  const locateKey = locateParams ? JSON.stringify(locateParams) : null;
  useEffect(() => {
    if (!locateKey || !locateParams) {
      setLocateResult(null);
      setLocateFailed(false);
      return;
    }
    let cancelled = false;
    const run = () =>
      fetchAllPoints(api, locateParams, LOCATE_MAX).then(
        (r) => {
          if (cancelled) return;
          setLocateFailed(false);
          setLocateResult(locate(r.points.map((p) => ({ lat: p.lat, lon: p.lon, rssi: p.rssi }))));
        },
        () => {
          if (!cancelled) setLocateFailed(true);
        }
      );
    void run();
    const timer = isLive(state.to) ? setInterval(run, LOCATE_POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // locateKey stands for locateParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateKey, api]);

  const locateLayer = useMemo(() => {
    if (!state.locate) return null;
    if (!locateResult) return EMPTY_LOCATE;
    const heat = locateResult.heatmap
      ? heatImage(locateResult.heatmap, [
          tierColor('mid', false),
          tierColor('warm', false),
          tierColor('hot', false),
        ])
      : null;
    return buildLocateLayer(locateResult, cvd, heat);
  }, [state.locate, locateResult, cvd]);

  const overlays: CoverageOverlays = useMemo(
    () => ({
      nodes: nodeOverlay?.overlays.nodes ?? null,
      reach: nodeOverlay?.overlays.reach ?? null,
      locate: locateLayer,
    }),
    [nodeOverlay, locateLayer]
  );

  const nodeNotice = (() => {
    if (!nodesOn) return null;
    if (nodesTooWide) return t('wardrive_cov_nodes_zoom');
    if (!registry) return null;
    if (registry.failed) return t('wardrive_cov_nodes_failed');
    if (nodeOverlay && nodeOverlay.rows.length === 0) return t('wardrive_cov_nodes_none');
    return null;
  })();

  const pickedRow = pickedNode
    ? (nodeOverlay?.rows.find((r) => r.id === pickedNode) ?? null)
    : null;
  const toggleReach = (id: string) =>
    setReachSel((sel) => {
      const next = new Set(sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => writeFlag(`${storeKey}-list`, listOpen), [listOpen, storeKey]);
  useEffect(() => {
    if (focus) setFlyTo(focus);
  }, [focus]);

  // The receptions list: the newest of the window under the filters, wherever
  // they were heard (no view limit).
  const listParams = useMemo(
    () => (listOpen ? ask(state, knownIds, ignore, null) : null),
    [listOpen, ask, state, knownIds, ignore]
  );
  const listKey = listParams ? JSON.stringify(listParams) : null;
  useEffect(() => {
    if (!listKey || !listParams) return;
    let cancelled = false;
    const run = () =>
      api.points({ ...listParams, limit: String(LIST_CAP), offset: '0' }).then(
        (r) => {
          if (cancelled) return;
          setListRows(r.points);
          setListTruncated(r.truncated);
        },
        () => {
          // The list keeps its rows; the next tick tries again.
        }
      );
    void run();
    const timer = isLive(state.to) ? setInterval(run, LIST_POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
    // listKey stands for listParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, api]);

  const openReception = (p: MapPoint) => {
    setPickedCell(null);
    setPickedNode(null);
    setSelected(p);
    const b = view?.bbox;
    const inView = !!b && p.lat >= b[0] && p.lat <= b[2] && p.lon >= b[1] && p.lon <= b[3];
    if (!inView) setFlyTo({ lat: p.lat, lon: p.lon, nonce: Date.now() });
  };

  // The "Repeaters heard" card for this view: the stars the reach would draw,
  // from the same registry slice and window, whether the reach is on or not.
  const exportHeard = async () => {
    if (!view) return;
    setHeardMsg(t('wardrive_cov_heard_making'));
    const [south, west, north, east] = view.bbox;
    const box = padBounds({ south, west, north, east }, REACH_CAP_KM);
    const tooWide = box.north - box.south > MAX_BOX_LAT || box.east - box.west > MAX_BOX_LON;
    try {
      const [reg, pts] = await Promise.all([
        tooWide
          ? Promise.resolve(null)
          : api
              .nodes({
                south: Math.max(-90, box.south),
                west: Math.max(-180, box.west),
                north: Math.min(90, box.north),
                east: Math.min(180, box.east),
              })
              .then(
                (r) => toRegistry(r.nodes),
                () => null
              ),
        fetchAllPoints(
          api,
          ask({ ...state, senders: [], senderPrefix: '' }, knownIds, ignore, null)
        ),
      ]);
      const registry = reg ?? [];
      const { stars, colorOf, byKey } = starsFor(registry, pts.points, nodeHues(cvdMode, 'dark'));
      const model = heardModel(stars, view.bbox, (id) => byKey.get(id)?.name ?? null);
      if (model.drawn.length === 0) {
        setHeardMsg(t('wardrive_cov_heard_empty'));
        return;
      }
      const drawnIds = new Set(model.drawn.map((s) => s.id));
      const drivers = new Set(
        stars.filter((s) => drawnIds.has(s.id)).flatMap((s) => s.points.map((p) => p.driver))
      );
      const theirs = pts.points.filter((p) => drivers.has(p.driver));
      const notes: string[] = [];
      if (pts.truncated) notes.push(t('wardrive_cov_heard_capped', { cap: POINTS_CAP }));
      if (reg === null) notes.push(t('wardrive_cov_heard_estimated'));
      const p = ask(state, null, [], null);
      setHeard({
        model,
        routes: routeSegments(theirs),
        cells: mappedCells(theirs),
        colorOf,
        notes,
        drivers: drivers.size,
        since: Number(p.since),
        until: Number(p.until),
      });
      setHeardMsg(null);
    } catch (e) {
      setHeardMsg(t('wardrive_cov_failed', { error: errorText(e) }));
    }
  };

  const buildHeard = (h: HeardExport) => async (opts: ShareBuildOptions) => {
    const title = t('wardrive_cov_heard_title');
    const kicker = [
      t('wardrive_cov_heard_kicker', {
        from: formatWhen(h.since, locale),
        to: formatWhen(h.until, locale),
      }),
      ...h.notes,
    ].join(' · ');
    const off = h.model.offMap.length
      ? t('wardrive_cov_heard_off', {
          km: FAR_KM,
          list: h.model.offMap.map((o) => `${o.name} (${o.km} km)`).join(', '),
        })
      : undefined;
    const card = await renderHeardCard(
      h.model,
      h.routes,
      h.cells,
      h.colorOf,
      {
        kicker,
        title,
        quote: off,
        figures: [
          {
            value: String(h.model.numbers.repeaters),
            label: t('wardrive_cov_heard_fig_repeaters'),
          },
          {
            value: String(h.model.numbers.receptions),
            label: t('wardrive_cov_heard_fig_receptions'),
          },
          {
            value: formatDistance(h.model.numbers.farthestKm, getSavedDistanceUnit()),
            label: t('wardrive_cov_heard_fig_farthest'),
          },
          { value: String(h.drivers), label: t('wardrive_cov_heard_fig_drivers') },
        ],
      },
      await brand(),
      { ...opts, cvd: cvdMode }
    );
    return {
      png: card.png,
      filenameBase: shareFilename('wardrive-repeaters-heard', new Date()),
      alt: t('wardrive_cov_heard_alt'),
      shareTitle: title,
    };
  };

  // No stored view: fit to the window's receptions once.
  const snapped = useRef(initial.current !== null);
  useEffect(() => {
    if (snapped.current || !view) return;
    snapped.current = true;
    fetchAllPoints(api, ask(state, knownIds, ignore, null)).then(
      (r) => {
        const bounds = pointBounds(r.points);
        if (bounds) setFit({ bounds, nonce: Date.now() });
      },
      () => {
        // Stays on the default view.
      }
    );
    // Once, on the first view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const changeDrivers = (ids: number[]) => {
    patch({ drivers: ids });
    setPin(null);
    if (ids.length === 0) return;
    const p = ask({ ...state, drivers: ids }, null, ignore, null);
    fetchAllPoints(api, p).then(
      (r) => {
        const bounds = pointBounds(r.points);
        if (bounds) setFit({ bounds, nonce: Date.now() });
        if (ids.length === 1) {
          const d = drivers.find((x) => x.user_id === ids[0]);
          if (d && d.last_lat !== null && d.last_lon !== null) {
            setPin({ lat: d.last_lat, lon: d.last_lon, label: d.username });
          }
        }
      },
      () => {
        // The map keeps its view.
      }
    );
  };

  const loadTargets = () => {
    if (!view) return;
    setTargetsLoading(true);
    const p = ask({ ...state, senders: [], senderPrefix: '' }, knownIds, ignore, view.bbox);
    fetchAllPoints(api, p).then(
      (r) => {
        setTargets(senderRows(r.points));
        setTargetsLoading(false);
      },
      () => setTargetsLoading(false)
    );
  };

  const addIgnore = (id: string) => {
    setIgnore((list) => (list.includes(id) ? list : [...list, id]));
    setSelected(null);
  };

  const ignoreNames = useMemo(() => {
    const names: Record<string, string | null> = {};
    for (const p of points) {
      const id = p.sender.id?.toLowerCase();
      if (id && ignore.includes(id)) names[id] = p.name;
    }
    return names;
  }, [points, ignore]);

  const copyLink = async (from: string, to: string) => {
    const p = encodeState({ ...state, from, to });
    const link =
      urlRef.current?.link?.(p) ?? `${window.location.href.split('#')[0].split('?')[0]}?${p}`;
    await navigator.clipboard.writeText(link);
  };

  const readout = (() => {
    if (error) return t('wardrive_cov_failed', { error });
    if (!status) return t('wardrive_cov_loading');
    const parts = [
      status.kind === 'points'
        ? t('wardrive_cov_points', { count: status.count })
        : t('wardrive_cov_cells', { count: status.count }),
    ];
    if (status.truncated && status.coversFrom) {
      parts.push(
        t('wardrive_cov_covers_from', { date: new Date(status.coversFrom).toLocaleString() })
      );
    }
    if (ignore.length) parts.push(t('wardrive_cov_ignored', { count: ignore.length }));
    return parts.join(' · ');
  })();

  const railButton =
    'flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/90 shadow hover:bg-muted';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background p-2">
        <DriverPicker drivers={drivers} selected={state.drivers} onChange={changeDrivers} />
        <TargetPicker
          rows={targets}
          loading={targetsLoading}
          selected={state.senders}
          prefix={state.senderPrefix}
          onOpen={loadTargets}
          onToggle={(id) =>
            patch({
              senders: state.senders.includes(id)
                ? state.senders.filter((x) => x !== id)
                : [...state.senders, id],
              senderPrefix: '',
            })
          }
          onPrefix={(prefix) => patch({ senderPrefix: prefix, senders: [] })}
          onClear={() => patch({ senders: [], senderPrefix: '' })}
        />
        <TimeRange
          from={state.from}
          to={state.to}
          nowMs={nowMs}
          onChange={(from, to) => patch({ from, to })}
          onCopy={copyLink}
        />
        <FilterPanel
          state={state}
          ignore={ignore}
          ignoreNames={ignoreNames}
          onChange={patch}
          onUnignore={(id) => setIgnore((list) => list.filter((x) => x !== id))}
          onClearIgnore={() => setIgnore([])}
          onClearFilters={() =>
            patch({
              types: [],
              idclass: [],
              nopath: false,
              senders: [],
              senderPrefix: '',
              drivers: [],
            })
          }
        />
        <button
          type="button"
          className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-sm ${
            listOpen ? 'border-primary bg-primary/15' : 'border-border bg-background hover:bg-muted'
          }`}
          aria-pressed={listOpen}
          onClick={() => setListOpen((v) => !v)}
        >
          <List className="h-3.5 w-3.5" aria-hidden />
          {t('wardrive_cov_list')}
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-2 text-sm hover:bg-muted"
          onClick={() => void exportHeard()}
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t('wardrive_cov_export')}
        </button>
        <Dropdown
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          align="right"
          button={
            <button
              type="button"
              className={BAR_BUTTON}
              aria-label={t('wardrive_cov_settings')}
              title={t('wardrive_cov_settings')}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <Settings className="h-3.5 w-3.5" aria-hidden />
            </button>
          }
        >
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="text-xs font-semibold text-muted-foreground">
                {t('wardrive_cov_settings_exag')}
              </span>
              <select
                aria-label={t('wardrive_cov_settings_exag')}
                value={exag}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setExag(v);
                  try {
                    localStorage.setItem(`${storeKey}-exag`, String(v));
                  } catch {
                    // Storage blocked: lasts for this page load.
                  }
                }}
                className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {EXAGGERATION_STEPS.map((v) => (
                  <option key={v} value={v}>{`${v}x`}</option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted-foreground">
                {t('wardrive_cov_settings_exag_hint')}
              </span>
            </label>
            <button
              type="button"
              className="w-full rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
              disabled={ignore.length === 0}
              onClick={() => setIgnore([])}
            >
              {t('wardrive_cov_ignore_clear')}
            </button>
            <button
              type="button"
              className="w-full rounded-md border border-border px-2 py-1 hover:bg-muted"
              onClick={() => {
                setSettingsOpen(false);
                setIntroOpen(true);
              }}
            >
              {t('wardrive_cov_help')}
            </button>
          </div>
        </Dropdown>
        {extraBar}
      </div>
      {heardMsg && (
        <p className="border-b border-border bg-background px-3 py-1 text-xs text-muted-foreground">
          {heardMsg}
        </p>
      )}
      {heard && (
        <ShareCardDialog
          open
          onClose={() => setHeard(null)}
          title={t('wardrive_cov_heard_title')}
          supportsHidePosition
          framing={{ located: heard.model.drawn.flatMap((s) => [s.origin, ...s.rays]) }}
          build={buildHeard(heard)}
        />
      )}
      {banner}
      <div className="relative min-h-[320px] flex-1 overflow-hidden">
        <CoverageMapGL
          ref={mapHandle}
          points={points}
          cells={cells}
          mode={state.mode}
          view3d={state.view3d}
          exaggeration={exag}
          selected={selected}
          pin={pin}
          live={live}
          fit={fit}
          focus={flyTo}
          initial={initial.current}
          onView={(v) => {
            setView(v);
            patch({ lat: v.lat, lon: v.lon, z: v.z, pitch: v.pitch, bearing: v.bearing });
          }}
          onPickPoint={(i) => {
            setPickedCell(null);
            setSelected(points[i] ?? null);
          }}
          onPickCell={(c) => {
            setSelected(null);
            setPickedCell(c);
            // The cell's newest reception the list holds gets its row marked.
            const hit = listRows.find((p) => pointInRing(p.lat, p.lon, c.ring));
            setListCurrent(hit ? receptionKey(hit) : null);
          }}
          onEmpty={() => {
            setSelected(null);
            setPickedCell(null);
            setPickedNode(null);
            setReachSel(new Set());
          }}
          overlays={overlays}
          pointOpacity={nodeOverlay?.pointOpacity}
          cellOpacity={nodeOverlay?.cellOpacity ?? 1}
          onPickNode={(id) => {
            setSelected(null);
            setPickedCell(null);
            setPickedNode(id);
            if (state.nodepos === 'reach') toggleReach(id);
          }}
        />
        <div
          className="absolute right-2 top-2 z-20 flex flex-col gap-2"
          role="group"
          aria-label={t('wardrive_cov_rail')}
        >
          <button
            type="button"
            className={railButton}
            aria-label={t('wardrive_cov_zoom_in')}
            onClick={() => mapHandle.current?.zoomIn()}
          >
            <Plus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className={railButton}
            aria-label={t('wardrive_cov_zoom_out')}
            onClick={() => mapHandle.current?.zoomOut()}
          >
            <Minus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className={railButton}
            aria-label={t('wardrive_cov_north')}
            onClick={() => mapHandle.current?.north()}
          >
            <Compass
              className="h-4 w-4"
              style={{ transform: `rotate(${-(view?.bearing ?? 0)}deg)` }}
              aria-hidden
            />
          </button>
          <button
            type="button"
            className={`${railButton} ${state.view3d ? 'ring-2 ring-primary' : ''}`}
            aria-pressed={state.view3d}
            aria-label={state.view3d ? t('wardrive_cov_view_3d') : t('wardrive_cov_view_2d')}
            onClick={() => patch({ view3d: !state.view3d })}
          >
            <Box className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            className={`${railButton} ${state.nodepos !== 'off' ? 'ring-2 ring-primary' : ''} ${
              state.nodepos === 'reach' ? 'bg-primary/20' : ''
            }`}
            aria-pressed={state.nodepos !== 'off'}
            aria-label={t(`wardrive_cov_nodepos_${state.nodepos}`)}
            title={t(`wardrive_cov_nodepos_${state.nodepos}`)}
            onClick={() => {
              const next = STOPS[(STOPS.indexOf(state.nodepos) + 1) % STOPS.length];
              if (next !== 'reach') setReachSel(new Set());
              setPickedNode(null);
              patch({ nodepos: next });
            }}
          >
            <MapPin className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {nodeNotice && (
          <p className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded bg-background/90 px-2 py-0.5 text-xs text-muted-foreground shadow">
            {nodeNotice}
          </p>
        )}
        {state.locate && (
          <LocateBox
            result={locateResult}
            failed={locateFailed}
            isHash={
              state.senders.length === 1 &&
              HASH_KINDS.some((k) => targets.find((r) => r.id === state.senders[0])?.kind === k)
            }
            legendOpen={legendOpen}
            onToggleLegend={() => setLegendOpen((v) => !v)}
            onLeave={() => patch({ locate: false })}
          />
        )}
        <p
          role="status"
          className="pointer-events-none absolute bottom-1 left-2 z-20 max-w-[calc(100%-1rem)] truncate rounded bg-background/85 px-2 py-0.5 text-xs text-muted-foreground"
          title={status?.truncated ? t('wardrive_cov_cap_title', { cap: POINTS_CAP }) : undefined}
        >
          {readout}
        </p>
        {selected && (
          <ReceptionCard
            point={selected}
            onClose={() => setSelected(null)}
            onIgnore={addIgnore}
            onLocate={(id) => {
              setSelected(null);
              patch({ senders: [id], senderPrefix: '', locate: true });
            }}
          />
        )}
        {listOpen && (
          <ReceptionList
            rows={listRows}
            truncated={listTruncated}
            current={selected ? receptionKey(selected) : listCurrent}
            nowMs={nowMs}
            storageKey={storeKey}
            onPick={openReception}
            onClose={() => setListOpen(false)}
          />
        )}
        {pickedCell && <CellCard cell={pickedCell} onClose={() => setPickedCell(null)} />}
        {introOpen && (
          <IntroCard
            onClose={() => {
              setIntroOpen(false);
              writeFlag(`${storeKey}-intro`, true);
            }}
          />
        )}
        {pickedRow && (
          <NodeCard
            row={pickedRow}
            reachOn={state.nodepos === 'reach'}
            selected={reachSel.has(pickedRow.id)}
            heard={nodeOverlay?.heard.has(pickedRow.id) ?? false}
            onToggleReach={() => toggleReach(pickedRow.id)}
            onClose={() => setPickedNode(null)}
          />
        )}
      </div>
    </div>
  );
}
