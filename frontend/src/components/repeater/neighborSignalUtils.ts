export interface SnrPoint {
  observed_at: number;
  snr: number;
}

export interface MergedSignalPoint {
  observed_at: number;
  repeater_snr?: number;
  self_snr?: number;
}

/** Merge repeater-view and my-node-view SNR series into one time-sorted array
 *  keyed by observed_at, so a chart can plot both lines on a shared X axis. */
export function mergeSignalSeries(
  repeaterSamples: SnrPoint[],
  selfSamples: SnrPoint[]
): MergedSignalPoint[] {
  const map = new Map<number, MergedSignalPoint>();
  for (const s of repeaterSamples) {
    const p = map.get(s.observed_at) ?? { observed_at: s.observed_at };
    p.repeater_snr = s.snr;
    map.set(s.observed_at, p);
  }
  for (const s of selfSamples) {
    const p = map.get(s.observed_at) ?? { observed_at: s.observed_at };
    p.self_snr = s.snr;
    map.set(s.observed_at, p);
  }
  return [...map.values()].sort((a, b) => a.observed_at - b.observed_at);
}
