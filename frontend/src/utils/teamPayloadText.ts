// Translated status lines for MeshCore TEAM payloads, shared by the chat cards,
// the map's Beacons popups and the contact beacon history.

import type { TFn } from '../i18n';
import type { TeamBeaconPoint } from '../types';
import { TEAM_WAYPOINT_TYPES, formatTeamBatteryVolts } from './teamPayloads';

/** The status fields of a beacon, however it was obtained (chat parse or API). */
export interface TeamBeaconStatus {
  source: 'team' | 'signalk';
  radioBatteryMv: number | null;
  phoneBatteryMv: number | null;
  phoneBatteryPct: number | null;
  autonomous: boolean;
  needsForwarding: boolean | null;
  maxPathObserved: number | null;
  nodeCount: number | null;
  neighborCount: number | null;
}

/** The status fields of an API beacon. */
export function teamBeaconStatus(beacon: TeamBeaconPoint): TeamBeaconStatus {
  return {
    source: beacon.source,
    radioBatteryMv: beacon.radio_battery_mv,
    phoneBatteryMv: beacon.phone_battery_mv,
    phoneBatteryPct: beacon.phone_battery_pct,
    autonomous: beacon.autonomous,
    needsForwarding: beacon.needs_forwarding,
    maxPathObserved: beacon.max_path_observed,
    nodeCount: beacon.node_count,
    neighborCount: beacon.neighbor_count,
  };
}

/** Short status phrases for a beacon: batteries, autonomous, forwarding, neighbours. */
export function teamBeaconDetails(beacon: TeamBeaconStatus, t: TFn): string[] {
  const details: string[] = [];
  if (beacon.radioBatteryMv != null) {
    details.push(t('team_radio_battery', { volts: formatTeamBatteryVolts(beacon.radioBatteryMv) }));
  }
  if (beacon.phoneBatteryMv != null) {
    details.push(t('team_phone_battery', { volts: formatTeamBatteryVolts(beacon.phoneBatteryMv) }));
  }
  if (beacon.phoneBatteryPct != null) {
    details.push(t('team_phone_battery_pct', { percent: beacon.phoneBatteryPct }));
  }
  if (beacon.autonomous) details.push(t('team_autonomous'));
  if (beacon.needsForwarding) details.push(t('team_needs_forwarding'));
  if (beacon.maxPathObserved) details.push(t('team_max_path', { count: beacon.maxPathObserved }));
  if (beacon.nodeCount != null && beacon.neighborCount != null) {
    details.push(t('team_neighbors', { neighbors: beacon.neighborCount, nodes: beacon.nodeCount }));
  }
  if (beacon.source === 'signalk') details.push(t('team_source_signalk'));
  return details;
}

/** Translated name of a TEAM waypoint type; the raw type for ones TEAM does not define. */
export function teamWaypointTypeName(waypointType: string, t: TFn): string {
  const type = waypointType.toLowerCase();
  return TEAM_WAYPOINT_TYPES.includes(type) ? t(`team_waypoint_type_${type}`) : waypointType;
}
