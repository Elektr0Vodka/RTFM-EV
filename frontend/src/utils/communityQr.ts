import { encode, renderSVG } from 'uqr';

/**
 * QR helpers for meshcore-open community codes.
 *
 * Rendering uses `uqr` (zero dependencies). Scanning uses `zxing-wasm/reader`,
 * imported lazily so its WASM only loads when a scan starts. The WASM file is
 * bundled with the app (Vite `?url`) instead of zxing-wasm's default jsDelivr
 * URL, so scanning works offline and never contacts a CDN.
 */

export const COMMUNITY_QR_TYPE = 'meshcore_community';

/** Cheap client-side check before sending a payload to the backend (which validates fully). */
export function looksLikeCommunityPayload(text: string): boolean {
  try {
    const data = JSON.parse(text) as unknown;
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as { type?: unknown }).type === COMMUNITY_QR_TYPE &&
      typeof (data as { k?: unknown }).k === 'string'
    );
  } catch {
    return false;
  }
}

export function renderQrSvg(text: string): string {
  return renderSVG(text, { ecc: 'M', border: 2, pixelSize: 8 });
}

export function qrSvgDataUrl(text: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderQrSvg(text))}`;
}

/** Render the QR matrix to a PNG blob (for "download image"). */
export function renderQrPng(text: string, moduleSize = 8): Promise<Blob> {
  const { data } = encode(text, { ecc: 'M', border: 4 });
  const size = data.length * moduleSize;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) ctx.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize);
    })
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed'))),
      'image/png'
    )
  );
}

type ZxingReader = typeof import('zxing-wasm/reader');
let readerPromise: Promise<ZxingReader> | null = null;

async function loadReader(): Promise<ZxingReader> {
  if (!readerPromise) {
    readerPromise = Promise.all([
      import('zxing-wasm/reader'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ]).then(([reader, wasm]) => {
      const wasmUrl = wasm.default;
      reader.prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) =>
            path.endsWith('.wasm') ? wasmUrl : prefix + path,
        },
      });
      return reader;
    });
    readerPromise.catch(() => {
      readerPromise = null;
    });
  }
  return readerPromise;
}

/** Decode the first QR code in an image file or a camera frame. Null when none is found. */
export async function scanQr(input: Blob | ImageData): Promise<string | null> {
  const reader = await loadReader();
  const results = await reader.readBarcodes(input, {
    formats: ['QRCode'],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  const hit = results.find((r) => r.isValid && r.text);
  return hit ? hit.text : null;
}
