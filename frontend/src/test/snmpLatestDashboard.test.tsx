import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { SnmpLatestDashboard } from '../components/snmp/SnmpLatestDashboard';
import { SNMP_FIELDS } from '../components/snmp/snmpFields';
import type { SnmpValues } from '../types';

// A repeater on current firmware that serves every repeater OID.
const REPEATER: SnmpValues = {
  node_name: 'NL-DHR-TDP-EV',
  firmware_version: 'v1.18.0',
  uptime_secs: 166500,
  battery_mv: 4069,
  mcu_temp_c: 39,
  reset_reason: 'Software reset',
  reset_reason_code: 3,
  packets_recv: 13471,
  packets_sent: 1092,
  recv_errors: 4756,
  noise_floor: -110,
  last_rssi: -102,
  last_snr: -3.5,
  sent_flood: 1077,
  sent_direct: 15,
  recv_flood: 12729,
  recv_direct: 737,
  total_air_time_secs: 360,
  rx_air_time_secs: 3960,
  tx_duty_percent: 0,
  tx_queue_len: 0,
  flood_dups: 8313,
  direct_dups: 1,
  error_flags: 0,
  mqtt_connected_slots: 3,
  mqtt_queue_depth: 0,
  mqtt_skipped_publishes: 0,
  ntp_synced: 1,
  free_heap: 140902,
  min_free_heap: 113561,
  max_alloc: 114688,
  internal_free: 140902,
  psram_free: 1897000,
  wifi_rssi: -59,
  dc_gate_enabled: 1,
  dc_gate_level: 0,
  dc_gate_max_level: 3,
  dc_gate_threshold: 70,
  dc_gate_hysteresis: 10,
  filter_enabled: 1,
  filter_dry_run: 0,
  filter_hop_limit_drops: 2465,
  filter_rate_limit_drops: 0,
  filter_channel_drops: 88,
  filter_path_hash_drops: 569,
  filter_malformed_drops: 22,
  filter_advert_drops: 0,
  filter_path_prefix_drops: 0,
  filter_sender_drops: 0,
  filter_text_drops: 0,
  filter_age_drops: 0,
  filter_air_saved_ms: 840000,
  neighbour_count: 11,
};

function renderDashboard(values: SnmpValues) {
  render(
    <I18nProvider>
      <SnmpLatestDashboard values={values} />
    </I18nProvider>
  );
}

describe('SnmpLatestDashboard', () => {
  it('shows every served value once, with filter rules at 0 behind a toggle', () => {
    renderDashboard(REPEATER);

    // Left out on purpose: the reset text (the code says the same), the error
    // flags at 0 and the 6 filter rules that dropped nothing.
    const hidden = new Set(['reset_reason', 'error_flags']);
    const zeroRules = Object.keys(REPEATER).filter(
      (key) => key.startsWith('filter_') && key.endsWith('_drops') && REPEATER[key] === 0
    );
    expect(zeroRules).toHaveLength(6);
    const expected = SNMP_FIELDS.filter(
      (field) => field.key in REPEATER && !hidden.has(field.key) && !zeroRules.includes(field.key)
    );
    for (const field of expected) {
      expect(screen.getAllByTestId(`snmp-row-${field.key}`)).toHaveLength(1);
    }
    expect(screen.getAllByTestId(/^snmp-row-/)).toHaveLength(expected.length);
    expect(screen.getByTestId('snmp-row-reset_reason_code')).toHaveTextContent(
      'Software reset (3)'
    );

    fireEvent.click(screen.getByRole('button', { name: '+6 at 0' }));
    for (const key of zeroRules) {
      expect(screen.getByTestId(`snmp-row-${key}`)).toHaveTextContent('0');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Hide the ones at 0' }));
    expect(screen.queryByTestId('snmp-row-filter_rate_limit_drops')).toBeNull();
  });

  it('puts traffic in a received/sent by flood/direct table', () => {
    renderDashboard(REPEATER);

    const table = within(screen.getByTestId('snmp-group-radio')).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'FloodDirectTotal',
      'Received1272973713471',
      'Sent1077151092',
      'Duplicates83131',
    ]);
  });

  it('sorts filter drops from most to least', () => {
    renderDashboard(REPEATER);

    const rows = within(screen.getByTestId('snmp-group-filter')).getAllByTestId(
      /^snmp-row-filter_.*_drops$/
    );
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      'snmp-row-filter_hop_limit_drops',
      'snmp-row-filter_path_hash_drops',
      'snmp-row-filter_channel_drops',
      'snmp-row-filter_malformed_drops',
    ]);
  });

  it('labels the firmware total air time as TX air time', () => {
    renderDashboard(REPEATER);

    expect(screen.getByTestId('snmp-row-total_air_time_secs')).toHaveTextContent('TX air time6m');
  });

  it('shows error flags as a warning only when one is set', () => {
    renderDashboard({ ...REPEATER, error_flags: 5 });

    expect(screen.getByTestId('snmp-row-error_flags')).toHaveTextContent(
      'Packet pool full, Start-RX timeout'
    );
  });

  it('leaves out the cards an older repeater does not serve', () => {
    const older: SnmpValues = Object.fromEntries(
      Object.entries(REPEATER).filter(([key]) => {
        const field = SNMP_FIELDS.find((f) => f.key === key);
        return field && !field.optional;
      })
    );
    renderDashboard(older);

    for (const group of ['filter', 'duty_gate', 'neighbours', 'companion', 'companion_filter']) {
      expect(screen.queryByTestId(`snmp-group-${group}`)).toBeNull();
    }
    // No duplicates OIDs: no Duplicates row.
    const table = within(screen.getByTestId('snmp-group-radio')).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByTestId('snmp-group-mqtt')).toBeInTheDocument();
  });

  it('shows a meshcomod companion with its receive filter', () => {
    renderDashboard({
      node_name: 'Companion',
      companion_tcp_clients: 1,
      companion_ws_clients: 0,
      companion_contacts: 304,
      companion_channels: 8,
      cfilter_enabled: 1,
      cfilter_sender_hidden: 16,
      cfilter_text_hidden: 0,
    });

    expect(screen.getByTestId('snmp-row-companion_contacts')).toHaveTextContent('304');
    expect(screen.getByTestId('snmp-row-cfilter_enabled')).toHaveTextContent('Filter on: Yes');
    expect(screen.getByTestId('snmp-row-cfilter_sender_hidden')).toHaveTextContent('16');
    expect(screen.getByRole('button', { name: '+1 at 0' })).toBeInTheDocument();
    expect(screen.queryByTestId('snmp-group-filter')).toBeNull();
  });
});
