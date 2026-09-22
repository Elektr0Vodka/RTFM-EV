import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BarChart, NoiseFloorLineChart, BatteryLineChart } from '../components/MyNodeView';
import type { TFn } from '../i18n';
import type { NoiseFloorSample, BatterySample } from '../types';

// Regression for the "zoom unloads the page" crash: each chart keeps its own
// hovered index in state, while ZoomableBinChart hands it a shorter sliced
// array after a zoom/pan. If the retained index points past the new end,
// reading `arr[hov]` was undefined and the render threw (TypeError on
// `bins[hov].time`, or RangeError from `fmtTime(undefined)`), unmounting the
// whole app. Hovering the last bucket then shrinking the array must not throw.

const t = ((key: string) => key) as unknown as TFn;

function bins(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    time: 1_700_000_000_000 + i * 60_000,
    packets: i + 1,
    bytes: (i + 1) * 10,
    types: {},
    snrs: [],
    rssis: [],
  }));
}

function noiseSamples(n: number): NoiseFloorSample[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: 1_700_000_000 + i * 60,
    noise_floor_dbm: -100 + i,
  }));
}

function batterySamples(n: number): BatterySample[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: 1_700_000_000 + i * 60,
    battery_mv: 3700 + i,
  }));
}

// Hover the last transparent overlay zone (sets hov to the last index), which
// is what leaves a stale index behind once the array shrinks on zoom.
function hoverLastZone(container: HTMLElement) {
  const zones = container.querySelectorAll('rect[fill="transparent"]');
  expect(zones.length).toBeGreaterThan(0);
  fireEvent.mouseOver(zones[zones.length - 1]);
}

describe('My Node charts survive a zoom that shrinks the array after hover', () => {
  it('BarChart does not crash when the sliced bins shrink past the hovered index', () => {
    const full = bins(10);
    const { container, rerender } = render(
      <BarChart bins={full} valueKey="packets" id="t-bar" windowSeconds={3600} />
    );
    hoverLastZone(container);
    expect(() =>
      rerender(
        <BarChart bins={full.slice(0, 4)} valueKey="packets" id="t-bar" windowSeconds={3600} />
      )
    ).not.toThrow();
  });

  it('NoiseFloorLineChart does not crash when the sliced samples shrink past the hovered index', () => {
    const full = noiseSamples(10);
    const { container, rerender } = render(
      <NoiseFloorLineChart samples={full} windowSeconds={3600} t={t} />
    );
    hoverLastZone(container);
    expect(() =>
      rerender(<NoiseFloorLineChart samples={full.slice(0, 4)} windowSeconds={3600} t={t} />)
    ).not.toThrow();
  });

  it('BatteryLineChart does not crash when the sliced samples shrink past the hovered index', () => {
    const full = batterySamples(10);
    const { container, rerender } = render(
      <BatteryLineChart samples={full} windowSeconds={3600} t={t} />
    );
    hoverLastZone(container);
    expect(() =>
      rerender(<BatteryLineChart samples={full.slice(0, 4)} windowSeconds={3600} t={t} />)
    ).not.toThrow();
  });
});
