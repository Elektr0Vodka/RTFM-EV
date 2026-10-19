// The heads-up display at the bottom of the wardrive screen: the shown
// reception's signal (big, in its tier colour), SNR and age, the speed, the
// upload backlog, Start/Stop and the drive counters. Readable at a glance from
// a phone in a holder.
import { useCvdMode } from '../../hooks/useCvdColors';
import { useT, type TFn } from '../../i18n';
import { Button } from '../../components/ui/button';
import type { DistanceUnit } from '../../utils/distanceUnits';
import type { CaptureCounts } from '../capture';
import type { LiveEntry } from '../liveLog';
import { rssiTier, tierColor } from '../signal';
import { formatSpeed } from '../speed';

/** A backlog this large is worth showing; from ALARM it is a warning. */
const BACKLOG_SHOW = 25;
const BACKLOG_ALARM = 250;

export interface HudProps {
  shown: LiveEntry | null;
  nowMs: number;
  speedMps: number | null;
  unit: DistanceUnit;
  pending: number;
  running: boolean;
  canStart: boolean;
  /** Why Start is not possible yet (shown under the button), when it is not. */
  startHint?: string | null;
  counts: CaptureCounts;
  onStart(): void;
  onStop(): void;
}

export function formatAge(ms: number, t: TFn): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t('wardrive_page_hud_age_s', { seconds: s });
  if (s < 3600) return t('wardrive_page_hud_age_m', { minutes: Math.floor(s / 60) });
  return t('wardrive_page_hud_age_h', { hours: Math.floor(s / 3600) });
}

function Counter({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="flex flex-col items-center leading-tight">
      <span className="text-base font-semibold tabular-nums" data-testid={testId}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

export function Hud({
  shown,
  nowMs,
  speedMps,
  unit,
  pending,
  running,
  canStart,
  startHint = null,
  counts,
  onStart,
  onStop,
}: HudProps) {
  const t = useT();
  const cvd = useCvdMode() !== 'off';
  const rssi = shown?.rssi ?? null;
  const hasRssi = rssi !== null && Number.isFinite(rssi);
  const snr = shown?.snr ?? null;
  const hasSnr = snr !== null && Number.isFinite(snr);

  return (
    <section
      className="rounded-t-2xl border border-border bg-card/95 px-4 pb-3 pt-2 shadow-lg backdrop-blur"
      aria-label={t('wardrive_page_hud_rssi')}
    >
      <div className="flex items-end gap-3">
        <div className="flex items-center gap-2">
          {/* The tier as a swatch; the digits stay in the text colour, readable on any theme. */}
          <span
            className="block h-10 w-2 rounded-full bg-muted"
            data-testid="wardrive-hud-tier"
            style={{ backgroundColor: hasRssi ? tierColor(rssiTier(rssi), cvd) : undefined }}
            aria-hidden="true"
          />
          <span
            className="text-5xl font-bold tabular-nums leading-none"
            data-testid="wardrive-hud-rssi"
          >
            {hasRssi ? Math.round(rssi) : '-'}
          </span>
          <span className="self-end text-xs text-muted-foreground">
            {t('wardrive_page_hud_dbm')}
          </span>
        </div>
        <div className="min-w-0 flex-1 truncate pb-1 text-sm">
          {shown ? shown.typeName : t('wardrive_page_hud_no_reception')}
        </div>
        {pending >= BACKLOG_SHOW && (
          <span
            className={
              pending >= BACKLOG_ALARM
                ? 'rounded-full bg-destructive px-2 py-0.5 text-xs text-destructive-foreground'
                : 'rounded-full bg-muted px-2 py-0.5 text-xs'
            }
            data-testid="wardrive-hud-backlog"
            data-alarm={pending >= BACKLOG_ALARM ? 'true' : 'false'}
          >
            {t('wardrive_page_hud_backlog', { count: pending })}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-4 text-sm tabular-nums text-muted-foreground">
        <span>{hasSnr ? t('wardrive_page_hud_snr', { value: snr.toFixed(1) }) : '-'}</span>
        <span>{shown ? formatAge(nowMs - shown.at, t) : '-'}</span>
        <span
          className="ml-auto text-base font-semibold text-foreground"
          title={t('wardrive_page_hud_speed')}
        >
          {formatSpeed(speedMps, unit)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        {running ? (
          <Button type="button" variant="destructive" onClick={onStop}>
            {t('wardrive_page_stop')}
          </Button>
        ) : (
          <Button type="button" onClick={onStart} disabled={!canStart}>
            {t('wardrive_page_start')}
          </Button>
        )}
        {!running && !canStart && startHint && (
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">{startHint}</span>
        )}
        <div className="ml-auto flex gap-4">
          <Counter label={t('wardrive_page_heard')} value={counts.heard} testId="wardrive-heard" />
          <Counter
            label={t('wardrive_page_stored')}
            value={counts.stored}
            testId="wardrive-stored"
          />
          <Counter
            label={t('wardrive_page_no_position')}
            value={counts.noPosition}
            testId="wardrive-no-position"
          />
        </div>
      </div>
    </section>
  );
}
