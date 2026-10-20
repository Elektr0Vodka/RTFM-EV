// The companion's battery, by the firmware's own numbers (rx's rule), so the
// page and the radio's screen agree about the same pack: a linear map from
// 3000 to 4200 mV (BATT_MIN/MAX_MILLIVOLTS), and low below 3500 mV
// (LOW_BATT_MILLIVOLTS). Above 5000 mV it is a multi-cell pack whose end
// points a build flag sets: volts only, no percentage.

const MV_EMPTY = 3000;
const MV_FULL = 4200;
const MULTI_CELL_MV = 5000;
export const LOW_BATTERY_MV = 3500;

/** Below this the radio did not measure: a board without battery sensing
 * reports 0 mV (MeshCore STM32Board, Station G2/G3). */
const MIN_MEASURED_MV = 1000;

export const batteryKnown = (mv: number | null): mv is number =>
  mv !== null && Number.isFinite(mv) && mv >= MIN_MEASURED_MV;

export function batteryPercent(mv: number | null): number | null {
  if (!batteryKnown(mv) || mv > MULTI_CELL_MV) return null;
  const pct = Math.round(((mv - MV_EMPTY) * 100) / (MV_FULL - MV_EMPTY));
  return Math.max(0, Math.min(100, pct));
}

export const isLowBattery = (mv: number | null): boolean =>
  batteryKnown(mv) && mv <= MULTI_CELL_MV && mv < LOW_BATTERY_MV;
