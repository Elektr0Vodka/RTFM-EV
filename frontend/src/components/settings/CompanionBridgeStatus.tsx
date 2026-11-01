import { useEffect, useState } from 'react';

import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { CompanionBridgeStatusResponse } from '../../types';

/**
 * Read-only status of the companion bridge (MeshCore companion apps over TCP).
 * It is turned on with an environment variable on the server, so there is no
 * switch here.
 */
export function CompanionBridgeStatus() {
  const t = useT();
  const [status, setStatus] = useState<CompanionBridgeStatusResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .getCompanionBridgeStatus(controller.signal)
      .then(setStatus)
      .catch((err) => {
        if (!isAbortError(err)) console.error('Failed to load companion bridge status:', err);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-3" data-testid="companion-bridge-status">
      <h3 className="text-base font-semibold tracking-tight">{t('companion_bridge_title')}</h3>
      {status &&
        (status.enabled ? (
          <>
            <p className="text-[0.8125rem]">
              {t('companion_bridge_running', {
                host: status.host ?? '',
                port: status.port ?? '',
                clients: status.clients.length,
              })}
            </p>
            {!status.allow_send && (
              <p className="text-[0.8125rem] text-muted-foreground">
                {t('companion_bridge_read_only')}
              </p>
            )}
            {status.clients.length > 0 && (
              <ul className="text-[0.8125rem] text-muted-foreground list-disc pl-5">
                {status.clients.map((client) => (
                  <li key={`${client.address}-${client.connected_at}`}>
                    {client.app_name
                      ? t('companion_bridge_client_named', {
                          app: client.app_name,
                          address: client.address,
                        })
                      : client.address}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">{t('companion_bridge_off_hint')}</p>
        ))}
      <p className="text-[0.8125rem] text-muted-foreground">{t('companion_bridge_help')}</p>
    </div>
  );
}
