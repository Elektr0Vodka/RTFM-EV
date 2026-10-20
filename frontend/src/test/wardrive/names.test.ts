import { describe, expect, it } from 'vitest';

import type { Sender } from '../../wardrive/decode/reception';
import en from '../../i18n/locales/en.json';
import {
  GUESS_MARK,
  NodeDirectory,
  REACH_CAP_KM,
  attribute,
  nameParts,
  reachKm,
  senderLine,
  type DirectoryNode,
} from '../../wardrive/names';

const t = (key: string, params?: Record<string, string | number>): string => {
  const found = (en as Record<string, unknown>)[key];
  let text = typeof found === 'string' ? found : key;
  for (const [k, v] of Object.entries(params ?? {})) text = text.replace(`{${k}}`, String(v));
  return text;
};

function node(publicKey: string, over: Partial<DirectoryNode> = {}): DirectoryNode {
  return { publicKey, name: null, role: null, lat: null, lon: null, seen: null, ...over };
}

const key = (prefix: string, fill = '0') => (prefix + fill.repeat(64)).slice(0, 64);
const sender = (kind: Sender['kind'], id: string | null, label: string | null = null): Sender => ({
  kind,
  id,
  label,
  role: null,
});

// About 3 km and 40 km north of the reception at (52, 6).
const AT = { lat: 52, lon: 6, rssi: -90 };
const NEAR = { lat: 52.027, lon: 6 };
const FAR = { lat: 52.36, lon: 6 };

describe('reachKm', () => {
  it('follows free-space loss at 868 MHz with a 36 dB budget', () => {
    expect(reachKm(-70)).toBeCloseTo(5.5, 1);
    expect(reachKm(-75)).toBeCloseTo(9.8, 1);
  });

  it('is capped', () => {
    expect(reachKm(-79)).toBe(REACH_CAP_KM);
    expect(reachKm(null)).toBe(15);
  });
});

describe('NodeDirectory', () => {
  it('keeps the newer of two copies of one key', () => {
    const dir = new NodeDirectory([
      node(key('aa'), { name: 'Old', seen: 1 }),
      node(key('aa'), { name: 'New', seen: 2 }),
    ]);
    expect(dir.byKey(key('aa'))?.name).toBe('New');
    expect(dir.withPrefix('aa')).toHaveLength(1);
  });

  it('keeps a known position and role when the newer copy has none', () => {
    const dir = new NodeDirectory([
      node(key('aa'), { name: 'Old', role: 'Repeater', lat: 52, lon: 6, seen: 1 }),
      node(key('aa'), { name: 'New', seen: 2 }),
    ]);
    expect(dir.byKey(key('aa'))).toMatchObject({ name: 'New', role: 'Repeater', lat: 52, lon: 6 });
    expect(dir.positionedWithPrefix('aa')).toHaveLength(1);
  });

  it('finds nodes by 1, 2, 3 and longer byte prefixes', () => {
    const dir = new NodeDirectory([node(key('a1b2c3d4e5')), node(key('a1ff'))]);
    expect(dir.withPrefix('a1')).toHaveLength(2);
    expect(dir.withPrefix('a1b2')).toHaveLength(1);
    expect(dir.withPrefix('A1B2C3')).toHaveLength(1);
    expect(dir.withPrefix('a1b2c3d4')).toHaveLength(1);
    expect(dir.withPrefix('a1b2c3d5')).toHaveLength(0);
  });

  it('gives each directory its own version', () => {
    expect(new NodeDirectory([]).version).not.toBe(new NodeDirectory([]).version);
  });
});

describe('attribute', () => {
  const relay = sender('relay', 'a1b2');

  it('places a relay on the one node with its prefix in reach', () => {
    const toren = node(key('a1b2'), { name: 'Toren', ...NEAR });
    const attr = attribute(relay, AT, new NodeDirectory([toren]));
    expect(attr).toEqual({ rule: 'node', node: toren });
  });

  it('reports a collision when two are in reach', () => {
    const dir = new NodeDirectory([
      node(key('a1b2', '1'), NEAR),
      node(key('a1b2', '2'), { lat: 52.01, lon: 6.01 }),
    ]);
    expect(attribute(relay, AT, dir)).toEqual({ rule: 'collision', count: 2 });
  });

  it('estimates when the only match is out of reach', () => {
    const dir = new NodeDirectory([node(key('a1b2'), FAR)]);
    expect(attribute(relay, AT, dir)).toEqual({ rule: 'estimate', prefixKnown: true });
  });

  it('estimates with an unknown prefix', () => {
    expect(attribute(relay, AT, new NodeDirectory([]))).toEqual({
      rule: 'estimate',
      prefixKnown: false,
    });
  });

  it('knows a prefix only from nodes with a position', () => {
    const dir = new NodeDirectory([node(key('a1b2'), { name: 'Toren' })]);
    expect(attribute(relay, AT, dir)).toEqual({ rule: 'estimate', prefixKnown: false });
  });

  it('estimates without a reception position', () => {
    const dir = new NodeDirectory([node(key('a1b2'), NEAR)]);
    expect(attribute(relay, { lat: null, lon: null, rssi: -90 }, dir)?.rule).toBe('estimate');
  });

  it('leaves senders with their own identity alone', () => {
    const dir = new NodeDirectory([]);
    expect(attribute(sender('advert_pubkey', key('a1b2')), AT, dir)).toBeNull();
    expect(attribute(sender('channel_name', 'Mike', 'Mike'), AT, dir)).toBeNull();
  });
});

