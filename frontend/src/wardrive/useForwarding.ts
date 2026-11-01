// The page's forwarding: the driver's broker switches (per radio, kept in
// this browser) and one Forwarder per served broker switched on for the
// connected radio, ticked every 10 s and right after a switch. A broker the
// server stops serving stops its forwarder; its switch is kept, so it comes
// back on if the owner serves it again.
import { useCallback, useEffect, useRef, useState } from 'react';

import { brokerFingerprint, destId, type Broker, type BrokerId } from './forward/brokers';
import type { MqttCredentials, MqttLike } from './forward/client';
import { Forwarder, disableBroker, enableBroker, type ForwardStatus } from './forward/forwarder';
import { loadBrokerSettings, saveBrokerSettings, type BrokerSettings } from './forward/settings';
import type { Queue } from './queue';
import type { Companion } from './radio/companion';
import { localDest } from './uploader';

const TICK_MS = 10000;

export type ConnectMqtt = (url: string, creds: MqttCredentials) => Promise<MqttLike>;

export function useForwarding(
  queue: Queue | null,
  companion: Companion | null,
  radioKey: string | null,
  connect: ConnectMqtt,
  brokers: Broker[],
  radioName?: string
) {
  const [settings, setSettingsState] = useState<BrokerSettings>(loadBrokerSettings);
  const [statuses, setStatuses] = useState<Record<string, ForwardStatus>>({});
  const settingsRef = useRef(settings);
  const forwarders = useRef(new Map<string, Forwarder>());
  /** dest -> the served entry its forwarder was built from */
  const builtFor = useRef(new Map<string, string>());
  /** dest -> the stop of its last forwarder (the next one waits for it) */
  const stopping = useRef(new Map<string, Promise<void>>());
  const brokersRef = useRef(brokers);
  brokersRef.current = brokers;

  const setSettings = useCallback((next: BrokerSettings) => {
    settingsRef.current = next;
    saveBrokerSettings(next);
    setSettingsState(next);
  }, []);

  /** Every destination a row of `key` is owed to (for pruning). */
  const destsFor = useCallback((key: string) => {
    const enabled = settingsRef.current.enabled;
    return [
      localDest(key),
      ...brokersRef.current.map((b) => destId(b.id, key)).filter((d) => enabled[d]),
    ];
  }, []);

  const tickAll = useCallback(async () => {
    for (const [dest, fw] of forwarders.current) {
      const status = await fw.tick();
      // Switched off while that tick ran: its status is no longer shown.
      if (forwarders.current.get(dest) !== fw) continue;
      setStatuses((prev) => ({ ...prev, [dest]: status }));
    }
  }, []);

  // A broker whose served entry changed (URL, account, region) gets a new
  // forwarder: the key carries the entry, not only its id, in a fixed form
  // (the built-in list and the server's list order their keys differently).
  const enabledKey = radioKey
    ? JSON.stringify(
        brokers
          .filter((b) => settings.enabled[destId(b.id, radioKey)])
          .map((b) => [brokerFingerprint(b), b])
      )
    : '[]';

  // Keep one forwarder per broker switched on for the connected radio.
  useEffect(() => {
    const pairs = JSON.parse(enabledKey) as [string, Broker][];
    const wantedBrokers = pairs.map(([, b]) => b);
    const wanted = new Map(
      radioKey ? pairs.map(([print, b]) => [destId(b.id, radioKey), print]) : []
    );
    const removed: string[] = [];
    for (const [dest, fw] of forwarders.current) {
      if (wanted.get(dest) !== builtFor.current.get(dest) || !companion || !queue) {
        // A forwarder rebuilt for this destination starts after this one's
        // row in flight, so that row is not published twice.
        stopping.current.set(dest, fw.stop());
        forwarders.current.delete(dest);
        builtFor.current.delete(dest);
        removed.push(dest);
      }
    }
    const added: string[] = [];
    if (companion && queue && radioKey) {
      for (const broker of wantedBrokers) {
        const dest = destId(broker.id, radioKey);
        if (forwarders.current.has(dest)) continue;
        builtFor.current.set(dest, wanted.get(dest) as string);
        forwarders.current.set(
          dest,
          new Forwarder({
            broker,
            radioKey,
            radioName,
            queue,
            companion,
            connect,
            settings: () => settingsRef.current,
            after: stopping.current.get(dest),
            saveToken: (key, token) =>
              setSettings({
                ...settingsRef.current,
                tokens: { ...settingsRef.current.tokens, [key]: token },
              }),
          })
        );
        added.push(dest);
      }
    }
    if (removed.length || added.length) {
      // A forwarder starts as connecting; a removed one leaves no status.
      setStatuses((prev) => {
        const next = { ...prev };
        for (const dest of removed) delete next[dest];
        for (const dest of added) next[dest] = { state: 'connecting', pending: 0 };
        return next;
      });
    }
    if (added.length) void tickAll();
  }, [enabledKey, companion, queue, radioKey, radioName, connect, setSettings, tickAll]);

  useEffect(() => {
    const timer = setInterval(() => void tickAll(), TICK_MS);
    const current = forwarders.current;
    const built = builtFor.current;
    return () => {
      clearInterval(timer);
      for (const fw of current.values()) void fw.stop();
      current.clear();
      built.clear();
    };
  }, [tickAll]);

  const toggle = useCallback(
    async (id: BrokerId, on: boolean) => {
      if (!queue || !radioKey) return;
      setSettings(
        on
          ? await enableBroker(queue, settingsRef.current, id, radioKey)
          : disableBroker(settingsRef.current, id, radioKey)
      );
    },
    [queue, radioKey, setSettings]
  );

  /** The server's broker list arrived: switches of brokers it no longer
   * serves go, so one served again later (or a new broker given the same id)
   * starts off, from what is heard then, like any broker switched on. */
  const keepOnly = useCallback(
    (ids: string[]) => {
      const served = new Set(ids);
      const enabled = settingsRef.current.enabled;
      const kept = Object.fromEntries(
        Object.entries(enabled).filter(([dest]) => served.has(dest.slice(0, dest.lastIndexOf('@'))))
      );
      if (Object.keys(kept).length !== Object.keys(enabled).length)
        setSettings({ ...settingsRef.current, enabled: kept });
    },
    [setSettings]
  );

  /** On log out: the radio-signed tokens let anyone with this browser
   * publish, so they go. The switches stay. */
  const forgetCredentials = useCallback(
    () => setSettings({ ...settingsRef.current, tokens: {} }),
    [setSettings]
  );

  return { settings, statuses, toggle, sendNow: tickAll, destsFor, forgetCredentials, keepOnly };
}
