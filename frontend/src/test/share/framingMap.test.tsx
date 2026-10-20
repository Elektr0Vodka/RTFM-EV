import { render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

const added: { id: string; data?: { features: unknown[] } }[] = [];
const fake = {
  addSource: vi.fn((id: string, spec: { data: { features: unknown[] } }) =>
    added.push({ id, data: spec.data })
  ),
  getSource: () => undefined,
  addLayer: vi.fn(),
  getLayer: () => undefined,
  getCenter: () => ({ lat: 52, lng: 5 }),
  getZoom: () => 11,
  getContainer: () => ({ clientWidth: 345 }),
};
let reapply: (() => void) | undefined;
vi.mock('../../map/MiniMap', () => ({
  MiniMap: ({
    onReady,
    onBasemapReapply,
  }: {
    onReady?: (m: unknown) => void;
    onBasemapReapply?: () => void;
  }) => {
    reapply = onBasemapReapply;
    useEffect(() => onReady?.(fake), [onReady]);
    return <div />;
  },
}));

import { I18nProvider } from '../../i18n/I18nProvider';
import FramingMap from '../../share/FramingMap';

describe('framing map', () => {
  it('shows the card data on the map it is framed on', () => {
    render(
      <I18nProvider>
        <FramingMap
          located={[
            { lat: 52, lon: 5 },
            { lat: 52.1, lon: 5.1 },
          ]}
          onUse={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nProvider>
    );
    const source = added.find((a) => a.id === 'framing-points');
    expect(source?.data?.features).toHaveLength(2);
    expect(fake.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'framing-points' })
    );
  });

  it('puts the card data back after the basemap style is applied again', () => {
    added.length = 0;
    render(
      <I18nProvider>
        <FramingMap located={[{ lat: 52, lon: 5 }]} onUse={vi.fn()} onCancel={vi.fn()} />
      </I18nProvider>
    );
    expect(added.filter((a) => a.id === 'framing-points')).toHaveLength(1);
    reapply?.();
    expect(added.filter((a) => a.id === 'framing-points')).toHaveLength(2);
  });
});
