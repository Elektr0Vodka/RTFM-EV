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
