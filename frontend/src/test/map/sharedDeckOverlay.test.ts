import { describe, it, expect, vi } from 'vitest';
import type { Map as MlMap } from 'maplibre-gl';
import { acquireDeckSlot, DECK_LAYER_GROUP_ID } from '../../map/layers/sharedDeckOverlay';

/* eslint-disable @typescript-eslint/no-explicit-any */

class FakeOverlay {
  props: Record<string, any>;
  calls: Record<string, any>[] = [];
  constructor(props: Record<string, any>) {
    this.props = { ...props };
  }
  setProps(p: Record<string, any>) {
    this.calls.push(p);
    Object.assign(this.props, p);
  }
}

function fakeDeck() {
  const instances: FakeOverlay[] = [];
  const deck = {
    MapLibreOverlay: class extends FakeOverlay {
      constructor(p: Record<string, any>) {
        super(p);
        instances.push(this);
      }
    },
  };
  return { deck: deck as unknown as typeof import('deck.gl'), instances };
}

function fakeMap(opts: { hasGroup?: boolean; styleLoaded?: boolean } = {}) {
  const handlers = new Map<string, Set<() => void>>();
  const state = { hasGroup: opts.hasGroup ?? true, styleLoaded: opts.styleLoaded ?? true };
  const map = {
    state,
    on: vi.fn((ev: string, cb: () => void) => {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(cb);
    }),
    off: vi.fn((ev: string, cb: () => void) => handlers.get(ev)?.delete(cb)),
    fire: (ev: string) => handlers.get(ev)?.forEach((cb) => cb()),
    listeners: (ev: string) => handlers.get(ev)?.size ?? 0,
    addControl: vi.fn(),
    removeControl: vi.fn(),
    getLayer: vi.fn((id: string) =>
      id === DECK_LAYER_GROUP_ID && state.hasGroup ? {} : undefined
    ),
    isStyleLoaded: vi.fn(() => state.styleLoaded),
    triggerRepaint: vi.fn(),
    getCanvas: () => ({ getContext: () => null }),
  };
  return map;
}

const asMap = (m: ReturnType<typeof fakeMap>) => m as unknown as MlMap;

/** Acquire a slot whose builder returns whatever `set` last stored. */
function slotWith(map: ReturnType<typeof fakeMap>, key: 'neon' | 'packets', deck: any) {
  let layers: unknown[] = [];
  const build = vi.fn(() => layers);
  const slot = acquireDeckSlot(asMap(map), key, deck, build);
  return {
    build,
    release: () => slot.release(),
    set(next: unknown[]) {
      layers = next;
      slot.refresh();
    },
  };
}

