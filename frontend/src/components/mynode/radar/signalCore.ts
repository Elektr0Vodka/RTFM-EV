// Pure geometry helpers for the directly-heard radar: great-circle
// bearing/distance and an SNR colour gradient. No DOM. Unit-tested.
// Ported from DutchMeshCore-Observers web/js/lib/signal-core.js
// (bearing/haversine/snrColor only).

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// bearingDeg returns the initial great-circle bearing from point 1 to point 2,
// in degrees clockwise from north (0 = N, 90 = E).
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R;
  const p2 = lat2 * D2R;
  const dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

// haversineKm returns the great-circle distance between two points in km.
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dp = (lat2 - lat1) * D2R;
  const dl = (lon2 - lon1) * D2R;
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// snrColor maps an SNR (dB) to a green(high) to red(low) CSS colour. LoRa SNR
// spans roughly -20 (weak) to +10 (strong); values are clamped. null is treated
// as the low endpoint.
export function snrColor(snr: number | null): string {
  const lo = -20;
  const hi = 10;
  const t = Math.max(0, Math.min(1, ((snr == null ? lo : snr) - lo) / (hi - lo)));
  const hue = Math.round(120 * t);
  return `hsl(${hue}, 70%, 50%)`;
}
