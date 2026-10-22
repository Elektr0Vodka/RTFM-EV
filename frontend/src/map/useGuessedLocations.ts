// Map "guessed locations" layer: estimated positions for nodes with no
// advertised or manual location, derived from their known advert paths (see
// guessedLocations.ts). MapView owns the toggle and fetches the advert paths
// (shared with the hops filter); this hook owns the pure computation, the
// layer and the popup.
//
// Local-only and never persisted: the guessed position is recomputed on every
// fetch and is never written back to the contact, never included in a GPX
// export, and never sent anywhere.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';

import type { Contact, ContactAdvertPathSummary } from '../types';
import { useT } from '../i18n';
import {
  computeGuessedLocations,
  type GuessAnchor,
  type GuessedLocation,
} from './guessedLocations';
import { latestAdvertHops, passesHopFilter, type MaxHops } from './hopFilter';
import { createGuessedLocationsLayer } from './layers/guessedLocationsLayer';
import type { NodeLabelMode } from './layers/nodesLayer';

type Translate = ReturnType<typeof useT>;

/** The local radio: anchors nodes heard direct (0 hop). */
export interface GuessSelf extends GuessAnchor {
  name: string;
}

export interface UseGuessedLocationsOptions {
  enabled: boolean;
  contacts: Contact[];
  /** Recent advert paths per contact; null while not loaded. */
  pathSummaries: ContactAdvertPathSummary[] | null;
  /** The local radio with a valid location, else null (no direct-heard guesses). */
  self: GuessSelf | null;
  /** The map's hops filter; guessed markers follow it like node markers. */
  maxHops: MaxHops;
  nowSec: number;
  /** The map's node-label mode; guessed markers are labelled the same way. */
  labelMode: NodeLabelMode;
}

function contactName(publicKey: string, contacts: Contact[]): string {
  const c = contacts.find((x) => x.public_key.toLowerCase() === publicKey.toLowerCase());
  return c?.name ?? publicKey.slice(0, 12);
}

/** DOM body of a guessed-location popup. Exported for unit testing. */
export function buildGuessedLocationPopup(
  guess: GuessedLocation,
  contacts: Contact[],
  t: Translate,
  selfName = ''
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'text-sm space-y-0.5';

  const line = (text: string, className = 'text-xs text-muted-foreground') => {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    el.append(div);
    return div;
  };

  line(contactName(guess.public_key, contacts), 'font-medium');
  line(t('map_guessed_locations_disclaimer'));

  const selfAnchor = guess.anchors.find((a) => a.isSelf);
  const heardDirect = selfAnchor !== undefined;
  if (selfAnchor) {
    line(
      t('map_guessed_locations_anchor_self', {
        name: selfName || selfAnchor.public_key.slice(0, 12),
      })
    );
  }
  const anchorNames = guess.anchors
    .filter((a) => !a.isSelf)
    .map((a) => contactName(a.public_key, contacts));
  if (anchorNames.length > 0) {
    line(
      anchorNames.length === 1
        ? t('map_guessed_locations_anchor_one', { name: anchorNames[0] })
        : t('map_guessed_locations_anchor_many', { names: anchorNames.join(', ') })
    );
  }
  line(
    guess.highConfidence
      ? t('map_guessed_locations_confidence_high')
      : heardDirect
        ? t('map_guessed_locations_confidence_low_self')
        : t('map_guessed_locations_confidence_low')
  );

  return el;
}

export function useGuessedLocations(opts: UseGuessedLocationsOptions) {
  const t = useT();
  const layerRef = useRef<ReturnType<typeof createGuessedLocationsLayer> | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const guessesRef = useRef<GuessedLocation[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tRef = useRef(t);
  tRef.current = t;

  const { enabled, labelMode, contacts, pathSummaries, self, maxHops, nowSec } = opts;

  const guesses = useMemo(() => {
    if (!enabled || !pathSummaries) return [];
    const all = computeGuessedLocations(contacts, pathSummaries, nowSec, { self });
    if (maxHops === null) return all;
    const hops = latestAdvertHops(pathSummaries);
    return all.filter((g) => passesHopFilter(hops.get(g.public_key.toLowerCase()), maxHops));
  }, [enabled, contacts, pathSummaries, self, maxHops, nowSec]);
  guessesRef.current = guesses;

  const openPopup = useCallback((publicKey: string) => {
    const map = mapRef.current;
    const guess = guessesRef.current.find((g) => g.public_key === publicKey);
    if (!map || !guess) return;
    popupRef.current?.remove();
    const popup = new MlPopup({ closeButton: true, offset: 10, maxWidth: '280px' });
    const el = buildGuessedLocationPopup(
      guess,
      optsRef.current.contacts,
      tRef.current,
      optsRef.current.self?.name
    );
    popupRef.current = popup.setLngLat([guess.lon, guess.lat]).setDOMContent(el).addTo(map);
  }, []);

  useEffect(() => {
    layerRef.current?.setData(guesses, optsRef.current.contacts);
  }, [guesses]);
  useEffect(() => {
    layerRef.current?.setLabelMode(labelMode);
  }, [labelMode]);
  useEffect(() => {
    layerRef.current?.setVisible(enabled);
    if (!enabled) popupRef.current?.remove();
  }, [enabled]);

  useEffect(
    () => () => {
      popupRef.current?.remove();
    },
    []
  );

  /** Create the layer on a ready map (call from MapView's handleReady). */
  const attach = useCallback(
    (map: MlMap) => {
      mapRef.current = map;
      const layer = createGuessedLocationsLayer(map, { onClick: openPopup });
      layer.ensure();
      layer.setLabelMode(optsRef.current.labelMode);
      layer.setData(guessesRef.current, optsRef.current.contacts);
      layer.setVisible(optsRef.current.enabled);
      layerRef.current = layer;
    },
    [openPopup]
  );

  /** Re-add the layer after a basemap style swap. */
  const reattach = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.reattach();
    layer.setData(guessesRef.current, optsRef.current.contacts);
    layer.setVisible(optsRef.current.enabled);
  }, []);

  return { attach, reattach, guesses };
}
