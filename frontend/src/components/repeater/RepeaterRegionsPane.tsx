import { useState } from 'react';
import { RepeaterPane, NotFetched } from './repeaterPaneShared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useT } from '../../i18n';
import type { RepeaterRegionsResponse, PaneState } from '../../types';

export function RegionsPane({
  data,
  state,
  onRefresh,
  disabled,
  onSeedKnownRegions,
}: {
  data: RepeaterRegionsResponse | null;
  state: PaneState;
  onRefresh: () => void;
  disabled?: boolean;
  // Merge this repeater's reported region codes into known_regions. Returns the
  // number of new codes added. Omitted when the caller cannot persist settings.
  onSeedKnownRegions?: (codes: string[]) => Promise<number>;
}) {
  const t = useT();
  const [seeding, setSeeding] = useState(false);
  const headerNote = data?.truncated
    ? t('repeater_regions_truncated')
    : data?.source === 'anon'
      ? t('repeater_regions_guest_view')
      : t('repeater_regions_header_note');

  // Named regions only; the wildcard `*` is not a nameable region to seed.
  const seedableCodes = (data?.regions ?? [])
    .map((r) => r.name)
    .filter((name) => name && name !== '*');

  const handleSeed = async () => {
    if (!onSeedKnownRegions || seedableCodes.length === 0) return;
    setSeeding(true);
    try {
      const added = await onSeedKnownRegions(seedableCodes);
      if (added > 0) {
        toast.success(t('repeater_regions_seed_added', { count: added }));
      } else {
        toast.info(t('repeater_regions_seed_none_new'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('repeater_regions_seed_failed'));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <RepeaterPane
      title={t('repeater_regions_title')}
      state={state}
      onRefresh={onRefresh}
      disabled={disabled}
      headerNote={headerNote}
    >
      {!data ? (
        <NotFetched />
      ) : data.regions.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          {t('repeater_regions_none_returned')}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="space-y-0.5">
            {data.regions.map((region, index) => (
              <div
                key={`${region.depth}-${region.name}-${index}`}
                className="flex items-center gap-2 text-sm py-0.5"
                style={{ paddingLeft: `${region.depth * 0.9}rem` }}
              >
                <span className="font-mono truncate">
                  {region.name === '*' ? t('repeater_regions_all_regions') : region.name}
                </span>
                {region.is_home && (
                  <span className="text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                    {t('repeater_regions_home_badge')}
                  </span>
                )}
                <span
                  className={cn(
                    'ml-auto shrink-0 text-[0.625rem] uppercase tracking-wider px-1.5 py-0.5 rounded',
                    region.flood_allowed
                      ? 'bg-success/15 text-success'
                      : 'bg-muted text-muted-foreground'
                  )}
                  title={
                    region.flood_allowed
                      ? t('repeater_regions_flood_allowed_tooltip')
                      : t('repeater_regions_flood_blocked_tooltip')
                  }
                >
                  {region.flood_allowed
                    ? t('repeater_flood_label')
                    : t('repeater_regions_blocked_badge')}
                </span>
              </div>
            ))}
          </div>
          {onSeedKnownRegions && seedableCodes.length > 0 && (
            <div className="space-y-1 border-t border-border/50 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={handleSeed}
                disabled={seeding}
              >
                {seeding
                  ? t('repeater_regions_seed_button_loading')
                  : t('repeater_regions_seed_button')}
              </Button>
              <p className="text-[0.6875rem] text-muted-foreground">
                {t('repeater_regions_seed_desc')}
              </p>
            </div>
          )}
        </div>
      )}
    </RepeaterPane>
  );
}
