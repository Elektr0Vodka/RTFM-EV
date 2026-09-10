import type { SnrPoint } from './neighborSignalUtils';

interface Props {
  samples: SnrPoint[];
  width?: number;
  height?: number;
  ariaLabel?: string;
}

/** Compact inline SVG SNR trend. Renders nothing with fewer than two samples
 *  (a single point is a misleading "trend"). Line color follows the latest
 *  SNR, matching the table's SNR thresholds. */
export function NeighborSnrSparkline({ samples, width = 64, height = 18, ariaLabel }: Props) {
  if (samples.length < 2) return null;
  const xs = samples.map((s) => s.observed_at);
  const ys = samples.map((s) => s.snr);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const points = samples
    .map((s) => {
      const x = ((s.observed_at - minX) / spanX) * (width - 2) + 1;
      const y = height - 1 - ((s.snr - minY) / spanY) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = ys[ys.length - 1];
  const color = last >= 6 ? '#22c55e' : last >= 0 ? '#eab308' : '#ef4444';
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'block' }}
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
