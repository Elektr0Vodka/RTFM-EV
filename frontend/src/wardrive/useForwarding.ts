// The page's forwarding: the driver's broker switches (per radio, kept in
// this browser) and one Forwarder per broker switched on for the connected
// radio, ticked every 10 s and right after a switch.
import { useCallback, useEffect, useRef, useState } from 'react';

import { BROKERS, destId, type BrokerId } from './forward/brokers';
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
  radioName?: string
) {
  const [settings, setSettingsState] = useState<BrokerSettings>(loadBrokerSettings);
  const [statuses, setStatuses] = useState<Record<string, ForwardStatus>>({});
  const settingsRef = useRef(settings);
  const forwarders = useRef(new Map<string, Forwarder>());

  const setSettings = useCallback((next: BrokerSettings) => {
    settingsRef.current = next;
    saveBrokerSettings(next);
    setSettingsState(next);
  }, []);

  /** Every destination a row of `key` is owed to (for pruning). */
  const destsFor = useCallback((key: string) => {
    const enabled = settingsRef.current.enabled;
    return [localDest(key), ...BROKERS.map((b) => destId(b.id, key)).filter((d) => enabled[d])];
  }, []);

  const tickAll = useCallback(async () => {
    for (const [dest, fw] of forwarders.current) {
      const status = await fw.tick();
      // Switched off while that tick ran: its status is no longer shown.
      if (forwarders.current.get(dest) !== fw) continue;
      setStatuses((prev) => ({ ...prev, [dest]: status }));
    }
  }, []);

  const enabledKey = radioKey
    ? BROKERS.map((b) => destId(b.id, radioKey))
        .filter((d) => settings.enabled[d])
        .join(',')
    : '';

  // Keep one forwarder per broker switched on for the connected radio.
  useEffect(() => {
    const wanted = new Set(enabledKey ? enabledKey.split(',') : []);
    const removed: string[] = [];
    for (const [dest, fw] of forwarders.current) {
      if (!wanted.has(dest) || !companion || !queue) {
        void fw.stop();
        forwarders.current.delete(dest);
        removed.push(dest);
      }
    }
    const added: string[] = [];
    if (companion && queue && radioKey) {
      for (const broker of BROKERS) {
        const dest = destId(broker.id, radioKey);
        if (!wanted.has(dest) || forwarders.current.has(dest)) continue;
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
    return () => {
      clearInterval(timer);
      for (const fw of current.values()) void fw.stop();
      current.clear();
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

  const setOn8ar = useCallback(
    (username: string, password: string) =>
      setSettings({ ...settingsRef.current, on8ar: { username, password } }),
    [setSettings]
  );

  /** On log out: the on8ar password and the radio-signed tokens let anyone
   * with this browser publish, so they go. The switches stay. */
  const forgetCredentials = useCallback(
    () => setSettings({ ...settingsRef.current, on8ar: null, tokens: {} }),
    [setSettings]
  );

  return { settings, statuses, toggle, setOn8ar, sendNow: tickAll, destsFor, forgetCredentials };
}
