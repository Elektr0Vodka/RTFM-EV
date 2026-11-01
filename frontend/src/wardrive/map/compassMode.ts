// The compass button's modes, rx's cycle: static (the map stays where the
// driver put it), follow north up, and follow with the map turned to the
// heading (the phone's compass when slow, the GPS course when driving; see
// arrow.ts). Heading mode puts the position two thirds down the screen, so
// the road ahead gets the room.

export type CompassMode = 'static' | 'north' | 'heading';

export const COMPASS_MODES: CompassMode[] = ['static', 'north', 'heading'];

export function nextCompassMode(m: CompassMode): CompassMode {
  return COMPASS_MODES[(COMPASS_MODES.indexOf(m) + 1) % COMPASS_MODES.length];
}

/** A stored mode; anything unknown is follow north up (the start). */
export function parseCompassMode(v: string | null): CompassMode {
  return (COMPASS_MODES as string[]).includes(v ?? '') ? (v as CompassMode) : 'north';
}

export const followsPosition = (m: CompassMode): boolean => m !== 'static';

/** The map bearing: the heading in heading mode (MapLibre's bearing is the
 * compass direction at the top of the screen, so driving east wants 90),
 * north up otherwise and whenever there is no usable heading (never NaN). */
export function bearingFor(mode: CompassMode, heading: number | null): number {
  if (mode !== 'heading' || heading === null || !Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

export const LOOK_AHEAD_FRACTION = 1 / 3;

/** What covers the map: the top bar above, the HUD below (px). */
export interface MapInsets {
  top: number;
  bottom: number;
}

/** Camera padding: the position sits in the map left between the top bar and
 * the HUD; in heading mode a third of that height more on top moves it from
 * half to two thirds down. */
export function lookAheadPadding(
  height: number,
  mode: CompassMode,
  insets: MapInsets = { top: 0, bottom: 0 }
): { top: number; bottom: number; left: number; right: number } {
  const top = Math.max(0, Math.round(insets.top) || 0);
  const bottom = Math.max(0, Math.round(insets.bottom) || 0);
  const visible = Math.max(0, (Number(height) || 0) - top - bottom);
  const ahead = mode === 'heading' ? Math.round(visible * LOOK_AHEAD_FRACTION) : 0;
  return { top: top + ahead, bottom, left: 0, right: 0 };
}
