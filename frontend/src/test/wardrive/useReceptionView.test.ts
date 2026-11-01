import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Sender } from '../../wardrive/decode/reception';
import { DEFAULT_FILTER, type Filter, type Stand } from '../../wardrive/filters';
import type { LiveEntry } from '../../wardrive/liveLog';
import { NodeDirectory, type DirectoryNode } from '../../wardrive/names';
import { useReceptionView } from '../../wardrive/useReceptionView';

const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);
const MIN = 60000;

const relay = (id: string): Sender => ({ kind: 'relay', id, label: null, role: null });

function entry(id: number, over: Partial<LiveEntry> = {}): LiveEntry {
  return {
    id,
    at: NOW - MIN,
    rssi: -80,
    snr: 5,
    payloadType: 5,
    typeName: 'GroupText',
    direct: false,
    hops: 1,
    lat: 52,
    lon: 6,
    kept: true,
    packetType: 'GroupText',
    heardDirect: true,
    sender: relay('a1b2'),
    channel: null,
    text: null,
    stored: false,
    ...over,
  };
}

const toren = (name: string): DirectoryNode => ({
  publicKey: ('a1b2' + '0'.repeat(64)).slice(0, 64),
  name,
  role: 'Repeater',
  lat: 52.01,
  lon: 6,
  seen: 1,
});

function view(
  entries: LiveEntry[],
  opts: { filter?: Filter; stand?: Stand; ignore?: string[]; dir?: NodeDirectory } = {}
) {
  return renderHook(
    (p: { dir: NodeDirectory; nowMs: number }) =>
      useReceptionView({
        entries,
        directory: p.dir,
        filter: opts.filter ?? DEFAULT_FILTER,
        stand: opts.stand ?? 'filtered',
        ignore: new Set(opts.ignore ?? []),
        nowMs: p.nowMs,
      }),
    { initialProps: { dir: opts.dir ?? new NodeDirectory([]), nowMs: NOW } }
  );
}

describe('useReceptionView', () => {
  it('leaves receptions older than the window out of what is shown', () => {
    const { result } = view([entry(2), entry(1, { at: NOW - 40 * MIN })]);
    expect(result.current.shown.map((e) => e.id)).toEqual([2]);
    expect(result.current.all.map((e) => e.id)).toEqual([2, 1]);
  });

  it('shows everything in the window with All, marking what the filter leaves out', () => {
    const filter = { ...DEFAULT_FILTER, types: ['Advert'] };
    const filtered = view([entry(1)], { filter });
    expect(filtered.result.current.shown).toEqual([]);
    const all = view([entry(1)], { filter, stand: 'all' });
    expect(all.result.current.shown.map((e) => e.id)).toEqual([1]);
    expect(all.result.current.shown[0].inFilter).toBe(false);
  });

  it('leaves an ignored sender out in both stands', () => {
    expect(view([entry(1)], { ignore: ['a1b2'] }).result.current.shown).toEqual([]);
    expect(view([entry(1)], { ignore: ['a1b2'], stand: 'all' }).result.current.shown).toEqual([]);
  });

  it('names again when the directory changes', () => {
    const { result, rerender } = view([entry(1)]);
    expect(result.current.shown[0].name).toEqual({ mark: '', name: '' });
    rerender({ dir: new NodeDirectory([toren('Toren')]), nowMs: NOW });
    expect(result.current.shown[0].name).toEqual({ mark: '~', name: 'Toren' });
    expect(result.current.shown[0].attr?.rule).toBe('node');
  });

  it('keeps the same entry objects while nothing about them changed', () => {
    const dir = new NodeDirectory([]);
    const { result, rerender } = view([entry(1)], { dir });
    const before = result.current.shown[0];
    rerender({ dir, nowMs: NOW + 1000 });
    expect(result.current.shown[0]).toBe(before);
  });

  it('returns the same lists on a clock tick that changes nothing', () => {
    const dir = new NodeDirectory([]);
    const { result, rerender } = view([entry(2), entry(1)], { dir });
    const before = result.current;
    rerender({ dir, nowMs: NOW + 1000 });
    expect(result.current.shown).toBe(before.shown);
    expect(result.current.all).toBe(before.all);
  });

  it('gives new lists once an entry leaves the window', () => {
    const dir = new NodeDirectory([]);
    const { result, rerender } = view([entry(2), entry(1, { at: NOW - 29 * MIN })], { dir });
    const before = result.current.shown;
    rerender({ dir, nowMs: NOW + 2 * MIN });
    expect(result.current.shown).not.toBe(before);
    expect(result.current.shown.map((e) => e.id)).toEqual([2]);
  });
});
