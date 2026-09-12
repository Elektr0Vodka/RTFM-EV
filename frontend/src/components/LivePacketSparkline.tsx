import { useEffect, useState } from 'react';
import { getRawPacketStatsSession } from '../stores/rawPacketStore';
import { buildRawPacketStatsSnapshot } from '../utils/rawPacketStats';
import { useT } from '../i18n';

// Refresh cadence for the navbar widget. Reading the store via its non-reactive
// getter on a timer (instead of subscribing) keeps the top bar from re-rendering
// on every incoming packet, which can arrive several times a second.
const REFRESH_MS = 2000;
// Rolling window the rate and sparkline summarise.
const WINDOW = '5m' as const;

/**
 * Compact live-packet rate indicator for the desktop top bar: a small themed
 * sparkline of the last few minutes plus a packets-per-minute counter. Purely
 * informational; it observes the shared raw-packet store.
 */
export function LivePacketSparkline({ className }: { className?: string }) {
  const t = useT();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  // Recomputed on each tick (and on any parent re-render); cheap over the buffer.
  const snapshot = buildRawPacketStatsSnapshot(getRawPacketStatsSession(), WINDOW);

  const bins = snapshot.timeline;
  const max = bins.reduce((m, b) => Math.max(m, b.total), 0);
  const perMinute = Math.round(snapshot.packetsPerMinute);

  // Tiny bar sparkline. viewBox units; the SVG scales to the CSS box.
  const barCount = bins.length;
  const gap = 1;
  const barWidth = 3;
  const vbWidth = barCount * (barWidth + gap);
  const vbHeight = 16;

  return (
    <div
      className={className}
      role="status"
      title={t('nav_live_packets_title', { count: snapshot.packetCount })}
      aria-label={t('nav_live_packets_aria', { rate: perMinute })}
    >
      <svg
        width={vbWidth}
        height={vbHeight}
        viewBox={`0 0 ${vbWidth} ${vbHeight}`}
        className="overflow-visible"
        aria-hidden="true"
      >
        {bins.map((b, i) => {
          const h = max > 0 ? Math.max(1, Math.round((b.total / max) * vbHeight)) : 1;
          return (
            <rect
              key={i}
              x={i * (barWidth + gap)}
              y={vbHeight - h}
              width={barWidth}
              height={h}
              rx={0.5}
              fill="hsl(var(--primary))"
              opacity={b.total > 0 ? 0.9 : 0.25}
            />
          );
        })}
      </svg>
      <span className="tabular-nums text-muted-foreground">
        {t('nav_live_packets_rate', { rate: perMinute })}
      </span>
    </div>
  );
}
