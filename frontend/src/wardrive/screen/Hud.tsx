// The heads-up display at the bottom of the wardrive screen: the direction
// arrow, the shown reception's signal (big, with its tier colour) and sender,
// SNR and age, the speed, the upload backlog, the target tools, Start/Stop and
// the drive counters. Readable at a glance from a phone in a holder.
import { Crosshair, EyeOff, Layers, PictureInPicture2, Plus } from 'lucide-react';

import { useCvdMode } from '../../hooks/useCvdColors';
import { useT, type TFn } from '../../i18n';
import { Button } from '../../components/ui/button';
import type { DistanceUnit } from '../../utils/distanceUnits';
import type { CaptureCounts } from '../capture';
import type { Stand } from '../filters';
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
  /** Where the sender is, relative to the way the driver faces; null draws none. */
  arrow: { angle: number; kind: 'advertised' | 'estimate' } | null;
  /** The sender line: `prefix + name`, or a note when nobody can be named. */
  sender: { prefix: string; name: string; note: string };
  onTargets(): void;
  onAddTarget(): void;
  onIgnore(): void;
  stand: Stand;
  onStand(s: Stand): void;
  /** The shown sender can be a target. */
  canTarget: boolean;
  /** The shown sender has an id to ignore. */
  canIgnore: boolean;
  /** dB added to the measured RSSI for its colour (calibration, attenuator). */
  rssiOffset?: number;
  /** The radio's noise floor (dBm), null when not read. */
  noiseFloor?: number | null;
  /** This browser can float the reading (float/floatModel.ts floatSupport). */
  canFloat?: boolean;
  floatOpen?: boolean;
  onFloat?(): void;
}

const TOOL =
  'flex h-8 items-center gap-1 rounded-full border border-border px-2.5 text-xs disabled:opacity-40';

function Arrow({ arrow }: { arrow: NonNullable<HudProps['arrow']> }) {
  const t = useT();
  const estimate = arrow.kind === 'estimate';
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-10 w-10 shrink-0 text-foreground"
      role="img"
      aria-label={t(estimate ? 'wardrive_page_hud_arrow_estimate' : 'wardrive_page_hud_arrow')}
      data-testid="wardrive-hud-arrow"
      data-kind={arrow.kind}
      fill={estimate ? 'none' : 'currentColor'}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      style={{ transform: `rotate(${arrow.angle}deg)` }}
    >
      <path d="M12 2 L20 21 L12 16 L4 21 Z" />
    </svg>
  );
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
  arrow,
  sender,
  onTargets,
  onAddTarget,
  onIgnore,
  stand,
  onStand,
  canTarget,
  canIgnore,
  rssiOffset = 0,
  noiseFloor = null,
  canFloat = false,
  floatOpen = false,
  onFloat,
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
        {arrow && Number.isFinite(arrow.angle) && <Arrow arrow={arrow} />}
        <div className="flex items-center gap-2">
          {/* The tier as a swatch; the digits stay in the text colour, readable on any theme. */}
          <span
            className="block h-10 w-2 rounded-full bg-muted"
            data-testid="wardrive-hud-tier"
            style={{
              backgroundColor: hasRssi ? tierColor(rssiTier(rssi, rssiOffset), cvd) : undefined,
            }}
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
          {rssiOffset !== 0 && (
            <span
              className="self-start rounded bg-muted px-1 text-xs tabular-nums"
              data-testid="wardrive-hud-offset"
              title={t('wardrive_page_hud_offset_title', { offset: rssiOffset })}
            >
              {rssiOffset > 0 ? `+${rssiOffset}` : String(rssiOffset)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1 truncate pb-1 text-sm" data-testid="wardrive-hud-sender">
          {!shown
            ? t('wardrive_page_hud_no_reception')
            : sender.name
              ? `${sender.prefix}${sender.name}`
              : sender.note}
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
        <span data-testid="wardrive-hud-noise">
          {noiseFloor !== null && Number.isFinite(noiseFloor)
            ? t('wardrive_page_hud_noise', { value: Math.round(noiseFloor) })
            : '-'}
        </span>
        <span>{shown ? formatAge(nowMs - shown.at, t) : '-'}</span>
        <span
          className="ml-auto text-base font-semibold text-foreground"
          title={t('wardrive_page_hud_speed')}
        >
          {formatSpeed(speedMps, unit)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={TOOL}
          aria-label={t('wardrive_page_hud_targets')}
          onClick={onTargets}
        >
          <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
          {t('wardrive_page_hud_targets')}
        </button>
        <button
          type="button"
          className={TOOL}
          aria-label={t('wardrive_page_hud_add_aria')}
          onClick={onAddTarget}
          disabled={!canTarget}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {/* Icon only on a narrow phone, so the tools keep one row. */}
          <span className="hidden min-[380px]:inline">{t('wardrive_page_hud_add')}</span>
        </button>
        <button
          type="button"
          className={TOOL}
          aria-label={t('wardrive_page_hud_ignore_aria')}
          onClick={onIgnore}
          disabled={!canIgnore}
        >
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          {/* Icon only on a narrow phone, so the tools keep one row. */}
          <span className="hidden min-[380px]:inline">{t('wardrive_page_hud_ignore')}</span>
        </button>
        {canFloat && (
          <button
            type="button"
            className={`${TOOL} ${floatOpen ? 'border-primary bg-primary text-primary-foreground' : ''}`}
            aria-label={t('wardrive_page_hud_float_aria')}
            aria-pressed={floatOpen}
            onClick={onFloat}
          >
            <PictureInPicture2 className="h-3.5 w-3.5" aria-hidden="true" />
            {/* Icon only on a narrow phone, so the tools keep one row. */}
            <span className="hidden min-[380px]:inline">{t('wardrive_page_hud_float')}</span>
          </button>
        )}
        <button
          type="button"
          className={`${TOOL} ml-auto ${stand === 'all' ? 'border-primary bg-primary text-primary-foreground' : ''}`}
          aria-label={t('wardrive_page_hud_all_aria')}
          aria-pressed={stand === 'all'}
          onClick={() => onStand(stand === 'all' ? 'filtered' : 'all')}
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          {t('wardrive_page_hud_all')}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {running ? (
          <Button type="button" variant="destructive" onClick={onStop}>
            {t('wardrive_page_stop')}
          </Button>
        ) : (
          <Button type="button" onClick={onStart} disabled={!canStart}>
            {t('wardrive_page_start')}
          </Button>
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
        {/* Its own line: squeezed between Start and the counters it wrapped
            into a narrow column on a phone. */}
        {!running && !canStart && startHint && (
          <span className="basis-full text-xs text-muted-foreground">{startHint}</span>
        )}
      </div>
    </section>
  );
}
