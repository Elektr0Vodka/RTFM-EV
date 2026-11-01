// The page's Auto-discover switch: one engine per radio connection, off when
// it is made, gone when the radio goes. Nothing about the switch is stored:
// every page start (and every connection) begins with it off.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import type { Companion } from '../radio/companion';
import { AutoDiscover, type Attributable, type SentKind } from './autoDiscover';
import {
  heardRepeaterIds,
  selectedCompanionIds,
  selectedRepeaterIds,
  type HeardEntry,
} from './targets';

export type AutoDiscoverState = 'off' | 'on' | 'target';

export type Attribute = (d: Attributable) => ReturnType<AutoDiscover['attribute']>;

export interface UseAutoDiscoverInput {
  radio: {
    companion: Companion;
    info: { publicKey: string; name: string; sf: number | null };
  } | null;
  position(): { lat: number; lon: number } | null;
  /** The receptions in the current time window (targets and sweep). */
  entries: HeardEntry[];
  /** The driver's picked target ids. */
  targets: string[];
  introduce: boolean;
  onSent(kind: SentKind): void;
  /** Filled with the engine's attribution for the reception pipeline. */
  attributeRef: MutableRefObject<Attribute | null>;
}

export function useAutoDiscover(input: UseAutoDiscoverInput) {
  const [enabled, setEnabled] = useState(false);
  const [cadence, setCadence] = useState<number | null>(null);
  // The switch works once the engine exists (made in an effect after the
  // radio connects); a tap before that would do nothing.
  const [engineReady, setEngineReady] = useState(false);
  const engineRef = useRef<AutoDiscover | null>(null);
  const live = useRef(input);
  live.current = input;
  const { radio, attributeRef } = input;

  const reading = () => {
    const { entries, targets } = live.current;
    const selected = new Set(targets.map((t) => t.toLowerCase()));
    return {
      repeaters: selectedRepeaterIds(entries, selected),
      companions: selectedCompanionIds(entries, selected),
    };
  };

  useEffect(() => {
    if (!radio) return;
    const engine = new AutoDiscover({
      companion: radio.companion,
      selfKey: radio.info.publicKey.toLowerCase(),
      sf: radio.info.sf,
      name: radio.info.name,
      position: () => live.current.position(),
      targets: reading,
      heard: () => {
        const entries = live.current.entries;
        const heardAt = new Map<string, number>();
        for (const e of entries) {
          const id = e.sender.id?.toLowerCase();
          if (id && (heardAt.get(id) ?? 0) < e.at) heardAt.set(id, e.at);
        }
        return { ids: heardRepeaterIds(entries), heardAt };
      },
      introduce: () => live.current.introduce,
      onSent: (kind) => live.current.onSent(kind),
      onChange: () => {
        setEnabled(engine.enabled);
        setCadence(engine.cadenceSeconds());
      },
    });
    engineRef.current = engine;
    setEngineReady(true);
    attributeRef.current = (d) => engine.attribute(d);
    // A dropped session may have left a contact zero-hop on this radio.
    void engine.replayRestores();
    return () => {
      engine.dispose();
      engineRef.current = null;
      setEngineReady(false);
      attributeRef.current = null;
      setEnabled(false);
      setCadence(null);
    };
  }, [radio, attributeRef]);

  const toggle = useCallback(() => {
    const e = engineRef.current;
    if (!e) return;
    if (e.enabled) e.stop();
    else e.start();
  }, []);

  const picked = enabled ? reading() : { repeaters: [], companions: [] };
  const state: AutoDiscoverState = !enabled
    ? 'off'
    : picked.repeaters.length || picked.companions.length
      ? 'target'
      : 'on';
  return { state, cadence, toggle, available: !!radio && engineReady };
}
