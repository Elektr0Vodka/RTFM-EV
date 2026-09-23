import { useT } from '../../i18n';
import { DateTimeField } from '../../components/DateTimeField';
import { LINK_AGE_CUSTOM_ID } from '../linkAge';

export interface LinkAgePresetOption {
  id: string;
  labelKey: string;
  seconds: number | null;
}

interface LinkAgeControlProps {
  follow: boolean;
  onFollow: (follow: boolean) => void;
  presets: LinkAgePresetOption[];
  presetId: string;
  onPreset: (id: string) => void;
  customFrom: string;
  onCustomFrom: (v: string) => void;
  customUntil: string;
  onCustomUntil: (v: string) => void;
}

/** Link-age window for the advert/traffic link layers. Follows the map's node
 *  time filter unless the user switches to an own preset or From/To range. */
export function LinkAgeControl({
  follow,
  onFollow,
  presets,
  presetId,
  onPreset,
  customFrom,
  onCustomFrom,
  customUntil,
  onCustomUntil,
}: LinkAgeControlProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{t('map_link_age_label')}</span>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={follow} onChange={(e) => onFollow(e.target.checked)} />
        {t('map_link_age_follow')}
      </label>
      {!follow && (
        <>
          <div role="group" aria-label={t('map_link_age_label')} className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={presetId === p.id}
                className={
                  'rounded px-2 py-1 text-xs ' +
                  (presetId === p.id
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-muted text-muted-foreground')
                }
                onClick={() => onPreset(p.id)}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
          {/* A <div>, not a <label>: DateTimeField is composite (see MapView's
              since panel for why a wrapping label breaks date picking). */}
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <span>{t('map_custom_button')}</span>
            <div className="flex flex-col gap-1">
              <span>{t('time_range_from')}</span>
              <DateTimeField
                mode="datetime"
                fullWidth
                value={customFrom}
                aria-label={t('map_link_age_from_aria')}
                onChange={(v) => {
                  onCustomFrom(v);
                  onPreset(LINK_AGE_CUSTOM_ID);
                }}
                className="rounded border border-border bg-background px-2 py-1 pr-7 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span>{t('time_range_to')}</span>
              <DateTimeField
                mode="datetime"
                fullWidth
                value={customUntil}
                aria-label={t('map_link_age_until_aria')}
                onChange={(v) => {
                  onCustomUntil(v);
                  onPreset(LINK_AGE_CUSTOM_ID);
                }}
                className="rounded border border-border bg-background px-2 py-1 pr-7 text-sm"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
