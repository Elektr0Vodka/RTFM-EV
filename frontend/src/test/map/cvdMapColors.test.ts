import { beforeEach, describe, expect, it } from 'vitest';

import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM } from '../../types';
import { getDataColors } from '../../utils/cvd/palettes';
import { snrColor } from '../../map/packets/packetAnimMath';
import { circleColorExpr } from '../../map/layers/nodesLayer';
import {
  DEFAULT_NODE_ROLE_COLORS,
  effectiveRoleColors,
  NODE_ROLE_COLORS_STORAGE_KEY,
  saveNodeRoleColors,
} from '../../map/layers/nodeRoleColors';
import { getHopColor, HOP_COLORS, markerEl, readableLabelColor } from '../../map/routeMapVisuals';

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

describe('colourblind map colours', () => {
  beforeEach(() => localStorage.clear());

  it('keeps today’s SNR ramp without colours', () => {
    expect(snrColor(-25)).toEqual([245, 158, 11]);
    expect(snrColor(15)).toEqual([34, 197, 94]);
  });

  it('uses the palette stops when given', () => {
    const signal = getDataColors('deutan', 'dark').signal;
    expect(snrColor(-25, signal)).toEqual(rgb(signal.bad));
    expect(snrColor(0, signal)).toEqual(rgb(signal.mid));
    expect(snrColor(15, signal)).toEqual(rgb(signal.good));
  });

  it('keeps today’s recency expression without colours', () => {
    expect(circleColorExpr()).toEqual([
      'match',
      ['get', 'tier'],
      'recent',
      '#06b6d4',
      'today',
      '#2563eb',
      'stale',
      '#f59e0b',
      'old',
      '#64748b',
      '#64748b',
    ]);
  });

  it('uses given recency colours', () => {
    const recency = getDataColors('tritan', 'light').recency;
    const expr = circleColorExpr(recency) as unknown[];
    expect(expr[3]).toBe(recency.recent);
    expect(expr[expr.length - 1]).toBe(recency.old);
  });

  it('recolours stock role colours under a mode', () => {
    expect(effectiveRoleColors(DEFAULT_NODE_ROLE_COLORS, 'protan', 'dark')).toEqual(
      getDataColors('protan', 'dark').roles
    );
  });

  it('keeps a role colour the user picked', () => {
    const saved = { ...DEFAULT_NODE_ROLE_COLORS, [CONTACT_TYPE_ROOM]: '#123456' };
    const out = effectiveRoleColors(saved, 'protan', 'dark');
    expect(out[CONTACT_TYPE_ROOM]).toBe('#123456');
    expect(out[CONTACT_TYPE_REPEATER]).toBe(
      getDataColors('protan', 'dark').roles[CONTACT_TYPE_REPEATER]
    );
  });

  it('changes nothing when off', () => {
    const saved = { ...DEFAULT_NODE_ROLE_COLORS, [CONTACT_TYPE_ROOM]: '#123456' };
    expect(effectiveRoleColors(saved, 'off', 'light')).toEqual(saved);
  });

  it('saves only roles the user changed', () => {
    saveNodeRoleColors({ ...DEFAULT_NODE_ROLE_COLORS });
    expect(localStorage.getItem(NODE_ROLE_COLORS_STORAGE_KEY)).toBeNull();
    saveNodeRoleColors({ ...DEFAULT_NODE_ROLE_COLORS, [CONTACT_TYPE_ROOM]: '#123456' });
    expect(JSON.parse(localStorage.getItem(NODE_ROLE_COLORS_STORAGE_KEY)!)).toEqual({
      [CONTACT_TYPE_ROOM]: '#123456',
    });
  });

  it('picks hop colours from a given list', () => {
    expect(getHopColor(2)).toBe(HOP_COLORS[2]);
    const hops = getDataColors('deutan', 'light').hops;
    expect(getHopColor(9, hops)).toBe(hops[9 % hops.length]);
  });
});

describe('route marker labels', () => {
  it('keeps white labels by default', () => {
    expect(markerEl('1', '#eab308', 't').style.color).toBe('rgb(255, 255, 255)');
  });

  it('uses the given label colour', () => {
    expect(markerEl('1', '#fadbd1', 't', '#0b0b0b').style.color).toBe('rgb(11, 11, 11)');
  });

  it('picks the label colour that reads best on the marker', () => {
    expect(readableLabelColor('#fadbd1')).toBe('#0b0b0b');
    expect(readableLabelColor('#e6f910')).toBe('#0b0b0b');
    expect(readableLabelColor('#0e1343')).toBe('#ffffff');
  });
});
