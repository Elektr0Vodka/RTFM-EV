import { useEffect, useState } from 'react';

import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { TakStreamStatusResponse } from '../../types';

/**
 * Read-only status of the TAK Stream (CoT over TCP for ATAK / WinTAK). It is
 * turned on with an environment variable on the server, so there is no switch here.
 */
export function TakStreamStatus() {
  const t = useT();
  const [status, setStatus] = useState<TakStreamStatusResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getTakStreamStatus(controller.signal)
      .then(setStatus)
      .catch((err) => {
        if (!isAbortError(err)) console.error('Failed to load TAK Stream status:', err);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-3" data-testid="tak-stream-status">
      <h3 className="text-base font-semibold tracking-tight">{t('tak_stream_title')}</h3>
      {status &&
        (status.enabled ? (
          <p className="text-[0.8125rem]">
            {t('tak_stream_running', { port: status.port ?? '', clients: status.clients })}
          </p>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t('tak_stream_off_hint')}</p>
        ))}
      <p className="text-[0.8125rem] text-muted-foreground">{t('tak_stream_help')}</p>
    </div>
  );
}
