// The coverage map's size: a fixed 320 px box inside the page's Drives tab, and
// all the height left on the owner's Tools > Wardrive Map tab.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import type { WardriveData } from '../../wardrive/api';
import { WardriveMap } from '../../wardrive/map/WardriveMap';

vi.mock('../../map/MiniMap', () => ({
  MiniMap: () => <div data-testid="mini-map" />,
}));
vi.mock('maplibre-gl', () => ({ Popup: class {} }));

const EMPTY: WardriveData = { obs: [], tracks: [], truncated: false };

function box(fill?: boolean) {
  render(
    <I18nProvider>
      <WardriveMap data={EMPTY} fill={fill} />
    </I18nProvider>
  );
  return screen.getByTestId('mini-map').parentElement as HTMLElement;
}

describe('wardrive coverage map size', () => {
  it('is a 320 px box by default', () => {
    const b = box();
    expect(b.className).toContain('h-80');
    expect(b.className).not.toContain('flex-1');
  });

  it('takes the height left when asked to fill, never below 320 px', () => {
    const b = box(true);
    expect(b.className).toContain('flex-1');
    expect(b.className).toContain('min-h-80');
    expect(b.className).not.toMatch(/(^| )h-80( |$)/);
    expect(b.parentElement?.className).toContain('flex-1');
  });
});
