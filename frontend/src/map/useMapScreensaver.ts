import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { setMapLock2D } from './engine/mapLock2D';
import {
  readCamera,
  runScreensaver,
  type CameraState,
  type LngLat,
  type ScreensaverMode,
  type ScreensaverRun,
} from './screensaver';

/** Pointer moves smaller than this (px) do not count as activity, so a
 *  synthetic or jittery move under a still mouse does not wake the map. */
const MOVE_THRESHOLD_PX = 4;
const IDLE_CHECK_MS = 1000;

export interface UseMapScreensaverOptions {
  mapRef: RefObject<MlMap | null>;
  mapReady: boolean;
  enabled: boolean;
  mode: ScreensaverMode;
  idleMinutes: number;
  /** Whether the user's 3D tilt is on; 2D lock is lifted while running. */
  tilt3D: boolean;
  /** The selected node's position (open popup), read when the run starts. */
  getSelectedCenter: () => LngLat | null;
  getFlyoverPoints: () => LngLat[];
}

/**
 * Idle tracking for the map screensaver. Any pointer, wheel, key or touch
 * input anywhere on the page counts as activity; the idle clock only runs
 * while the tab is visible. On wake the saved camera is restored exactly.
 */
export function useMapScreensaver(opts: UseMapScreensaverOptions) {
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  const runRef = useRef<ScreensaverRun | null>(null);
  const savedRef = useRef<CameraState | null>(null);
  const lastActivityRef = useRef(Date.now());
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  /** Started from a node popup button: pointer moves do not wake it. */
  const manualRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const wake = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (!activeRef.current) return;
    activeRef.current = false;
    manualRef.current = false;
    runRef.current?.stop();
    runRef.current = null;
    const map = optsRef.current.mapRef.current;
    const saved = savedRef.current;
    savedRef.current = null;
    if (map && saved) {
      map.jumpTo({
        center: saved.center,
        zoom: saved.zoom,
        bearing: saved.bearing,
        pitch: saved.pitch,
      });
      if (!optsRef.current.tilt3D) setMapLock2D(map, true);
    }
    setActive(false);
  }, []);

  const start = useCallback((manual?: { mode: ScreensaverMode; at: LngLat }) => {
    const o = optsRef.current;
    const map = o.mapRef.current;
    if (!map || activeRef.current) return;
    activeRef.current = true;
    manualRef.current = !!manual;
    savedRef.current = readCamera(map);
    if (!o.tilt3D) setMapLock2D(map, false);
    runRef.current = runScreensaver(map, {
      mode: manual?.mode ?? o.mode,
      orbitCenter: manual?.at ?? o.getSelectedCenter(),
      flyFrom: manual?.at ?? null,
      getPoints: () => optsRef.current.getFlyoverPoints(),
    });
    setActive(true);
  }, []);

  /** Start right away from a node (popup buttons), whatever the idle toggle.
   *  Orbit circles `at`; flyover flies to `at` first, then tours from there. */
  const startAt = useCallback(
    (mode: ScreensaverMode, at: LngLat) => {
      if (activeRef.current) return;
      start({ mode, at });
    },
    [start]
  );

  const { enabled, mapReady, idleMinutes, mode } = opts;

  // Activity listeners (also needed for a run started from a popup while the
  // idle toggle is off). Capture phase so nothing on the page can swallow the
  // input before it counts.
  useEffect(() => {
    if (!mapReady) return;
    const onInput = () => wake();
    // Measured from where the pointer last counted, not from the previous
    // event, so a slow drag made of 1px steps still adds up to activity.
    const onPointerMove = (e: PointerEvent) => {
      const anchor = lastPointerRef.current;
      if (
        anchor &&
        Math.abs(e.clientX - anchor.x) < MOVE_THRESHOLD_PX &&
        Math.abs(e.clientY - anchor.y) < MOVE_THRESHOLD_PX
      ) {
        return;
      }
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      // A run started by hand ignores moves, or leaving the button would end it.
      if (activeRef.current && manualRef.current) return;
      wake();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') lastActivityRef.current = Date.now();
    };
    const inputEvents = ['pointerdown', 'wheel', 'keydown', 'touchstart'] as const;
    for (const ev of inputEvents) window.addEventListener(ev, onInput, true);
    window.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      for (const ev of inputEvents) window.removeEventListener(ev, onInput, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mapReady, wake]);

  // The idle clock, only while the screensaver toggle is on.
  useEffect(() => {
    if (!enabled || !mapReady) return;
    lastActivityRef.current = Date.now();
    const idleMs = idleMinutes * 60_000;
    const timer = setInterval(() => {
      if (activeRef.current || document.visibilityState !== 'visible') return;
      if (Date.now() - lastActivityRef.current >= idleMs) start();
    }, IDLE_CHECK_MS);
    return () => clearInterval(timer);
  }, [enabled, mapReady, idleMinutes, start]);

  // Turning the screensaver off or switching mode while an idle run is going
  // wakes it, so a new mode takes effect on the next idle period.
  useEffect(() => {
    if (!enabled && !manualRef.current) wake();
  }, [enabled, wake]);
  useEffect(() => {
    if (!manualRef.current) wake();
  }, [mode, wake]);

  // Leaving the map page mid-run: stop the animation (the map is going away).
  useEffect(
    () => () => {
      runRef.current?.stop();
      runRef.current = null;
      activeRef.current = false;
      manualRef.current = false;
    },
    []
  );

  return { active, activeRef, wake, startAt };
}
