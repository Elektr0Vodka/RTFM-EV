/**
 * My Node > Live signal: the RSSI of every packet heard in the last few
 * minutes against the radio's noise floor.
 *
 * Packets come from the live feed the page already holds (no extra traffic);
 * the noise floor is the stored 60-second sample series, re-read once a
 * minute. Four meters sum it up: the last packet's RSSI, the current noise
 * floor, the strongest packet in the window, and how far the last packet sat
 * above the floor. Read-only: nothing here talks to the radio.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useT, type TFn } from '../../i18n';
import { cn } from '@/lib/utils';
import type { NoiseFloorSample, RawPacket } from '../../types';
import { typeColor } from './packetTypeColors';

const WINDOW_MINUTES = [2, 5, 15] as const;
const DEFAULT_WINDOW_MINUTES = 5;
const TICK_MS = 2000;
const NOISE_REFRESH_MS = 60_000;
// The noise floor is sampled once a minute; read a little before the window
// so the line starts at its left edge.
const NOISE_LEAD_SECONDS = 120;

// Chart geometry in viewBox units; the SVG scales to the card width.
const W = 600;
const H = 180;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 18;

export interface SignalPoint {
  t: number; // unix seconds
  rssi: number;
  snr: number | null;
  type: string;
}

export interface SignalSummary {
  points: SignalPoint[];
  last: SignalPoint | null;
  peak: number | null;
  floor: number | null;
  margin: number | null;
}

/** Packets with an RSSI inside the window, oldest first, and the four meter values. */
export function summarizeSignal(
  packets: RawPacket[],
  noise: NoiseFloorSample[],
  nowSec: number,
  windowSec: number
): SignalSummary {
  const start = nowSec - windowSec;
  const points = packets
    .filter((p) => p.rssi !== null && p.timestamp >= start && p.timestamp <= nowSec + 1)
    .map((p) => ({ t: p.timestamp, rssi: p.rssi as number, snr: p.snr, type: p.payload_type }))
    .sort((a, b) => a.t - b.t);
  const last = points.length > 0 ? points[points.length - 1] : null;
  const peak = points.length > 0 ? Math.max(...points.map((p) => p.rssi)) : null;
  const latestNoise = noise.reduce<NoiseFloorSample | null>(
    (best, s) => (s.timestamp <= nowSec && (!best || s.timestamp > best.timestamp) ? s : best),
    null
  );
  const floor = latestNoise ? latestNoise.noise_floor_dbm : null;
  const margin = last && floor !== null ? last.rssi - floor : null;
  return { points, last, peak, floor, margin };
}

function formatAge(seconds: number, t: TFn): string {
  if (seconds < 60) return t('node_signal_age_seconds', { seconds: Math.max(0, seconds) });
  return t('node_signal_age_minutes', { minutes: Math.floor(seconds / 60) });
}

function Meter({
  label,
  value,
  sub,
  title,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  title?: string;
  testId: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-md border border-border bg-background px-2.5 py-2"
      title={title}
      data-testid={testId}
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="text-base font-semibold tabular-nums text-foreground">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </div>
  );
}

