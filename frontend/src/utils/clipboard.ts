/**
 * Copy text to the clipboard, also on a plain-http LAN address.
 *
 * `navigator.clipboard` only exists in a secure context (https or localhost),
 * so on e.g. http://192.168.x.x it is missing. There, and when the async API
 * refuses, fall back to a hidden textarea and `document.execCommand('copy')`,
 * which browsers still allow inside a click handler. The fallback runs
 * synchronously when the async API is missing, so it stays inside the click's
 * user activation. Rejects when neither way works.
 */
export async function copyText(text: string): Promise<void> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path.
    }
  }
  if (!legacyCopy(text)) {
    throw new Error('Clipboard copy is not available');
  }
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    return false;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  // Inside an open dialog the focus trap keeps focus in the dialog, so put
  // the textarea next to the active element rather than at the end of body.
  const host = document.activeElement?.parentElement ?? document.body;
  host.appendChild(textarea);
  const previous = document.activeElement as HTMLElement | null;
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  textarea.remove();
  previous?.focus?.();
  return ok;
}
