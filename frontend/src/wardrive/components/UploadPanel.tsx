// The upload to RTFM-EV, on the menu's Status tab: its state and what waits.
// Start/Stop and the drive counters live in the HUD; another account's
// waiting receptions show as a banner.
import { useT } from '../../i18n';
import type { UploadStatus } from '../uploader';

export function UploadPanel({ upload }: { upload: UploadStatus | null }) {
  const t = useT();
  if (!upload) return null;
  const line = (() => {
    switch (upload.state) {
      case 'idle':
        return t('wardrive_page_upload_idle');
      case 'uploading':
        return t('wardrive_page_upload_uploading');
      case 'offline':
        return t('wardrive_page_upload_offline');
      case 'logged-out':
        return t('wardrive_page_upload_logged_out');
      case 'error':
        return t('wardrive_page_upload_error', { error: upload.lastError ?? '?' });
    }
  })();
  return (
    <section className="space-y-1 rounded-md border border-border p-3 text-sm">
      <h2 className="text-base font-semibold">{t('wardrive_page_drive_heading')}</h2>
      <p>{line}</p>
      <p className="text-xs text-muted-foreground">
        {t('wardrive_page_pending', { obs: upload.pendingObs, tracks: upload.pendingTracks })}
      </p>
      {upload.setAside > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('wardrive_page_set_aside', { count: upload.setAside })}
        </p>
      )}
    </section>
  );
}
