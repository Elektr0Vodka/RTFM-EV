// Saves one export file: fetched (so a refusal shows the server's message
// instead of a browser error page), then saved under the server's file name.
// The page sends its session cookie, the Tools page the main login; both
// are same-origin credentials.
import type { ExportKind } from './types';

const FILENAME = /filename="([^"]+)"/;

export async function saveExport(
  url: string,
  kind: ExportKind,
  makeError: (message: string, status: number) => Error
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin' });
  } catch (e) {
    throw makeError(e instanceof Error ? e.message : String(e), 0);
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') message = body.detail;
    } catch {
      // Not JSON.
    }
    throw makeError(message, res.status);
  }
  const blob = await res.blob();
  const name =
    FILENAME.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `rtfm-ev-wardrive-${kind}`;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
