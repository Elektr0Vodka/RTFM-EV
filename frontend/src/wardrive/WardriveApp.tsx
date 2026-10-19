// The wardrive page: account, the driver's own radio, a position source and
// the drive, on a map-first screen (live map, top bar, banners, live log,
// HUD, button rail, start screen, menu). The browser adapters come in through
// `deps` so the page can be tested without a radio or a GPS; the defaults are
// the real ones.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AccessibilitySettings } from '../components/settings/AccessibilitySettings';
import { ThemeSelector } from '../components/settings/ThemeSelector';
import { useT } from '../i18n';
import { getSavedDistanceUnit } from '../utils/distanceUnits';
import { loadMe, radioState, rememberMe, signedRadio } from './account';
import { WardriveApiError, wardriveApi, type WardriveMe } from './api';
import { MAX_ACCURACY_M, isUsableFix } from './capture';
import { AccountPanel, type RegisterInput } from './components/AccountPanel';
import { ForwardPanel } from './components/ForwardPanel';
import { MapPanel } from './components/MapPanel';
import { PositionPanel } from './components/PositionPanel';
import { RadioPanel } from './components/RadioPanel';
import { UploadPanel } from './components/UploadPanel';
import type { Fix } from './messages';
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
import { Hud } from './screen/Hud';
import { MapErrorBoundary } from './screen/MapErrorBoundary';
import { MenuSheet, type MenuTab } from './screen/MenuSheet';
import { LOG_SIZE_KEY, ReceptionLog, type LogSize } from './screen/ReceptionLog';
import { RightRail } from './screen/RightRail';
import { StartScreen, dismissStartScreen, startScreenWanted } from './screen/StartScreen';
import { brokerDot, radioDot, uploadDot } from './screen/StatusDots';
import { TopBar } from './screen/TopBar';
import { WardriveScreen } from './screen/WardriveScreen';
import { SpeedTracker } from './speed';
import { Trail } from './trail';
import { useDrive } from './useDrive';
import { useLiveReceptions } from './useLiveReceptions';
import { SOUND_KEY, useWardriveSound, type SoundMode } from './useWardriveSound';
import { useWakeLock } from './wakeLock';
import { useForwarding, type ConnectMqtt } from './useForwarding';

export interface WardriveDeps {
  makeTransport(kind: 'ble' | 'usb'): RadioTransport;
  makePosition(kind: 'device' | 'usb-gps'): PositionSource;
  openQueue(): Promise<Queue>;
  bleSupported(): boolean;
  serialSupported(): boolean;
  deviceLocationAllowed(): boolean;
  connectMqtt: ConnectMqtt;
}

export const defaultDeps: WardriveDeps = {
  makeTransport: (kind) => (kind === 'ble' ? new BleTransport() : new SerialTransport()),
  makePosition: (kind) => (kind === 'device' ? new DevicePosition() : new UsbGpsPosition()),
  openQueue: () => openQueue(),
  bleSupported,
  serialSupported,
  deviceLocationAllowed,
  connectMqtt,
};

