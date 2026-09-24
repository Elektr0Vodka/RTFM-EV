import { useState } from 'react';

import type {
  HealthStatus,
  RadioDiscoveryResponse,
  RadioDiscoveryTarget,
  RadioRegionDiscoveryResponse,
} from '../types';
import { useT } from '../i18n';
import { Button } from './ui/button';
import { toast } from './ui/sonner';

// Standalone Tools view for the mesh discovery sweep and repeater region
// discovery, both of which used to live in Settings > Radio. Sweep and region
// state live in useRadioControl so the last results survive navigation, and
// region discovery prefers repeaters from the last sweep.
export function MeshDiscoveryView({
  health,
  meshDiscovery,
  meshDiscoveryLoadingTarget,
  onDiscoverMesh,
  regionDiscovery = null,
  regionDiscoveryLoading = false,
  onDiscoverRegions,
  onSeedKnownRegions,
}: {
  health: HealthStatus | null;
  meshDiscovery: RadioDiscoveryResponse | null;
  meshDiscoveryLoadingTarget: RadioDiscoveryTarget | null;
  onDiscoverMesh: (target: RadioDiscoveryTarget) => Promise<void>;
  regionDiscovery?: RadioRegionDiscoveryResponse | null;
  regionDiscoveryLoading?: boolean;
  onDiscoverRegions?: (publicKeys?: string[]) => Promise<void>;
  onSeedKnownRegions?: (codes: string[]) => Promise<number>;
}) {
  const t = useT();
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [seedingRegions, setSeedingRegions] = useState(false);

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

  const handleDiscoverRegions = async () => {
    if (!onDiscoverRegions) return;
    // Prefer repeaters from the most recent mesh-discovery sweep (they just
    // answered, so they're likely in range for the direct-routed regions
    // request); otherwise let the backend pick recent repeater contacts.
    const discoveredRepeaterKeys = (meshDiscovery?.results ?? [])
      .filter((r) => r.node_type === 'repeater')
      .map((r) => r.public_key);
    await onDiscoverRegions(discoveredRepeaterKeys);
  };

  // Merges the discovered regions into known_regions and persists right away
  // (there is no unsaved form on this page to review them in).
  const handleAddDiscoveredRegions = async () => {
    if (!onSeedKnownRegions || !regionDiscovery || regionDiscovery.regions.length === 0) return;
    setSeedingRegions(true);
    try {
      const added = await onSeedKnownRegions(regionDiscovery.regions);
      if (added > 0) {
        toast.success(t('repeater_regions_seed_added', { count: added }));
      } else {
        toast.info(t('settings_radio_toast_regions_already_listed'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('repeater_regions_seed_failed'));
    } finally {
      setSeedingRegions(false);
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
          {onDiscoverRegions && (
            <div className="space-y-2 rounded-md border border-input bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[0.625rem] uppercase tracking-wider text-muted-foreground font-medium">
                  {t('settings_radio_discover_regions_label')}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDiscoverRegions}
                  disabled={regionDiscoveryLoading || !health?.radio_connected}
                >
                  {regionDiscoveryLoading
                    ? t('settings_radio_asking_repeaters')
                    : t('settings_radio_discover_regions_button')}
                </Button>
              </div>
              <p className="text-[0.8125rem] text-muted-foreground">
                {t('settings_radio_discover_regions_desc')}
              </p>
              {regionDiscovery && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {t('settings_radio_repeaters_answered', {
                      count: regionDiscovery.repeaters_queried,
                      answered: regionDiscovery.repeaters_answered,
                      queried: regionDiscovery.repeaters_queried,
                    })}
                    {regionDiscovery.regions.length > 0
                      ? t('settings_radio_regions_found_suffix', {
                          count: regionDiscovery.regions.length,
                        })
                      : ''}
                  </p>
                  {regionDiscovery.regions.length > 0 ? (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {regionDiscovery.regions.map((region) => (
                          <span
                            key={region}
                            className="text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 font-mono"
                          >
                            {region}
                          </span>
                        ))}
                      </div>
                      {onSeedKnownRegions && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleAddDiscoveredRegions}
                          disabled={seedingRegions}
                          className="border-success/50 text-success hover:bg-success/10"
                        >
                          {seedingRegions
                            ? t('repeater_regions_seed_button_loading')
                            : t('settings_radio_add_known_regions_button')}
                        </Button>
                      )}
                    </>
                  ) : (
                    regionDiscovery.repeaters_queried > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {t('settings_radio_no_regions_reported')}
                      </p>
                    )
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
