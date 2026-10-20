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

/** Camera padding: a third of the height on top in heading mode moves the
 * centre (the position) from half to two thirds down. */
export function lookAheadPadding(
  height: number,
  mode: CompassMode
): { top: number; bottom: number; left: number; right: number } {
  const top = mode === 'heading' ? Math.round((Number(height) || 0) * LOOK_AHEAD_FRACTION) : 0;
  return { top, bottom: 0, left: 0, right: 0 };
}
