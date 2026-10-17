import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../i18n/I18nProvider';
import { MapLegend } from '../../map/controls/legend/MapLegend';
import { PacketLegend } from '../../map/controls/legend/PacketLegend';

function swatchFor(label: RegExp): HTMLElement {
  const row = screen.getByText(label).parentElement!;
  return row.querySelector('span[aria-hidden]') as HTMLElement;
}

describe('MapLegend', () => {
  it('labels each recency swatch and shows today’s colours by default', () => {
    render(
      <I18nProvider>
        <MapLegend />
      </I18nProvider>
    );
    expect(swatchFor(/1 ?h/i).style.backgroundColor).toBe('rgb(6, 182, 212)');
  });

  it('shows the recency colours it is given', () => {
    const recency = { recent: '#010203', today: '#040506', stale: '#070809', old: '#0a0b0c' };
    render(
      <I18nProvider>
        <MapLegend recencyColors={recency} />
      </I18nProvider>
    );
    expect(swatchFor(/1 ?h/i).style.backgroundColor).toBe('rgb(1, 2, 3)');
  });
});

describe('PacketLegend SNR gradient', () => {
  function gradient(): string {
    const group = screen.getByRole('group', { name: /snr/i });
    return (group.querySelector('[aria-hidden]') as HTMLElement).style.background;
  }

  it('keeps today’s ramp by default', () => {
    render(
      <I18nProvider>
        <PacketLegend />
      </I18nProvider>
    );
    expect(gradient()).toContain('rgb(245, 158, 11)');
  });

  it('draws the ramp from the signal stops it is given', () => {
    render(
      <I18nProvider>
        <PacketLegend signalColors={{ bad: '#010203', mid: '#040506', good: '#0a0b0c' }} />
      </I18nProvider>
    );
    expect(gradient()).toContain('rgb(1, 2, 3)');
    expect(gradient()).toContain('rgb(10, 11, 12)');
  });
});
