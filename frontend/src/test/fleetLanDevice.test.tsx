import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { FleetLanDevice } from '../components/fleet/FleetLanDevice';
import type { FleetApplyPlan, FleetConfigSummary, FleetLanReadResult } from '../types';

const KEY = 'ab'.repeat(32);

const mocks = vi.hoisted(() => ({
  fleetWebconfigRead: vi.fn(),
  fleetWebconfigPlan: vi.fn(),
  fleetWebconfigStep: vi.fn(),
  startFleetWebconfig: vi.fn(),
  stopFleetWebconfig: vi.fn(),
  logFleetConfigApply: vi.fn(),
  checkFleetApplyStep: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

const READ: FleetLanReadResult = {
  status: {
    mode: 'lan',
    name: 'NL-TST-OBS',
    node_id: KEY.slice(0, 16),
    fw: 'v1.14.1-dmc-observer',
    role: 'repeater',
    board: 'Heltec V4',
  },
  document: { vars: { name: 'NL-TST-OBS' } },
  secrets: 1,
  stored: null,
};

const PLAN: FleetApplyPlan = {
  identity: {
    public_key: KEY,
    role: 'repeater',
    firmware_version: 'v1.14.1',
    board: 'Heltec V4',
    name: 'NL-TST-OBS',
  },
  steps: [
    {
      index: 0,
      section: 'vars',
      path: ['vars', 'tx'],
      command: 'set tx 20',
      display: 'set tx 20',
      secret: false,
      reboot: false,
      readback: [],
      expect: 20,
      check: 'value',
    },
  ],
  rows: [{ path: ['vars', 'tx'], status: 'change', configured: '20', device: '22', reason: null }],
  reboot: false,
  rekey: false,
  vault: 'open',
};

function summary(overrides: Partial<FleetConfigSummary> = {}): FleetConfigSummary {
  return {
    id: 4,
    asset_id: 5,
    kind: 'desired',
    source: 'template',
    profile: 'dmc_observer',
    role: 'repeater',
    firmware_version: null,
    label: 'Observer base',
    created_at: 1700000000,
    secrets_stored: 0,
    secrets_missing: 0,
    ...overrides,
  };
}

function renderLan(
  props: Partial<{ vault: 'off' | 'locked' | 'open'; configs: FleetConfigSummary[] }> = {}
) {
  const onStored = vi.fn();
  const onLogChanged = vi.fn();
  render(
    <I18nProvider>
      <FleetLanDevice
        assetId={5}
        configs={props.configs ?? [summary()]}
        vault={props.vault ?? 'open'}
        onStored={onStored}
        onLogChanged={onLogChanged}
      />
    </I18nProvider>
  );
  return { onStored, onLogChanged };
}

function typeHost(host = '192.168.1.20') {
  fireEvent.change(screen.getByTestId('fleet-lan-host'), { target: { value: host } });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mocks.fleetWebconfigRead.mockResolvedValue(READ);
  mocks.fleetWebconfigPlan.mockResolvedValue(PLAN);
  mocks.fleetWebconfigStep.mockResolvedValue({ ok: true, reason: null, reply: 'OK' });
  mocks.logFleetConfigApply.mockResolvedValue({ id: 1 });
});

afterEach(() => {
  window.localStorage.clear();
});

describe('FleetLanDevice', () => {
  it('needs the key vault unlocked', () => {
    renderLan({ vault: 'locked' });

    expect(screen.getByTestId('fleet-lan-vault-hint')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-lan-read')).toBeDisabled();
  });

  it('starts the web config over the radio only on a second, confirming click', async () => {
    mocks.startFleetWebconfig.mockResolvedValue({
      reply: 'WebConfig started: http://192.168.1.20/ (admin password login)',
      host: '192.168.1.20',
    });
    renderLan();

    fireEvent.click(screen.getByTestId('fleet-lan-start'));
    expect(mocks.startFleetWebconfig).not.toHaveBeenCalled();
    expect(screen.getByTestId('fleet-lan-start-warning')).toHaveTextContent(/radio/i);
    expect(screen.getByTestId('fleet-lan-start-warning')).toHaveTextContent(/access point/i);
    fireEvent.click(screen.getByTestId('fleet-lan-start'));

    await waitFor(() => expect(mocks.startFleetWebconfig).toHaveBeenCalledWith(5));
    expect(await screen.findByTestId('fleet-lan-toggle-reply')).toHaveTextContent('192.168.1.20');
    expect(screen.getByTestId('fleet-lan-host')).toHaveValue('192.168.1.20');
  });

  it('stops the web config only on a second click too', async () => {
    mocks.stopFleetWebconfig.mockResolvedValue({ reply: 'WebConfig stopped', host: null });
    renderLan();

    fireEvent.click(screen.getByTestId('fleet-lan-stop'));
    expect(mocks.stopFleetWebconfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('fleet-lan-stop'));
    await waitFor(() => expect(mocks.stopFleetWebconfig).toHaveBeenCalledWith(5));
  });

  it('reads over the LAN and stores a snapshot', async () => {
    mocks.fleetWebconfigRead.mockResolvedValueOnce(READ).mockResolvedValueOnce({
      ...READ,
      stored: { config: summary({ id: 9 }), secrets_stored: 1, secrets_left_out: 0 },
    });
    const { onStored } = renderLan();
    typeHost();

    fireEvent.click(screen.getByTestId('fleet-lan-read'));
    const shown = await screen.findByTestId('fleet-lan-status');
    expect(shown).toHaveTextContent('NL-TST-OBS');
    expect(shown).toHaveTextContent('Heltec V4');
    expect(mocks.fleetWebconfigRead).toHaveBeenCalledWith(5, '192.168.1.20', false, null);
    expect(screen.getByTestId('fleet-lan-partial')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('fleet-lan-store'));
    await waitFor(() => expect(onStored).toHaveBeenCalled());
    expect(mocks.fleetWebconfigRead).toHaveBeenLastCalledWith(5, '192.168.1.20', true, null);
  });

  it('remembers the address per asset in this browser', () => {
    renderLan();
    typeHost('192.168.1.77');

    expect(window.localStorage.getItem('rtfm-fleet-lan-host-5')).toBe('192.168.1.77');
  });

  it('applies one step at a time through the server and logs it as the LAN', async () => {
    const { onLogChanged } = renderLan();
    typeHost();

    expect(screen.getByTestId('fleet-lan-allow-radio')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('fleet-lan-prepare'));
    await screen.findByTestId('fleet-usb-commands');
    expect(mocks.fleetWebconfigPlan).toHaveBeenCalledWith(4, '192.168.1.20', false);

    expect(screen.getByTestId('fleet-usb-send')).toBeDisabled();
    fireEvent.click(screen.getByTestId('fleet-usb-confirm'));
    fireEvent.click(screen.getByTestId('fleet-usb-send'));

    expect(await screen.findByTestId('fleet-usb-outcome')).toHaveTextContent(/1 of 1/);
    expect(mocks.fleetWebconfigStep).toHaveBeenCalledWith(4, '192.168.1.20', PLAN.steps[0]);
    expect(mocks.checkFleetApplyStep).not.toHaveBeenCalled();
    expect(mocks.logFleetConfigApply.mock.calls[0][1]).toMatchObject({ transport: 'webconfig' });
    expect(onLogChanged).toHaveBeenCalled();
  });

  it('offers no companion file and says the private key is not set over the LAN', () => {
    renderLan({ configs: [summary({ id: 7, profile: 'companion_v1' })] });

    expect(screen.getByTestId('fleet-lan-no-configs')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-lan-no-key')).toBeInTheDocument();
  });
});
