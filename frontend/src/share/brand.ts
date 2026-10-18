import type { AppSettings } from '../types';

/** The app's name and logo as drawn in a share card's footer. */
export interface CardBrand {
  /** Empty when the user hid the brand name (as `AppBrand` does). */
  name: string;
  icon: HTMLImageElement | null;
}

// Keep in sync with APP_TITLE in hooks/useFaviconBadge.ts and AppBrand.
const DEFAULT_NAME = 'RTFM-EV';
const DEFAULT_ICON = './favicon.svg';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadCardBrand(
  settings: Pick<AppSettings, 'brand_name' | 'brand_icon' | 'brand_hidden'> | null
): Promise<CardBrand> {
  const custom = settings?.brand_name?.trim();
  const name = settings?.brand_hidden ? '' : custom || DEFAULT_NAME;
  const icon =
    (settings?.brand_icon ? await loadImage(settings.brand_icon) : null) ??
    (await loadImage(DEFAULT_ICON));
  return { name, icon };
}
