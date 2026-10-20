import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DRIVER_CHANNELS_KEY,
  boxAround,
  loadDriverChannels,
  needsNewBox,
  openNodeCache,
  saveDriverChannels,
  servedToNode,
} from '../../wardrive/nodeSources';

let n = 0;

afterEach(() => {
  localStorage.clear();
});

describe('node box', () => {
  it('spans 1 degree of latitude and 1.6 of longitude each way', () => {
    const box = boxAround(52, 6);
    expect(box.minLat).toBeCloseTo(51);
    expect(box.maxLat).toBeCloseTo(53);
    expect(box.minLon).toBeCloseTo(4.4);
    expect(box.maxLon).toBeCloseTo(7.6);
  });

  it('needs a new box only outside the middle half', () => {
    const box = boxAround(52, 6);
    expect(needsNewBox(box, 52, 6)).toBe(false);
    expect(needsNewBox(box, 52.4, 6.7)).toBe(false);
    expect(needsNewBox(box, 52.6, 6)).toBe(true);
    expect(needsNewBox(box, 52, 6.9)).toBe(true);
    expect(needsNewBox(null, 52, 6)).toBe(true);
  });
});

describe('servedToNode', () => {
  it('turns a served node into a directory node', () => {
    expect(
      servedToNode({
        public_key: 'AB'.repeat(32),
        name: 'Toren',
        role: 'Repeater',
        lat: 52.5,
        lon: 6.1,
        seen: 5,
      })
    ).toEqual({
      publicKey: 'ab'.repeat(32),
      name: 'Toren',
      role: 'Repeater',
      lat: 52.5,
      lon: 6.1,
      seen: 5,
    });
  });
});

describe('node cache', () => {
  it('keeps the box, the nodes and the channels for offline use', async () => {
    const name = `rtfm-wardrive-nodes-test-${n++}`;
    const cache = await openNodeCache(name);
    expect(await cache.load()).toEqual({ box: null, nodes: [], channels: [] });
    const data = {
      box: boxAround(52, 6),
      nodes: [{ publicKey: 'ab'.repeat(32), name: 'T', role: null, lat: null, lon: null, seen: 1 }],
      channels: ['#test'],
    };
    await cache.save(data);
    const again = await openNodeCache(name);
    expect(await again.load()).toEqual(data);
  });
});

describe('driver channels', () => {
  it('stay in this browser', () => {
    expect(loadDriverChannels()).toEqual([]);
    saveDriverChannels(['#zwolle']);
    expect(localStorage.getItem(DRIVER_CHANNELS_KEY)).toBe('["#zwolle"]');
    expect(loadDriverChannels()).toEqual(['#zwolle']);
  });

  it('read bad storage as none', () => {
    localStorage.setItem(DRIVER_CHANNELS_KEY, '{bad');
    expect(loadDriverChannels()).toEqual([]);
    localStorage.setItem(DRIVER_CHANNELS_KEY, '[1, "#a"]');
    expect(loadDriverChannels()).toEqual(['#a']);
  });
});
