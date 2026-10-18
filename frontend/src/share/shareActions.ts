/**
 * What the browser lets a share card do: the system share sheet and image
 * copy need a secure context (https or localhost); a download always works.
 */

export interface ShareCapabilities {
  secure: boolean;
  canShareFiles: (file: File) => boolean;
  canCopyImage: boolean;
}

export function getShareCapabilities(): ShareCapabilities {
  const secure = typeof window !== 'undefined' && window.isSecureContext === true;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    secure,
    canShareFiles: (file) => {
      if (!secure || typeof nav?.canShare !== 'function') return false;
      try {
        return nav.canShare({ files: [file] });
      } catch {
        return false;
      }
    },
    canCopyImage:
      secure &&
      typeof nav?.clipboard?.write === 'function' &&
      typeof globalThis.ClipboardItem === 'function',
  };
}

/** Opens the system share sheet. Closing the sheet is not an error. */
export async function shareFile(file: File, title: string): Promise<'shared' | 'cancelled'> {
  try {
    await navigator.share({ files: [file], title });
    return 'shared';
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    throw err;
  }
}

export async function copyPng(png: Blob): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some Safari and Firefox versions fail a download whose blob URL is
  // revoked right away; keep it for a while.
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}
