import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { toast } from '../components/ui/sonner';
import { useT } from '../i18n';
import { BasemapLoadError } from './basemapCapture';
import { getHidePosition, setHidePosition } from './hidePosition';
import { copyPng, downloadBlob, getShareCapabilities, shareFile } from './shareActions';
import type { LatLon } from './geo';

// The framing map pulls in MapLibre: only loaded when a card is framed.
const FramingMap = lazy(() => import('./FramingMap'));

/** A view framed on the dialog's map, in the card's map area. */
export interface CardFrame {
  center: LatLon;
  zoom: number;
}

export interface ShareBuildOptions {
  hidePosition: boolean;
  noMap: boolean;
  flags: Record<string, boolean>;
  /** The framed view; null (or absent) fits the card's data. */
  view?: CardFrame | null;
}

export interface ShareCardResult {
  png: Blob;
  /** Absent for cards without an animation. */
  gif?: (signal?: AbortSignal) => Promise<Blob>;
  /** File name without extension, e.g. "rtfm-ev-message-2026-10-18-2114". */
  filenameBase: string;
  /** Accessible description of the preview. */
  alt: string;
  /** Passed to the system share sheet. */
  shareTitle: string;
}

export interface ShareToggle {
  key: string;
  label: string;
  defaultOn: boolean;
}

type Phase = 'building' | 'ready' | 'map-error' | 'error';
type GifState = 'none' | 'making' | 'ready' | 'failed';

function useObjectUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

/**
 * The one dialog every share card uses: preview, then Share / Copy image /
 * Download. The preview is exactly the file that leaves the browser.
 */
export function ShareCardDialog({
  open,
  onClose,
  title,
  supportsHidePosition,
  toggles = [],
  framing,
  build,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  supportsHidePosition: boolean;
  toggles?: ShareToggle[];
  /** Map cards that may be framed by hand: the points the card shows. */
  framing?: { located: LatLon[] };
  build: (opts: ShareBuildOptions) => Promise<ShareCardResult>;
}) {
  const t = useT();
  const caps = useMemo(() => getShareCapabilities(), []);
  const buildRef = useRef(build);
  buildRef.current = build;

  const [hidePosition, setHide] = useState(() => supportsHidePosition && getHidePosition());
  const [noMap, setNoMap] = useState(false);
  const [view, setView] = useState<CardFrame | null>(null);
  const [framingOpen, setFramingOpen] = useState(false);
  const [flags, setFlags] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(toggles.map((tg) => [tg.key, tg.defaultOn]))
  );
  const [phase, setPhase] = useState<Phase>('building');
  const [result, setResult] = useState<ShareCardResult | null>(null);
  const [gifState, setGifState] = useState<GifState>('none');
  const [gifBlob, setGifBlob] = useState<Blob | null>(null);

  const pngUrl = useObjectUrl(result?.png ?? null);
  const gifUrl = useObjectUrl(gifBlob);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    setPhase('building');
    setResult(null);
    setGifBlob(null);
    setGifState('none');
    buildRef
      .current({ hidePosition, noMap, flags, view })
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setPhase('ready');
        if (!res.gif) return;
        setGifState('making');
        res.gif(controller.signal).then(
          (blob) => {
            if (cancelled) return;
            setGifBlob(blob);
            setGifState('ready');
          },
          () => {
            if (!cancelled) setGifState('failed');
          }
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPhase(err instanceof BasemapLoadError ? 'map-error' : 'error');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, hidePosition, noMap, flags, view]);

  const pngFile = result
    ? new File([result.png], `${result.filenameBase}.png`, { type: 'image/png' })
    : null;
  const gifFile =
    result && gifBlob
      ? new File([gifBlob], `${result.filenameBase}.gif`, { type: 'image/gif' })
      : null;
  const shareTarget = gifFile ?? pngFile;
  const canShare = !!shareTarget && caps.canShareFiles(shareTarget);

  const onShare = async () => {
    if (!shareTarget || !result) return;
    try {
      await shareFile(shareTarget, result.shareTitle);
    } catch {
      toast.error(t('share_error'));
    }
  };
  const onCopy = async () => {
    if (!result) return;
    try {
      await copyPng(result.png);
      toast.success(t('share_copied'));
    } catch {
      toast.error(t('share_copy_failed'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-2xl max-h-[90dvh] flex flex-col gap-3 overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('share_dialog_description')}</DialogDescription>
        </DialogHeader>

        <div className="relative w-full overflow-hidden rounded border border-border bg-muted/30 aspect-[1200/630]">
          {(gifUrl ?? pngUrl) && result ? (
            <img
              src={gifUrl ?? pngUrl ?? ''}
              alt={result.alt}
              className="h-full w-full object-contain"
            />
          ) : null}
          {phase === 'building' && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {t('share_making_image')}
            </div>
          )}
          {phase === 'map-error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-sm">
              <p>{t('share_map_failed')}</p>
              <Button type="button" variant="outline" onClick={() => setNoMap(true)}>
                {t('share_without_map')}
              </Button>
            </div>
          )}
          {phase === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-destructive">
              {t('share_error')}
            </div>
          )}
        </div>

        {gifState === 'making' && (
          <p className="text-xs text-muted-foreground" role="status">
            {t('share_making_animation')}
          </p>
        )}
        {gifState === 'failed' && (
          <p className="text-xs text-muted-foreground" role="status">
            {t('share_animation_failed')}
          </p>
        )}

        {framing && !hidePosition && framing.located.length > 0 && (
          <div className="space-y-2">
            {framingOpen ? (
              <Suspense fallback={null}>
                <FramingMap
                  located={framing.located}
                  onUse={(v) => {
                    setView(v);
                    setFramingOpen(false);
                  }}
                  onCancel={() => setFramingOpen(false)}
                />
              </Suspense>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setFramingOpen(true)}
                >
                  {t('share_frame_open')}
                </Button>
                {view && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setView(null)}>
                    {t('share_frame_fit')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {(supportsHidePosition || toggles.length > 0) && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {supportsHidePosition && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={hidePosition}
                  onChange={(e) => {
                    setHide(e.target.checked);
                    setHidePosition(e.target.checked);
                  }}
                />
                {t('share_hide_position')}
              </label>
            )}
            {toggles.map((tg) => (
              <label key={tg.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!flags[tg.key]}
                  onChange={(e) => setFlags((f) => ({ ...f, [tg.key]: e.target.checked }))}
                />
                {tg.label}
              </label>
            ))}
          </div>
        )}

        {!caps.secure && (
          <p className="text-xs text-muted-foreground">{t('share_insecure_note')}</p>
        )}

        {phase === 'ready' && result && (
          <div className="flex flex-wrap gap-2">
            {canShare && (
              <Button type="button" onClick={() => void onShare()}>
                {t('share_btn_share')}
              </Button>
            )}
            {caps.canCopyImage && (
              <Button type="button" variant="outline" onClick={() => void onCopy()}>
                {t('share_btn_copy')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadBlob(result.png, `${result.filenameBase}.png`)}
            >
              {t('share_btn_download_png')}
            </Button>
            {gifBlob && (
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadBlob(gifBlob, `${result.filenameBase}.gif`)}
              >
                {t('share_btn_download_gif')}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
