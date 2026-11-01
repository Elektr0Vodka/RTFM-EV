// A drive: every reception the radio hears goes through Capture (kept only
// with a usable fix), becomes an obs and lands in the queue; every second the
// track window may cut a listening interval. Stopping, or losing the radio,
// closes the window with listening false.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import { Capture, TrackWindow, type CaptureCounts } from './capture';
import { DriveIds } from './driveId';
import { buildObs, buildTrack, type Fix } from './messages';
import type { Queue } from './queue';
import type { Companion } from './radio/companion';

const TICK_MS = 1000;
const ZERO: CaptureCounts = { heard: 0, stored: 0, noPosition: 0 };

interface DriveSession {
  off: () => void;
  timer: ReturnType<typeof setInterval>;
  window: TrackWindow;
  radioKey: string;
  /** RTFM-EV's drive id for this drive's rows (a new one after a long gap). */
  ids: DriveIds;
}

export function useDrive(queue: Queue | null, fixRef: MutableRefObject<Fix | null>) {
  const [running, setRunning] = useState(false);
  const [counts, setCounts] = useState<CaptureCounts>(ZERO);
  const session = useRef<DriveSession | null>(null);

  const stop = useCallback(() => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    s.off();
    clearInterval(s.timer);
    const now = Date.now();
    const last = s.window.close(now, fixRef.current);
    if (last && queue) {
      void queue.addTrack(s.radioKey, buildTrack(last, s.radioKey), now, s.ids.current(now));
    }
    setRunning(false);
  }, [queue, fixRef]);

  const start = useCallback(
    (companion: Companion, radioKey: string) => {
      if (!queue || session.current) return;
      const capture = new Capture();
      const window = new TrackWindow();
      const ids = new DriveIds();
      const off = companion.onReception((r) => {
        window.heard();
        const now = Date.now();
        const rec = capture.onReception(r, fixRef.current, now);
        setCounts(capture.counts);
        if (!rec) return;
        const driveId = ids.current(now);
        void buildObs(rec, radioKey).then((obs) => {
          if (obs) void queue.addObs(radioKey, obs, now, driveId);
        });
      });
      const timer = setInterval(() => {
        const now = Date.now();
        const row = window.tick(now, fixRef.current);
        if (row) void queue.addTrack(radioKey, buildTrack(row, radioKey), now, ids.current(now));
      }, TICK_MS);
      window.tick(Date.now(), fixRef.current);
      session.current = { off, timer, window, radioKey, ids };
      setCounts(ZERO);
      setRunning(true);
    },
    [queue, fixRef]
  );

  // Only leaving the page ends a drive. A cleanup keyed on stop also ran when
  // stop changed (the queue opening), and React may run it after a click
  // that already started the drive, ending it at once.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);
  useEffect(() => () => stopRef.current(), []);

  return { running, counts, start, stop };
}
