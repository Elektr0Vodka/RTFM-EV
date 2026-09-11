import type { ReactNode } from 'react';
import { useT } from '../../../i18n';
import {
  NODE_RECENCY_COLORS,
  NODE_TYPE_STROKE,
  type RecencyTier,
} from '../../layers/nodesLayer';
import {
  CONTACT_TYPE_CLIENT,
  CONTACT_TYPE_REPEATER,
  CONTACT_TYPE_ROOM,
  CONTACT_TYPE_SENSOR,
} from '../../../types';

function Dot({ color, ring }: { color: string; ring?: string }) {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 rounded-full"
      style={{ backgroundColor: color, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
    />
  );
}

function Row({ color, ring, label }: { color: string; ring?: string; label: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
      <Dot color={color} ring={ring} />
      <span>{label}</span>
    </div>
  );
}

/** Node-type and recency legend for the map. Optional extra content (e.g. a
 *  packet-type legend) can be appended by the caller. */
export function MapLegend({ extra }: { extra?: ReactNode }) {
  const t = useT();
  const typeRows = [
    { type: CONTACT_TYPE_CLIENT, label: t('map_type_client') },
    { type: CONTACT_TYPE_REPEATER, label: t('map_type_repeater') },
    { type: CONTACT_TYPE_ROOM, label: t('map_type_room') },
    { type: CONTACT_TYPE_SENSOR, label: t('map_type_sensor') },
  ];
  const recencyRows: { tier: RecencyTier; label: string }[] = [
    { tier: 'recent', label: t('map_lt_1h') },
    { tier: 'today', label: t('map_lt_1d') },
    { tier: 'stale', label: t('map_lt_3d') },
    { tier: 'old', label: t('map_recency_older') },
  ];
  return (
    <div className="space-y-3">
      <div role="group" aria-label={t('map_node_type_legend_aria')}>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('map_legend_node_types')}
        </div>
        {typeRows.map((r) => (
          <Row key={r.type} color="#64748b" ring={NODE_TYPE_STROKE[r.type]} label={r.label} />
        ))}
      </div>
      <div role="group" aria-label={t('map_recency_legend_aria')}>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('map_legend_recency')}
        </div>
        {recencyRows.map((r) => (
          <Row key={r.tier} color={NODE_RECENCY_COLORS[r.tier]} label={r.label} />
        ))}
      </div>
      {extra}
    </div>
  );
}
