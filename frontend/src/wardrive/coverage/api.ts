// The coverage map's server calls (app/wardrive/map.py), over whichever
// fetch the surface has: the owner's /api/wardrive-admin (main login) or the
// driver's /api/wardrive (wardrive session). The owner's adapter adds the
// view-as parameters to every call.
import type { QueryParams } from './state';
import type { CellsPage, MapDriver, PointsPage } from './types';

export type Getter = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface RegistryEntry {
  public_key: string;
  name: string | null;
  role: string | null;
  lat: number | null;
  lon: number | null;
  seen: number | null;
}

export interface Box {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface CoverageApi {
  /** The nodes RTFM-EV knows inside the box (`/nodes`). */
  nodes(box: Box, signal?: AbortSignal): Promise<{ nodes: RegistryEntry[]; truncated: boolean }>;
  points(params: QueryParams, signal?: AbortSignal): Promise<PointsPage>;
  cells(params: QueryParams, res: number, signal?: AbortSignal): Promise<CellsPage>;
  drivers(params: QueryParams, signal?: AbortSignal): Promise<{ drivers: MapDriver[] }>;
}

/** `?a=b&sender=x&sender=y`, list values as repeated keys; '' for none. */
export function toQuery(params: QueryParams): string {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const v of value) p.append(key, v);
    else p.set(key, value);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function coverageApi(get: Getter, extra: QueryParams = {}): CoverageApi {
  const init = (signal?: AbortSignal): RequestInit | undefined => (signal ? { signal } : undefined);
  return {
    nodes: (b, signal) =>
      get<{ nodes: RegistryEntry[]; truncated: boolean }>(
        `/nodes${toQuery({
          min_lat: String(b.south),
          max_lat: String(b.north),
          min_lon: String(b.west),
          max_lon: String(b.east),
        })}`,
        init(signal)
      ),
    points: (params, signal) =>
      get<PointsPage>(`/map/points${toQuery({ ...params, ...extra })}`, init(signal)),
    cells: (params, res, signal) =>
      get<CellsPage>(
        `/map/cells${toQuery({ ...params, res: String(res), ...extra })}`,
        init(signal)
      ),
    drivers: (params, signal) =>
      get<{ drivers: MapDriver[] }>(
        `/map/drivers${toQuery({ ...params, ...extra })}`,
        init(signal)
      ),
  };
}

export const PAGE_SIZE = 5000;
/** Points fetched for one view at most (map.mesh-hunter.eu's cap). */
export const POINTS_CAP = 25000;

/** Every page of points up to `max`. */
export async function fetchAllPoints(
  api: CoverageApi,
  params: QueryParams,
  max = POINTS_CAP,
  signal?: AbortSignal
): Promise<PointsPage> {
  const out: PointsPage = { points: [], truncated: false, covers_from: null };
  for (let offset = 0; offset < max; offset += PAGE_SIZE) {
    const page = await api.points(
      { ...params, limit: String(PAGE_SIZE), offset: String(offset) },
      signal
    );
    out.points.push(...page.points);
    out.covers_from = page.covers_from ?? out.covers_from;
    out.truncated = page.truncated;
    if (!page.truncated) break;
  }
  return out;
}
