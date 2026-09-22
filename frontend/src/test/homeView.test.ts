import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveHomeView,
  readLastView,
  writeLastView,
  MAP_LAST_VIEW_STORAGE_KEY,
  DEFAULT_HOME_ZOOM,
  type MapHomeSettings,
} from '../map/homeView';

const HOME: MapHomeSettings = { mode: 'home', lat: 52.1, lon: 5.1, zoom: 11 };

describe('resolveHomeView', () => {
  it('returns the home camera in home mode with valid coords', () => {
    expect(resolveHomeView(HOME, null)).toEqual({ center: [5.1, 52.1], zoom: 11 });
  });

  it('falls back to a default zoom in home mode when zoom is null', () => {
    expect(resolveHomeView({ ...HOME, zoom: null }, null)).toEqual({
      center: [5.1, 52.1],
      zoom: DEFAULT_HOME_ZOOM,
    });
  });

  it('returns null in home mode when coords are missing', () => {
    expect(resolveHomeView({ mode: 'home', lat: null, lon: null, zoom: 11 }, null)).toBeNull();
  });

  it('returns null in home mode when coords are out of range', () => {
    expect(resolveHomeView({ mode: 'home', lat: 200, lon: 5, zoom: 11 }, null)).toBeNull();
  });

  it('restores the last view in last mode when present and valid', () => {
    const last = { center: [4, 51] as [number, number], zoom: 8 };
    expect(resolveHomeView({ mode: 'last', lat: null, lon: null, zoom: null }, last)).toEqual(last);
  });

  it('returns null in last mode when there is no saved view', () => {
    expect(resolveHomeView({ mode: 'last', lat: null, lon: null, zoom: null }, null)).toBeNull();
  });

  it('returns null in last mode when the saved view is malformed', () => {
    const bad = { center: [NaN, 51] as [number, number], zoom: 8 };
    expect(resolveHomeView({ mode: 'last', lat: null, lon: null, zoom: null }, bad)).toBeNull();
  });

  it('returns null in auto mode regardless of coords/last view', () => {
    const last = { center: [4, 51] as [number, number], zoom: 8 };
    expect(resolveHomeView({ mode: 'auto', lat: 52, lon: 5, zoom: 11 }, last)).toBeNull();
  });
});

describe('last-view localStorage round-trip', () => {
  beforeEach(() => localStorage.clear());

  it('reads back what was written', () => {
    writeLastView({ center: [5.5, 52.3], zoom: 9.25 });
    expect(readLastView()).toEqual({ center: [5.5, 52.3], zoom: 9.25 });
  });

  it('returns null when nothing is stored', () => {
    expect(readLastView()).toBeNull();
  });

  it('returns null when the stored value is corrupt', () => {
    localStorage.setItem(MAP_LAST_VIEW_STORAGE_KEY, '{not json');
    expect(readLastView()).toBeNull();
  });

  it('returns null when the stored camera is out of range', () => {
    localStorage.setItem(MAP_LAST_VIEW_STORAGE_KEY, JSON.stringify({ center: [999, 52], zoom: 9 }));
    expect(readLastView()).toBeNull();
  });
});
