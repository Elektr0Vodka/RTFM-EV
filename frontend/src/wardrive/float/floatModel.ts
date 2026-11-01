// What the float readout shows, as plain values, and whether this browser
// can show it outside the page. The readout follows the HUD: the measured
// RSSI as a number, its colour from the plotted value (calibration and
// attenuator added), the SNR, the age and the sender line.
import type { LiveEntry } from '../liveLog';
import { rssiTier, type RssiTier } from '../signal';

export interface FloatSender {
  prefix: string;
  name: string;
  note: string;
}

export interface FloatModel {
  /** Nothing heard yet: the window says so instead of drawing dashes. */
  empty: boolean;
  rssi: string;
  snr: string;
  since: string;
  tier: RssiTier;
  sender: FloatSender;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

const finite = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export function floatModel({
  entry,
  sender,
  ageText,
  offset,
  t,
}: {
  entry: LiveEntry | null;
  sender: FloatSender;
  ageText: string;
  offset: number;
  t: T;
}): FloatModel {
  if (!entry) return { empty: true, rssi: '', snr: '', since: '', tier: 'none', sender };
  return {
    empty: false,
    rssi: finite(entry.rssi) ? String(Math.round(entry.rssi)) : '',
    snr: finite(entry.snr) ? t('wardrive_page_hud_snr', { value: entry.snr.toFixed(1) }) : '',
    since: ageText,
    tier: finite(entry.rssi) ? rssiTier(entry.rssi, offset) : 'none',
    sender,
  };
}

/** Android, told apart by platform: its capability flags match desktop
 * Chrome's. */
function isAndroid(nav: Navigator): boolean {
  const data = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (data?.platform) return data.platform === 'Android';
  return /Android/i.test(nav.userAgent ?? '');
}

/** How this browser can float the reading: picture-in-picture wherever the
 * document has it (Android too: a small window over the navigation app, as
 * the owner asked); fullscreen only on Android without it. null hides the
 * Float button: on a desktop without picture-in-picture the page itself is
 * on screen. */
export interface FloatWindow {
  document: Pick<Document, 'pictureInPictureEnabled'>;
  HTMLCanvasElement?: { prototype: unknown };
  HTMLVideoElement?: { prototype: unknown };
}

export function floatSupport(win: FloatWindow, nav: Navigator): 'pip' | 'fullscreen' | null {
  const canvas = win.HTMLCanvasElement?.prototype as Partial<HTMLCanvasElement> | undefined;
  const video = win.HTMLVideoElement?.prototype as Partial<HTMLVideoElement> | undefined;
  if (!canvas || typeof canvas.captureStream !== 'function' || !video) return null;
  if (win.document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function')
    return 'pip';
  return isAndroid(nav) && typeof video.requestFullscreen === 'function' ? 'fullscreen' : null;
}
