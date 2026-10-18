/** The share dialog's "Hide my position" choice, remembered per browser. */
const KEY = 'rtfm-share-hide-position';

export function getHidePosition(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setHidePosition(v: boolean): void {
  try {
    localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    // Storage blocked (private window, site data off): the choice just is not kept.
  }
}
