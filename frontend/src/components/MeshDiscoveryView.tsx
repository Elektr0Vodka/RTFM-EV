import { useState } from 'react';

import type { HealthStatus, RadioDiscoveryResponse, RadioDiscoveryTarget } from '../types';
import { useT } from '../i18n';
import { Button } from './ui/button';

// Standalone Tools view for the mesh discovery sweep that used to live in
// Settings > Radio. Sweep state lives in useRadioControl so the last result
// survives navigation and stays available to Settings > Radio region discovery.
export function MeshDiscoveryView({
  health,
  meshDiscovery,
  meshDiscoveryLoadingTarget,
  onDiscoverMesh,
}: {
  health: HealthStatus | null;
  meshDiscovery: RadioDiscoveryResponse | null;
  meshDiscoveryLoadingTarget: RadioDiscoveryTarget | null;
  onDiscoverMesh: (target: RadioDiscoveryTarget) => Promise<void>;
}) {
  const t = useT();
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  const handleDiscover = async (target: RadioDiscoveryTarget) => {
    setDiscoverError(null);
    try {
      await onDiscoverMesh(target);
    } catch (err) {
      setDiscoverError(
        err instanceof Error ? err.message : t('settings_radio_failed_mesh_discovery')
      );
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="font-semibold text-base text-foreground">{t('nav_mesh_discovery')}</h2>
        <p className="hidden md:block text-xs text-muted-foreground">
          {t('settings_radio_mesh_discovery_desc')}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-3">
          <p className="text-[0.8125rem] text-muted-foreground md:hidden">
            {t('settings_radio_mesh_discovery_desc')}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { target: 'repeaters', label: t('settings_radio_discover_repeaters_button') },
              { target: 'sensors', label: t('settings_radio_discover_sensors_button') },
              { target: 'all', label: t('settings_radio_discover_both_button') },
            ].map(({ target, label }) => (
              <Button
                key={target}
                type="button"
                variant="outline"
                onClick={() => handleDiscover(target as RadioDiscoveryTarget)}
                disabled={meshDiscoveryLoadingTarget !== null || !health?.radio_connected}
                className="w-full"
              >
                {meshDiscoveryLoadingTarget === target ? t('settings_radio_listening') : label}
              </Button>
            ))}
          </div>
          {!health?.radio_connected && (
            <p className="text-sm text-destructive">{t('settings_radio_not_connected')}</p>
          )}
          {discoverError && (
            <p className="text-sm text-destructive" role="alert">
              {discoverError}
            </p>
          )}
          {meshDiscovery && (
            <div className="space-y-2 rounded-md border border-input bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium">
                  {t('settings_radio_last_sweep', { count: meshDiscovery.results.length })}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('settings_radio_listen_window', {
                    duration: meshDiscovery.duration_seconds.toFixed(0),
                  })}
                </p>
              </div>
              {meshDiscovery.results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('settings_radio_no_nodes_responded')}
                </p>
              ) : (
                <div className="space-y-2">
                  {meshDiscovery.results.map((result) => (
                    <div
                      key={result.public_key}
                      className="rounded-md border border-input bg-background px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium">
                          {result.name ?? <span className="capitalize">{result.node_type}</span>}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t('settings_radio_heard_count', { count: result.heard_count })}
                        </span>
                      </div>
                      {result.name && (
                        <p className="text-xs capitalize text-muted-foreground">
                          {result.node_type}
                        </p>
                      )}
                      <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                        {result.public_key}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('settings_radio_heard_here', {
                          localSnr: result.local_snr ?? t('settings_radio_na'),
                          localRssi: result.local_rssi ?? t('settings_radio_na'),
                          remoteSnr: result.remote_snr ?? t('settings_radio_na'),
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
