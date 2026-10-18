import type { AirtimeSample } from '../../types';
import { isValidLocation } from '../../utils/pathUtils';
import type { LatLon } from '../geo';

export interface SummaryNode {
  key: string;
  point: LatLon;
}

export interface SummaryBin {
  keys: Set<string>;
  packets: number;
}

/** Card 4, "Local mesh summary": the mesh as heard by my radio over a window. */
export interface MeshSummaryModel {
  /** Located nodes only (the map). */
  nodes: SummaryNode[];
  /** Null when Mesh Health could not be read (left out, never shown as 0). */
  activeNodes: number | null;
  packets: number | null;
  /** Mean of TX + RX airtime percent; null without samples. */
  airtimePct: number | null;
  floodAdverts: number | null;
  bins: SummaryBin[];
  located: LatLon[];
}

export function buildMeshSummaryModel(input: {
  totalContacts: number | null;
  contacts:
    { public_key: string; lat: number | null; lon: number | null; flood_count: number }[] | null;
  totalPackets: number | null;
  airtime: AirtimeSample[];
  heardBins: { keys: string[] }[] | null;
  packetBins: number[] | null;
}): MeshSummaryModel {
  const nodes: SummaryNode[] = (input.contacts ?? []).flatMap((c) =>
    isValidLocation(c.lat, c.lon)
      ? [{ key: c.public_key, point: { lat: c.lat as number, lon: c.lon as number } }]
      : []
  );
  const airtimePct = input.airtime.length
    ? input.airtime.reduce((sum, s) => sum + s.tx_pct + s.rx_pct, 0) / input.airtime.length
    : null;
  const bins: SummaryBin[] = (input.heardBins ?? []).map((b, i) => ({
    keys: new Set(b.keys),
    packets: input.packetBins?.[i] ?? 0,
  }));
  return {
    nodes,
    activeNodes: input.totalContacts,
    packets: input.totalPackets,
    airtimePct,
    floodAdverts: input.contacts ? input.contacts.reduce((sum, c) => sum + c.flood_count, 0) : null,
    bins,
    located: nodes.map((n) => n.point),
  };
}
