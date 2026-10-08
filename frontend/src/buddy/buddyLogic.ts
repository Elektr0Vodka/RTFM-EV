import type { Conversation } from '../types';

/** A warned battery re-arms once it is this many points above the threshold. */
export const BATTERY_REARM_MARGIN = 5;

/** Node telemetry older than this is not worth warning about. */
export const BATTERY_TELEMETRY_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Warn-once-per-drop tracker: a key warns when it first reads below the
 * threshold, then stays quiet until it climbs to threshold + margin.
 */
export class BatteryWatch {
  private warned = new Set<string>();

  /** Returns true when this reading should raise a warning. */
  observe(key: string, percent: number, threshold: number): boolean {
    if (this.warned.has(key)) {
      if (percent >= threshold + BATTERY_REARM_MARGIN) this.warned.delete(key);
      return false;
    }
    if (percent < threshold) {
      this.warned.add(key);
      return true;
    }
    return false;
  }
}

type PageType = Conversation['type'] | 'settings';

/** i18n key of the tip said the first time a page is opened in a session. */
const PAGE_TIP_KEYS: Partial<Record<PageType, string>> = {
  channel: 'buddy_tip_channel',
  contact: 'buddy_tip_contact',
  'contact-info': 'buddy_tip_contact_info',
  raw: 'buddy_tip_raw',
  map: 'buddy_tip_map',
  visualizer: 'buddy_tip_visualizer',
  search: 'buddy_tip_search',
  trace: 'buddy_tip_trace',
  'channel-registry': 'buddy_tip_channel_registry',
  node: 'buddy_tip_node',
  'mesh-health': 'buddy_tip_mesh_health',
  'mesh-trends': 'buddy_tip_mesh_trends',
  'mesh-discovery': 'buddy_tip_mesh_discovery',
  snmp: 'buddy_tip_snmp',
  analyze: 'buddy_tip_analyze',
  'packet-history': 'buddy_tip_packet_history',
  manual: 'buddy_tip_manual',
  'knowledge-base': 'buddy_tip_knowledge_base',
  settings: 'buddy_tip_settings',
};

export function pageTipKey(page: PageType | null | undefined): string | null {
  return page ? (PAGE_TIP_KEYS[page] ?? null) : null;
}
