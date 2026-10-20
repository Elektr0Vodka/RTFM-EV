// The companion's battery, by the firmware's own numbers (rx's rule), so the
// page and the radio's screen agree about the same pack: a linear map from
// 3000 to 4200 mV (BATT_MIN/MAX_MILLIVOLTS), and low below 3500 mV
// (LOW_BATT_MILLIVOLTS). Above 5000 mV it is a multi-cell pack whose end
// points a build flag sets: volts only, no percentage.

const MV_EMPTY = 3000;
const MV_FULL = 4200;
const MULTI_CELL_MV = 5000;
export const LOW_BATTERY_MV = 3500;

export function batteryPercent(mv: number | null): number | null {
  if (mv === null || !Number.isFinite(mv) || mv > MULTI_CELL_MV) return null;
  const pct = Math.round(((mv - MV_EMPTY) * 100) / (MV_FULL - MV_EMPTY));
  return Math.max(0, Math.min(100, pct));
}

export const isLowBattery = (mv: number | null): boolean =>
  mv !== null && mv <= MULTI_CELL_MV && mv < LOW_BATTERY_MV;
