/**
 * Contact page > Fleet: whether this node is in the fleet asset register, a
 * button to add it, and a link to its asset. Stored data only.
 */
import { useEffect, useState } from 'react';
import { api, isAbortError } from '../../api';
import { useT } from '../../i18n';
import type { FleetAsset } from '../../types';
import { Button } from '../ui/button';
import { FleetStatusBadge } from './fleetShared';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ContactFleetSection({
  publicKey,
  onOpenFleetAsset,
}: {
  publicKey: string;
  /** Opens the asset's page. Absent where that page cannot be reached (chat window). */
  onOpenFleetAsset?: (assetId: number) => void;
}) {
  const t = useT();
  // undefined = not loaded yet, null = this node has no asset.
  const [asset, setAsset] = useState<FleetAsset | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    setAsset(undefined);
    setError(null);
    const controller = new AbortController();
    api
      .fleetAssetForKey(publicKey, controller.signal)
      .then(setAsset)
      .catch((err) => {
        if (!isAbortError(err)) setError(errorMessage(err));
      });
    return () => controller.abort();
  }, [publicKey]);

  const add = async () => {
    setAdding(true);
    setError(null);
    try {
      const result = await api.addFleetAssetsFromContacts([publicKey]);
      // Nothing created means another browser added it in the meantime.
      setAsset(result.created[0] ?? (await api.fleetAssetForKey(publicKey)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  if (asset === undefined && !error) return null;

  return (
    <div className="space-y-2 border-b border-border px-5 py-3" data-testid="contact-fleet">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('nav_fleet')}
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {t('fleet_contact_failed', { error })}
        </p>
      )}
      {asset === null && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('fleet_contact_none')}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            data-testid="contact-fleet-add"
            disabled={adding}
            onClick={() => void add()}
          >
            {t('fleet_contact_add')}
          </Button>
        </div>
      )}
      {asset && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground">{t('fleet_contact_in')}</span>
          <FleetStatusBadge status={asset.status} />
          {asset.org_serial && (
            <span className="font-mono text-xs text-muted-foreground">{asset.org_serial}</span>
          )}
          {onOpenFleetAsset && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              data-testid="contact-fleet-open"
              onClick={() => onOpenFleetAsset(asset.id)}
            >
              {t('fleet_contact_open')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
