import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { LanScanView, isMeshcoreHost, snmpSetupState } from '../components/LanScanView';
import type { LanScanHost, LanScanStatus } from '../types';

const mocks = vi.hoisted(() => ({
  lanScanSuggestions: vi.fn(),
  lanScanStatus: vi.fn(),
  startLanScan: vi.fn(),
  cancelLanScan: vi.fn(),
  saveSnmpConfig: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

const KEY = 'ab'.repeat(32);

function host(overrides: Partial<LanScanHost> = {}): LanScanHost {
  return {
    ip: '192.168.1.45',
    snmp: null,
    companion: null,
    webconfig: null,
    contact: null,
    ...overrides,
  };
}

const SNMP_OBSERVER: LanScanHost = host({
  snmp: {
    kind: 'meshcore',
    node_name: 'Observer',
    firmware_version: 'v1.18.0-ob',
    uptime_secs: 60,
    sys_name: null,
    sys_descr: null,
    error: null,
  },
  contact: {
    public_key: KEY,
    name: 'Observer',
    type: 2,
    matched_by: 'name',
    snmp_host: null,
    snmp_port: null,
  },
});

const COMPANION: LanScanHost = host({
  ip: '192.168.1.60',
  companion: {
    found: true,
    adv_type: 1,
    public_key: 'cd'.repeat(32),
    name: 'Pocket',
    lat: null,
    lon: null,
    model: 'Heltec V4',
    firmware_version: 'v1.18.0',
    build_date: '16 Oct 2026',
    protocol_version: 10,
    error: null,
  },
});

const PRINTER: LanScanHost = host({
  ip: '192.168.1.20',
  snmp: {
    kind: 'other',
    node_name: null,
    firmware_version: null,
    uptime_secs: null,
    sys_name: 'printer',
    sys_descr: 'Laser printer',
    error: null,
  },
});

const WEB_OBSERVER: LanScanHost = host({
  ip: '192.168.1.70',
  webconfig: {
    node_id: 'ef'.repeat(8),
    name: 'Dune Observer',
    role: 'room_server',
    adv_type: 3,
    firmware_version: 'v1.18.0-dev-ob',
    build_date: '16-Oct-2026',
    board: 'Heltec V3',
    mode: 'lan',
    needs_setup: false,
    uptime_secs: 100,
  },
  contact: {
    public_key: 'ef'.repeat(32),
    name: 'Dune Observer',
    type: 3,
    matched_by: 'node_id',
    snmp_host: null,
    snmp_port: null,
  },
});

function status(overrides: Partial<LanScanStatus> = {}): LanScanStatus {
  return {
    id: 'abc',
    running: false,
    cancelled: false,
    error: null,
    started_at: 1,
    finished_at: 2,
    total: 254,
    done: 254,
    snmp: true,
    snmp_port: 161,
    companion: false,
    companion_port: 5000,
    webconfig: false,
    webconfig_port: 80,
    skipped: [],
    hosts: [SNMP_OBSERVER, COMPANION, PRINTER],
    ...overrides,
  };
}

const onOpenContactInfo = vi.fn();

function renderView() {
  render(
    <I18nProvider>
      <LanScanView onOpenContactInfo={onOpenContactInfo} />
    </I18nProvider>
  );
}

beforeEach(() => {
  mocks.lanScanSuggestions.mockResolvedValue({
    networks: ['192.168.1.0/24'],
    own_radio: ['192.168.1.60'],
  });
  mocks.lanScanStatus.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LanScanView', () => {
  it('prefills the first known network and starts an SNMP-only scan by default', async () => {
    mocks.startLanScan.mockResolvedValue(status({ running: true, done: 0, hosts: [] }));
    renderView();
    const input = await screen.findByLabelText('Addresses');
    await waitFor(() => expect(input).toHaveValue('192.168.1.0/24'));

    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));
    await waitFor(() => expect(mocks.startLanScan).toHaveBeenCalled());
    expect(mocks.startLanScan).toHaveBeenCalledWith({
      targets: '192.168.1.0/24',
      snmp: true,
      snmp_port: 161,
      community: null,
      companion: false,
      companion_port: 5000,
      webconfig: false,
      webconfig_port: 80,
    });
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('sends the web config check when ticked, even on its own', async () => {
    mocks.startLanScan.mockResolvedValue(status());
    renderView();
    await screen.findByLabelText('Addresses');
    fireEvent.click(screen.getByLabelText('Ask for SNMP'));
    fireEvent.click(screen.getByLabelText('Ask the web config page (DMC observer)'));
    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));
    await waitFor(() => expect(mocks.startLanScan).toHaveBeenCalled());
    expect(mocks.startLanScan.mock.calls[0][0]).toMatchObject({
      snmp: false,
      webconfig: true,
      webconfig_port: 80,
    });
  });

  it('lists an observer found on its web config, with a link to the page', async () => {
    mocks.lanScanStatus.mockResolvedValue(
      status({ webconfig: true, webconfig_port: 8080, hosts: [WEB_OBSERVER] })
    );
    renderView();
    const row = await screen.findByTestId('lan-scan-host-192.168.1.70');
    expect(within(row).getByText('Web config (HTTP 8080)')).toBeInTheDocument();
    expect(within(row).getByText('Heltec V3')).toBeInTheDocument();
    expect(within(row).getByText('v1.18.0-dev-ob')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open web config' })).toHaveAttribute(
      'href',
      'http://192.168.1.70:8080/'
    );
    expect(within(row).getByRole('button', { name: 'Dune Observer' })).toHaveAttribute(
      'title',
      'Matched on the node id from the web config (start of the public key)'
    );
    // No SNMP answer, so nothing to set up.
    expect(within(row).queryByRole('button', { name: 'Set up SNMP' })).not.toBeInTheDocument();
  });

  it('sends the app port check only when ticked', async () => {
    mocks.startLanScan.mockResolvedValue(status());
    renderView();
    await screen.findByLabelText('Addresses');
    fireEvent.click(screen.getByLabelText('Ask the app port (companion protocol)'));
    fireEvent.change(screen.getByLabelText('Community'), { target: { value: 'mesh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start scan' }));
    await waitFor(() => expect(mocks.startLanScan).toHaveBeenCalled());
    expect(mocks.startLanScan.mock.calls[0][0]).toMatchObject({
      companion: true,
      community: 'mesh',
    });
  });

  it('lists MeshCore devices and hides other SNMP agents until asked', async () => {
    mocks.lanScanStatus.mockResolvedValue(status());
    renderView();
    const observer = await screen.findByTestId('lan-scan-host-192.168.1.45');
    expect(within(observer).getByText('Observer', { selector: 'span' })).toBeInTheDocument();
    expect(within(observer).getByText('SNMP (UDP 161)')).toBeInTheDocument();
    const companion = screen.getByTestId('lan-scan-host-192.168.1.60');
    expect(within(companion).getByText('Heltec V4')).toBeInTheDocument();
    expect(within(companion).getByText('Not in your contacts')).toBeInTheDocument();
    expect(screen.queryByTestId('lan-scan-host-192.168.1.20')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show other devices (1)'));
    expect(screen.getByTestId('lan-scan-host-192.168.1.20')).toBeInTheDocument();
    // The count stays the number of other devices, shown or not.
    expect(screen.getByLabelText('Show other devices (1)')).toBeInTheDocument();
    expect(screen.getByText('Laser printer')).toBeInTheDocument();
  });

  it('sets up SNMP on the matched contact with the address found', async () => {
    mocks.lanScanStatus.mockResolvedValue(status());
    mocks.saveSnmpConfig.mockResolvedValue({});
    renderView();
    const row = await screen.findByTestId('lan-scan-host-192.168.1.45');
    fireEvent.click(within(row).getByRole('button', { name: 'Set up SNMP' }));
    await waitFor(() => expect(mocks.saveSnmpConfig).toHaveBeenCalled());
    expect(mocks.saveSnmpConfig).toHaveBeenCalledWith(KEY, {
      host: '192.168.1.45',
      port: 161,
      community: null,
      poll_enabled: false,
      poll_interval_minutes: 5,
    });
  });

  it('opens the matched contact', async () => {
    mocks.lanScanStatus.mockResolvedValue(status());
    renderView();
    const row = await screen.findByTestId('lan-scan-host-192.168.1.45');
    fireEvent.click(within(row).getByRole('button', { name: 'Observer' }));
    expect(onOpenContactInfo).toHaveBeenCalledWith(KEY);
  });

  it('names the radio left out of the app port check', async () => {
    mocks.lanScanStatus.mockResolvedValue(status({ companion: true, skipped: ['192.168.1.60'] }));
    renderView();
    expect(
      await screen.findByText(
        'Left out of the app port check (the radio this RTFM-EV uses): 192.168.1.60'
      )
    ).toBeInTheDocument();
  });
});

describe('snmpSetupState', () => {
  it('needs a MeshCore SNMP answer and a contact that can carry SNMP', () => {
    expect(snmpSetupState(COMPANION, 161)).toBe('no-agent');
    expect(snmpSetupState({ ...SNMP_OBSERVER, contact: null }, 161)).toBe('unavailable');
    expect(
      snmpSetupState({ ...SNMP_OBSERVER, contact: { ...SNMP_OBSERVER.contact!, type: 4 } }, 161)
    ).toBe('unavailable');
    expect(snmpSetupState(SNMP_OBSERVER, 161)).toBe('new');
  });

  it('tells this address from another one', () => {
    const contact = SNMP_OBSERVER.contact!;
    const set = {
      ...SNMP_OBSERVER,
      contact: { ...contact, snmp_host: '192.168.1.45', snmp_port: 161 },
    };
    expect(snmpSetupState(set, 161)).toBe('set');
    expect(snmpSetupState(set, 1161)).toBe('elsewhere');
  });

  it('counts companions and MeshCore agents as MeshCore', () => {
    expect(isMeshcoreHost(SNMP_OBSERVER)).toBe(true);
    expect(isMeshcoreHost(COMPANION)).toBe(true);
    expect(isMeshcoreHost(PRINTER)).toBe(false);
  });
});
