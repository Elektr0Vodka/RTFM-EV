/**
 * Per-page persistence of the selected time range (window id + custom range).
 *
 * Stored as a small JSON blob under a page-specific localStorage key so a
 * viewer's choice survives reloads. All access is wrapped in try/catch: storage
 * can be unavailable (private windows, blocked site data) and must never break
 * rendering.
 */

export interface StoredTimeRange {
  id: string;
  customStart: string;
  customEnd: string;
}

export function loadStoredTimeRange(key: string, fallbackId: string): StoredTimeRange {
  const fallback: StoredTimeRange = { id: fallbackId, customStart: '', customEnd: '' };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredTimeRange>;
    return {
      id: typeof parsed.id === 'string' && parsed.id ? parsed.id : fallbackId,
      customStart: typeof parsed.customStart === 'string' ? parsed.customStart : '',
      customEnd: typeof parsed.customEnd === 'string' ? parsed.customEnd : '',
    };
  } catch {
    return fallback;
  }
}

export function saveStoredTimeRange(key: string, value: StoredTimeRange): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; ignore */
  }
}
