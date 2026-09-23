export const BATTERY_DISPLAY_CHANGE_EVENT = 'remoteterm-battery-display-change';

export type BatteryChemistry = 'lipo' | 'lifepo4' | 'lipo_hv' | 'nmc';

export const BATTERY_CHEMISTRIES: readonly BatteryChemistry[] = [
  'lipo',
  'lifepo4',
  'lipo_hv',
  'nmc',
];

export const DEFAULT_BATTERY_CHEMISTRY: BatteryChemistry = 'lipo';

// Meshtastic default OCV table (meshtastic/firmware src/power.h). This is a real
// LiPo discharge curve, not a linear approximation.
const OCV_TABLE: [number, number][] = [
  [4190, 100],
  [4050, 90],
  [3990, 80],
  [3890, 70],
  [3800, 60],
  [3720, 50],
  [3630, 40],
  [3530, 30],
  [3420, 20],
  [3300, 10],
  [3100, 0],
];

/**
 * Linear min-max mV ranges for chemistries without a cited discharge curve, as
 * used by meshcore-open: lib/utils/battery_utils.dart in
 * https://github.com/zjs81/meshcore-open (fetched and verified 2026-09-23).
 * meshcore-open uses these same linear ranges for every chemistry including
 * LiPo (3000-4200 mV there); RTFM-EV keeps its existing real LiPo curve
 * (above) instead and only falls back to a linear range where no cited
 * discharge curve was found.
 */
const LINEAR_RANGES: Record<Exclude<BatteryChemistry, 'lipo'>, [number, number]> = {
  lifepo4: [2600, 3650],
  lipo_hv: [3000, 4350],
  nmc: [3000, 4200],
};

function ocvPercent(mv: number): number {
  if (mv >= OCV_TABLE[0][0]) return 100;
  if (mv <= OCV_TABLE[OCV_TABLE.length - 1][0]) return 0;
  for (let i = 0; i < OCV_TABLE.length - 1; i++) {
    const [highMv, highPct] = OCV_TABLE[i];
    const [lowMv, lowPct] = OCV_TABLE[i + 1];
    if (mv >= lowMv)
      return Math.round(lowPct + ((mv - lowMv) / (highMv - lowMv)) * (highPct - lowPct));
  }
  return 0;
}

function linearPercent(mv: number, minMv: number, maxMv: number): number {
  if (mv <= minMv) return 0;
  if (mv >= maxMv) return 100;
  return Math.round(((mv - minMv) / (maxMv - minMv)) * 100);
}

// The global default chemistry, kept in sync by App from app_settings
// (battery_chemistry, migration _108). It is stored server-side rather than in
// localStorage so it stays consistent across browsers, unlike most other local
// display preferences in this module. Defaults to 'lipo' so isolated renders
// (e.g. tests) are deterministic before the setting loads.
let activeBatteryChemistry: BatteryChemistry = DEFAULT_BATTERY_CHEMISTRY;

/** Set the active global default chemistry. Called by App as app_settings loads/changes. */
export function setActiveBatteryChemistry(chemistry: BatteryChemistry): void {
  activeBatteryChemistry = chemistry;
}

/** The current active global default chemistry (for callers that need the raw value). */
export function getActiveBatteryChemistry(): BatteryChemistry {
  return activeBatteryChemistry;
}

/**
 * Convert a battery reading in millivolts to a percentage.
 *
 * `chemistry` is a per-node override; omit it (or pass `null`/`undefined`) to
 * use the active global default (status bar, My Node, and any other caller
 * without a specific node in view). 'lipo' uses a real discharge curve; the
 * other chemistries use meshcore-open's linear min-max ranges (see
 * `LINEAR_RANGES` above) since no cited discharge curve was found for them.
 */
export function mvToPercent(mv: number, chemistry?: BatteryChemistry | null): number {
  const chem = chemistry ?? activeBatteryChemistry;
  if (chem === 'lipo') return ocvPercent(mv);
  const [minMv, maxMv] = LINEAR_RANGES[chem];
  return linearPercent(mv, minMv, maxMv);
}

export function formatBatteryLabel(
  mv: number,
  showPercent: boolean,
  showVoltage: boolean,
  chemistry?: BatteryChemistry | null
): string | null {
  if (!showPercent && !showVoltage) return null;
  const pct = mvToPercent(mv, chemistry);
  if (showPercent && showVoltage) return `${pct}% (${mv}mV)`;
  if (showPercent) return `${pct}%`;
  return `${mv}mV`;
}

const PERCENT_KEY = 'remoteterm-show-battery-percent';
const VOLTAGE_KEY = 'remoteterm-show-battery-voltage';

export function getShowBatteryPercent(): boolean {
  try {
    return localStorage.getItem(PERCENT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setShowBatteryPercent(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(PERCENT_KEY, 'true');
    } else {
      localStorage.removeItem(PERCENT_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
}

export function getShowBatteryVoltage(): boolean {
  try {
    return localStorage.getItem(VOLTAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setShowBatteryVoltage(enabled: boolean): void {
  try {
    if (enabled) {
      localStorage.setItem(VOLTAGE_KEY, 'true');
    } else {
      localStorage.removeItem(VOLTAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
}
