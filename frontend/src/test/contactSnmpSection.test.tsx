import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { ContactSnmpSection } from '../components/snmp/ContactSnmpSection';
import { toChartPoints } from '../components/snmp/SnmpHistoryChart';
import { SNMP_FIELDS, formatBytes, formatSnmpValue } from '../components/snmp/snmpFields';
import type { Contact, ContactSnmpConfig, SnmpHistoryEntry, SnmpPollResponse } from '../types';

const mocks = vi.hoisted(() => ({
  getSnmpConfig: vi.fn(),
  saveSnmpConfig: vi.fn(),
  deleteSnmpConfig: vi.fn(),
  pollSnmp: vi.fn(),
  discoverSnmpAddress: vi.fn(),
  snmpHistory: vi.fn(),
}));

vi.mock('../api', () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message);
    }
  }
  return { api: mocks, ApiError, isAbortError: () => false };
});

const KEY = 'ab'.repeat(32);

const contact = {
  public_key: KEY,
  name: 'Observer',
  type: 2,
  flags: 0,
  direct_path: null,
  direct_path_len: -1,
  direct_path_hash_mode: -1,
  last_advert: null,
  lat: null,
  lon: null,
  last_seen: null,
  on_radio: false,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
} as Contact;

function config(overrides: Partial<ContactSnmpConfig> = {}): ContactSnmpConfig {
  return {
    public_key: KEY,
    host: '192.168.50.95',
    port: 161,
    community_is_default: true,
    poll_enabled: false,
    poll_interval_minutes: 5,
    last_ok_at: null,
    last_error: null,
    last_error_at: null,
    ...overrides,
  };
}

function pollOk(): SnmpPollResponse {
  return {
    ok: true,
    timestamp: 1700000000,
    host: '192.168.50.95',
    port: 161,
    error: null,
    values: {
      node_name: 'Heltec Repeater',
      firmware_version: 'v1.17.1',
      uptime_secs: 3725,
      noise_floor: -96,
      last_snr: -7.5,
      free_heap: 199612,
      psram_free: null,
      wifi_rssi: -22,
    },
  };
}

async function renderSection() {
  render(
    <I18nProvider>
      <ContactSnmpSection contact={contact} />
    </I18nProvider>
  );
  await waitFor(() => expect(mocks.getSnmpConfig).toHaveBeenCalled());
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.snmpHistory.mockResolvedValue([]);
});

describe('snmpFields', () => {
  it('lists the 22 firmware values once each', () => {
    expect(SNMP_FIELDS).toHaveLength(22);
    expect(new Set(SNMP_FIELDS.map((f) => f.key)).size).toBe(22);
  });

  it('formats by unit and shows a dash for a missing value', () => {
    const field = (key: string) => SNMP_FIELDS.find((f) => f.key === key)!;
    const values = pollOk().values!;
    expect(formatSnmpValue(field('uptime_secs'), values)).toBe('1h2m');
    expect(formatSnmpValue(field('noise_floor'), values)).toBe('-96 dBm');
    expect(formatSnmpValue(field('last_snr'), values)).toBe('-7.5 dB');
    expect(formatSnmpValue(field('free_heap'), values)).toBe('194.9 KiB');
    expect(formatSnmpValue(field('psram_free'), values)).toBe('-');
    expect(formatSnmpValue(field('packets_recv'), values)).toBe('-');
    expect(formatSnmpValue(field('node_name'), values)).toBe('Heltec Repeater');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4 * 1024 * 1024)).toBe('4.00 MiB');
  });
});

