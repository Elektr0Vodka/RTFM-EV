// The MeshCore observer firmware's SNMP values, in display order.
//
// Mirrors app/snmp/mib.py (keys, groups, units), which mirrors the firmware's
// SNMPAgent.cpp. The server already turns last_snr from dB x 4 into dB.
//
// The fields marked `optional` came with a later firmware (Dutch-MeshCore
// MeshCore PR #16). A node without them (older firmware, a room server without
// the duty gate and filter groups) serves no value: the field is then hidden,
// not shown as 0.

import { formatDuration } from '../repeater/repeaterPaneShared';
import { formatDateTime } from '../../utils/dateTimeFormat';
import type { TFn } from '../../i18n';
import type { SnmpValues } from '../../types';

export type SnmpGroup =
  'system' | 'radio' | 'mqtt' | 'memory' | 'network' | 'duty_gate' | 'filter' | 'neighbours';
export type SnmpUnit =
  'seconds' | 'milliseconds' | 'dbm' | 'db' | 'bytes' | 'millivolts' | 'celsius' | 'percent';
/** How a value reads when it is not a plain number with its unit. */
export type SnmpFormat = 'text' | 'yes_no' | 'reset_reason' | 'error_flags';

export interface SnmpField {
  key: string;
  group: SnmpGroup;
  labelKey: string;
  unit?: SnmpUnit;
  format?: SnmpFormat;
  /** A Counter32 running total: reset to 0 by a reboot or `clear stats`. */
  counter?: boolean;
  /** Hidden when the node does not serve it (added after the first release). */
  optional?: boolean;
  /** What the node sends when it cannot measure this; shown as n/a, never charted. */
  sentinel?: number;
}

export const SNMP_GROUPS: { group: SnmpGroup; labelKey: string }[] = [
  { group: 'system', labelKey: 'snmp_group_system' },
  { group: 'radio', labelKey: 'snmp_group_radio' },
  { group: 'mqtt', labelKey: 'snmp_group_mqtt' },
  { group: 'memory', labelKey: 'snmp_group_memory' },
  { group: 'network', labelKey: 'snmp_group_network' },
  { group: 'duty_gate', labelKey: 'snmp_group_duty_gate' },
  { group: 'filter', labelKey: 'snmp_group_filter' },
  { group: 'neighbours', labelKey: 'snmp_group_neighbours' },
];

function added(key: string, group: SnmpGroup, extra: Partial<SnmpField> = {}): SnmpField {
  return { key, group, labelKey: `snmp_field_${key}`, optional: true, ...extra };
}

export const FILTER_DROP_KEYS = [
  'filter_hop_limit_drops',
  'filter_rate_limit_drops',
  'filter_channel_drops',
  'filter_path_hash_drops',
  'filter_malformed_drops',
  'filter_advert_drops',
  'filter_path_prefix_drops',
  'filter_sender_drops',
  'filter_text_drops',
  'filter_age_drops',
];

export const SNMP_FIELDS: SnmpField[] = [
  { key: 'node_name', group: 'system', labelKey: 'snmp_field_node_name', format: 'text' },
  {
    key: 'firmware_version',
    group: 'system',
    labelKey: 'snmp_field_firmware_version',
    format: 'text',
  },
  { key: 'uptime_secs', group: 'system', labelKey: 'snmp_field_uptime_secs', unit: 'seconds' },
  added('battery_mv', 'system', { unit: 'millivolts', sentinel: 0 }),
  added('mcu_temp_c', 'system', { unit: 'celsius', sentinel: -127 }),
  added('reset_reason', 'system', { format: 'text' }),
  added('reset_reason_code', 'system', { format: 'reset_reason' }),
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
  added('rx_air_time_secs', 'radio', { unit: 'seconds', counter: true }),
  added('tx_duty_percent', 'radio', { unit: 'percent' }),
  added('tx_queue_len', 'radio'),
  added('flood_dups', 'radio', { counter: true }),
  added('direct_dups', 'radio', { counter: true }),
  added('error_flags', 'radio', { format: 'error_flags' }),
  { key: 'mqtt_connected_slots', group: 'mqtt', labelKey: 'snmp_field_mqtt_connected_slots' },
  { key: 'mqtt_queue_depth', group: 'mqtt', labelKey: 'snmp_field_mqtt_queue_depth' },
  { key: 'mqtt_skipped_publishes', group: 'mqtt', labelKey: 'snmp_field_mqtt_skipped_publishes' },
  added('ntp_synced', 'mqtt', { format: 'yes_no' }),
  { key: 'free_heap', group: 'memory', labelKey: 'snmp_field_free_heap', unit: 'bytes' },
  added('min_free_heap', 'memory', { unit: 'bytes' }),
  { key: 'max_alloc', group: 'memory', labelKey: 'snmp_field_max_alloc', unit: 'bytes' },
  { key: 'internal_free', group: 'memory', labelKey: 'snmp_field_internal_free', unit: 'bytes' },
  { key: 'psram_free', group: 'memory', labelKey: 'snmp_field_psram_free', unit: 'bytes' },
  { key: 'wifi_rssi', group: 'network', labelKey: 'snmp_field_wifi_rssi', unit: 'dbm' },
  added('dc_gate_enabled', 'duty_gate', { format: 'yes_no' }),
  added('dc_gate_level', 'duty_gate'),
  added('dc_gate_max_level', 'duty_gate'),
  added('dc_gate_threshold', 'duty_gate', { unit: 'percent' }),
  added('dc_gate_hysteresis', 'duty_gate', { unit: 'percent' }),
  added('filter_enabled', 'filter', { format: 'yes_no' }),
  added('filter_dry_run', 'filter', { format: 'yes_no' }),
  ...FILTER_DROP_KEYS.map((key) => added(key, 'filter', { counter: true })),
  added('filter_air_saved_ms', 'filter', { unit: 'milliseconds', counter: true }),
  added('neighbour_count', 'neighbours'),
];

