import type { SensorPushThreshold } from '../types';

/**
 * Bytes a threshold set takes on the sensor. The firmware keeps at most 14
 * (`ClientInfo.extra.sensor.min_deltas[14]`); unsupported types count as 0.
 */
export function thresholdBytes(
  selected: SensorPushThreshold[],
  supported: Record<string, number>
): number {
  return selected.reduce((sum, t) => sum + (supported[t.type_name] ?? 0), 0);
}
