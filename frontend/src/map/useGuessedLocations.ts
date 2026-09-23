// Map "guessed locations" layer: estimated positions for nodes with no
// advertised or manual location, derived from their known advert paths (see
// guessedLocations.ts). MapView owns the toggle; this hook owns fetch, the
// pure computation, the layer and the popup.
//
// Local-only and never persisted: the guessed position is recomputed on every
// fetch and is never written back to the contact, never included in a GPX
// export, and never sent anywhere.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Popup as MlPopup, type Map as MlMap } from 'maplibre-gl';

import { api, isAbortError } from '../api';
import type { Contact, ContactAdvertPathSummary } from '../types';
import { useT } from '../i18n';
import { computeGuessedLocations, type GuessedLocation } from './guessedLocations';
import { createGuessedLocationsLayer } from './layers/guessedLocationsLayer';

type Translate = ReturnType<typeof useT>;

export interface UseGuessedLocationsOptions {
  enabled: boolean;
  contacts: Contact[];
  nowSec: number;
}

function contactName(publicKey: string, contacts: Contact[]): string {
  const c = contacts.find((x) => x.public_key.toLowerCase() === publicKey.toLowerCase());
  return c?.name ?? publicKey.slice(0, 12);
}

/** DOM body of a guessed-location popup. Exported for unit testing. */
export function buildGuessedLocationPopup(
  guess: GuessedLocation,
  contacts: Contact[],
  t: Translate
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

  const anchorNames = guess.anchors.map((a) => contactName(a.public_key, contacts));
  line(
    anchorNames.length === 1
      ? t('map_guessed_locations_anchor_one', { name: anchorNames[0] })
      : t('map_guessed_locations_anchor_many', { names: anchorNames.join(', ') })
  );
  line(
    guess.highConfidence
      ? t('map_guessed_locations_confidence_high')
      : t('map_guessed_locations_confidence_low')
  );

  return el;
}

export function useGuessedLocations(opts: UseGuessedLocationsOptions) {
  const t = useT();
  const [pathSummaries, setPathSummaries] = useState<ContactAdvertPathSummary[]>([]);
  const layerRef = useRef<ReturnType<typeof createGuessedLocationsLayer> | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const popupRef = useRef<MlPopup | null>(null);
  const guessesRef = useRef<GuessedLocation[]>([]);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const tRef = useRef(t);
  tRef.current = t;

  const { enabled } = opts;

  useEffect(() => {
    if (!enabled) {
      setPathSummaries([]);
      return;
    }
    const controller = new AbortController();
    api
      .getRepeaterAdvertPaths()
      .then(setPathSummaries)
      .catch((err) => {
        if (!isAbortError(err))
          console.error('Failed to load advert paths for guessed locations:', err);
      });
    return () => controller.abort();
  }, [enabled]);

  const guesses = enabled ? computeGuessedLocations(opts.contacts, pathSummaries, opts.nowSec) : [];
  guessesRef.current = guesses;

  const openPopup = useCallback((publicKey: string) => {
    const map = mapRef.current;
    const guess = guessesRef.current.find((g) => g.public_key === publicKey);
    if (!map || !guess) return;
    popupRef.current?.remove();
    const popup = new MlPopup({ closeButton: true, offset: 10, maxWidth: '280px' });
    const el = buildGuessedLocationPopup(guess, optsRef.current.contacts, tRef.current);
    popupRef.current = popup.setLngLat([guess.lon, guess.lat]).setDOMContent(el).addTo(map);
  }, []);

  const names = new Map(
    opts.contacts.map((c) => [c.public_key.toLowerCase(), c.name ?? c.public_key])
  );

  useEffect(() => {
    layerRef.current?.setData(guesses, names);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guesses]);
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
      layer.setData(guessesRef.current, names);
      layer.setVisible(optsRef.current.enabled);
      layerRef.current = layer;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openPopup]
  );

  /** Re-add the layer after a basemap style swap. */
  const reattach = useCallback(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.reattach();
    layer.setData(guessesRef.current, names);
    layer.setVisible(optsRef.current.enabled);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { attach, reattach, guesses };
}
