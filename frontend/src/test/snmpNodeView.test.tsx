import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { SnmpNodeView } from '../components/SnmpNodeView';
import { SNMP_FIELDS, formatSnmpValue } from '../components/snmp/snmpFields';
import type { SnmpChartSeries } from '../components/snmp/SnmpSeriesChart';
import type { SnmpHistoryEntry, SnmpNodeOverview, SnmpPollResponse, SnmpValues } from '../types';

const mocks = vi.hoisted(() => ({
  snmpNodes: vi.fn(),
  snmpHistoryRange: vi.fn(),
  pollSnmp: vi.fn(),
  discoverSnmpAddress: vi.fn(),
  saveSnmpConfig: vi.fn(),
  deleteSnmpConfig: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

// The real chart needs a layout; this stand-in shows what each chart was given.
vi.mock('../components/snmp/SnmpSeriesChart', () => ({
  SnmpSeriesChart: ({
    series,
    format,
  }: {
    series: SnmpChartSeries[];
    format: (value: number) => string;
  }) => (
    <ul data-testid="chart-series">
      {series.map((s) => (
        <li key={s.key} data-series={s.key} data-points={JSON.stringify(s.points)}>
          {s.label}: {s.points.length > 0 ? format(s.points[s.points.length - 1].value) : 'none'}
        </li>
      ))}
    </ul>
  ),
}));

const KEY = 'ab'.repeat(32);
const NOW = 1_800_000_000;

function values(overrides: SnmpValues = {}): SnmpValues {
  return {
    node_name: 'Heltec Repeater',
    firmware_version: 'v1.17.1',
    uptime_secs: 3725,
    packets_recv: 100,
    packets_sent: 50,
    recv_errors: 3,
    noise_floor: -96,
    last_rssi: -70,
    last_snr: -7.5,
    sent_flood: 10,
    sent_direct: 40,
    recv_flood: 60,
    recv_direct: 40,
    total_air_time_secs: 120,
    mqtt_connected_slots: 2,
    mqtt_queue_depth: 0,
    mqtt_skipped_publishes: 1,
    free_heap: 199612,
    max_alloc: 110000,
    internal_free: 150000,
    psram_free: 0,
    wifi_rssi: -22,
    ...overrides,
  };
}

// Three polls a minute apart, then a reboot, then one more poll.
const HISTORY: SnmpHistoryEntry[] = [
  {
    timestamp: NOW - 240,
    values: values({ uptime_secs: 3605, packets_recv: 40, packets_sent: 20 }),
  },
  {
    timestamp: NOW - 180,
    values: values({ uptime_secs: 3665, packets_recv: 70, packets_sent: 25 }),
  },
  {
    timestamp: NOW - 120,
    values: values({ uptime_secs: 3725, packets_recv: 100, packets_sent: 50, free_heap: 180000 }),
  },
  { timestamp: NOW - 60, values: values({ uptime_secs: 20, packets_recv: 4, packets_sent: 1 }) },
  { timestamp: NOW, values: values({ uptime_secs: 80, packets_recv: 16, packets_sent: 4 }) },
];

function node(overrides: Partial<SnmpNodeOverview> = {}): SnmpNodeOverview {
  return {
    public_key: KEY,
    name: 'Alpha',
    type: 2,
    host: '192.168.50.95',
    port: 161,
    community_is_default: true,
    poll_enabled: true,
    poll_interval_minutes: 1,
    last_ok_at: NOW,
    last_error: null,
    last_error_at: null,
    latest: HISTORY[HISTORY.length - 1],
    ...overrides,
  };
}

const onBack = vi.fn();
const onOpenContactInfo = vi.fn();

function field(key: string) {
  const found = SNMP_FIELDS.find((f) => f.key === key);
  if (!found) throw new Error(`unknown field ${key}`);
  return found;
}

async function renderNode(nodes: SnmpNodeOverview[] = [node()], history = HISTORY) {
  mocks.snmpNodes.mockResolvedValue(nodes);
  mocks.snmpHistoryRange.mockResolvedValue(history);
  render(
    <I18nProvider>
      <SnmpNodeView publicKey={KEY} onBack={onBack} onOpenContactInfo={onOpenContactInfo} />
    </I18nProvider>
  );
  await waitFor(() => expect(mocks.snmpNodes).toHaveBeenCalled());
}

function chart(id: string) {
  return within(screen.getByTestId(`snmp-chart-${id}`));
}

function seriesPoints(id: string, key: string): { time: number; value: number }[] {
  const item = screen
    .getByTestId(`snmp-chart-${id}`)
    .querySelector<HTMLElement>(`[data-series="${key}"]`);
  if (!item) throw new Error(`no series ${key} in chart ${id}`);
  return JSON.parse(item.dataset.points ?? '[]');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SnmpNodeView', () => {
  it('shows the node, its state and the stored history of the last 24 hours', async () => {
    await renderNode();

    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByText('192.168.50.95:161')).toBeInTheDocument();
    expect(screen.getByTestId('snmp-node-status')).toHaveTextContent('OK');
    await waitFor(() => expect(mocks.snmpHistoryRange).toHaveBeenCalledTimes(1));
    expect(mocks.snmpHistoryRange.mock.calls[0].slice(0, 3)).toEqual([
      KEY,
      NOW - 24 * 3600,
      undefined,
    ]);

    const tiles = within(await screen.findByTestId('snmp-node-tiles'));
    expect(
      tiles.getByText(formatSnmpValue(field('uptime_secs'), { uptime_secs: 80 }))
    ).toBeTruthy();
    expect(tiles.getByText('v1.17.1')).toBeInTheDocument();
    expect(tiles.getByTestId('snmp-tile-reboots')).toHaveTextContent('1');
  });

  it('graphs counters as rates and leaves the reboot out', async () => {
    await renderNode();
    await screen.findByTestId('snmp-chart-packets');

    // 30 packets in each of the first two minutes; the reboot interval is
    // skipped; 12 packets in the last minute.
    expect(seriesPoints('packets', 'packets_recv')).toEqual([
      { time: NOW - 180, value: 30 },
      { time: NOW - 120, value: 30 },
      { time: NOW, value: 12 },
    ]);
    expect(seriesPoints('packets', 'packets_sent').map((p) => p.value)).toEqual([5, 25, 3]);
    expect(chart('packets').getByText(/Packets received: 12\.0 \/min/)).toBeInTheDocument();

    // Gauges are plotted as they are.
    expect(seriesPoints('memory', 'free_heap')).toHaveLength(5);
    expect(seriesPoints('memory', 'free_heap')[2]).toEqual({ time: NOW - 120, value: 180000 });
    expect(seriesPoints('noise_floor', 'noise_floor')[0].value).toBe(-96);
  });

  it('switches the counters to raw totals and remembers it', async () => {
    await renderNode();
    await screen.findByTestId('snmp-chart-packets');
    expect(screen.getByRole('button', { name: 'Rates' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Totals' }));

    expect(screen.getByRole('button', { name: 'Totals' })).toHaveAttribute('aria-pressed', 'true');
    expect(seriesPoints('packets', 'packets_recv').map((p) => p.value)).toEqual([
      40, 70, 100, 4, 16,
    ]);
    expect(chart('packets').getByText(/Packets received: 16$/)).toBeInTheDocument();
    expect(localStorage.getItem('rtfm-snmp-node-counters')).toBe('totals');
    // Gauges do not change with the switch.
    expect(seriesPoints('memory', 'free_heap')).toHaveLength(5);
  });

  it('has a chart for every value group and hides PSRAM on a node without it', async () => {
    await renderNode();
    await screen.findByTestId('snmp-chart-packets');

    for (const id of [
      'packets',
      'recv_route',
      'sent_route',
      'recv_errors',
      'air_time',
      'noise_floor',
      'last_rssi',
      'last_snr',
      'mqtt_slots',
      'mqtt_queue',
      'mqtt_skipped',
      'memory',
      'wifi_rssi',
      'uptime',
    ]) {
      expect(screen.getByTestId(`snmp-chart-${id}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('snmp-chart-psram')).toBeNull();
    // All 22 current values are listed too.
    expect(screen.getAllByTestId(/^snmp-row-/)).toHaveLength(22);
  });

  it('shows the PSRAM chart when the node reports some', async () => {
    const history = HISTORY.map((row) => ({
      ...row,
      values: { ...row.values, psram_free: 4_000_000 },
    }));
    await renderNode([node({ latest: history[history.length - 1] })], history);

    expect(await screen.findByTestId('snmp-chart-psram')).toBeInTheDocument();
  });

  it('leaves out every added chart and group for a node on older firmware', async () => {
    await renderNode();
    await screen.findByTestId('snmp-chart-packets');

    for (const id of ['battery', 'mcu_temp', 'dups', 'filter_drops', 'neighbours', 'tx_duty']) {
      expect(screen.queryByTestId(`snmp-chart-${id}`)).toBeNull();
    }
    for (const group of ['duty_gate', 'filter', 'neighbours']) {
      expect(screen.queryByTestId(`snmp-group-${group}`)).toBeNull();
    }
    expect(screen.queryByTestId('snmp-row-battery_mv')).toBeNull();
  });

  it('charts the added OIDs a room server serves, without sentinels', async () => {
    // A room server: no duty gate or filter OIDs. The battery reads 0 mV
    // (cannot measure) in one poll; the MCU has no temperature sensor.
    const added = [
      { battery_mv: 4105, flood_dups: 10, neighbour_count: 5 },
      { battery_mv: 0, flood_dups: 40, neighbour_count: 6 },
      { battery_mv: 4090, flood_dups: 70, neighbour_count: 6 },
      { battery_mv: 4080, flood_dups: 2, neighbour_count: 4 },
      { battery_mv: 4070, flood_dups: 14, neighbour_count: 4 },
    ];
    const history = HISTORY.map((row, i) => ({
      ...row,
      values: { ...row.values, ...added[i], mcu_temp_c: -127, ntp_synced: 1, error_flags: 5 },
    }));
    await renderNode([node({ latest: history[history.length - 1] })], history);
    await screen.findByTestId('snmp-chart-battery');

    expect(seriesPoints('battery', 'battery_mv').map((p) => p.value)).toEqual([
      4105, 4090, 4080, 4070,
    ]);
    expect(screen.queryByTestId('snmp-chart-mcu_temp')).toBeNull();
    expect(seriesPoints('neighbours', 'neighbour_count')).toHaveLength(5);
    // Duplicates per minute; the drop across the reboot gives no point.
    expect(seriesPoints('dups', 'flood_dups').map((p) => p.value)).toEqual([30, 30, 12]);
    expect(screen.queryByTestId('snmp-chart-filter_drops')).toBeNull();
    expect(screen.queryByTestId('snmp-chart-dc_gate_level')).toBeNull();
    expect(screen.queryByTestId('snmp-group-filter')).toBeNull();
    expect(screen.queryByTestId('snmp-group-duty_gate')).toBeNull();

    const rows = within(screen.getByTestId('snmp-values'));
    expect(rows.getByTestId('snmp-row-battery_mv')).toHaveTextContent('4.070 V');
    expect(rows.getByTestId('snmp-row-mcu_temp_c')).toHaveTextContent('n/a');
    expect(rows.getByTestId('snmp-row-ntp_synced')).toHaveTextContent('Yes');
    expect(rows.getByTestId('snmp-row-error_flags')).toHaveTextContent(
      'Packet pool full, Start-RX timeout'
    );
    expect(rows.getByTestId('snmp-row-neighbour_count')).toHaveTextContent('4');
  });

  it('charts filter drops per rule and starts again after clear stats', async () => {
    // Uptime keeps going up, so the drop at the 4th poll is `clear stats`.
    const drops = [0, 30, 60, 6, 18];
    const history = HISTORY.map((row, i) => ({
      ...row,
      values: {
        ...row.values,
        uptime_secs: 1000 + i * 60,
        filter_enabled: 1,
        filter_dry_run: 0,
        filter_rate_limit_drops: drops[i],
        filter_hop_limit_drops: 0,
        dc_gate_enabled: 1,
        dc_gate_level: i % 2,
      },
    }));
    await renderNode([node({ latest: history[history.length - 1] })], history);
    await screen.findByTestId('snmp-chart-filter_drops');

    expect(seriesPoints('filter_drops', 'filter_rate_limit_drops').map((p) => p.value)).toEqual([
      30, 30, 12,
    ]);
    // A rule that never dropped anything is not drawn.
    expect(
      screen
        .getByTestId('snmp-chart-filter_drops')
        .querySelector('[data-series="filter_hop_limit_drops"]')
    ).toBeNull();
    expect(seriesPoints('dc_gate_level', 'dc_gate_level')).toHaveLength(5);
    expect(screen.getByTestId('snmp-group-filter')).toBeInTheDocument();
    expect(screen.getByTestId('snmp-row-filter_dry_run')).toHaveTextContent('No');
    expect(screen.getByTestId('snmp-tile-reboots')).toHaveTextContent('0');
  });

  it('lists each reboot with the reset reason of the new boot', async () => {
    const history = HISTORY.map((row, i) =>
      i === 3
        ? {
            ...row,
            values: { ...row.values, reset_reason: 'Brownout (low voltage)', reset_reason_code: 9 },
          }
        : row
    );
    // A second reboot without the text, only the code.
    history.push({
      timestamp: NOW + 60,
      values: values({ uptime_secs: 5, reset_reason_code: 4 }),
    });
    await renderNode([node({ latest: history[history.length - 1] })], history);

    const list = within(await screen.findByTestId('snmp-node-reboots'));
    const items = list.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    // Newest first.
    expect(items[0]).toHaveTextContent('Panic (4)');
    expect(items[1]).toHaveTextContent('Brownout (low voltage)');
    expect(screen.getByTestId('snmp-tile-reboots')).toHaveTextContent('2');
  });

  it('charts a meshcomod companion: clients, contacts and the receive filter', async () => {
    const hidden = [0, 4, 8, 12, 16];
    const history = HISTORY.map((row, i) => ({
      ...row,
      values: {
        ...row.values,
        uptime_secs: 1000 + i * 60,
        companion_tcp_clients: 1,
        companion_ws_clients: i % 2,
        companion_contacts: 300 + i,
        companion_channels: 8,
        cfilter_enabled: 1,
        cfilter_sender_hidden: hidden[i],
        cfilter_text_hidden: 0,
      },
    }));
    await renderNode([node({ type: 1, latest: history[history.length - 1] })], history);
    await screen.findByTestId('snmp-chart-companion_clients');

    expect(seriesPoints('companion_clients', 'companion_ws_clients')).toHaveLength(5);
    expect(seriesPoints('companion_store', 'companion_contacts').map((p) => p.value)).toEqual([
      300, 301, 302, 303, 304,
    ]);
    // 4 hidden per minute; a rule reason that never hid anything is not drawn.
    expect(seriesPoints('cfilter', 'cfilter_sender_hidden').map((p) => p.value)).toEqual([
      4, 4, 4, 4,
    ]);
    expect(
      screen.getByTestId('snmp-chart-cfilter').querySelector('[data-series="cfilter_text_hidden"]')
    ).toBeNull();
    expect(screen.getByTestId('snmp-group-companion')).toBeInTheDocument();
    expect(screen.getByTestId('snmp-row-cfilter_enabled')).toHaveTextContent('Yes');
    // Not a repeater: no duty gate or repeater filter.
    expect(screen.queryByTestId('snmp-group-duty_gate')).toBeNull();
    expect(screen.queryByTestId('snmp-chart-filter_drops')).toBeNull();
  });

  it('shows the latest values as a dashboard on a wide screen', async () => {
    await renderNode();
    await screen.findByTestId('snmp-values');

    expect(screen.getByText('Radio traffic')).toBeInTheDocument();
    expect(within(screen.getByTestId('snmp-group-radio')).getByRole('table')).toBeInTheDocument();
  });

  it('keeps the plain value list on a phone', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...original(query),
      matches: query === '(max-width: 768px)',
    })) as typeof window.matchMedia;
    try {
      await renderNode();
      await screen.findByTestId('snmp-values');

      expect(screen.queryByText('Radio traffic')).toBeNull();
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.getAllByTestId(/^snmp-row-/)).toHaveLength(22);
    } finally {
      window.matchMedia = original;
    }
  });

  it('says the reason was not reported on older firmware', async () => {
    await renderNode();

    const list = within(await screen.findByTestId('snmp-node-reboots'));
    expect(list.getByRole('listitem')).toHaveTextContent('Reason not reported');
  });

  it('loads another period when the range changes', async () => {
    await renderNode();
    await waitFor(() => expect(mocks.snmpHistoryRange).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    await waitFor(() => expect(mocks.snmpHistoryRange).toHaveBeenCalledTimes(2));
    expect(mocks.snmpHistoryRange.mock.calls[1].slice(0, 3)).toEqual([
      KEY,
      NOW - 7 * 24 * 3600,
      undefined,
    ]);
    expect(JSON.parse(localStorage.getItem('rtfm-snmp-node-window') ?? '{}').id).toBe('7d');
  });

  it('loads a custom period with a start and an end', async () => {
    const start = '2026-10-01T10:00';
    const end = '2026-10-02T10:00';
    localStorage.setItem(
      'rtfm-snmp-node-window',
      JSON.stringify({ id: 'custom', customStart: start, customEnd: end })
    );
    await renderNode();

    await waitFor(() => expect(mocks.snmpHistoryRange).toHaveBeenCalledTimes(1));
    expect(mocks.snmpHistoryRange.mock.calls[0].slice(0, 3)).toEqual([
      KEY,
      Math.floor(new Date(start).getTime() / 1000),
      Math.floor(new Date(end).getTime() / 1000),
    ]);
  });

  it('asks for a period when Custom is chosen and loads nothing until Apply', async () => {
    await renderNode();
    await screen.findByTestId('snmp-chart-packets');

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    expect(await screen.findByTestId('snmp-node-custom-hint')).toHaveTextContent(
      'Choose a start and an end, then press Apply.'
    );
    expect(screen.queryByTestId('snmp-chart-packets')).toBeNull();
    expect(mocks.snmpHistoryRange).toHaveBeenCalledTimes(1);
  });

  it('polls the node and reloads the history', async () => {
    await renderNode();
    await waitFor(() => expect(mocks.snmpHistoryRange).toHaveBeenCalledTimes(1));
    mocks.pollSnmp.mockResolvedValue({
      ok: true,
      timestamp: NOW + 5,
      host: '192.168.50.95',
      port: 161,
      error: null,
      values: values({ free_heap: 123456 }),
    } satisfies SnmpPollResponse);

    fireEvent.click(screen.getByRole('button', { name: 'Poll now' }));

    await waitFor(() => expect(mocks.snmpHistoryRange).toHaveBeenCalledTimes(2));
    expect(mocks.pollSnmp).toHaveBeenCalledWith(KEY);
    expect(
      within(screen.getByTestId('snmp-node-tiles')).getByText(
        formatSnmpValue(field('free_heap'), { free_heap: 123456 })
      )
    ).toBeInTheDocument();
    expect(mocks.discoverSnmpAddress).not.toHaveBeenCalled();
    expect(mocks.saveSnmpConfig).not.toHaveBeenCalled();
    expect(mocks.deleteSnmpConfig).not.toHaveBeenCalled();
  });

  it('makes a failing node stand out with its error', async () => {
    await renderNode([
      node({ last_error: 'no SNMP reply from 192.168.50.95:161', last_error_at: NOW - 30 }),
    ]);

    expect(await screen.findByTestId('snmp-node-status')).toHaveTextContent('Failing');
    expect(screen.getByTestId('snmp-node-error')).toHaveTextContent(
      'no SNMP reply from 192.168.50.95:161'
    );
  });

  it('says so when there are too few stored polls for a chart', async () => {
    await renderNode([node()], [HISTORY[0]]);

    const card = await screen.findByTestId('snmp-chart-noise_floor');
    expect(within(card).getByText(/Not enough stored polls/)).toBeInTheDocument();
    expect(within(card).queryByTestId('chart-series')).toBeNull();
  });

  it('goes back to the overview and opens the contact page', async () => {
    await renderNode();
    await screen.findByRole('heading', { name: 'Alpha' });

    fireEvent.click(screen.getByRole('button', { name: 'All SNMP nodes' }));
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open contact page' }));
    expect(onOpenContactInfo).toHaveBeenCalledWith(KEY);
  });

  it('does not load history under a new key with the previous node still in state', async () => {
    const OTHER = 'cd'.repeat(32);
    mocks.snmpNodes.mockResolvedValue([node()]);
    mocks.snmpHistoryRange.mockResolvedValue(HISTORY);
    const view = render(
      <I18nProvider>
        <SnmpNodeView publicKey={KEY} onBack={onBack} onOpenContactInfo={onOpenContactInfo} />
      </I18nProvider>
    );
    await waitFor(() => expect(mocks.snmpHistoryRange).toHaveBeenCalledTimes(1));

    view.rerender(
      <I18nProvider>
        <SnmpNodeView publicKey={OTHER} onBack={onBack} onOpenContactInfo={onOpenContactInfo} />
      </I18nProvider>
    );

    expect(await screen.findByTestId('snmp-node-missing')).toBeInTheDocument();
    expect(mocks.snmpHistoryRange.mock.calls.map((call) => call[0])).toEqual([KEY]);
  });

  it('explains when the node has no SNMP settings', async () => {
    await renderNode([node({ public_key: 'cd'.repeat(32) })]);

    expect(await screen.findByTestId('snmp-node-missing')).toHaveTextContent(
      'SNMP is not set up for this node'
    );
    expect(mocks.snmpHistoryRange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'All SNMP nodes' }));
    expect(onBack).toHaveBeenCalled();
  });
});
