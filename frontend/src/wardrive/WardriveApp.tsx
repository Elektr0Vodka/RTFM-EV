// The wardrive page: account, the driver's own radio, a position source and
// the drive, on a map-first screen (live map, top bar, banners, live log,
// HUD, button rail, start screen, menu). What the radio hears is decoded and
// named (RTFM-EV's nodes, the radio's contacts), then filtered (targets,
// ignore list, filters, the filtered/all stand) into one view the map, the
// log and the HUD share. The browser adapters come in through
// `deps` so the page can be tested without a radio or a GPS; the defaults are
// the real ones.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AccessibilitySettings } from '../components/settings/AccessibilitySettings';
import { ThemeSelector } from '../components/settings/ThemeSelector';
import { useT } from '../i18n';
import {
  arrowFor,
  arrowTarget,
  courseHeading,
  headingFor,
  nextHeadingSource,
  type HeadingSource,
} from './arrow';
import { getSavedDistanceUnit } from '../utils/distanceUnits';
import { loadMe, radioState, rememberMe, signedRadio } from './account';
import { WardriveApiError, wardriveApi, type WardriveMe } from './api';
import { MAX_ACCURACY_M, isUsableFix } from './capture';
import { requestCompassPermission, watchCompass } from './compass';
import { AccountPanel, type RegisterInput } from './components/AccountPanel';
import { ForwardPanel } from './components/ForwardPanel';
import { isLowBattery } from './radio/battery';
import { DEFAULT_BROKERS, destId, parseBrokers, type Broker } from './forward/brokers';
import { loadServedBrokers, saveServedBrokers } from './forward/brokerConfig';
import { MapPanel } from './components/MapPanel';
import { ReportsTab } from './components/ReportsTab';
import { PositionPanel } from './components/PositionPanel';
import { RadioPanel } from './components/RadioPanel';
import { UploadPanel } from './components/UploadPanel';
import {
  activeFilterCount,
  loadFilter,
  loadIgnore,
  loadStand,
  saveFilter,
  saveIgnore,
  saveStand,
  type Filter,
  type Stand,
} from './filters';
import type { Fix } from './messages';
import { senderLine } from './names';
import { openNodeCache, type NodeCache } from './nodeSources';
import {
  DevicePosition,
  UsbGpsPosition,
  deviceLocationAllowed,
  type PositionSource,
} from './position/sources';
import { keepQueue, openQueue, type Queue } from './queue';
import { Companion } from './radio/companion';
import {
  BleTransport,
  SerialTransport,
  bleSupported,
  serialSupported,
  type RadioTransport,
} from './radio/transport';
import { Uploader, type UploadStatus } from './uploader';
import { connectMqtt } from './forward/client';
import { AboutPanel } from './screen/AboutPanel';
import { Banners } from './screen/Banners';
import { Hud, formatAge } from './screen/Hud';
import { FloatReadout, type FloatReadoutOptions } from './float/FloatReadout';
import { floatModel, floatSupport } from './float/floatModel';
import { useCvdMode } from '../hooks/useCvdColors';
import { MapErrorBoundary } from './screen/MapErrorBoundary';
import { MenuSheet, type MenuTab } from './screen/MenuSheet';
import { LOG_SIZE_KEY, ReceptionLog, type LogSize } from './screen/ReceptionLog';
import { FilterSheet } from './screen/FilterSheet';
import { RightRail } from './screen/RightRail';
import { StartScreen, dismissStartScreen, startScreenWanted } from './screen/StartScreen';
import { brokerDot, radioDot, uploadDot } from './screen/StatusDots';
import { TargetSheet } from './screen/TargetSheet';
import { TopBar } from './screen/TopBar';
import { WardriveScreen } from './screen/WardriveScreen';
import { SpeedTracker } from './speed';
import { TARGET_KINDS, senderRows } from './targets';
import { Trail } from './trail';
import { useDrive } from './useDrive';
import { ExaggerationSetting } from './components/ExaggerationSetting';
import { AttenuatorSetting } from './components/AttenuatorSetting';
import { NoiseMapSetting } from './components/NoiseMapSetting';
import { IntroduceSetting } from './components/IntroduceSetting';
import { useAutoDiscover, type Attribute } from './discover/useAutoDiscover';
import { parseAttenuator, plotOffset } from './signal';
import { useRadioStats } from './useRadioStats';
import { nextCompassMode, parseCompassMode, type CompassMode } from './map/compassMode';
import { nextNodePosMode, parseNodePosMode, type NodePosMode } from './map/nodeLayer';
import { parseExaggeration } from './map/terrain';
import { VIEW_STATES, nextViewIndex, parseViewKey, viewKey } from './map/viewModes';
import { DrivesPanel } from './reports/DrivesPanel';
import { pageDrivesApi } from './reports/pageDrivesApi';
import type { DrivesApi } from './reports/types';
import { useLiveReceptions } from './useLiveReceptions';
import { useNodeDirectory } from './useNodeDirectory';
import { useReceptionView } from './useReceptionView';
import { SOUND_KEY, useWardriveSound, type SoundMode } from './useWardriveSound';
import { useWakeLock } from './wakeLock';
import { useForwarding, type ConnectMqtt } from './useForwarding';

