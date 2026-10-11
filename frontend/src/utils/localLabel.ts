import { radioKey } from '../gateway/context';
const LOCAL_LABEL_KEY = 'remoteterm-local-label';

export interface LocalLabel {
  text: string;
  color: string;
}

const DEFAULT_LABEL: LocalLabel = { text: '', color: '#062d60' };

export function getLocalLabel(): LocalLabel {
  try {
    const raw = localStorage.getItem(radioKey(LOCAL_LABEL_KEY));
    if (!raw) return DEFAULT_LABEL;
    const parsed = JSON.parse(raw) as Partial<LocalLabel>;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      color: typeof parsed.color === 'string' ? parsed.color : DEFAULT_LABEL.color,
    };
  } catch {
    return DEFAULT_LABEL;
  }
}

export function setLocalLabel(text: string, color: string): void {
  try {
    localStorage.setItem(radioKey(LOCAL_LABEL_KEY), JSON.stringify({ text, color }));
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Returns 'white' or 'black' for best contrast against the given hex color.
 * Uses WCAG relative luminance formula.
 */
export function getContrastTextColor(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  // sRGB to linear
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

  // WCAG threshold: luminance > 0.179 → dark text, else light text
  return luminance > 0.179 ? 'black' : 'white';
}
