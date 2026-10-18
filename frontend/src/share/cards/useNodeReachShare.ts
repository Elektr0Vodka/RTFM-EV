import { useCallback } from 'react';
import { useDistanceUnit } from '../../contexts/DistanceUnitContext';
import { useCvdMode } from '../../hooks/useCvdColors';
import { useT } from '../../i18n';
import type { Contact } from '../../types';
import { formatDistance } from '../../utils/pathUtils';
import type { CardFigure, CardText } from '../cardChrome';
import { shareFilename } from '../filename';
import { loadShareBrand } from '../shareBrand';
import type { ShareBuildOptions, ShareCardResult } from '../ShareCardDialog';
import { buildNodeReachModel, type ReachNeighbor } from './nodeReach';
import { renderNodeReachCard } from './nodeReachRender';

/** Card 3: the directly heard neighbours My Node shows, into the share dialog's `build`. */
export function useNodeReachBuild(
  neighbors: ReachNeighbor[],
  config: { name: string; lat: number | null; lon: number | null } | null,
  contacts: Contact[],
  windowLabel: string
): ((opts: ShareBuildOptions) => Promise<ShareCardResult>) | null {
  const t = useT();
  const { distanceUnit } = useDistanceUnit();
  const cvd = useCvdMode();

  const build = useCallback(
    async (opts: ShareBuildOptions): Promise<ShareCardResult> => {
      const model = buildNodeReachModel(neighbors, config, contacts);
      const figures: CardFigure[] = [
        {
          value: model.capped
            ? t('share_fig_count_capped', { n: model.count })
            : String(model.count),
          label: t('share_fig_heard_direct'),
        },
      ];
      if (model.furthestKm != null) {
        figures.push({
          value: formatDistance(model.furthestKm, distanceUnit),
          label: t('share_fig_furthest'),
        });
      }
      figures.push({
        value: String(model.repeaters),
        label: t('share_fig_repeaters', { count: model.repeaters }),
      });
      if (model.medianSnr != null) {
        figures.push({
          value: t('share_fig_snr_value', { snr: model.medianSnr.toFixed(1) }),
          label: t('share_fig_median_snr'),
        });
      }
      const name = config?.name || t('common_unknown');
      const title = opts.hidePosition
        ? t('share_reach_title_hidden')
        : t('share_reach_title', { name });
      const text: CardText = {
        kicker: t('share_reach_kicker', { window: windowLabel }),
        title,
        figures,
      };
      const brand = await loadShareBrand();
      const { png, gif } = await renderNodeReachCard(model, text, brand, { ...opts, cvd });
      return {
        png,
        gif,
        filenameBase: shareFilename('reach', new Date()),
        alt: opts.hidePosition ? t('share_reach_alt_hidden') : t('share_reach_alt', { name }),
        shareTitle: title,
      };
    },
    [neighbors, config, contacts, windowLabel, t, distanceUnit, cvd]
  );

  return neighbors.length > 0 ? build : null;
}
