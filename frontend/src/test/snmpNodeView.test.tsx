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
