import { calculateDistance } from '../utils/pathUtils';
import type { TFn } from '../i18n';
import type { LinkClickInfo } from './layers/advertLinksLayer';

export interface LinkPopupDeps {
  t: TFn;
  nameFor: (pubkey: string) => string;
  formatTime: (unixSec: number) => string;
  onDetails: (a: string, b: string) => void;
}

/** DOM content for the map link popup (MapLibre popups take plain DOM). */
export function buildLinkPopup(info: LinkClickInfo, deps: LinkPopupDeps): HTMLElement {
  const el = document.createElement('div');
  el.className = 'text-sm';

  const title = document.createElement('div');
  title.className = 'font-medium';
  title.textContent = `${deps.nameFor(info.a)} \u2194 ${deps.nameFor(info.b)}`;

  const count = document.createElement('div');
  count.className = 'text-xs text-muted-foreground mt-1';
  count.textContent = deps.t('map_link_popup_packets', { count: info.count });

  const seen = document.createElement('div');
  seen.className = 'text-xs text-muted-foreground';
  seen.textContent = deps.t('map_link_popup_last_seen', { time: deps.formatTime(info.lastSeen) });

  el.append(title, count, seen);

  const [p1, p2] = info.coords;
  if (p1 && p2) {
    const km = calculateDistance(p1[1], p1[0], p2[1], p2[0]);
    if (km != null) {
      const dist = document.createElement('div');
      dist.className = 'text-xs text-muted-foreground';
      dist.textContent = deps.t('map_link_popup_distance', { km: km.toFixed(1) });
      el.append(dist);
    }
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mt-2 text-xs text-primary hover:underline';
  btn.textContent = deps.t('map_link_popup_details');
  btn.addEventListener('click', () => deps.onDetails(info.a, info.b));
  el.append(btn);
  return el;
}
