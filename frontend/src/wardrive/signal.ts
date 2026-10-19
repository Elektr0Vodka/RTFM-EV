// Signal tiers of the RX app (rx.mesh-hunter.eu): hot = strong = close. The
// HUD, the live log and the maps colour a reception by its tier; colourblind
// mode gets its own ramp.

export type RssiTier = 'hot' | 'warm' | 'mid' | 'cool' | 'cold' | 'faint' | 'none';

const FLOORS: [number, RssiTier][] = [
  [-80, 'hot'],
  [-90, 'warm'],
  [-100, 'mid'],
  [-110, 'cool'],
  [-115, 'cold'],
];

export function rssiTier(rssi: number | null): RssiTier {
  if (rssi === null || !Number.isFinite(rssi)) return 'none';
  for (const [floor, tier] of FLOORS) if (rssi >= floor) return tier;
  return 'faint';
}

const NORMAL: Record<RssiTier, string> = {
  hot: '#ef4444',
  warm: '#f97316',
  mid: '#eab308',
  cool: '#06b6d4',
  cold: '#3b82f6',
  faint: '#6366f1',
  none: '#9ca3af',
};

// Viridis steps: tell apart without red and green.
const CVD: Record<RssiTier, string> = {
  hot: '#fde725',
  warm: '#7ad151',
  mid: '#22a884',
  cool: '#2a788e',
  cold: '#414487',
  faint: '#440154',
  none: '#9ca3af',
};

export function tierColor(tier: RssiTier, cvd: boolean): string {
  return (cvd ? CVD : NORMAL)[tier];
}