describe('ContactSnmpSection', () => {
  it('offers setup when nothing is configured', async () => {
    mocks.getSnmpConfig.mockResolvedValue(null);
    await renderSection();
    expect(await screen.findByRole('button', { name: 'Set up SNMP' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Poll now' })).toBeNull();
  });

  it('saves host, port and community; the community is not shown afterwards', async () => {
    mocks.getSnmpConfig.mockResolvedValue(null);
    mocks.saveSnmpConfig.mockResolvedValue(config({ community_is_default: false }));
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up SNMP' }));

    fireEvent.change(screen.getByLabelText('Host or IP address'), {
      target: { value: ' 192.168.50.95 ' },
    });
    fireEvent.change(screen.getByLabelText('Community'), { target: { value: 's3cret' } });
    expect(screen.getByLabelText('Community')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.saveSnmpConfig).toHaveBeenCalledTimes(1));
    expect(mocks.saveSnmpConfig).toHaveBeenCalledWith(KEY, {
      host: '192.168.50.95',
      port: 161,
      community: 's3cret',
      poll_enabled: false,
      poll_interval_minutes: 5,
    });
    expect(await screen.findByRole('button', { name: 'Poll now' })).toBeInTheDocument();
    expect(screen.getByText('192.168.50.95:161')).toBeInTheDocument();
    expect(screen.queryByText(/s3cret/)).toBeNull();
    expect(screen.queryByDisplayValue('s3cret')).toBeNull();
  });

  it('sends a null community when the field is left empty (keep the stored one)', async () => {
    mocks.getSnmpConfig.mockResolvedValue(config({ poll_enabled: true }));
    mocks.saveSnmpConfig.mockResolvedValue(config({ host: '10.0.0.2', poll_enabled: true }));
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Host or IP address')).toHaveValue('192.168.50.95');
    expect(screen.getByLabelText('Community')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Host or IP address'), {
      target: { value: '10.0.0.2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.saveSnmpConfig).toHaveBeenCalledTimes(1));
    expect(mocks.saveSnmpConfig).toHaveBeenCalledWith(KEY, {
      host: '10.0.0.2',
      port: 161,
      community: null,
      poll_enabled: true,
      poll_interval_minutes: 5,
    });
  });

  it.each([
    ['http://node.lan', '161', 'Enter an IP address or hostname'],
    ['node lan', '161', 'Enter an IP address or hostname'],
    ['', '161', 'Enter an IP address or hostname'],
    ['192.168.1.20', '0', 'Port must be between 1 and 65535'],
    ['192.168.1.20', '70000', 'Port must be between 1 and 65535'],
    ['192.168.1.20', 'abc', 'Port must be between 1 and 65535'],
  ])('refuses host=%s port=%s before any request', async (host, port, message) => {
    mocks.getSnmpConfig.mockResolvedValue(null);
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up SNMP' }));
    fireEvent.change(screen.getByLabelText('Host or IP address'), { target: { value: host } });
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: port } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(mocks.saveSnmpConfig).not.toHaveBeenCalled();
  });

  it('Poll now shows the values grouped, with units', async () => {
    mocks.getSnmpConfig.mockResolvedValue(config());
    mocks.pollSnmp.mockResolvedValue(pollOk());
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Poll now' }));

    const values = await screen.findByTestId('snmp-values');
    expect(mocks.pollSnmp).toHaveBeenCalledWith(KEY);
    expect(within(values).getByText('System')).toBeInTheDocument();
    expect(within(values).getByText('Memory')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('snmp-row-node_name')).getByText('Heltec Repeater')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('snmp-row-uptime_secs')).getByText('1h2m')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('snmp-row-wifi_rssi')).getByText('-22 dBm')
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('snmp-row-psram_free')).getByText('-')).toBeInTheDocument();
    expect(screen.getByTestId('snmp-status')).toHaveTextContent('Last good poll:');
  });

  it('a failed poll shows the reason and no value table', async () => {
    mocks.getSnmpConfig.mockResolvedValue(config());
    mocks.pollSnmp.mockResolvedValue({
      ok: false,
      timestamp: 1700000000,
      host: '192.168.50.95',
      port: 161,
      error: 'no SNMP reply from 192.168.50.95:161',
      values: null,
    });
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Poll now' }));

    expect(await screen.findByTestId('snmp-last-error')).toHaveTextContent(
      'no SNMP reply from 192.168.50.95:161'
    );
    expect(screen.queryByTestId('snmp-values')).toBeNull();
    expect(screen.getByTestId('snmp-status')).toHaveTextContent('Not polled yet.');
  });

  it('Ask node needs a second click, then fills in the reported address', async () => {
    mocks.getSnmpConfig.mockResolvedValue(null);
    mocks.discoverSnmpAddress.mockResolvedValue({
      status: 'ok',
      ip: '192.168.50.95',
      reply: 'connected, IP: 192.168.50.95, RSSI: -22 dBm',
    });
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up SNMP' }));

    fireEvent.click(screen.getByRole('button', { name: 'Ask node for its address' }));
    expect(mocks.discoverSnmpAddress).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: send 1 packet over RF' }));

    await waitFor(() => expect(mocks.discoverSnmpAddress).toHaveBeenCalledTimes(1));
    expect(mocks.discoverSnmpAddress).toHaveBeenCalledWith(KEY);
    await waitFor(() =>
      expect(screen.getByLabelText('Host or IP address')).toHaveValue('192.168.50.95')
    );
    expect(screen.getByTestId('snmp-ask-note')).toHaveTextContent('The node reports 192.168.50.95');
    // The lookup only fills the form; nothing is saved until the user saves.
    expect(mocks.saveSnmpConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['no_reply', null, 'No reply. Log in to the node as admin first'],
    ['unsupported', '??: wifi.status', 'does not know the command'],
    ['no_address', 'disconnected', 'no WiFi address right now (disconnected)'],
  ])('Ask node explains status %s and leaves the host alone', async (status, reply, text) => {
    mocks.getSnmpConfig.mockResolvedValue(null);
    mocks.discoverSnmpAddress.mockResolvedValue({ status, ip: null, reply });
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Set up SNMP' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask node for its address' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: send 1 packet over RF' }));

    expect(await screen.findByTestId('snmp-ask-note')).toHaveTextContent(text);
    expect(screen.getByLabelText('Host or IP address')).toHaveValue('');
  });

  it('Remove needs a second click', async () => {
    mocks.getSnmpConfig.mockResolvedValue(config());
    mocks.deleteSnmpConfig.mockResolvedValue({ status: 'ok', deleted: true });
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(mocks.deleteSnmpConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));

    await waitFor(() => expect(mocks.deleteSnmpConfig).toHaveBeenCalledWith(KEY));
    expect(await screen.findByRole('button', { name: 'Set up SNMP' })).toBeInTheDocument();
  });
});

