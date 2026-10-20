import { describe, expect, it } from 'vitest';

import {
  VIEW_STATES,
  layerVisibility,
  nextViewIndex,
  parseViewKey,
  pitchTransition,
  viewKey,
} from '../../wardrive/map/viewModes';
import {
  bearingFor,
  followsPosition,
  lookAheadPadding,
  nextCompassMode,
  parseCompassMode,
} from '../../wardrive/map/compassMode';

describe('view modes', () => {
  it('has rx five states in order', () => {
    expect(VIEW_STATES.map(viewKey)).toEqual(['points2d', 'both2d', 'hex3d', 'points3d', 'both3d']);
  });

  it('cycles and recovers from a bad index', () => {
    expect(nextViewIndex(0)).toBe(1);
    expect(nextViewIndex(4)).toBe(0);
    expect(nextViewIndex(-1)).toBe(1);
    expect(nextViewIndex(9)).toBe(1);
    expect(nextViewIndex(1.5)).toBe(1);
  });

  it('reads a stored key, unknown is the start state', () => {
    expect(parseViewKey('hex3d')).toBe(2);
    expect(parseViewKey('nonsense')).toBe(0);
    expect(parseViewKey(null)).toBe(0);
  });

  it('moves the camera only when crossing between 2D and 3D', () => {
    expect(pitchTransition(false, false)).toBeNull();
    expect(pitchTransition(true, true)).toBeNull();
    expect(pitchTransition(false, true)).toBe(60);
    expect(pitchTransition(true, false)).toBe(0);
  });

  it('shows the layers of each state', () => {
    const v = (key: string) => layerVisibility(VIEW_STATES[parseViewKey(key)]);
    expect(v('points2d')).toEqual({
      hex: false,
      hex3d: false,
      hexLabels: false,
      points: true,
      points3d: false,
      selected: true,
    });
    expect(v('both2d')).toEqual({
      hex: true,
      hex3d: false,
      hexLabels: true,
      points: true,
      points3d: false,
      selected: true,
    });
    expect(v('hex3d')).toEqual({
      hex: false,
      hex3d: true,
      hexLabels: false,
      points: false,
      points3d: false,
      selected: false,
    });
    // The selected ring stays with the pillars, so a pick shows in 3D too.
    expect(v('points3d')).toEqual({
      hex: false,
      hex3d: false,
      hexLabels: false,
      points: false,
      points3d: true,
      selected: true,
    });
    // Pillars share the scene: the hexes lie flat so they do not hide them.
    expect(v('both3d')).toEqual({
      hex: true,
      hex3d: false,
      hexLabels: false,
      points: false,
      points3d: true,
      selected: true,
    });
  });
});

describe('compass modes', () => {
  it('cycles static, north up, heading', () => {
    expect(nextCompassMode('static')).toBe('north');
    expect(nextCompassMode('north')).toBe('heading');
    expect(nextCompassMode('heading')).toBe('static');
  });

  it('reads a stored mode, unknown is north up', () => {
    expect(parseCompassMode('heading')).toBe('heading');
    expect(parseCompassMode(null)).toBe('north');
    expect(parseCompassMode('spin')).toBe('north');
  });

  it('follows the position except when static', () => {
    expect(followsPosition('static')).toBe(false);
    expect(followsPosition('north')).toBe(true);
    expect(followsPosition('heading')).toBe(true);
  });

  it('puts the heading up only in heading mode', () => {
    // MapLibre's bearing is the compass direction at the top: driving east
    // (90) wants east up, bearing 90.
    expect(bearingFor('heading', 90)).toBe(90);
    expect(bearingFor('heading', 370)).toBe(10);
    expect(bearingFor('heading', -90)).toBe(270);
    expect(bearingFor('heading', 0)).toBe(0);
    expect(bearingFor('heading', null)).toBe(0);
    expect(bearingFor('heading', Number.NaN)).toBe(0);
    expect(bearingFor('north', 90)).toBe(0);
    expect(bearingFor('static', 90)).toBe(0);
  });

  it('puts the position two thirds down while heading', () => {
    expect(lookAheadPadding(900, 'heading')).toEqual({ top: 300, bottom: 0, left: 0, right: 0 });
    expect(lookAheadPadding(900, 'north').top).toBe(0);
  });

  it('keeps the position in the map left between the top bar and the HUD', () => {
    const insets = { top: 120, bottom: 480 };
    expect(lookAheadPadding(900, 'north', insets)).toEqual({
      top: 120,
      bottom: 480,
      left: 0,
      right: 0,
    });
    // Heading: two thirds down the visible 300 px.
    expect(lookAheadPadding(900, 'heading', insets)).toEqual({
      top: 220,
      bottom: 480,
      left: 0,
      right: 0,
    });
    // A HUD taller than the map leaves no room to shift: no negative space.
    expect(lookAheadPadding(400, 'heading', { top: 200, bottom: 400 }).top).toBe(200);
  });
});
