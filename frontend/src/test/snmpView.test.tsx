import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { SnmpView } from '../components/SnmpView';
import { SNMP_FIELDS, formatSnmpValue } from '../components/snmp/snmpFields';
import type { SnmpNodeOverview, SnmpPollResponse, SnmpValues } from '../types';

const mocks = vi.hoisted(() => ({
  snmpNodes: vi.fn(),
  pollSnmp: vi.fn(),
  snmpHistory: vi.fn(),
  discoverSnmpAddress: vi.fn(),
  saveSnmpConfig: vi.fn(),
  deleteSnmpConfig: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

const KEY_A = 'aa'.repeat(32);
const KEY_B = 'bb'.repeat(32);
const KEY_C = 'cc'.repeat(32);

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
    psram_free: null,
    wifi_rssi: -22,
    ...overrides,
  };
}

function node(overrides: Partial<SnmpNodeOverview> = {}): SnmpNodeOverview {
  return {
    public_key: KEY_A,
    name: 'Alpha',
    type: 2,
    host: '192.168.50.95',
    port: 161,
    community_is_default: true,
    poll_enabled: true,
    poll_interval_minutes: 5,
    last_ok_at: 1700000000,
    last_error: null,
    last_error_at: null,
    latest: { timestamp: 1700000000, values: values() },
    ...overrides,
  };
}

const ALPHA = node();
const BRAVO = node({
  public_key: KEY_B,
  name: 'Bravo',
  type: 3,
  host: 'bravo.lan',
  port: 1161,
  poll_enabled: false,
  latest: { timestamp: 1700000100, values: values({ free_heap: 50000, wifi_rssi: -60 }) },
});
const FAILING = node({
  public_key: KEY_C,
  name: 'Zulu',
  host: '10.0.0.9',
  last_ok_at: null,
  last_error: 'No reply from 10.0.0.9:161',
  last_error_at: 1700000200,
  latest: null,
});

function pollOk(overrides: SnmpValues = {}): SnmpPollResponse {
  return {
    ok: true,
    timestamp: 1700009999,
    host: '192.168.50.95',
    port: 161,
    error: null,
    values: values(overrides),
  };
}

function field(key: string) {
  const found = SNMP_FIELDS.find((f) => f.key === key);
  if (!found) throw new Error(`unknown field ${key}`);
  return found;
}

const onOpenContactInfo = vi.fn();
const onOpenNode = vi.fn();

async function renderView(nodes: SnmpNodeOverview[]) {
  mocks.snmpNodes.mockResolvedValue(nodes);
  render(
    <I18nProvider>
      <SnmpView onOpenContactInfo={onOpenContactInfo} onOpenNode={onOpenNode} />
    </I18nProvider>
  );
  await waitFor(() => expect(mocks.snmpNodes).toHaveBeenCalled());
}

function rowOf(key: string): HTMLElement {
  return screen.getByTestId(`snmp-node-${key}`);
}

function rowOrder(): string[] {
  return screen
    .getAllByTestId(/^snmp-node-[0-9a-f]{64}$/)
    .map((row) => row.getAttribute('data-testid')!.slice('snmp-node-'.length));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.snmpHistory.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('SnmpView overview', () => {
  it('explains how to set SNMP up when no node has it', async () => {
    await renderView([]);

    const empty = await screen.findByTestId('snmp-empty');
    expect(empty).toHaveTextContent('No node has SNMP set up yet');
    expect(empty).toHaveTextContent('Set up SNMP');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Poll all now' })).toBeDisabled();
  });

  it('shows one row per node with address, schedule and the key values', async () => {
    await renderView([ALPHA, BRAVO]);

    const alpha = within(await screen.findByTestId(`snmp-node-${KEY_A}`));
    expect(alpha.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(alpha.getByText('192.168.50.95:161')).toBeInTheDocument();
    expect(alpha.getByText('5 min')).toBeInTheDocument();
    expect(alpha.getByText('v1.17.1')).toBeInTheDocument();
    const shown = values();
    for (const key of [
      'uptime_secs',
      'free_heap',
      'max_alloc',
      'mqtt_connected_slots',
      'mqtt_queue_depth',
      'wifi_rssi',
      'noise_floor',
      'recv_errors',
      'last_rssi',
      'last_snr',
    ]) {
      expect(alpha.getByTestId(`snmp-cell-${key}`)).toHaveTextContent(
        formatSnmpValue(field(key), shown)
      );
    }

    const bravo = within(rowOf(KEY_B));
    expect(bravo.getByText('bravo.lan:1161')).toBeInTheDocument();
    expect(bravo.getByText('Off')).toBeInTheDocument();
  });

  it('makes a failing node stand out and lists it first', async () => {
    await renderView([ALPHA, BRAVO, FAILING]);

    const failing = await screen.findByTestId(`snmp-node-${KEY_C}`);
    expect(failing).toHaveAttribute('data-status', 'failing');
    expect(within(failing).getByText('Failing')).toBeInTheDocument();
    expect(within(failing).getByText('No reply from 10.0.0.9:161')).toBeInTheDocument();
    expect(rowOf(KEY_A)).toHaveAttribute('data-status', 'ok');
    expect(rowOrder()).toEqual([KEY_C, KEY_A, KEY_B]);
  });

  it('sorts by a column header, both ways, with missing values last', async () => {
    await renderView([ALPHA, BRAVO, FAILING]);
    await screen.findByTestId(`snmp-node-${KEY_A}`);

    const header = screen.getByRole('columnheader', { name: /Free heap/ });
    fireEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(rowOrder()).toEqual([KEY_B, KEY_A, KEY_C]);

    fireEvent.click(within(header).getByRole('button'));
    expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(rowOrder()).toEqual([KEY_A, KEY_B, KEY_C]);

    const nodeHeader = screen.getByRole('columnheader', { name: /Node/ });
    fireEvent.click(within(nodeHeader).getByRole('button'));
    expect(rowOrder()).toEqual([KEY_A, KEY_B, KEY_C]);
    fireEvent.click(within(nodeHeader).getByRole('button'));
    expect(rowOrder()).toEqual([KEY_C, KEY_B, KEY_A]);
  });

  it('opens the contact page from the node name', async () => {
    await renderView([ALPHA]);

    fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }));
    expect(onOpenContactInfo).toHaveBeenCalledWith(KEY_A);
  });

  it('shows a load failure', async () => {
    mocks.snmpNodes.mockRejectedValue(new Error('boom'));
    render(
      <I18nProvider>
        <SnmpView onOpenContactInfo={onOpenContactInfo} onOpenNode={onOpenNode} />
      </I18nProvider>
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});

describe('SnmpView full page link', () => {
  it('opens the full page of a node from the arrow, without polling or expanding', async () => {
    await renderView([ALPHA, BRAVO]);
    await screen.findByTestId(`snmp-node-${KEY_A}`);

    fireEvent.click(screen.getByRole('button', { name: 'Open the SNMP page of Alpha' }));

    expect(onOpenNode).toHaveBeenCalledTimes(1);
    expect(onOpenNode).toHaveBeenCalledWith(KEY_A);
    expect(screen.queryByTestId('snmp-values')).toBeNull();
    expect(screen.queryByTestId('snmp-history')).toBeNull();
    expect(mocks.pollSnmp).not.toHaveBeenCalled();
    expect(mocks.snmpHistory).not.toHaveBeenCalled();
  });

  it('opens the full page from a click on the row', async () => {
    await renderView([ALPHA, BRAVO]);

    fireEvent.click(
      within(await screen.findByTestId(`snmp-node-${KEY_B}`)).getByText('bravo.lan:1161')
    );

    expect(onOpenNode).toHaveBeenCalledWith(KEY_B);
  });

  it('keeps the name and Poll now to their own jobs', async () => {
    await renderView([ALPHA]);
    mocks.pollSnmp.mockResolvedValue(pollOk());

    fireEvent.click(await screen.findByRole('button', { name: 'Alpha' }));
    expect(onOpenContactInfo).toHaveBeenCalledWith(KEY_A);
    fireEvent.click(within(rowOf(KEY_A)).getByRole('button', { name: 'Poll now' }));
    await waitFor(() => expect(mocks.pollSnmp).toHaveBeenCalledWith(KEY_A));

    expect(onOpenNode).not.toHaveBeenCalled();
  });
});

describe('SnmpView polling', () => {
  it('polls one node and shows the new values and outcome', async () => {
    await renderView([ALPHA, FAILING]);
    mocks.pollSnmp.mockResolvedValue(pollOk({ free_heap: 123456 }));

    const failing = within(await screen.findByTestId(`snmp-node-${KEY_C}`));
    fireEvent.click(failing.getByRole('button', { name: 'Poll now' }));

    await waitFor(() => expect(rowOf(KEY_C)).toHaveAttribute('data-status', 'ok'));
    expect(mocks.pollSnmp).toHaveBeenCalledTimes(1);
    expect(mocks.pollSnmp).toHaveBeenCalledWith(KEY_C);
    expect(within(rowOf(KEY_C)).getByTestId('snmp-cell-free_heap')).toHaveTextContent(
      formatSnmpValue(field('free_heap'), { free_heap: 123456 })
    );
    expect(within(rowOf(KEY_C)).queryByText('No reply from 10.0.0.9:161')).toBeNull();
  });

  it('marks a node as failing when its poll fails and keeps the old values', async () => {
    await renderView([ALPHA]);
    mocks.pollSnmp.mockResolvedValue({
      ok: false,
      timestamp: 1700009999,
      host: '192.168.50.95',
      port: 161,
      error: 'No reply from 192.168.50.95:161',
      values: null,
    } satisfies SnmpPollResponse);

    const alpha = within(await screen.findByTestId(`snmp-node-${KEY_A}`));
    fireEvent.click(alpha.getByRole('button', { name: 'Poll now' }));

    await waitFor(() => expect(rowOf(KEY_A)).toHaveAttribute('data-status', 'failing'));
    expect(within(rowOf(KEY_A)).getByText('No reply from 192.168.50.95:161')).toBeInTheDocument();
    expect(within(rowOf(KEY_A)).getByTestId('snmp-cell-free_heap')).toHaveTextContent(
      formatSnmpValue(field('free_heap'), values())
    );
  });

  it('polls every node one after the other with Poll all now', async () => {
    await renderView([ALPHA, BRAVO, FAILING]);
    await screen.findByTestId(`snmp-node-${KEY_A}`);
    const release: Record<string, (value: SnmpPollResponse) => void> = {};
    mocks.pollSnmp.mockImplementation(
      (key: string) =>
        new Promise<SnmpPollResponse>((resolve) => {
          release[key] = resolve;
        })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Poll all now' }));

    // Shown order: the failing node first, then by name.
    await waitFor(() => expect(mocks.pollSnmp).toHaveBeenCalledTimes(1));
    expect(mocks.pollSnmp).toHaveBeenLastCalledWith(KEY_C);
    expect(screen.getByTestId('snmp-poll-all')).toHaveTextContent('Polling 1 of 3...');
    expect(screen.getByTestId('snmp-poll-all')).toBeDisabled();

    await act(async () => release[KEY_C](pollOk()));
    await waitFor(() => expect(mocks.pollSnmp).toHaveBeenCalledTimes(2));
    expect(mocks.pollSnmp).toHaveBeenLastCalledWith(KEY_A);

    await act(async () => release[KEY_A](pollOk()));
    await waitFor(() => expect(mocks.pollSnmp).toHaveBeenCalledTimes(3));
    expect(mocks.pollSnmp).toHaveBeenLastCalledWith(KEY_B);

    await act(async () => release[KEY_B](pollOk()));
    await waitFor(() =>
      expect(screen.getByTestId('snmp-poll-all')).toHaveTextContent('Poll all now')
    );
    expect(mocks.pollSnmp).toHaveBeenCalledTimes(3);
    // The page never asks a node for its address: that would transmit over RF.
    expect(mocks.discoverSnmpAddress).not.toHaveBeenCalled();
    expect(mocks.saveSnmpConfig).not.toHaveBeenCalled();
    expect(mocks.deleteSnmpConfig).not.toHaveBeenCalled();
  });

  it('goes on with the next node when one poll request fails', async () => {
    await renderView([ALPHA, BRAVO]);
    await screen.findByTestId(`snmp-node-${KEY_A}`);
    mocks.pollSnmp.mockRejectedValueOnce(new Error('HTTP 500')).mockResolvedValueOnce(pollOk());

    fireEvent.click(screen.getByRole('button', { name: 'Poll all now' }));

    await waitFor(() => expect(mocks.pollSnmp).toHaveBeenCalledTimes(2));
    expect(mocks.pollSnmp.mock.calls.map((call) => call[0])).toEqual([KEY_A, KEY_B]);
    expect(await within(rowOf(KEY_A)).findByRole('alert')).toHaveTextContent('HTTP 500');
  });
});

describe('SnmpView refresh', () => {
  it('re-reads the stored data on the chosen interval, 30 s by default', async () => {
    vi.useFakeTimers();
    await act(async () => {
      mocks.snmpNodes.mockResolvedValue([ALPHA]);
      render(
        <I18nProvider>
          <SnmpView onOpenContactInfo={onOpenContactInfo} onOpenNode={onOpenNode} />
        </I18nProvider>
      );
    });
    expect(mocks.snmpNodes).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Auto refresh')).toHaveValue('30');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    expect(mocks.snmpNodes).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(mocks.snmpNodes).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByLabelText('Auto refresh'), { target: { value: '10' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(mocks.snmpNodes).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem('rtfm-snmp-refresh-seconds')).toBe('10');

    fireEvent.change(screen.getByLabelText('Auto refresh'), { target: { value: '0' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(mocks.snmpNodes).toHaveBeenCalledTimes(3);
    // Refreshing only re-reads stored data; it never polls a node.
    expect(mocks.pollSnmp).not.toHaveBeenCalled();
  });

  it('remembers the chosen interval and reloads on the Refresh button', async () => {
    localStorage.setItem('rtfm-snmp-refresh-seconds', '60');
    await renderView([ALPHA]);
    await screen.findByTestId(`snmp-node-${KEY_A}`);
    expect(screen.getByLabelText('Auto refresh')).toHaveValue('60');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(mocks.snmpNodes).toHaveBeenCalledTimes(2));
  });
});