describe('ContactSnmpSection schedule and history', () => {
  it('turns scheduled polling on with an interval', async () => {
    mocks.getSnmpConfig.mockResolvedValue(config());
    mocks.saveSnmpConfig.mockResolvedValue(
      config({ poll_enabled: true, poll_interval_minutes: 15 })
    );
    await renderSection();
    expect(await screen.findByTestId('snmp-status')).toHaveTextContent('Scheduled polling is off.');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByLabelText('Every (minutes)')).toBeNull();
    fireEvent.click(screen.getByLabelText('Poll on a schedule'));
    fireEvent.change(screen.getByLabelText('Every (minutes)'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.saveSnmpConfig).toHaveBeenCalledTimes(1));
    expect(mocks.saveSnmpConfig).toHaveBeenCalledWith(KEY, {
      host: '192.168.50.95',
      port: 161,
      community: null,
      poll_enabled: true,
      poll_interval_minutes: 15,
    });
    expect(await screen.findByTestId('snmp-status')).toHaveTextContent('Scheduled every 15 min.');
  });

  it.each(['0', '1441', 'x'])('refuses interval %s', async (interval) => {
    mocks.getSnmpConfig.mockResolvedValue(config({ poll_enabled: true }));
    await renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Every (minutes)'), { target: { value: interval } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Interval must be between 1 and 1440 minutes'
    );
    expect(mocks.saveSnmpConfig).not.toHaveBeenCalled();
  });

  it('loads 24 hours of history and says so when there is too little to chart', async () => {
    mocks.getSnmpConfig.mockResolvedValue(config());
    await renderSection();
    expect(await screen.findByTestId('snmp-history-empty')).toBeInTheDocument();
    expect(mocks.snmpHistory).toHaveBeenCalledWith(KEY, 24, expect.anything());
  });

  it('draws a chart for the chosen value and reloads on range change and after a poll', async () => {
    mocks.getSnmpConfig.mockResolvedValue(config());
    mocks.pollSnmp.mockResolvedValue(pollOk());
    mocks.snmpHistory.mockResolvedValue([
      { timestamp: 1700000000, values: { free_heap: 199612, wifi_rssi: -22 } },
      { timestamp: 1700000300, values: { free_heap: 198000, wifi_rssi: -25 } },
    ]);
    await renderSection();

    expect(
      await screen.findByRole('img', { name: 'SNMP history chart: Free heap' })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Value to chart'), { target: { value: 'wifi_rssi' } });
    expect(screen.getByRole('img', { name: 'SNMP history chart: WiFi RSSI' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Time range'), { target: { value: '168' } });
    await waitFor(() =>
      expect(mocks.snmpHistory).toHaveBeenCalledWith(KEY, 168, expect.anything())
    );

    const before = mocks.snmpHistory.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Poll now' }));
    await waitFor(() => expect(mocks.snmpHistory.mock.calls.length).toBe(before + 1));
  });

  it('toChartPoints keeps numeric values only', () => {
    const history: SnmpHistoryEntry[] = [
      { timestamp: 10, values: { free_heap: 5, node_name: 'Obs' } },
      { timestamp: 20, values: { free_heap: null } },
      { timestamp: 30, values: {} },
      { timestamp: 40, values: { free_heap: 7 } },
    ];
    expect(toChartPoints(history, 'free_heap')).toEqual([
      { time: 10, value: 5 },
      { time: 40, value: 7 },
    ]);
    expect(toChartPoints(history, 'node_name')).toEqual([]);
  });
});
