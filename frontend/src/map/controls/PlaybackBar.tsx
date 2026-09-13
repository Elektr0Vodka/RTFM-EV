import { useCallback, type KeyboardEvent } from 'react';
import { Play, Pause, Radio } from 'lucide-react';
import { useT } from '../../i18n';
import { SPEEDS } from '../packets/packetAnimMath';
import type { PlaybackSnapshot } from '../packets/playbackController';

export interface LookbackOption {
  ms: number;
  labelKey: string;
}

export const LOOKBACK_OPTIONS: LookbackOption[] = [
  { ms: 15 * 60 * 1000, labelKey: 'map_lookback_15m' },
  { ms: 60 * 60 * 1000, labelKey: 'map_lookback_1h' },
  { ms: 6 * 60 * 60 * 1000, labelKey: 'map_lookback_6h' },
  { ms: Number.MAX_SAFE_INTEGER, labelKey: 'map_lookback_all' },
];

export interface PlaybackBarProps {
  snapshot: PlaybackSnapshot;
  range: { minMs: number; maxMs: number };
  onPlay: () => void;
  onPause: () => void;
  onSeek: (ms: number) => void;
  onRate: (rate: number) => void;
  onLive: () => void;
  lookbackMs: number;
  onLookback: (ms: number) => void;
}

/** VCR bar for the live packet map: play/pause, speed, a seekable timeline, a
 *  Live button that re-pins to the newest packet, and a look-back selector. */
export function PlaybackBar({
  snapshot,
  range,
  onPlay,
  onPause,
  onSeek,
  onRate,
  onLive,
  lookbackMs,
  onLookback,
}: PlaybackBarProps) {
  const t = useT();
  const isLive = snapshot.mode === 'live';
  const min = range.minMs;
  const max = Math.max(range.maxMs, range.minMs + 1);
  const value = Math.min(Math.max(snapshot.currentMs, min), max);
  const step = Math.max(1, Math.round((max - min) / 1000));

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === ' ') {
        e.preventDefault();
        if (snapshot.playing) onPause();
        else onPlay();
      } else if (e.key === 'ArrowLeft') {
        onSeek(Math.max(min, value - step * 10));
      } else if (e.key === 'ArrowRight') {
        onSeek(Math.min(max, value + step * 10));
      } else if (e.key === 'l' || e.key === 'L') {
        onLive();
      }
    },
    [snapshot.playing, onPause, onPlay, onSeek, onLive, min, max, value, step]
  );

  return (
    <div
      className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-background/90 px-3 py-2 shadow-lg backdrop-blur"
      role="group"
      aria-label={t('map_playback_group_aria')}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="rounded p-1 text-foreground hover:bg-muted"
        aria-label={snapshot.playing ? t('map_playback_pause') : t('map_playback_play')}
        onClick={() => (snapshot.playing ? onPause() : onPlay())}
      >
        {snapshot.playing ? <Pause size={16} /> : <Play size={16} />}
      </button>

      <input
        type="range"
        className="h-1 w-40 cursor-pointer sm:w-56"
        aria-label={t('map_playback_timeline_aria')}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onSeek(Number(e.target.value))}
      />

      <div role="group" aria-label={t('map_playback_speed_aria')} className="flex gap-1">
        {SPEEDS.map((rate) => (
          <button
            key={rate}
            type="button"
            aria-pressed={snapshot.rate === rate}
            className={
              'rounded px-1.5 py-0.5 text-xs ' +
              (snapshot.rate === rate
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted text-muted-foreground')
            }
            onClick={() => onRate(rate)}
          >
            {t('map_playback_speed', { rate })}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-pressed={isLive}
        className={
          'flex items-center gap-1 rounded px-2 py-0.5 text-xs ' +
          (isLive ? 'bg-red-500 text-white' : 'bg-muted text-muted-foreground')
        }
        onClick={onLive}
      >
        <Radio size={12} />
        {t('map_playback_live')}
      </button>

      <select
        className="rounded border border-border bg-background px-1 py-0.5 text-xs"
        aria-label={t('map_playback_lookback_label')}
        value={lookbackMs}
        onChange={(e) => onLookback(Number(e.target.value))}
      >
        {LOOKBACK_OPTIONS.map((opt) => (
          <option key={opt.labelKey} value={opt.ms}>
            {t(opt.labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
