import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useCvdColors, useCvdMode, useSeriesColor } from '../hooks/useCvdColors';
import { setSavedCvdMode } from '../utils/accessibility';
import { getDataColors } from '../utils/cvd/palettes';

describe('useCvdColors', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.cvd;
    document.documentElement.dataset.tone = 'dark';
  });

  it('returns today’s series when nothing is saved', () => {
    const { result } = renderHook(() => useCvdColors());
    expect(result.current.series).toEqual(['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6']);
  });

  it('follows a mode change', () => {
    const { result } = renderHook(() => useCvdColors());
    act(() => setSavedCvdMode('tritan'));
    expect(result.current.series).toEqual(getDataColors('tritan', 'dark').series);
  });

  it('uses an explicit tone over the page tone', () => {
    setSavedCvdMode('deutan');
    const { result } = renderHook(() => useCvdColors('light'));
    expect(result.current).toEqual(getDataColors('deutan', 'light'));
  });

  it('exposes the mode itself', () => {
    const { result } = renderHook(() => useCvdMode());
    expect(result.current).toBe('off');
    act(() => setSavedCvdMode('protan'));
    expect(result.current).toBe('protan');
  });
});

describe('useSeriesColor', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.cvd;
    // The tone is derived from --card whenever the mode is applied.
    document.documentElement.style.setProperty('--card', '0 0% 100%');
  });

  it('keeps the chart’s own colour when off', () => {
    const { result } = renderHook(() => useSeriesColor());
    expect(result.current(3, '#123456')).toBe('#123456');
  });

  it('cycles through the palette series under a mode', () => {
    setSavedCvdMode('protan');
    const series = getDataColors('protan', 'light').series;
    const { result } = renderHook(() => useSeriesColor());
    expect(result.current(1, '#123456')).toBe(series[1]);
    expect(result.current(series.length + 2, '#123456')).toBe(series[2]);
  });
});