describe('acquireDeckSlot', () => {
  // deck.gl's MapLibreOverlay allows one interleaved overlay per map; a second
  // one throws. Packets and neon nodes must therefore share one overlay.
  it('shares a single interleaved overlay between slots on the same map', () => {
    const { deck, instances } = fakeDeck();
    const map = fakeMap();
    const neon = slotWith(map, 'neon', deck);
    const packets = slotWith(map, 'packets', deck);
    neon.set(['n1', 'n2']);
    packets.set(['p1']);
    expect(instances).toHaveLength(1);
    expect(instances[0].props.interleaved).toBe(true);
    expect(map.addControl).toHaveBeenCalledTimes(1);
    // Neon nodes draw under the packet arcs regardless of acquisition order.
    expect(instances[0].props.layers).toEqual(['n1', 'n2', 'p1']);
  });

  it('only rebuilds the slot that refreshed', () => {
    const { deck } = fakeDeck();
    const map = fakeMap();
    const neon = slotWith(map, 'neon', deck);
    const packets = slotWith(map, 'packets', deck);
    neon.set(['n1']);
    const neonBuilds = neon.build.mock.calls.length;
    packets.set(['p1']);
    packets.set(['p2']);
    expect(neon.build.mock.calls.length).toBe(neonBuilds);
  });

  it('keeps a stable neon-under-packets order when packets acquire first', () => {
    const { deck, instances } = fakeDeck();
    const map = fakeMap();
    const packets = slotWith(map, 'packets', deck);
    const neon = slotWith(map, 'neon', deck);
    packets.set(['p1']);
    neon.set(['n1']);
    expect(instances[0].props.layers).toEqual(['n1', 'p1']);
  });

  it('removes the overlay only when the last slot is released', () => {
    const { deck, instances } = fakeDeck();
    const map = fakeMap();
    const neon = slotWith(map, 'neon', deck);
    const packets = slotWith(map, 'packets', deck);
    neon.set(['n1']);
    packets.set(['p1']);
    packets.release();
    expect(map.removeControl).not.toHaveBeenCalled();
    expect(instances[0].props.layers).toEqual(['n1']);
    neon.release();
    expect(map.removeControl).toHaveBeenCalledWith(instances[0]);
    expect(map.listeners('render')).toBe(0);
    expect(map.listeners('webglcontextrestored')).toBe(0);
  });

  it('starts a fresh overlay after all slots were released', () => {
    const { deck, instances } = fakeDeck();
    const map = fakeMap();
    slotWith(map, 'neon', deck).release();
    slotWith(map, 'neon', deck).set(['n1']);
    expect(instances).toHaveLength(2);
    expect(instances[1].props.layers).toEqual(['n1']);
  });

  // deck skips adding its layer group while the style is still loading (it
  // checks isStyleLoaded, which is false until tiles load) and never retries,
  // so layers set during a basemap switch never drew.
  it('re-adds the missing layer group once the style has loaded', () => {
    const { deck, instances } = fakeDeck();
    const map = fakeMap({ hasGroup: false, styleLoaded: false });
    const neon = slotWith(map, 'neon', deck);
    neon.set(['n1']);
    const ov = instances[0];
    const before = ov.calls.length;
    map.fire('render');
    expect(ov.calls.length).toBe(before); // style still loading: wait
    map.state.styleLoaded = true;
    map.fire('render');
    expect(ov.calls.length).toBe(before + 1);
    // Same array: deck diffs nothing and only adds the missing group.
    expect(ov.calls[ov.calls.length - 1].layers).toBe(ov.calls[ov.calls.length - 2].layers);
    map.state.hasGroup = true;
    map.fire('render');
    expect(ov.calls.length).toBe(before + 1);
  });

  it('does not force a layer group when there are no layers', () => {
    const { deck, instances } = fakeDeck();
    const map = fakeMap({ hasGroup: false });
    slotWith(map, 'neon', deck).set([]);
    const before = instances[0].calls.length;
    map.fire('render');
    expect(instances[0].calls.length).toBe(before);
  });

  it('rebuilds the overlay with every slot after a WebGL context restore', () => {
    const { deck, instances } = fakeDeck();
    const map = fakeMap();
    const neon = slotWith(map, 'neon', deck);
    neon.set(['n1']);
    slotWith(map, 'packets', deck).set(['p1']);
    const neonBuilds = neon.build.mock.calls.length;
    map.fire('webglcontextrestored');
    // Layer instances hold GPU state from the lost device; a rebuilt deck needs
    // fresh ones, so every slot is rebuilt, not just re-sent.
    expect(neon.build.mock.calls.length).toBe(neonBuilds + 1);
    expect(map.removeControl).toHaveBeenCalledWith(instances[0]);
    expect(instances).toHaveLength(2);
    expect(map.addControl).toHaveBeenLastCalledWith(instances[1]);
    expect(instances[1].props.layers).toEqual(['n1', 'p1']);
  });

  it('keeps separate overlays for separate maps', () => {
    const { deck, instances } = fakeDeck();
    slotWith(fakeMap(), 'neon', deck).set(['a']);
    slotWith(fakeMap(), 'neon', deck).set(['b']);
    expect(instances).toHaveLength(2);
  });
});
