// Feeds the live log from the connected radio: everything it hears, driving or
// not, decoded (sender, channel, text). A reception is marked kept when the
// drive would store it (driving with a usable fix, the same rule as Capture).
// The receptions this browser stored earlier for the account's radios are
// loaded once and placed after them. Renders are batched so a burst of
// receptions does not re-render the page per packet.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';

import { isUsableFix } from './capture';
import type { ChannelKeys } from './decode/channels';
import { decodeReception } from './decode/reception';
import { payloadTypeName } from './forward/payloads';
import { LiveLog, STORE_MAX, type LiveEntry } from './liveLog';
import type { Fix, ObsMessage } from './messages';
import { frameWalk, hexToBytes } from './packet';
import type { Queue } from './queue';
import type { Attribute } from './discover/useAutoDiscover';
import type { Companion } from './radio/companion';

const FLUSH_MS = 100;
// Route types 2 and 3 are direct (with and without transport codes).
const DIRECT_ROUTES = new Set([2, 3]);
/** Stored receptions shown: the queue's own 7 days. */
const HISTORY_MS = 7 * 86400000;

async function fromStored(
  message: ObsMessage,
  keys: ChannelKeys
): Promise<Omit<LiveEntry, 'id'> | null> {
  const at = Date.parse(message.rx_at);
  if (!Number.isFinite(at)) return null;
  const raw = hexToBytes(message.raw);
  const d = await decodeReception(raw, keys);
  return {
    ...d,
    at,
    rssi: message.RSSI ?? null,
    snr: message.SNR ?? null,
    payloadType: message.packet_type,
    typeName: payloadTypeName(message.packet_type),
    direct: message.route === undefined ? null : message.route === 'D',
    hops: message.path.length,
    lat: message.pos?.lat ?? null,
    lon: message.pos?.lon ?? null,
    kept: true,
    stored: true,
  };
}

export function useLiveReceptions(
  companion: Companion | null,
  fixRef: MutableRefObject<Fix | null>,
  driving: boolean,
  keys: ChannelKeys,
  history: { queue: Queue | null; radioKeys: string[] },
  /** Auto-discover's attribution of answers to its own asks. */
  attributeRef?: MutableRefObject<Attribute | null>
): { entries: LiveEntry[]; latest: LiveEntry | null } {
  const logRef = useRef(new LiveLog());
  const drivingRef = useRef(driving);
  const keysRef = useRef(keys);
  const loadedAt = useRef(Date.now());
  const flushRef = useRef<() => void>(() => {});
  const [entries, setEntries] = useState<LiveEntry[]>([]);

  useEffect(() => {
    drivingRef.current = driving;
  }, [driving]);

  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    flushRef.current = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        setEntries(logRef.current.entries());
      }, FLUSH_MS);
    };
    return () => {
      flushRef.current = () => {};
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!companion) return;
    let live = true;
    // Decoding is async: one chain keeps the receptions in arrival order.
    let chain: Promise<void> = Promise.resolve();
    const off = companion.onReception((r) => {
      const now = Date.now();
      const fix = fixRef.current;
      const placed = isUsableFix(fix, now);
      const w = frameWalk(r.raw);
      const heard = {
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
        stored: false,
      };
      chain = chain.then(async () => {
        const d = await decodeReception(r.raw, keysRef.current);
        if (!live) return;
        // An answer to one of our asks names the node asked (heard directly).
        const asked = attributeRef?.current?.({
          packetType: d.packetType,
          sender: d.sender,
          traceTag: d.traceTag ?? null,
          heardUsSnr: d.heardUsSnr ?? null,
        });
        const named = asked
          ? {
              ...d,
              sender: asked.sender,
              heardDirect: true,
              heardUsSnr: asked.heardUsSnr ?? null,
            }
          : { ...d, heardUsSnr: null };
        // The frame walk's hop count stands even when the payload is unreadable.
        logRef.current.push({ ...named, ...heard });
        flushRef.current();
      });
    });
    return () => {
      live = false;
      off();
    };
  }, [companion, fixRef, attributeRef]);

  const { queue, radioKeys } = history;
  const radioList = radioKeys.join(',');
  useEffect(() => {
    if (!queue || !radioList) return;
    let cancelled = false;
    const until = loadedAt.current;
    void queue
      .obsBefore(radioList.split(','), until, STORE_MAX)
      .then(async (rows) => {
        const out: Omit<LiveEntry, 'id'>[] = [];
        for (const row of rows) {
          if (cancelled) return;
          if (row.addedAt < until - HISTORY_MS) continue;
          const e = await fromStored(row.message, keys);
          if (e) out.push(e);
        }
        if (cancelled) return;
        logRef.current.clearHistory();
        logRef.current.addHistory(out);
        flushRef.current();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [queue, radioList, keys]);

  return { entries, latest: entries[0] ?? null };
}
