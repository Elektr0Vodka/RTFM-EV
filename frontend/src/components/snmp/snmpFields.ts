// The MeshCore observer firmware's SNMP values, in display order.
//
// Mirrors app/snmp/mib.py (keys, groups, units), which mirrors the firmware's
// SNMPAgent.cpp. The server already turns last_snr from dB x 4 into dB.

import { formatDuration } from '../repeater/repeaterPaneShared';
import { formatDateTime } from '../../utils/dateTimeFormat';
import type { SnmpValues } from '../../types';

export type SnmpGroup = 'system' | 'radio' | 'mqtt' | 'memory' | 'network';
export type SnmpUnit = 'seconds' | 'dbm' | 'db' | 'bytes';

export interface SnmpField {
  key: string;
  group: SnmpGroup;
  labelKey: string;
  unit?: SnmpUnit;
}

export const SNMP_GROUPS: { group: SnmpGroup; labelKey: string }[] = [
  { group: 'system', labelKey: 'snmp_group_system' },
  { group: 'radio', labelKey: 'snmp_group_radio' },
  { group: 'mqtt', labelKey: 'snmp_group_mqtt' },
  { group: 'memory', labelKey: 'snmp_group_memory' },
  { group: 'network', labelKey: 'snmp_group_network' },
];

export const SNMP_FIELDS: SnmpField[] = [
  { key: 'node_name', group: 'system', labelKey: 'snmp_field_node_name' },
  { key: 'firmware_version', group: 'system', labelKey: 'snmp_field_firmware_version' },
  { key: 'uptime_secs', group: 'system', labelKey: 'snmp_field_uptime_secs', unit: 'seconds' },
  { key: 'packets_recv', group: 'radio', labelKey: 'snmp_field_packets_recv' },
  { key: 'packets_sent', group: 'radio', labelKey: 'snmp_field_packets_sent' },
  { key: 'recv_errors', group: 'radio', labelKey: 'snmp_field_recv_errors' },
  { key: 'noise_floor', group: 'radio', labelKey: 'snmp_field_noise_floor', unit: 'dbm' },
  { key: 'last_rssi', group: 'radio', labelKey: 'snmp_field_last_rssi', unit: 'dbm' },
  { key: 'last_snr', group: 'radio', labelKey: 'snmp_field_last_snr', unit: 'db' },
  { key: 'sent_flood', group: 'radio', labelKey: 'snmp_field_sent_flood' },
  { key: 'sent_direct', group: 'radio', labelKey: 'snmp_field_sent_direct' },
  { key: 'recv_flood', group: 'radio', labelKey: 'snmp_field_recv_flood' },
  { key: 'recv_direct', group: 'radio', labelKey: 'snmp_field_recv_direct' },
  {
    key: 'total_air_time_secs',
    group: 'radio',
    labelKey: 'snmp_field_total_air_time_secs',
    unit: 'seconds',
  },
  { key: 'mqtt_connected_slots', group: 'mqtt', labelKey: 'snmp_field_mqtt_connected_slots' },
  { key: 'mqtt_queue_depth', group: 'mqtt', labelKey: 'snmp_field_mqtt_queue_depth' },
  { key: 'mqtt_skipped_publishes', group: 'mqtt', labelKey: 'snmp_field_mqtt_skipped_publishes' },
  { key: 'free_heap', group: 'memory', labelKey: 'snmp_field_free_heap', unit: 'bytes' },
  { key: 'max_alloc', group: 'memory', labelKey: 'snmp_field_max_alloc', unit: 'bytes' },
  { key: 'internal_free', group: 'memory', labelKey: 'snmp_field_internal_free', unit: 'bytes' },
  { key: 'psram_free', group: 'memory', labelKey: 'snmp_field_psram_free', unit: 'bytes' },
  { key: 'wifi_rssi', group: 'network', labelKey: 'snmp_field_wifi_rssi', unit: 'dbm' },
];

/** Short date and time of a server timestamp (Unix seconds). */
export function formatSnmpTime(seconds: number): string {
  return formatDateTime(seconds * 1000, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (Math.abs(kib) < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(2)} MiB`;
}

/** Display text for one value; '-' when the node did not serve it. */
export function formatSnmpValue(field: SnmpField, values: SnmpValues): string {
  const value = values[field.key];
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  switch (field.unit) {
    case 'seconds':
      return value >= 0 ? formatDuration(Math.floor(value)) : String(value);
    case 'dbm':
      return `${value} dBm`;
    case 'db':
      return `${value} dB`;
    case 'bytes':
      return formatBytes(value);
    default:
      return String(value);
  }
}
