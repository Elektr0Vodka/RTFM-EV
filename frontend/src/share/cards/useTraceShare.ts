import { useCallback } from 'react';
import { useDistanceUnit } from '../../contexts/DistanceUnitContext';
import { useCvdMode } from '../../hooks/useCvdColors';
import { useT } from '../../i18n';
import type { Contact, RadioConfig, RadioTraceNode } from '../../types';
import { formatDateTime } from '../../utils/dateTimeFormat';
import { formatDistance } from '../../utils/pathUtils';
import { resolveTraceNodeLocations } from '../../utils/traceMapUtils';
import type { CardFigure, CardText } from '../cardChrome';
import { shareFilename } from '../filename';
import { loadShareBrand } from '../shareBrand';
import type { ShareBuildOptions, ShareCardResult } from '../ShareCardDialog';
import { buildTraceModel } from './traceRoute';
import { renderTraceCard } from './traceRouteRender';

/**
 * Card 2: the trace result on screen (`nodes` with my radio first, as
 * TracePane builds them) into the share dialog's `build`. `ranAt` is when the
 * result came in (the response carries no time).
 */
export function useTraceShareBuild(
  nodes: RadioTraceNode[],
  ranAt: number,
  repeaters: Contact[],
  config: RadioConfig | null,
  localName: string
): ((opts: ShareBuildOptions) => Promise<ShareCardResult>) | null {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();
  const cvd = useCvdMode();

  const build = useCallback(
    async (opts: ShareBuildOptions): Promise<ShareCardResult> => {
      const byKey = new Map(repeaters.map((c) => [c.public_key, c]));
      const located = resolveTraceNodeLocations(nodes, config, byKey);
      const names = nodes.map(
        (n) =>
          n.name ||
          (n.role === 'custom'
            ? (n.observed_hash?.toUpperCase() ?? t('trace_custom_hop_label'))
            : n.role === 'local'
              ? localName
              : (n.public_key?.slice(0, 12) ?? t('trace_unknown_key')))
      );
      const model = buildTraceModel(located, names);
      const figures: CardFigure[] = [
        { value: String(model.hops), label: t('share_fig_hops', { count: model.hops }) },
      ];
      if (model.weakestSnr != null) {
        figures.push({
          value: t('share_fig_snr_value', { snr: model.weakestSnr.toFixed(1) }),
          label: t('share_fig_weakest_snr'),
        });
      }
      if (model.pathKm != null) {
        figures.push({
          value: formatDistance(model.pathKm, distanceUnit),
          label: t('share_fig_path_length'),
        });
      }
      const target = model.turnaroundName ?? localName;
      // Hidden position: no hop near my radio is named, not even in the title.
      const title = opts.hidePosition
        ? t('share_trace_title_hidden')
        : t('share_trace_title', { name: target });
      const time = formatDateTime(ranAt, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const text: CardText = { kicker: t('share_trace_kicker', { time }), title, figures };
      const brand = await loadShareBrand();
      const { png, gif } = await renderTraceCard(model, text, brand, { ...opts, cvd });
      return {
        png,
        gif,
        filenameBase: shareFilename('trace', new Date(ranAt)),
        alt: opts.hidePosition
          ? t('share_trace_alt_hidden')
          : t('share_trace_alt', { name: target }),
        shareTitle: title,
      };
    },
    [nodes, ranAt, repeaters, config, localName, t, distanceUnit, cvd]
  );

  return nodes.length > 0 ? build : null;
}
