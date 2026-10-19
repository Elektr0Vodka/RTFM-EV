// Feeds the live log from the connected radio: everything it hears, driving or
// not. A reception is marked kept when the drive would store it (driving with a
// usable fix, the same rule as Capture). Renders are batched so a burst of
// receptions does not re-render the page per packet.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';

import { isUsableFix } from './capture';
import { payloadTypeName } from './forward/payloads';
import { LiveLog, type LiveEntry } from './liveLog';
import type { Fix } from './messages';
import { frameWalk } from './packet';
import type { Companion } from './radio/companion';

const FLUSH_MS = 100;
// Route types 2 and 3 are direct (with and without transport codes).
const DIRECT_ROUTES = new Set([2, 3]);

export function useLiveReceptions(
  companion: Companion | null,
  fixRef: MutableRefObject<Fix | null>,
  driving: boolean
): { entries: LiveEntry[]; latest: LiveEntry | null } {
  const logRef = useRef(new LiveLog());
  const drivingRef = useRef(driving);
  const [entries, setEntries] = useState<LiveEntry[]>([]);

  useEffect(() => {
    drivingRef.current = driving;
  }, [driving]);

  useEffect(() => {
    if (!companion) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = companion.onReception((r) => {
      const now = Date.now();
      const fix = fixRef.current;
      const placed = isUsableFix(fix, now);
      const w = frameWalk(r.raw);
      logRef.current.push({
        at: now,
        rssi: r.rssi,
        snr: r.snr,
        payloadType: w ? w.payloadType : null,
        typeName: w ? payloadTypeName(w.payloadType) : '?',
        direct: w ? DIRECT_ROUTES.has(w.routeType) : null,
        hops: w ? w.hops.length : null,
        lat: placed ? fix.lat : null,
        lon: placed ? fix.lon : null,
        kept: drivingRef.current && placed,
      });
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          setEntries(logRef.current.entries());
        }, FLUSH_MS);
      }
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [companion, fixRef]);

  return { entries, latest: entries[0] ?? null };
}
