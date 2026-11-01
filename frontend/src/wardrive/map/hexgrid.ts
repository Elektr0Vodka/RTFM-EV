// Hex cells for wardrive coverage: CoreScope's server grid
// (cmd/server/hexgrid.go), the grid rx.mesh-hunter.eu's live map and the
// analyzer coverage map use. Pointy-top hexagons over Web Mercator metres; a
// cell id is "res:q:r" (axial). The backend has the same grid in
// app/wardrive/hexgrid.py; both are tested on tests/fixtures/wardrive_hex_vectors.json.

const R = 6378137;
const SQRT3 = Math.sqrt(3);
const SIZES: Record<number, number> = {
  6: 1500,
  7: 720,
  8: 360,
  9: 180,
  10: 90,
  11: 40,
  12: 20,
  13: 10,
  14: 5,
  15: 3,
};
const STEPS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Edge length in metres; below 6 is 1500, above 15 is 3. */
export function hexSize(res: number): number {
  return SIZES[Math.min(15, Math.max(6, Math.trunc(res)))];
}

/** rx's zoom to resolution: finer cells as the map zooms in. */
export function hexResForZoom(z: number): number {
  if (z >= 19) return 15;
  if (z >= 18) return 14;
  if (z >= 17) return 13;
  if (z >= 16) return 12;
  if (z >= 15) return 11;
  if (z >= 13) return 10;
  if (z >= 11) return 9;
  if (z >= 9) return 8;
  if (z >= 7) return 7;
  return 6;
}

const mercator = (lat: number, lon: number): [number, number] => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

const inverse = (x: number, y: number): { lat: number; lon: number } => ({
  lat: ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI,
  lon: ((x / R) * 180) / Math.PI,
});

/** Nearest hexagon of fractional axial coordinates (cube rounding). */
function round(q: number, r: number): [number, number] {
  const y = -q - r;
  let rx = Math.round(q);
  const ry = Math.round(y);
  let rz = Math.round(r);
  const dx = Math.abs(rx - q);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - r);
  // The coordinate that rounded worst is rebuilt from the other two (ry is
  // not part of the id, so its own fix-up has nothing to change).
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  // "+ 0" turns -0 into 0, so the id never reads "-0".
  return [rx + 0, rz + 0];
}

export function cellAt(lat: number, lon: number, res: number): string {
  const size = hexSize(res);
  const [x, y] = mercator(lat, lon);
  const [q, r] = round(((SQRT3 / 3) * x - y / 3) / size, ((2 / 3) * y) / size);
  return `${res}:${q}:${r}`;
}

function parse(cell: string): [number, number, number] | null {
  const parts = cell.split(':');
  if (parts.length !== 3 || parts.some((p) => !/^-?\d+$/.test(p))) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function centerXy(res: number, q: number, r: number): [number, number] {
  const size = hexSize(res);
  return [size * (SQRT3 * q + (SQRT3 / 2) * r), size * 1.5 * r];
}

export function cellCenter(cell: string): { lat: number; lon: number } | null {
  const p = parse(cell);
  return p ? inverse(...centerXy(...p)) : null;
}

/** The six corners as [lon, lat], closed (GeoJSON order). */
export function cellRing(cell: string): [number, number][] | null {
  const p = parse(cell);
  if (!p) return null;
  const [cx, cy] = centerXy(...p);
  const size = hexSize(p[0]);
  const ring: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const c = inverse(cx + size * Math.cos(a), cy + size * Math.sin(a));
    ring.push([c.lon, c.lat]);
  }
  ring.push(ring[0]);
  return ring;
}

export function neighbours(cell: string): string[] {
  const p = parse(cell);
  if (!p) return [];
  const [res, q, r] = p;
  return STEPS.map(([dq, dr]) => `${res}:${q + dq}:${r + dr}`);
}