describe('nameParts', () => {
  it('names a prefix every node agrees on, marked as a guess', () => {
    const dir = new NodeDirectory([
      node(key('a1b2', '1'), { name: 'Toren' }),
      node(key('a1b2', '2'), { name: 'Toren ' }),
    ]);
    expect(nameParts(sender('relay', 'a1b2'), null, dir)).toEqual({
      mark: GUESS_MARK,
      name: 'Toren',
    });
  });

  it('names a relay by consensus when no node with its prefix has a position', () => {
    const dir = new NodeDirectory([
      node(key('a1b2', '1'), { name: 'Toren' }),
      node(key('a1b2', '2'), { name: 'Toren' }),
    ]);
    const s = sender('relay', 'a1b2');
    expect(nameParts(s, attribute(s, AT, dir), dir)).toEqual({ mark: '~', name: 'Toren' });
    const unplaced = attribute(s, { lat: null, lon: null, rssi: -80 }, dir);
    expect(nameParts(s, unplaced, dir)).toEqual({ mark: '~', name: 'Toren' });
  });

  it('gives no name when the nodes disagree, case included', () => {
    const dir = new NodeDirectory([
      node(key('a1b2', '1'), { name: 'Toren' }),
      node(key('a1b2', '2'), { name: 'toren' }),
    ]);
    expect(nameParts(sender('relay', 'a1b2'), null, dir)).toEqual({ mark: '', name: '' });
  });

  it('names a long discover prefix without the guess mark', () => {
    const dir = new NodeDirectory([node(key('a1b2c3d4e5f60718'), { name: 'Toren' })]);
    expect(nameParts(sender('discover_pubkey', 'a1b2c3d4e5f60718'), null, dir)).toEqual({
      mark: '',
      name: 'Toren',
    });
  });

  it('names a placed relay after its node, marked', () => {
    const toren = node(key('a1b2'), { name: 'Toren', ...NEAR });
    const dir = new NodeDirectory([toren]);
    const s = sender('relay', 'a1b2');
    expect(nameParts(s, attribute(s, AT, dir), dir)).toEqual({ mark: '~', name: 'Toren' });
  });

  it('gives no name on a collision or a known prefix out of reach', () => {
    const dir = new NodeDirectory([node(key('a1b2'), { name: 'Toren', ...FAR })]);
    const s = sender('relay', 'a1b2');
    expect(nameParts(s, { rule: 'collision', count: 2 }, dir).name).toBe('');
    expect(nameParts(s, attribute(s, AT, dir), dir).name).toBe('');
  });

  it('reads an advert by its own name, else the directory', () => {
    const dir = new NodeDirectory([node(key('aa'), { name: 'Dir' })]);
    expect(nameParts(sender('advert_pubkey', key('aa'), 'Own'), null, dir).name).toBe('Own');
    expect(nameParts(sender('advert_pubkey', key('aa')), null, dir).name).toBe('Dir');
  });

  it('reads a channel sender by its label', () => {
    const dir = new NodeDirectory([]);
    expect(nameParts(sender('channel_name', 'Mike', 'Mike'), null, dir)).toEqual({
      mark: '',
      name: 'Mike',
    });
  });
});

describe('senderLine', () => {
  const empty = new NodeDirectory([]);

  it('reads a 1-byte hash with a # and via', () => {
    const s = sender('path_hash', '64', '64');
    const line = senderLine(s, attribute(s, AT, empty), empty, 'GroupText', t);
    expect(line.prefix + line.name).toBe('via #64');
  });

  it('reads a placed relay as via ~name', () => {
    const toren = node(key('a1b2'), { name: 'Toren', ...NEAR });
    const dir = new NodeDirectory([toren]);
    const s = sender('relay', 'a1b2');
    const line = senderLine(s, attribute(s, AT, dir), dir, 'GroupText', t);
    expect(line.prefix + line.name).toBe('via ~Toren');
  });

  it('shows the first 6 hex of a key nobody named', () => {
    const line = senderLine(sender('advert_pubkey', key('a1b2c3d4')), null, empty, 'Advert', t);
    expect(line.prefix + line.name).toBe('a1b2c3');
    expect(line.note).toBe('');
  });

  it('says why there is no sender', () => {
    const line = senderLine(sender(null, null), null, empty, 'Trace', t);
    expect(line).toEqual({ prefix: '', name: '', note: 'Trace, no sender id' });
  });

  it('never returns undefined with an empty directory', () => {
    const kinds: Sender['kind'][] = [
      'advert_pubkey',
      'discover_pubkey',
      'relay',
      'path_hash',
      'direct_hash',
      'channel_name',
      null,
    ];
    for (const kind of kinds) {
      const s = sender(kind, kind ? 'a1' : null);
      const attr = attribute(s, { lat: null, lon: null, rssi: null }, empty);
      const parts = nameParts(s, attr, empty);
      const line = senderLine(s, attr, empty, 'Unknown', t);
      const text = JSON.stringify({ parts, line });
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
    }
  });
});