export interface WardriveDeps {
  makeTransport(kind: 'ble' | 'usb'): RadioTransport;
  makePosition(kind: 'device' | 'usb-gps'): PositionSource;
  openQueue(): Promise<Queue>;
  openNodeCache(): Promise<NodeCache>;
  bleSupported(): boolean;
  serialSupported(): boolean;
  deviceLocationAllowed(): boolean;
  connectMqtt: ConnectMqtt;
  /** Drives and reports in RTFM-EV (the Drives and Reports tabs). */
  drivesApi: DrivesApi;
}

export const defaultDeps: WardriveDeps = {
  makeTransport: (kind) => (kind === 'ble' ? new BleTransport() : new SerialTransport()),
  makePosition: (kind) => (kind === 'device' ? new DevicePosition() : new UsbGpsPosition()),
  openQueue: () => openQueue(),
  openNodeCache: () => openNodeCache(),
  bleSupported,
  serialSupported,
  deviceLocationAllowed,
  connectMqtt,
  drivesApi: pageDrivesApi,
};

interface RadioConnection {
  companion: Companion;
  info: { publicKey: string; name: string; sf: number | null };
  offClose: () => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
/** The banner about a background pause stays this long after coming back. */
const PAUSED_NOTE_MS = 4000;

// MapLibre is large: the map loads after the screen is up. A new lazy
// component per attempt, since a failed import stays failed in its lazy.
const loadLiveMap = () => lazy(() => import('./map/LiveMap').then((m) => ({ default: m.LiveMap })));

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const VIEW_KEY = 'rtfm-wardrive-view';
const COMPASS_KEY = 'rtfm-wardrive-compass';
const NODEPOS_KEY = 'rtfm-wardrive-nodepos';
const EXAGGERATION_KEY = 'rtfm-wardrive-exaggeration';
const ATTENUATOR_KEY = 'rtfm-wardrive-attenuator';
const CALIBRATION_KEY = 'rtfm-wardrive-calibration';
const NOISE_MAP_KEY = 'rtfm-wardrive-noise-map';
const INTRODUCE_KEY = 'rtfm-wardrive-introduce';

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept: the default comes back next time.
  }
}
/** The compass may move the arrow this often, not on every reading. */
const COMPASS_UI_MS = 200;
const unique = (list: string[]) => [...new Set(list)];

/** How often the page looks whether RTFM-EV is back while offline. */
const RECHECK_MS = 30000;

