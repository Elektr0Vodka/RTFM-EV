// Terrain for the 3D view, as rx does it: a DEM from the key-free AWS Open
// Data terrarium tiles, capped at z10 (MapLibre overzooms instead of fetching
// finer tiles: coarser but far fewer requests; for radio work the landform
// that blocks a path is what counts). The exaggeration defaults to 7: in the
// flat Netherlands a true 1x shows nothing, though 1x is the only step where a
// line-of-sight read is literally true. Discrete steps, for a thumb.

export const DEM_SOURCE_ID = 'wd-dem';
/** The hillshade reads its own copy of the DEM (MapLibre wants a separate
 * source for terrain and hillshade). */
export const DEM_SHADE_SOURCE_ID = 'wd-dem-shade';
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_ENCODING = 'terrarium';
export const DEM_MAX_ZOOM = 10;
export const DEM_ATTRIBUTION = 'DEM: Mapzen / AWS Open Data';

export const EXAGGERATION_STEPS = [1, 2, 4, 7, 10];
export const DEFAULT_EXAGGERATION = 7;

export function parseExaggeration(v: string | null): number {
  const x = Number(v);
  return EXAGGERATION_STEPS.includes(x) ? x : DEFAULT_EXAGGERATION;
}

/** Hillshade strength follows the exaggeration (0.1 to 1). */
export function hillshadeFor(exaggeration: number): number {
  const v = Number.isFinite(exaggeration) ? exaggeration / 10 : 0.1;
  return Math.min(1, Math.max(0.1, v));
}

/** What to draw: 3D brings terrain along; the mesh waits for the DEM to have
 * loaded (flat until then, so a slow connection never stalls the camera). */
export function terrainPlan({
  mode3D,
  ready,
  exaggeration,
}: {
  mode3D: boolean;
  ready: boolean;
  exaggeration: number;
}): { hillshade: boolean; mesh: boolean; exaggeration: number } {
  const x = EXAGGERATION_STEPS.includes(exaggeration) ? exaggeration : DEFAULT_EXAGGERATION;
  return { hillshade: mode3D, mesh: mode3D && ready, exaggeration: x };
}

/** A DEM tile that did not load (offline): the map stays flat, not worth a
 * console line per tile. */
export function isDemTileError(e: { sourceId?: string; tile?: unknown }): boolean {
  return (e.sourceId === DEM_SOURCE_ID || e.sourceId === DEM_SHADE_SOURCE_ID) && !!e.tile;
}
