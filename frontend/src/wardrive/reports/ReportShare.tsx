// The three report share cards (Drive, Coverage, Weak spots) through the
// share dialog every RTFM-EV card uses.
import { useState } from 'react';

import { Button } from '../../components/ui/button';
import { useCvdMode } from '../../hooks/useCvdColors';
import { useLocale, useT } from '../../i18n';
import type { CardBrand } from '../../share/brand';
import type { CardFigure } from '../../share/cardChrome';
import { shareFilename } from '../../share/filename';
import { ShareCardDialog, type ShareBuildOptions } from '../../share/ShareCardDialog';
import { getSavedDistanceUnit } from '../../utils/distanceUnits';
import { formatDistance } from '../../utils/pathUtils';
import { cardIsEmpty, renderReportCard, type ReportCardKind } from './cards';
import { formatDbm, formatDuration, formatShare, formatWhen, nodeLabel } from './format';
import type { WardriveReport } from './types';

const KINDS: ReportCardKind[] = ['drive', 'coverage', 'weak'];

export function ReportShare({
  report,
  brand,
}: {
  report: WardriveReport;
  /** The brand drawn in the card footer (the page cannot read the owner's). */
  brand: () => Promise<CardBrand>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const cvd = useCvdMode();
  const [open, setOpen] = useState<ReportCardKind | null>(null);
  const s = report.summary;
  const unit = getSavedDistanceUnit();
  const period = t('wardrive_report_from_to', {
    from: formatWhen(s.first_ts, locale),
    to: formatWhen(s.last_ts, locale),
  });

  const figuresFor = (kind: ReportCardKind): CardFigure[] => {
    if (kind === 'drive') {
      return [
        {
          value: formatDistance(s.distance_m / 1000, unit),
          label: t('wardrive_card_fig_distance'),
        },
        { value: formatDuration(s.drive_seconds, t), label: t('wardrive_card_fig_time') },
        { value: String(s.receptions), label: t('wardrive_card_fig_receptions') },
        { value: String(s.nodes_heard), label: t('wardrive_card_fig_nodes') },
        { value: formatDbm(s.rssi_best), label: t('wardrive_card_fig_best') },
      ];
    }
    if (kind === 'coverage') {
      const c = report.coverage;
      return [
        { value: String(c.cells_driven), label: t('wardrive_card_fig_cells') },
        { value: formatShare(c.covered_share), label: t('wardrive_card_fig_covered') },
        { value: String(c.cell_bands.strong), label: t('wardrive_card_fig_strong') },
        { value: String(c.cell_bands.weak), label: t('wardrive_card_fig_weak') },
      ];
    }
    const w = report.weak_spots;
    // The node heard best next to any weak cell (each cell lists its best first).
    const best = w.cells
      .flatMap((c) => c.nearby.slice(0, 1))
      .reduce<(typeof w.cells)[number]['nearby'][number] | null>(
        (top, n) => (top === null || n.rssi_best > top.rssi_best ? n : top),
        null
      );
    return [
      { value: String(w.gaps), label: t('wardrive_card_fig_gaps') },
      { value: String(w.weak), label: t('wardrive_card_fig_weak') },
      { value: formatDuration(w.track_s, t), label: t('wardrive_card_fig_time_there') },
      { value: best ? nodeLabel(best) : '-', label: t('wardrive_card_fig_best_nearby') },
    ];
  };

  const build = (kind: ReportCardKind) => async (opts: ShareBuildOptions) => {
    const title =
      kind === 'drive'
        ? s.drives > 1
          ? t('wardrive_card_drive_title_n', { n: s.drives })
          : t('wardrive_card_drive_title')
        : t(`wardrive_card_${kind}_title`);
    const text = {
      kicker: t(`wardrive_card_${kind}_kicker`, { period }),
      title,
      figures: figuresFor(kind),
    };
    const { png, gif } = await renderReportCard(kind, report, text, await brand(), {
      ...opts,
      cvd,
    });
    return {
      png,
      gif,
      filenameBase: shareFilename(`wardrive-${kind}`, new Date()),
      alt: t(`wardrive_card_alt_${kind}`),
      shareTitle: title,
    };
  };

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">{t('wardrive_card_share')}</h3>
      <div className="flex flex-wrap gap-2">
        {KINDS.map((kind) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant="outline"
            disabled={cardIsEmpty(kind, report)}
            onClick={() => setOpen(kind)}
          >
            {t(`wardrive_card_${kind}`)}
          </Button>
        ))}
      </div>
      {open && (
        <ShareCardDialog
          open
          onClose={() => setOpen(null)}
          title={t(`wardrive_card_${open}`)}
          supportsHidePosition
          build={build(open)}
        />
      )}
    </section>
  );
}