/** ESP-IDF `esp_reset_reason_t` codes the firmware reports in .1.6.0. */
const RESET_REASON_CODES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
/** Error-flag bits of .2.17.0, in bit order. */
export const ERROR_FLAG_BITS = [1, 2, 4, 8];

/** True when the node served a value for this field. */
export function snmpValueServed(field: SnmpField, values: SnmpValues): boolean {
  const value = values[field.key];
  return value !== null && value !== undefined && value !== '';
}

/** True for the value a node sends when it cannot measure the field. */
export function isSnmpSentinel(field: SnmpField, value: unknown): boolean {
  return field.sentinel !== undefined && value === field.sentinel;
}

/** The bits set in an error-flag value, lowest first. */
export function errorFlagBits(value: number): number[] {
  const bits: number[] = [];
  for (let bit = 1; bit > 0 && bit <= value; bit *= 2) {
    if (value & bit) bits.push(bit);
  }
  return bits;
}

/** Text of a reset reason code, e.g. "Brownout (9)". */
export function formatResetReasonCode(code: number, t: TFn): string {
  return RESET_REASON_CODES.has(code)
    ? t('snmp_reset_reason_named', { name: t(`snmp_reset_reason_${code}`), code })
    : t('snmp_reset_reason_other', { code });
}

function formatErrorFlags(value: number, t: TFn): string {
  const bits = errorFlagBits(value);
  if (bits.length === 0) return t('snmp_error_flags_none');
  return bits
    .map((bit) =>
      ERROR_FLAG_BITS.includes(bit)
        ? t(`snmp_error_flag_${bit}`)
        : t('snmp_error_flag_other', { bit })
    )
    .join(', ');
}

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

/**
 * Display text for one value; '-' when the node did not serve it. `t` gives
 * the words for n/a, yes/no, reset reasons and error flags; without it those
 * show the raw number.
 */
export function formatSnmpValue(field: SnmpField, values: SnmpValues, t?: TFn): string {
  const value = values[field.key];
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  if (t) {
    if (isSnmpSentinel(field, value)) return t('snmp_value_na');
    if (field.format === 'yes_no') return t(value ? 'snmp_value_yes' : 'snmp_value_no');
    if (field.format === 'reset_reason') return formatResetReasonCode(value, t);
    if (field.format === 'error_flags') return formatErrorFlags(value, t);
  }
  switch (field.unit) {
    case 'seconds':
      return value >= 0 ? formatDuration(Math.floor(value)) : String(value);
    case 'milliseconds':
      if (value < 1000) return `${value} ms`;
      return formatDuration(Math.floor(value / 1000));
    case 'dbm':
      return `${value} dBm`;
    case 'db':
      return `${value} dB`;
    case 'bytes':
      return formatBytes(value);
    case 'millivolts':
      return `${(value / 1000).toFixed(3)} V`;
    case 'celsius':
      return `${value} °C`;
    case 'percent':
      return `${value} %`;
    default:
      return String(value);
  }
}
