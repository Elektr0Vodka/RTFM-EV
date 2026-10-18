import { captureBasemap } from './basemapCapture';
import { CARD_H, CARD_W, VISUAL_RECT, cardPalette, type CardTone } from './cardChrome';
import { fitProjector, type LatLon, type Projector } from './geo';
import type { ShareBuildOptions } from './ShareCardDialog';

const MAP_PADDING = 48;

/** How a map card's visual area is drawn: on a captured basemap, on a plain
 *  background in true shape, or (position hidden) as a diagram. */
export interface MapView {
  project: Projector | null;
  mapImage: CanvasImageSource | null;
  tone: CardTone;
  /** Base map credit; only with a map image. */
  credit?: string;
  /** Hidden position: the card draws a diagram, no real direction or scale. */
  diagram: boolean;
  hideNames: boolean;
}

/**
 * With the position hidden, "without the map" chosen, or nothing located, no
 * base map is fetched. Throws `BasemapLoadError` when a map was wanted but did
 * not load (the dialog then offers the card without it).
 */
export async function prepareMapView(
  located: LatLon[],
  opts: Pick<ShareBuildOptions, 'hidePosition' | 'noMap'>
): Promise<MapView> {
  if (opts.hidePosition) {
    return { project: null, mapImage: null, tone: 'dark', diagram: true, hideNames: true };
  }
  if (opts.noMap || located.length === 0) {
    return {
      project: fitProjector(located, VISUAL_RECT, MAP_PADDING),
      mapImage: null,
      tone: 'dark',
      diagram: false,
      hideNames: false,
    };
  }
  const cap = await captureBasemap(located, { w: VISUAL_RECT.w, h: VISUAL_RECT.h }, MAP_PADDING);
  return {
    project: cap.project,
    mapImage: cap.image,
    tone: cap.tone,
    credit: cap.credit || undefined,
    diagram: false,
    hideNames: false,
  };
}

/** Card background plus the base map image when there is one. */
export function drawCardBackground(
  ctx: CanvasRenderingContext2D,
  tone: CardTone,
  mapImage: CanvasImageSource | null
): void {
  ctx.fillStyle = cardPalette(tone).bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (mapImage) {
    ctx.drawImage(mapImage, VISUAL_RECT.x, VISUAL_RECT.y, VISUAL_RECT.w, VISUAL_RECT.h);
  }
}
