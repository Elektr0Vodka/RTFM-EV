import { describe, it, expect } from 'vitest';
import {
  rasterStyle,
  basemapSig,
  resolveBasemapKind,
  switchStrategy,
  BASEMAPS,
  getBasemap,
  type BasemapEntry,
} from '../../map/engine/basemaps';

const raster: BasemapEntry = {
  id: 'osm',
  kind: 'raster',
  label: 'OSM',
  tiles: ['https://a.tile.example/{z}/{x}/{y}.png'],
  attribution: 'OSM',
  maxzoom: 19,
};
const vector: BasemapEntry = {
  id: 'ofm-positron',
  kind: 'vector',
  label: 'Positron',
  styleUrl: 'https://tiles.openfreemap.org/styles/positron',
  attribution: 'OFM',
};
const recolor: BasemapEntry = {
  id: 'nova',
  kind: 'vector-recolor',
  label: 'Nova',
  styleUrl: 'https://tiles.openfreemap.org/styles/dark',
  recolorId: 'nova',
  recolor: (s) => s,
  attribution: 'OFM',
};

describe('rasterStyle', () => {
  it('builds a v8 raster style with the tiles, size and maxzoom cap', () => {
    const s = rasterStyle(raster);
    expect(s.version).toBe(8);
    expect(s.sources.carto).toMatchObject({
      type: 'raster',
      tiles: raster.tiles,
      tileSize: 256,
      maxzoom: 19,
    });
    expect(s.layers[0]).toMatchObject({ id: 'carto', type: 'raster', source: 'carto' });
  });
});

describe('basemapSig', () => {
  it('signs vector by styleUrl', () => {
    expect(basemapSig(vector)).toBe(vector.styleUrl);
  });
  it('signs raster by joined tiles', () => {
    expect(basemapSig(raster)).toBe(raster.tiles!.join('|'));
  });
  it('distinguishes a recolour from plain OFM dark via recolorId', () => {
    expect(basemapSig(recolor)).toBe('https://tiles.openfreemap.org/styles/dark#nova');
    expect(basemapSig(recolor)).not.toBe('https://tiles.openfreemap.org/styles/dark');
  });
});

describe('resolveBasemapKind / switchStrategy', () => {
  it('treats vector-recolor as vector', () => {
    expect(resolveBasemapKind(recolor)).toBe('vector');
  });
  it('uses setTiles only raster->raster', () => {
    expect(switchStrategy(true, 'raster')).toBe('setTiles');
    expect(switchStrategy(false, 'raster')).toBe('setStyle');
    expect(switchStrategy(true, 'vector')).toBe('setStyle');
  });
});

describe('registry', () => {
  it('contains Nova and OpenFreeMap positron and keyless raster fallbacks', () => {
    expect(getBasemap('nova')?.kind).toBe('vector-recolor');
    expect(getBasemap('ofm-positron')?.kind).toBe('vector');
    expect(BASEMAPS.some((b) => b.kind === 'raster')).toBe(true);
  });
  it('falls back to a known id for an unknown id', () => {
    expect(getBasemap('does-not-exist')?.id).toBe('nova');
  });
});