export function WardriveApp({ deps = defaultDeps }: { deps?: WardriveDeps }) {
  const t = useT();
  const [me, setMe] = useState<WardriveMe | null>(null);
  // The uploader reads the account's radios between renders.
  const meRef = useRef<WardriveMe | null>(null);
  meRef.current = me;
  const [offline, setOffline] = useState(false);
  const offlineRef = useRef(false);
  offlineRef.current = offline;
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [upload, setUpload] = useState<UploadStatus | null>(null);
  const [radio, setRadio] = useState<RadioConnection | null>(null);
  const [radioLost, setRadioLost] = useState(false);
  const [positionKind, setPositionKind] = useState<'device' | 'usb-gps' | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const fixRef = useRef<Fix | null>(null);
  const positionRef = useRef<PositionSource | null>(null);
  const speedRef = useRef(new SpeedTracker());
  const trailRef = useRef(new Trail());
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Map view, compass mode, node positions and terrain: kept in this browser.
  const [viewIndex, setViewIndex] = useState(() => parseViewKey(readRaw(VIEW_KEY)));
  const [compassMode, setCompassMode] = useState<CompassMode>(() =>
    parseCompassMode(readRaw(COMPASS_KEY))
  );
  const [nodePos, setNodePos] = useState<NodePosMode>(() => parseNodePosMode(readRaw(NODEPOS_KEY)));
  const [exaggeration, setExaggeration] = useState(() =>
    parseExaggeration(readRaw(EXAGGERATION_KEY))
  );
  const [attenuator, setAttenuator] = useState(() => parseAttenuator(readRaw(ATTENUATOR_KEY)));
  // The owner's RSSI calibration, kept for offline use.
  const [calibration, setCalibration] = useState(() => {
    const v = Number(readRaw(CALIBRATION_KEY));
    return Number.isInteger(v) && Math.abs(v) <= 30 ? v : 0;
  });
  const rssiOffset = plotOffset(calibration, attenuator);
  const [noiseMap, setNoiseMap] = useState(() => readRaw(NOISE_MAP_KEY) === '1');
  const changeNoiseMap = (on: boolean) => {
    setNoiseMap(on);
    writePref(NOISE_MAP_KEY, on ? '1' : '0');
  };
  const [sound, setSound] = useState<SoundMode>(() => readPref(SOUND_KEY, ['off', 'rx'], 'off'));
  const [logSize, setLogSize] = useState<LogSize>(() =>
    readPref(LOG_SIZE_KEY, ['full', 'three', 'one', 'hidden'], 'three')
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuTab, setMenuTab] = useState<MenuTab>('status');
  // Drives picked in the Drives tab, reported on in the Reports tab.
  const [pickedDrives, setPickedDrives] = useState<number[]>([]);
  const [startShown, setStartShown] = useState(() => startScreenWanted(false));
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [unit] = useState(getSavedDistanceUnit);
  const [mapAttempt, setMapAttempt] = useState(0);
  // mapAttempt is the point: each retry gets a fresh lazy component.
  const LiveMap = useMemo(loadLiveMap, [mapAttempt]);
  const drive = useDrive(queue, fixRef);
  const { start } = drive;
  useWakeLock(drive.running);
  // The brokers the owner serves; the last list is kept for offline starts.
  const [brokers, setBrokers] = useState<Broker[]>(() => loadServedBrokers() ?? DEFAULT_BROKERS);
  // An owner's broker account is for logged-in drivers only: it goes from
  // this browser on log out or when the server says nobody is logged in.
  const dropAccountBrokers = useCallback(() => {
    setBrokers((prev) => prev.filter((b) => b.auth !== 'password'));
    const cached = loadServedBrokers();
    if (cached) saveServedBrokers(cached.filter((b) => b.auth !== 'password'));
  }, []);
  const forwarding = useForwarding(
    queue,
    radio?.companion ?? null,
    radio?.info.publicKey ?? null,
    deps.connectMqtt,
    brokers,
    radio?.info.name || undefined
  );
  const destsForRef = useRef(forwarding.destsFor);
  destsForRef.current = forwarding.destsFor;
  const forwardingRef = useRef(forwarding);
  forwardingRef.current = forwarding;
  const nodeCache = useMemo(() => deps.openNodeCache().catch(() => null), [deps]);
  const nodes = useNodeDirectory({
    loggedIn: !!me,
    offline,
    fix,
    companion: radio?.companion ?? null,
    cache: nodeCache,
    onConfig: (c) => {
      const cal = c.rssi_calibration_db ?? 0;
      setCalibration(cal);
      writePref(CALIBRATION_KEY, String(cal));
      // An older server sends no list: keep what the page has.
      const served = parseBrokers(c.brokers);
      if (served) {
        setBrokers(served);
        saveServedBrokers(served);
        forwardingRef.current.keepOnly(served.map((b) => b.id));
      }
    },
  });
  const radioStats = useRadioStats(radio?.companion ?? null, fix);
  // Receptions this browser stored earlier: the account's radios, or the
  // connected radio when logged out.
  const historyRadios = me
    ? me.radios.map((r) => r.public_key)
    : radio
      ? [radio.info.publicKey]
      : [];
  // Auto-discover names the answers to its own asks in the reception pipeline.
  const attributeRef = useRef<Attribute | null>(null);
  const live = useLiveReceptions(
    radio?.companion ?? null,
    fixRef,
    drive.running,
    nodes.channelKeys,
    {
      queue,
      radioKeys: historyRadios,
    },
    attributeRef
  );
  const soundCtl = useWardriveSound(sound, live.entries);

  const [filter, setFilterState] = useState<Filter>(loadFilter);
  const [stand, setStandState] = useState<Stand>(loadStand);
  const [ignoreList, setIgnoreList] = useState<string[]>(loadIgnore);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const setFilter = (f: Filter) => {
    setFilterState(f);
    saveFilter(f);
  };
  const setStand = (s: Stand) => {
    setStandState(s);
    saveStand(s);
  };
  const setIgnore = (ids: string[]) => {
    setIgnoreList(ids);
    saveIgnore(ids);
  };
  const ignore = useMemo(() => new Set(ignoreList.map((id) => id.toLowerCase())), [ignoreList]);
  const view = useReceptionView({
    entries: live.entries,
    directory: nodes.directory,
    filter,
    stand,
    ignore,
    nowMs,
  });

  // Auto-discover: the page's only transmitting function. Off at every start
  // and every connection; the switch itself is never stored.
  const [introduce, setIntroduce] = useState(() => readRaw(INTRODUCE_KEY) === '1');
  const changeIntroduce = (on: boolean) => {
    setIntroduce(on);
    try {
      if (on) localStorage.setItem(INTRODUCE_KEY, '1');
      else localStorage.removeItem(INTRODUCE_KEY);
    } catch {
      // Not kept: off again next time.
    }
  };
  const [txPulse, setTxPulse] = useState(0);
  const autoDiscover = useAutoDiscover({
    radio,
    position: () => {
      const f = fixRef.current;
      return f && isUsableFix(f, Date.now()) ? { lat: f.lat, lon: f.lon } : null;
    },
    entries: view.all,
    targets: filter.targets,
    introduce,
    onSent: (kind) => {
      setTxPulse((n) => n + 1);
      soundCtl.tx(kind);
    },
    attributeRef,
  });

  // Heading for the arrow: the compass when slow, the GPS course from 2 m/s.
  const [compassOn, setCompassOn] = useState(false);
  const [compass, setCompass] = useState<{ deg: number; at: number } | null>(null);
  const [headingSrc, setHeadingSrc] = useState<HeadingSource>('compass');
  const [course, setCourse] = useState<number | null>(null);
  useEffect(() => {
    if (!compassOn) return;
    let last = 0;
    return watchCompass((deg, at) => {
      if (at - last < COMPASS_UI_MS) return;
      last = at;
      setCompass({ deg, at });
    });
  }, [compassOn]);

  // A drive pauses when the page goes to the background (the phone stops
  // listening); say so, and for a moment after coming back.
  useEffect(() => {
    if (!drive.running) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onVisibility = () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState === 'hidden') setPausedAt(Date.now());
      else timer = setTimeout(() => setPausedAt(null), PAUSED_NOTE_MS);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer) clearTimeout(timer);
      // The drive is over (or the page goes): nothing is paused any more.
      setPausedAt(null);
    };
  }, [drive.running]);

  useEffect(() => {
    void loadMe().then(({ me: loaded, offline: off }) => {
      setMe(loaded);
      setOffline(off);
      if (!loaded && !off) dropAccountBrokers();
    });
    let cancelled = false;
    let uploader: Uploader | null = null;
    void deps.openQueue().then((q) => {
      if (cancelled) return;
      setQueue(q);
      uploader = new Uploader(
        q,
        undefined,
        undefined,
        (key) => destsForRef.current(key),
        () => meRef.current?.radios.map((r) => r.public_key) ?? null,
        // A 403: a radio left the account or the account was disabled.
        () =>
          void loadMe().then(({ me: loaded, offline: off }) => {
            if (off) return;
            setMe(loaded);
            if (!loaded) dropAccountBrokers();
          })
      );
      uploader.start((s) => {
        setUpload(s);
        // Only a call that went out says anything about the server.
        if (s.reached !== null) setOffline(!s.reached);
      });
    });
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    // While offline with nothing to upload, look whether RTFM-EV is back.
    const recheck = setInterval(() => {
      if (!offlineRef.current) return;
      void loadMe().then(({ me: loaded, offline: off }) => {
        if (off) return;
        setMe(loaded);
        setOffline(false);
        if (!loaded) dropAccountBrokers();
      });
    }, RECHECK_MS);
    return () => {
      cancelled = true;
      uploader?.stop();
      clearInterval(clock);
      clearInterval(recheck);
    };
  }, [deps, dropAccountBrokers]);

  const run = async (action: () => Promise<void>) => {
    try {
      setError(null);
      await action();
    } catch (e) {
      if (e instanceof WardriveApiError && e.status === 0) setOffline(true);
      setError(errorText(e));
    }
  };

  const adoptMe = (next: WardriveMe | null) => {
    rememberMe(next);
    setMe(next);
  };

  const connectRadio = (kind: 'ble' | 'usb') =>
    void run(async () => {
      const transport = deps.makeTransport(kind);
      await transport.connect();
      const companion = new Companion(transport);
      let info: { publicKey: string; name: string; sf: number | null };
      try {
        info = await companion.start();
      } catch (e) {
        // Let the Bluetooth link or the USB port go, or the next try finds it
        // still held ("already open") and needs a reload.
        await transport.disconnect().catch(() => undefined);
        throw e;
      }
      const offClose = transport.onClose(() => {
        drive.stop();
        setRadio(null);
        setRadioLost(true);
        void transport.disconnect().catch(() => undefined);
      });
      setRadioLost(false);
      setRadio({ companion, info, offClose });
    });

  const disconnectRadio = () => {
    drive.stop();
    if (radio) {
      radio.offClose();
      void radio.companion.transport.disconnect();
    }
    setRadio(null);
  };

  const choosePosition = (kind: 'device' | 'usb-gps') =>
    void run(async () => {
      const source = deps.makePosition(kind);
      await source.start(
        (f) => {
          fixRef.current = f;
          setFix(f);
          speedRef.current.push(f);
          if (trailRef.current.push(f)) setTrail(trailRef.current.points());
          // The start screen is done once there is a usable position.
          if (isUsableFix(f, Date.now())) setStartShown(false);
        },
        (e) => setError(errorText(e))
      );
      positionRef.current = source;
      setPositionKind(kind);
    });

  const onLogin = (username: string, password: string) =>
    run(async () => adoptMe(await wardriveApi.login(username, password)));

  const onLogout = () =>
    run(async () => {
      drive.stop();
      forwarding.forgetCredentials();
      dropAccountBrokers();
      await wardriveApi.logout();
      adoptMe(null);
    });

  const onRegister = (input: RegisterInput) =>
    run(async () => {
      if (!radio) return;
      const signed = await signedRadio(radio.companion, radio.info.publicKey);
      adoptMe(
        await wardriveApi.register({
          ...signed,
          username: input.username.trim(),
          password: input.password,
          radio_name: input.radioName.trim() || radio.info.name || undefined,
        })
      );
    });

  const onAddRadio = () =>
    run(async () => {
      if (!radio) return;
      const signed = await signedRadio(radio.companion, radio.info.publicKey);
      adoptMe(await wardriveApi.addRadio({ ...signed, name: radio.info.name || undefined }));
    });

  const state = radio ? radioState(me, radio.info.publicKey) : null;
  const canStart = !!queue && state === 'on-account' && !!positionKind;

  const startDrive = useCallback(() => {
    if (!radio) return;
    // From the tap: iPhones only ask for the compass from a user gesture.
    void requestCompassPermission().then((ok) => {
      if (ok) setCompassOn(true);
    });
    keepQueue();
    start(radio.companion, radio.info.publicKey);
  }, [radio, start]);

  const shown =
    (selectedId !== null ? view.all.find((e) => e.id === selectedId) : undefined) ??
    view.shown[0] ??
    null;
  const speedMps = speedRef.current.speedMps(nowMs);
  useEffect(() => {
    setHeadingSrc((src) => nextHeadingSource(src, speedMps));
    setCourse((last) => courseHeading(fix?.headingDeg ?? null, last, speedMps));
  }, [fix, speedMps]);
  const heading = headingFor(headingSrc, course, compass, nowMs);
  const arrow = useMemo(() => {
    if (!shown) return null;
    const id = shown.sender.id;
    const same = id ? view.shown.filter((e) => e.sender.id === id) : [];
    return arrowFor(
      arrowTarget(shown.sender, shown.attr, nodes.directory, same),
      fix,
      heading,
      nowMs
    );
  }, [shown, view.shown, nodes.directory, fix, heading, nowMs]);
  const sender = shown
    ? senderLine(shown.sender, shown.attr, nodes.directory, shown.packetType, t)
    : { prefix: '', name: '', note: '' };
  // The float readout: built on the first tap, fed the HUD reading while out.
  const floatMode = useMemo(() => floatSupport(window, navigator), []);
  const floatCanvasRef = useRef<HTMLCanvasElement>(null);
  const floatVideoRef = useRef<HTMLVideoElement>(null);
  const floatRef = useRef<FloatReadout | null>(null);
  const [floatOpen, setFloatOpen] = useState(false);
  const cvdOn = useCvdMode() !== 'off';
  const floatNow = floatModel({
    entry: shown,
    sender,
    ageText: shown ? formatAge(nowMs - shown.at, t) : '',
    offset: rssiOffset,
    t,
  });
  const floatKey = JSON.stringify(floatNow);
  useEffect(() => {
    if (floatOpen) floatRef.current?.update(JSON.parse(floatKey));
  }, [floatOpen, floatKey]);
  useEffect(
    () => () => {
      const readout = floatRef.current;
      if (!readout) return;
      readout.dispose();
      void readout.close();
    },
    []
  );
  const toggleFloat = () => {
    if (!floatMode) return;
    if (floatRef.current?.isOpen()) {
      void floatRef.current.close();
      return;
    }
    const canvas = floatCanvasRef.current;
    const video = floatVideoRef.current;
    if (!floatRef.current && canvas && video) {
      floatRef.current = new FloatReadout({
        canvas,
        video,
        mode: floatMode,
        labels: {
          empty: t('wardrive_page_hud_no_reception'),
          emptyHint: t('wardrive_page_float_empty_hint'),
          dbm: t('wardrive_page_hud_dbm'),
        },
        cvd: cvdOn,
        onChange: setFloatOpen,
        orientation: (screen.orientation ?? null) as FloatReadoutOptions['orientation'],
      });
    }
    void floatRef.current?.open(floatNow);
  };
  const shownId = shown?.sender.id ?? null;
  const canTarget = !!shownId && !!shown?.sender.kind && TARGET_KINDS.includes(shown.sender.kind);
  const canIgnore = !!shownId && !!shown?.sender.kind;

  const targetRows = useMemo(() => senderRows(view.all, ignore), [view.all, ignore]);
  const nameOf = (id: string) => {
    const row = targetRows.find((r) => r.id.toLowerCase() === id.toLowerCase());
    return row?.name.name ? `${row.name.mark}${row.name.name}` : id;
  };
  const targetLabel =
    filter.targets.length === 0
      ? t('wardrive_page_targets_all')
      : filter.targets.length === 1
        ? nameOf(filter.targets[0])
        : t('wardrive_page_targets_count', { count: filter.targets.length });
  // Ignored senders are not in the target rows: their names come from the receptions.
  const ignoreNames = useMemo(() => {
    const names: Record<string, string> = {};
    for (const id of ignoreList) {
      const e = view.all.find((x) => x.sender.id?.toLowerCase() === id);
      if (e?.name.name) names[id] = `${e.name.mark}${e.name.name}`;
    }
    return names;
  }, [ignoreList, view.all]);

  const toggleTarget = (id: string) =>
    setFilter({
      ...filter,
      targets: filter.targets.includes(id)
        ? filter.targets.filter((x) => x !== id)
        : [...filter.targets, id],
    });
  const addShownTarget = () => {
    if (canTarget && shownId)
      setFilter({ ...filter, targets: unique([...filter.targets, shownId]) });
  };
  const ignoreShown = () => {
    if (!canIgnore || !shownId) return;
    setIgnore(unique([...ignoreList, shownId.toLowerCase()]));
    setSelectedId(null);
  };
  const usableNow = isUsableFix(fix, nowMs);
  const fixTooPoor = fix && fix.accM !== null && fix.accM > MAX_ACCURACY_M ? fix.accM : null;
  const enabledDests = radio
    ? brokers
        .map((b) => destId(b.id, radio.info.publicKey))
        .filter((dest) => forwarding.settings.enabled[dest])
    : [];

  // Why Start is not possible yet, said on the main screen.
  const startHint = !me
    ? t('wardrive_page_hint_login')
    : !radio
      ? t('wardrive_page_hint_radio')
      : state === 'not-on-account'
        ? t('wardrive_page_radio_not_on_account')
        : !positionKind
          ? t('wardrive_page_hint_position')
          : null;

  const connectAny = () => {
    if (deps.bleSupported()) connectRadio('ble');
    else if (deps.serialSupported()) connectRadio('usb');
    else setMenuOpen(true);
  };

  const clearSelection = useCallback(() => setSelectedId(null), []);
  const directoryNodes = useMemo(() => nodes.directory.all(), [nodes.directory]);

  // One handler for the whole page life: the memoised log rows keep it, so a
  // clock tick does not render every row again. It reads the latest state.
  const selectionRef = useRef({ selectedId, all: view.all });
  selectionRef.current = { selectedId, all: view.all };
  const selectEntry = useCallback((id: number) => {
    const { selectedId: current, all } = selectionRef.current;
    const next = id === current ? null : id;
    setSelectedId(next);
    const entry = all.find((e) => e.id === id);
    // Looking at a reception elsewhere: the map stops following.
    if (next !== null && entry?.lat !== null && entry?.lat !== undefined) {
      setCompassMode('static');
    }
  }, []);

  const toggleSound = () => {
    const next: SoundMode = sound === 'off' ? 'rx' : 'off';
    // Audio may only start from a tap.
    if (next === 'rx') soundCtl.enable();
    setSound(next);
    writePref(SOUND_KEY, next);
  };

  const cycleView = () => {
    const next = nextViewIndex(viewIndex);
    setViewIndex(next);
    writePref(VIEW_KEY, viewKey(VIEW_STATES[next]));
  };

  const cycleCompass = () => {
    const next = nextCompassMode(compassMode);
    // Heading mode turns the map with the phone: an iPhone asks for the
    // compass only from a tap.
    if (next === 'heading') {
      void requestCompassPermission().then((ok) => {
        if (ok) setCompassOn(true);
      });
    }
    setCompassMode(next);
    writePref(COMPASS_KEY, next);
  };

  const cycleNodePos = () => {
    const next = nextNodePosMode(nodePos);
    setNodePos(next);
    writePref(NODEPOS_KEY, next);
  };

  const changeExaggeration = (x: number) => {
    setExaggeration(x);
    writePref(EXAGGERATION_KEY, String(x));
  };

  const changeLogSize = (size: LogSize) => {
    setLogSize(size);
    writePref(LOG_SIZE_KEY, size);
  };

  return (
    <WardriveScreen
      map={
        <MapErrorBoundary onRetry={() => setMapAttempt((n) => n + 1)}>
          <Suspense fallback={<div className="h-full w-full bg-muted" />}>
            <LiveMap
              entries={view.shown}
              selectedId={selectedId}
              fix={fix}
              trail={trail}
              view={VIEW_STATES[viewIndex]}
              compass={compassMode}
              heading={heading}
              nodePos={nodePos}
              nodes={directoryNodes}
              exaggeration={exaggeration}
              rssiOffset={rssiOffset}
              noiseReadings={radioStats.noiseReadings}
              noiseOn={noiseMap}
              onUserPan={() => {
                // A drag looks away; before the first fix there is nothing to leave.
                if (fixRef.current) setCompassMode('static');
              }}
              onSelect={selectEntry}
            />
          </Suspense>
        </MapErrorBoundary>
      }
      topBar={
        <TopBar
          dots={{
            radio: radioDot(!!radio, radioLost, isLowBattery(radioStats.batteryMv)),
            brokers: brokerDot(enabledDests, forwarding.statuses),
            upload: uploadDot(upload, offline),
          }}
          targetLabel={targetLabel}
          onTargets={() => setTargetsOpen(true)}
          filterCount={activeFilterCount(filter)}
          onFilters={() => setFiltersOpen(true)}
          logHidden={logSize === 'hidden'}
          onShowLog={() => changeLogSize('three')}
          onMenu={() => setMenuOpen(true)}
        />
      }
      banners={
        <Banners
          noRadio={!radio && !radioLost && !startShown}
          radioLost={radioLost}
          noFix={!!radio && !usableNow && fixTooPoor === null && !startShown}
          fixTooPoor={radio ? fixTooPoor : null}
          pausedAt={pausedAt}
          offline={offline}
          error={error}
          otherAccounts={upload?.otherAccounts ?? 0}
          onConnect={connectAny}
          onDismissError={() => setError(null)}
        />
      }
      log={
        <ReceptionLog
          entries={view.shown}
          selectedId={selectedId}
          onSelect={selectEntry}
          onClearSelection={clearSelection}
          size={logSize}
          onSize={changeLogSize}
          nowMs={nowMs}
          rssiOffset={rssiOffset}
        />
      }
      hud={
        <>
          {floatMode && (
            // Off screen, not hidden: fullscreen needs the video in the
            // document, and the browser's fullscreen style puts it back in view.
            <div aria-hidden="true" className="pointer-events-none fixed -left-[10000px] top-0">
              <canvas ref={floatCanvasRef} width={1} height={1} />
              <video ref={floatVideoRef} muted playsInline className="h-px w-px" />
            </div>
          )}
          <Hud
            shown={shown}
            nowMs={nowMs}
            speedMps={speedMps}
            unit={unit}
            pending={upload?.pendingObs ?? 0}
            running={drive.running}
            canStart={canStart && usableNow}
            startHint={startHint}
            counts={drive.counts}
            onStart={startDrive}
            onStop={drive.stop}
            arrow={arrow}
            sender={sender}
            onTargets={() => setTargetsOpen(true)}
            onAddTarget={addShownTarget}
            onIgnore={ignoreShown}
            stand={stand}
            onStand={setStand}
            canTarget={canTarget}
            canIgnore={canIgnore}
            rssiOffset={rssiOffset}
            noiseFloor={radioStats.noiseFloor}
            canFloat={!!floatMode}
            floatOpen={floatOpen}
            onFloat={toggleFloat}
          />
        </>
      }
      rail={
        <RightRail
          view={VIEW_STATES[viewIndex]}
          onView={cycleView}
          compass={compassMode}
          onCompass={cycleCompass}
          sound={sound}
          onSound={toggleSound}
          nodePos={nodePos}
          onNodePos={cycleNodePos}
          autoDiscover={autoDiscover.state}
          autoDiscoverDisabled={!autoDiscover.available}
          onAutoDiscover={autoDiscover.toggle}
          autoDiscoverPulse={txPulse}
        />
      }
      start={
        startShown ? (
          <StartScreen
            radioName={radio ? radio.info.name || radio.info.publicKey.slice(0, 8) : null}
            radioError={radio ? null : error}
            fixAccuracy={fix?.accM ?? null}
            positionChosen={!!positionKind}
            bleSupported={deps.bleSupported()}
            serialSupported={deps.serialSupported()}
            deviceAllowed={deps.deviceLocationAllowed()}
            onConnectBle={() => connectRadio('ble')}
            onConnectUsb={() => connectRadio('usb')}
            onChoosePosition={choosePosition}
            onClose={() => {
              dismissStartScreen();
              setStartShown(false);
            }}
          />
        ) : null
      }
      sheets={
        <>
          <TargetSheet
            open={targetsOpen}
            onOpenChange={setTargetsOpen}
            rows={targetRows}
            selected={filter.targets}
            nowMs={nowMs}
            onToggle={toggleTarget}
            onClear={() => setFilter({ ...filter, targets: [] })}
          />
          <FilterSheet
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            filter={filter}
            onChange={setFilter}
            ignore={ignoreList}
            ignoreNames={ignoreNames}
            onUnignore={(id) => setIgnore(ignoreList.filter((x) => x !== id))}
            channels={nodes.channels}
            driverChannels={nodes.driverChannels}
            onDriverChannels={nodes.setDriverChannels}
          />
        </>
      }
      menu={
        <MenuSheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          tab={menuTab}
          onTab={setMenuTab}
          status={
            <>
              <AccountPanel
                me={me}
                radioConnected={!!radio}
                radioOnAccount={state}
                onLogin={onLogin}
                onLogout={onLogout}
                onRegister={onRegister}
                onAddRadio={onAddRadio}
              />
              <RadioPanel
                info={radio?.info ?? null}
                lost={radioLost}
                bleSupported={deps.bleSupported()}
                serialSupported={deps.serialSupported()}
                onConnect={connectRadio}
                onDisconnect={disconnectRadio}
                batteryMv={radioStats.batteryMv}
                autoDiscoverCadence={autoDiscover.cadence}
              />
              <PositionPanel
                kind={positionKind}
                fix={fix}
                nowMs={nowMs}
                deviceAllowed={deps.deviceLocationAllowed()}
                usbSupported={deps.serialSupported()}
                onChoose={choosePosition}
              />
              {radio && queue && (
                <ForwardPanel
                  radioKey={radio.info.publicKey}
                  brokers={brokers}
                  settings={forwarding.settings}
                  statuses={forwarding.statuses}
                  onToggle={(id, on) => void run(() => forwarding.toggle(id, on))}
                  onSendNow={() => void forwarding.sendNow()}
                />
              )}
              <UploadPanel upload={upload} />
            </>
          }
          settings={
            <>
              <ThemeSelector />
              <AccessibilitySettings compact />
              <ExaggerationSetting value={exaggeration} onChange={changeExaggeration} />
              <AttenuatorSetting
                value={attenuator}
                onChange={(db) => {
                  setAttenuator(db);
                  writePref(ATTENUATOR_KEY, String(db));
                }}
              />
              <NoiseMapSetting on={noiseMap} onChange={changeNoiseMap} />
              <IntroduceSetting on={introduce} onChange={changeIntroduce} />
            </>
          }
          drives={
            me ? (
              <>
                <DrivesPanel
                  api={deps.drivesApi}
                  filter={{}}
                  reloadKey={String(me.user_id)}
                  selected={pickedDrives}
                  onSelectedChange={setPickedDrives}
                  showDriver={me.visibility !== 'own'}
                />
                <MapPanel />
              </>
            ) : (
              <p className="text-sm">{t('wardrive_page_drives_login')}</p>
            )
          }
          reports={
            me ? (
              <ReportsTab api={deps.drivesApi} picked={pickedDrives} />
            ) : (
              <p className="text-sm">{t('wardrive_page_drives_login')}</p>
            )
          }
          about={<AboutPanel />}
        />
      }
    />
  );
}
