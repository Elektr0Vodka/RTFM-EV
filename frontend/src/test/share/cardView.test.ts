import { describe, expect, it } from 'vitest';

import { VISUAL_RECT } from '../../share/cardChrome';
import { prepareMapView } from '../../share/cardView';

describe('prepareMapView with a framed view', () => {
  it('centres the framed view in the card without a basemap', async () => {
    const view = await prepareMapView(
      [
        { lat: 52, lon: 5 },
        { lat: 52.5, lon: 5.5 },
      ],
      { hidePosition: false, noMap: true, view: { center: { lat: 52.3, lon: 5.2 }, zoom: 12 } }
    );
    const at = view.project!({ lat: 52.3, lon: 5.2 });
    expect(Math.round(at.x)).toBe(VISUAL_RECT.x + VISUAL_RECT.w / 2);
    expect(Math.round(at.y)).toBe(VISUAL_RECT.y + VISUAL_RECT.h / 2);
  });
});
