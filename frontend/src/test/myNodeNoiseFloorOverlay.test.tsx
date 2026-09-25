import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import {
  LineChart,
  estimatedNoiseFloorPerBin,
  noiseFloorPerBin,
  type Bin,
} from '../components/MyNodeView';
import type { NoiseFloorSample } from '../types';

const t = (key: string, params?: Record<string, unknown>) =>
  params && 'value' in params ? `${key}:${String(params.value)}` : key;

function bin(time: number, rssis: number[], snrs: number[]): Bin {
  return { time, packets: rssis.length, bytes: 0, types: {}, rssis, snrs };
}

// Four 30 s bins starting at t0 (ms).
const T0 = 1_700_000_000_000;
const bins: Bin[] = [
  bin(T0, [-90, -92], [8, 6]),
  bin(T0 + 30_000, [-95], [3]),
  bin(T0 + 60_000, [], []),
  bin(T0 + 90_000, [-88], [10]),
];

describe('plan 21 S4: noise-floor overlay data', () => {
  it('carries the latest polled sample forward per bin and is null before the first sample', () => {
    const samples: NoiseFloorSample[] = [
      { timestamp: T0 / 1000 + 45, noise_floor_dbm: -101 }, // lands in bin 1
      { timestamp: T0 / 1000 + 100, noise_floor_dbm: -99 }, // lands in bin 3
      { timestamp: T0 / 1000 + 20, noise_floor_dbm: -104 }, // unsorted input, bin 0
    ];
    expect(noiseFloorPerBin(bins, samples)).toEqual([-104, -101, -101, -99]);
  });

  it('returns nulls without samples or bins', () => {
    expect(noiseFloorPerBin(bins, [])).toEqual([null, null, null, null]);
    expect(noiseFloorPerBin([], [{ timestamp: 1, noise_floor_dbm: -100 }])).toEqual([]);
  });

  it('estimates the floor as mean RSSI minus mean SNR, null when a reading is missing', () => {
    expect(estimatedNoiseFloorPerBin(bins)).toEqual([-98, -98, null, -98]);
  });
});

describe('plan 21 S4: LineChart overlay rendering', () => {
  const samples: NoiseFloorSample[] = [{ timestamp: T0 / 1000 + 10, noise_floor_dbm: -101 }];

  it('draws the dashed polled line and the shaded estimate, and extends the y range to them', () => {
    const { container } = render(
      <LineChart
        bins={bins}
        valueKey="rssi"
        id="line-rssi"
        windowSeconds={1200}
        formatY={(v) => `${v} dBm`}
        t={t}
        overlay={{ values: noiseFloorPerBin(bins, samples), label: 'NF' }}
        band={{ values: estimatedNoiseFloorPerBin(bins), label: 'est' }}
      />
    );
    const overlay = container.querySelector('[data-testid="line-rssi-overlay"]');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('stroke-dasharray')).toBe('3,2');
    const band = container.querySelector('[data-testid="line-rssi-band"]');
    expect(band).not.toBeNull();
    // Bin 2 has no estimate, so the band is split into two closed segments.
    expect((band?.getAttribute('d') ?? '').split('Z').filter((s) => s.trim()).length).toBe(2);
    // The y axis now spans from the lowest overlay value (-101) to the top RSSI (-88).
    const labels = Array.from(container.querySelectorAll('text')).map((el) => el.textContent);
    expect(labels).toContain('-101 dBm');
    expect(labels).toContain('-88 dBm');
  });

  it('shows the overlay values in the hover tooltip', () => {
    const { container } = render(
      <LineChart
        bins={bins}
        valueKey="rssi"
        id="line-rssi"
        windowSeconds={1200}
        formatY={(v) => `${v} dBm`}
        t={t}
        overlay={{ values: noiseFloorPerBin(bins, samples), label: 'NF' }}
        band={{ values: estimatedNoiseFloorPerBin(bins), label: 'est' }}
      />
    );
    const zones = container.querySelectorAll('rect[fill="transparent"]');
    fireEvent.mouseEnter(zones[1]);
    const extra = container.querySelector('[data-testid="line-rssi-tooltip-extra"]');
    expect(extra?.textContent).toBe('NF -101 dBm · est -98 dBm');
  });

  it('renders nothing extra without overlay or band props', () => {
    const { container } = render(
      <LineChart bins={bins} valueKey="rssi" id="line-rssi" windowSeconds={1200} t={t} />
    );
    expect(container.querySelector('[data-testid="line-rssi-overlay"]')).toBeNull();
    expect(container.querySelector('[data-testid="line-rssi-band"]')).toBeNull();
  });
});
