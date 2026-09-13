import { useT } from '../../../i18n';
import { PACKET_LEGEND_ITEMS } from '../../../utils/visualizerUtils';

// i18n keys for packet-type labels, shared with the 3D visualizer legend.
const PACKET_LEGEND_KEYS: Record<string, string> = {
  AD: 'visualizer_legend_packet_advertisement',
  GT: 'visualizer_legend_packet_group_text',
  DM: 'visualizer_legend_packet_direct_message',
  ACK: 'visualizer_legend_packet_acknowledgment',
  TR: 'nav_trace',
  RQ: 'visualizer_legend_packet_request',
  RS: 'visualizer_legend_packet_response',
  '?': 'visualizer_legend_packet_other',
};

const SECTION = 'mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const ROW = 'flex items-center gap-2 py-0.5 text-xs text-muted-foreground';

/** Legend for the live packet visualization: packet-type colours, the SNR arc
 *  gradient, and the witnessed-vs-inferred line-style key. Appended to MapLegend
 *  (as its `extra`) while packet visualization is on. */
export function PacketLegend() {
  const t = useT();
  return (
    <>
      <div role="group" aria-label={t('packet_types_title')}>
        <div className={SECTION}>{t('packet_types_title')}</div>
        {PACKET_LEGEND_ITEMS.map((item) => (
          <div key={item.label} className={ROW}>
            <span
              aria-hidden
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span>{t(PACKET_LEGEND_KEYS[item.label] ?? item.description)}</span>
          </div>
        ))}
      </div>

      <div role="group" aria-label={t('map_legend_snr')}>
        <div className={SECTION}>{t('map_legend_snr')}</div>
        <div
          aria-hidden
          className="h-2 w-full rounded"
          style={{
            background:
              'linear-gradient(to right, rgb(245,158,11), rgb(59,130,246), rgb(34,197,94))',
          }}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{t('map_legend_snr_low')}</span>
          <span>{t('map_legend_snr_high')}</span>
        </div>
      </div>

      <div role="group" aria-label={t('map_legend_links')}>
        <div className={SECTION}>{t('map_legend_links')}</div>
        <div className={ROW}>
          <span aria-hidden className="inline-block h-0.5 w-6 bg-current" />
          <span>{t('map_legend_witnessed')}</span>
        </div>
        <div className={ROW}>
          <span
            aria-hidden
            className="inline-block h-0 w-6 opacity-50"
            style={{ borderTop: '1px dashed currentColor' }}
          />
          <span>{t('map_legend_inferred')}</span>
        </div>
      </div>
    </>
  );
}
