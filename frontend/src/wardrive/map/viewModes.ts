// The live map's view modes, as rx.mesh-hunter.eu cycles them: points, hexes
// and both, flat or in 3D. Five states, not six: "2D, hex only" is not one of
// rx's (the flat hex view comes with the points). One rail button cycles them.

export type ViewMode = 'points' | 'both' | 'hex';

export interface ViewState {
  mode: ViewMode;
  mode3D: boolean;
}

export const VIEW_STATES: ViewState[] = [
  { mode: 'points', mode3D: false },
  { mode: 'both', mode3D: false },
  { mode: 'hex', mode3D: true },
  { mode: 'points', mode3D: true },
  { mode: 'both', mode3D: true },
];

/** The stored and labelled name of a state, e.g. `both2d`. */
export const viewKey = (s: ViewState): string => `${s.mode}${s.mode3D ? '3d' : '2d'}`;

/** Index of a stored key; anything unknown is the start state (2D points). */
export function parseViewKey(v: string | null): number {
  const i = VIEW_STATES.findIndex((s) => viewKey(s) === v);
  return i < 0 ? 0 : i;
}

/** The next state; a bad index counts as "before the first". */
export function nextViewIndex(i: number): number {
  const valid = Number.isInteger(i) && i >= 0 && i < VIEW_STATES.length;
  return ((valid ? i : 0) + 1) % VIEW_STATES.length;
}

export const PITCH_3D = 60;

/** The pitch to ease to after a view change: only when crossing between 2D
 * and 3D, so a tilt the driver chose is kept on a same-side step. */
export function pitchTransition(was3D: boolean, is3D: boolean): number | null {
  if (was3D === is3D) return null;
  return is3D ? PITCH_3D : 0;
}

export interface LayerVisibility {
  hex: boolean;
  hex3d: boolean;
  hexLabels: boolean;
  points: boolean;
  points3d: boolean;
  /** The ring around the picked reception, with points or pillars. */
  selected: boolean;
}

/** Which layers a state draws. In 3D with points the hexes lie flat: an
 * extruded cell is as tall as its strongest reception, so it would hide the
 * pillars standing in it. Labels only on flat hexes in 2D. */
export function layerVisibility({ mode, mode3D }: ViewState): LayerVisibility {
  const hexOn = mode !== 'points';
  const pointsOn = mode !== 'hex';
  if (!mode3D) {
    return {
      hex: hexOn,
      hex3d: false,
      hexLabels: hexOn,
      points: pointsOn,
      points3d: false,
      selected: pointsOn,
    };
  }
  return {
    hex: hexOn && pointsOn,
    hex3d: hexOn && !pointsOn,
    hexLabels: false,
    points: false,
    points3d: pointsOn,
    selected: pointsOn,
  };
}