export function LiveSignalCard({ packets }: { packets: RawPacket[] }) {
  const t = useT();
  const [windowMinutes, setWindowMinutes] = useState<number>(DEFAULT_WINDOW_MINUTES);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [noise, setNoise] = useState<NoiseFloorSample[]>([]);
  const windowSec = windowMinutes * 60;

  useEffect(() => {
    const timer = window.setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const end = Math.floor(Date.now() / 1000);
      api.getNoiseFloorHistory(end - windowSec - NOISE_LEAD_SECONDS, end).then(
        (samples) => {
          if (!cancelled) setNoise(samples);
        },
        () => {} // no noise floor: the chart shows packets only
      );
    };
    load();
    const timer = window.setInterval(load, NOISE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [windowSec]);

  const summary = useMemo(
    () => summarizeSignal(packets, noise, nowSec, windowSec),
    [packets, noise, nowSec, windowSec]
  );
  const { points, last, peak, floor, margin } = summary;

  const start = nowSec - windowSec;
  const values = [
    ...points.map((p) => p.rssi),
    ...noise.filter((s) => s.timestamp >= start - NOISE_LEAD_SECONDS).map((s) => s.noise_floor_dbm),
  ];
  const yMax = values.length > 0 ? Math.ceil((Math.max(...values) + 5) / 10) * 10 : -40;
  const yMin = values.length > 0 ? Math.floor((Math.min(...values) - 5) / 10) * 10 : -130;
  const x = (ts: number) => PAD_L + ((ts - start) / windowSec) * (W - PAD_L - PAD_R);
  const y = (dbm: number) => PAD_T + ((yMax - dbm) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);
  const yTicks: number[] = [];
  const step = yMax - yMin > 60 ? 20 : 10;
  for (let v = yMax; v >= yMin; v -= step) yTicks.push(v);

  // Noise floor as a step line: each sample holds until the next one.
  const noiseInView = noise
    .filter((s) => s.timestamp <= nowSec)
    .sort((a, b) => a.timestamp - b.timestamp);
  let noisePath = '';
  noiseInView.forEach((s, i) => {
    const next = noiseInView[i + 1];
    const x1 = Math.max(PAD_L, x(s.timestamp));
    const x2 = next ? Math.max(PAD_L, x(next.timestamp)) : W - PAD_R;
    if (x2 <= PAD_L) return;
    const yy = y(s.noise_floor_dbm);
    noisePath += `${noisePath ? 'L' : 'M'}${x1.toFixed(1)},${yy.toFixed(1)}H${x2.toFixed(1)}`;
  });

  const types = Array.from(new Set(points.map((p) => p.type))).sort();
  const dbm = (v: number | null) => (v === null ? '-' : t('node_signal_dbm', { value: v }));

  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card"
      data-testid="live-signal"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-foreground">{t('node_signal_title')}</span>
        <div className="flex gap-1" role="group" aria-label={t('node_signal_window_label')}>
          {WINDOW_MINUTES.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={windowMinutes === minutes}
              onClick={() => setWindowMinutes(minutes)}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                windowMinutes === minutes
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {t('node_signal_window_minutes', { minutes })}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Meter
            testId="live-signal-last"
            label={t('node_signal_last')}
            value={dbm(last?.rssi ?? null)}
            sub={
              last
                ? last.snr !== null
                  ? t('node_signal_last_sub', {
                      snr: last.snr,
                      age: formatAge(nowSec - last.t, t),
                    })
                  : formatAge(nowSec - last.t, t)
                : undefined
            }
          />
          <Meter testId="live-signal-floor" label={t('node_signal_floor')} value={dbm(floor)} />
          <Meter testId="live-signal-peak" label={t('node_signal_peak')} value={dbm(peak)} />
          <Meter
            testId="live-signal-margin"
            label={t('node_signal_margin')}
            value={margin === null ? '-' : t('node_signal_db', { value: margin })}
            title={t('node_signal_margin_title')}
          />
        </div>

        {points.length === 0 && noiseInView.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{t('node_signal_empty')}</p>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={t('node_signal_chart_label', { count: points.length })}
          >
            {yTicks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="hsl(var(--border))"
                  strokeWidth={0.5}
                />
                <text
                  x={PAD_L - 4}
                  y={y(v) + 3}
                  textAnchor="end"
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                >
                  {v}
                </text>
              </g>
            ))}
            {noisePath && (
              <path
                d={noisePath}
                fill="none"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                data-testid="live-signal-noise-line"
              />
            )}
            {points.map((p, i) => (
              <circle
                key={`${p.t}-${i}`}
                cx={x(p.t)}
                cy={y(p.rssi)}
                r={3}
                fill={typeColor(p.type)}
                fillOpacity={0.85}
              >
                <title>
                  {t('node_signal_point_title', {
                    type: p.type,
                    rssi: p.rssi,
                    snr: p.snr ?? '-',
                    age: formatAge(nowSec - p.t, t),
                  })}
                </title>
              </circle>
            ))}
            <text
              x={PAD_L}
              y={H - 4}
              fontSize={9}
              fill="hsl(var(--muted-foreground))"
              textAnchor="start"
            >
              {t('node_signal_window_minutes_ago', { minutes: windowMinutes })}
            </text>
            <text
              x={W - PAD_R}
              y={H - 4}
              fontSize={9}
              fill="hsl(var(--muted-foreground))"
              textAnchor="end"
            >
              {t('node_signal_now')}
            </text>
          </svg>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {types.map((type) => (
            <span key={type} className="flex items-center gap-1">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: typeColor(type) }}
              />
              {type}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <svg width="16" height="6" aria-hidden>
              <line
                x1="0"
                x2="16"
                y1="3"
                y2="3"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            </svg>
            {t('node_signal_noise_legend')}
          </span>
        </div>
      </div>
    </div>
  );
}