interface RadioConnection {
  companion: Companion;
  info: { publicKey: string; name: string };
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

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept: the default comes back next time.
  }
}
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
  const [follow, setFollow] = useState(true);
  const [tilt3D, setTilt3D] = useState(false);
  const [sound, setSound] = useState<SoundMode>(() => readPref(SOUND_KEY, ['off', 'rx'], 'off'));
  const [logSize, setLogSize] = useState<LogSize>(() =>
    readPref(LOG_SIZE_KEY, ['full', 'three', 'one', 'hidden'], 'three')
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuTab, setMenuTab] = useState<MenuTab>('status');
  const [startShown, setStartShown] = useState(() => startScreenWanted(false));
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [unit] = useState(getSavedDistanceUnit);
  const [mapAttempt, setMapAttempt] = useState(0);
  // mapAttempt is the point: each retry gets a fresh lazy component.
  const LiveMap = useMemo(loadLiveMap, [mapAttempt]);
  const drive = useDrive(queue, fixRef);
  const { start } = drive;
  useWakeLock(drive.running);
  const forwarding = useForwarding(
    queue,
    radio?.companion ?? null,
    radio?.info.publicKey ?? null,
    deps.connectMqtt,
    radio?.info.name || undefined
  );
  const destsForRef = useRef(forwarding.destsFor);
  destsForRef.current = forwarding.destsFor;
  const live = useLiveReceptions(radio?.companion ?? null, fixRef, drive.running);
  const soundCtl = useWardriveSound(sound, live.entries);

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
            if (!off) setMe(loaded);
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
      });
    }, RECHECK_MS);
    return () => {
      cancelled = true;
      uploader?.stop();
      clearInterval(clock);
      clearInterval(recheck);
    };
  }, [deps]);

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
      let info: { publicKey: string; name: string };
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
    keepQueue();
    start(radio.companion, radio.info.publicKey);
  }, [radio, start]);

  const shown =
    (selectedId !== null ? live.entries.find((e) => e.id === selectedId) : undefined) ??
    live.latest;
  const usableNow = isUsableFix(fix, nowMs);
  const fixTooPoor = fix && fix.accM !== null && fix.accM > MAX_ACCURACY_M ? fix.accM : null;
  const enabledDests = radio
    ? Object.entries(forwarding.settings.enabled)
        .filter(([dest, on]) => on && dest.endsWith(`@${radio.info.publicKey}`))
        .map(([dest]) => dest)
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

  const selectEntry = (id: number) => {
    const next = id === selectedId ? null : id;
    setSelectedId(next);
    const entry = live.entries.find((e) => e.id === id);
    // Looking at a reception elsewhere: the map stops following.
    if (next !== null && entry?.lat !== null && entry?.lat !== undefined) setFollow(false);
  };

  const toggleSound = () => {
    const next: SoundMode = sound === 'off' ? 'rx' : 'off';
    // Audio may only start from a tap.
    if (next === 'rx') soundCtl.enable();
    setSound(next);
    writePref(SOUND_KEY, next);
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
              entries={live.entries}
              selectedId={selectedId}
              fix={fix}
              trail={trail}
              follow={follow}
              tilt3D={tilt3D}
              onUserPan={() => setFollow(false)}
              onSelect={selectEntry}
            />
          </Suspense>
        </MapErrorBoundary>
      }
      topBar={
        <TopBar
          dots={{
            radio: radioDot(!!radio, radioLost),
            brokers: brokerDot(enabledDests, forwarding.statuses),
            upload: uploadDot(upload, offline),
          }}
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
          entries={live.entries}
          selectedId={selectedId}
          onSelect={selectEntry}
          size={logSize}
          onSize={changeLogSize}
          nowMs={nowMs}
        />
      }
      hud={
        <Hud
          shown={shown}
          nowMs={nowMs}
          speedMps={speedRef.current.speedMps(nowMs)}
          unit={unit}
          pending={upload?.pendingObs ?? 0}
          running={drive.running}
          canStart={canStart && usableNow}
          startHint={startHint}
          counts={drive.counts}
          onStart={startDrive}
          onStop={drive.stop}
        />
      }
      rail={
        <RightRail
          tilt3D={tilt3D}
          onTilt={() => setTilt3D((v) => !v)}
          follow={follow}
          onFollow={() => setFollow((v) => !v)}
          sound={sound}
          onSound={toggleSound}
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
                  settings={forwarding.settings}
                  statuses={forwarding.statuses}
                  onToggle={(id, on) => void run(() => forwarding.toggle(id, on))}
                  onOn8arAccount={forwarding.setOn8ar}
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
            </>
          }
          map={me ? <MapPanel /> : <p className="text-sm">{t('wardrive_page_map_login')}</p>}
          about={<AboutPanel />}
        />
      }
    />
  );
}
