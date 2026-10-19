import { useCallback } from 'react';
import { useT, type TFn } from '../../i18n';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { shareFilename } from '../filename';
import { ANIM } from '../renderCard';
import { loadShareBrand } from '../shareBrand';
import type { ShareCardResult } from '../ShareCardDialog';
import { loadSvgImage, type ChartSnapshot } from './chartCapture';
import { renderChartCard, type ChartCardText } from './chartCardRender';

/** Unix seconds, start and end of what the chart shows. */
export type ChartTimeRange = [number, number];

/** "90 min", "36 h", "7 d": the span the animation plays through. */
export function formatSpan(t: TFn, seconds: number): string {
  if (seconds < 2 * 3600)
    return t('share_chart_span_minutes', { n: Math.max(1, Math.round(seconds / 60)) });
  if (seconds < 3 * 86400) return t('share_chart_span_hours', { n: Math.round(seconds / 3600) });
  return t('share_chart_span_days', { n: Math.round(seconds / 86400) });
}

/** Time from a fraction of the range, with or without the date, in the app's date/time format. */
export function chartClock(range: ChartTimeRange, withDate: boolean): (progress: number) => string {
  const opts: Intl.DateTimeFormatOptions = withDate
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' };
  return (p) => {
    const ts = range[0] + (range[1] - range[0]) * Math.max(0, Math.min(1, p));
    return formatDateTime(ts * 1000, opts);
  };
}

/** The share dialog's `build` for a chart snapshot. */
export function useChartShareBuild(
  snap: ChartSnapshot | null,
  title: string,
  range: ChartTimeRange | null
): () => Promise<ShareCardResult> {
  const t = useT();

  return useCallback(async (): Promise<ShareCardResult> => {
    if (!snap) throw new Error('no chart');
    const [full, base] = await Promise.all([
      loadSvgImage(snap.fullSvg),
      snap.baseSvg ? loadSvgImage(snap.baseSvg) : Promise.resolve(null),
    ]);
    const span = range ? range[1] - range[0] : 0;
    const timed = range != null && span > 0;
    const withDate = span >= 20 * 3600;
    const fmt = timed ? chartClock(range, withDate) : null;
    const text: ChartCardText = {
      kicker:
        timed && fmt
          ? t('share_chart_kicker_range', { start: fmt(0), end: fmt(1) })
          : t('share_chart_kicker'),
      title,
      speed: timed
        ? t('share_chart_speed', {
            span: formatSpan(t, span),
            secs: Math.round(ANIM.playMs / 1000),
          })
        : null,
      clock: fmt,
    };
    const brand = await loadShareBrand();
    const { png, gif } = await renderChartCard(snap, { full, base }, text, brand);
    return {
      png,
      gif,
      filenameBase: shareFilename('graph', new Date()),
      alt: t('share_chart_alt', { title }),
      shareTitle: title,
    };
  }, [snap, title, range, t]);
}
