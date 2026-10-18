import { useCallback } from 'react';
import { api } from '../../api';
import { useCvdMode } from '../../hooks/useCvdColors';
import { useLocale, useT } from '../../i18n';
import type { AirtimeSample } from '../../types';
import { formatNumber } from '../../utils/localeFormat';
import type { CardFigure, CardText } from '../cardChrome';
import { shareFilename } from '../filename';
import { loadShareBrand } from '../shareBrand';
import type { ShareBuildOptions, ShareCardResult } from '../ShareCardDialog';
import { buildMeshSummaryModel } from './meshSummary';
import { renderMeshSummaryCard } from './meshSummaryRender';

interface MeshHealthLike {
  total_contacts: number;
  contacts: { public_key: string; lat: number | null; lon: number | null; flood_count: number }[];
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Bins for the animation: hourly up to 2 days, fewer for long windows, 12 for short ones. */
function binCountFor(hours: number): number {
  if (hours <= 2) return 12;
  return Math.max(12, Math.min(48, Math.round(hours)));
}

/**
 * Card 4: the Mesh Health window into the share dialog's `build`. Everything
 * is fetched when the card is made; a figure whose data is missing is left out.
 */
export function useMeshSummaryBuild(
  window: { hours: number; label: string },
  radioName: string
): (opts: ShareBuildOptions) => Promise<ShareCardResult> {
  const t = useT();
  const { locale } = useLocale();
  const cvd = useCvdMode();

  return useCallback(
    async (opts: ShareBuildOptions): Promise<ShareCardResult> => {
      const end = Math.floor(Date.now() / 1000);
      const start = end - Math.round(window.hours * 3600);
      const bins = binCountFor(window.hours);
      const q = `start_ts=${start}&end_ts=${end}`;
      const [health, stats, airtime, heard, series] = await Promise.all([
        getJson<MeshHealthLike>(`./api/packets/mesh-health?${q}`),
        getJson<{ total_packets: number }>(`./api/packets/historical-stats?${q}`),
        api.getAirtimeRange(start, end, bins).catch((): AirtimeSample[] => []),
        api.getMeshHealthHeardBins(start, end, bins).catch(() => null),
        getJson<{ bins: { packet_count: number }[] }>(
          `./api/packets/timeseries?${q}&bin_count=${bins}`
        ),
      ]);
      const model = buildMeshSummaryModel({
        totalContacts: health?.total_contacts ?? null,
        contacts: health?.contacts ?? null,
        totalPackets: stats?.total_packets ?? null,
        airtime,
        heardBins: heard?.bins ?? null,
        packetBins: series?.bins.map((b) => b.packet_count) ?? null,
      });

      const figures: CardFigure[] = [];
      if (model.activeNodes != null) {
        figures.push({
          value: formatNumber(locale, model.activeNodes),
          label: t('share_fig_active_nodes'),
        });
      }
      if (model.packets != null) {
        figures.push({ value: formatNumber(locale, model.packets), label: t('share_fig_packets') });
      }
      if (model.airtimePct != null) {
        figures.push({
          value: t('share_fig_percent', { n: model.airtimePct.toFixed(1) }),
          label: t('share_fig_airtime'),
        });
      }
      if (model.floodAdverts != null) {
        figures.push({
          value: formatNumber(locale, model.floodAdverts),
          label: t('share_fig_flood_adverts'),
        });
      }
      const title = radioName
        ? t('share_summary_title', { name: radioName })
        : t('share_summary_title_unnamed');
      const text: CardText = {
        kicker: t('share_summary_kicker', { window: window.label }),
        title,
        figures,
      };
      const brand = await loadShareBrand();
      const { png, gif } = await renderMeshSummaryCard(model, text, brand, { ...opts, cvd });
      return {
        png,
        gif,
        filenameBase: shareFilename('mesh', new Date()),
        alt: t('share_summary_alt', { window: window.label }),
        shareTitle: title,
      };
    },
    [window.hours, window.label, radioName, t, locale, cvd]
  );
}
