import { afterEach, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { I18nProvider } from '../i18n/I18nProvider';
import { NodeInfoPane } from '../components/repeater/RepeaterNodeInfoPane';
import type { RepeaterNodeInfoResponse, PaneState } from '../types';
import { COORDINATE_FORMAT_KEY } from '../utils/coordinateFormat';

const state: PaneState = { loading: false, attempt: 1, error: null };

function renderPane(data: RepeaterNodeInfoResponse) {
  return render(
    <I18nProvider>
      <NodeInfoPane data={data} state={state} onRefresh={() => {}} />
    </I18nProvider>
  );
}

describe('NodeInfoPane lat/lon', () => {
  afterEach(() => {
    localStorage.removeItem(COORDINATE_FORMAT_KEY);
  });

  it('keeps the raw repeater values in decimal format', () => {
    renderPane({ name: 'Rep', lat: '51.8120', lon: '4.7030', clock_utc: null });
    expect(screen.getByText('51.8120, 4.7030')).toBeInTheDocument();
  });

  it('follows the degrees, minutes, seconds setting', () => {
    localStorage.setItem(COORDINATE_FORMAT_KEY, 'dms');
    renderPane({ name: 'Rep', lat: '51.8120', lon: '4.7030', clock_utc: null });
    expect(screen.getByText(`51°48'43.2"N 4°42'10.8"E`)).toBeInTheDocument();
  });

  it('falls back to the raw text when a value is missing', () => {
    localStorage.setItem(COORDINATE_FORMAT_KEY, 'dms');
    renderPane({ name: 'Rep', lat: '51.8120', lon: null, clock_utc: null });
    expect(screen.getByText('51.8120, -')).toBeInTheDocument();
  });
});

describe('NodeInfoPane power row (firmware 1.18)', () => {
  it('shows the parsed power reply', () => {
    renderPane({
      name: 'Rep',
      lat: null,
      lon: null,
      clock_utc: null,
      power: 'batt:4012 mV usb:no solar_chg:yes ext:no charger:yes',
      power_info: { batt_mv: '4012', usb: 'no', solar_chg: 'yes', ext: 'no', charger: 'yes' },
    });
    expect(screen.getByText('Power')).toBeInTheDocument();
    expect(screen.getByText(/4012 mV/)).toBeInTheDocument();
  });

  it('hides the row on older firmware', () => {
    renderPane({
      name: 'Rep',
      lat: null,
      lon: null,
      clock_utc: null,
      power: 'Unknown command',
      power_info: null,
    });
    expect(screen.queryByText('Power')).toBeNull();
  });
});
