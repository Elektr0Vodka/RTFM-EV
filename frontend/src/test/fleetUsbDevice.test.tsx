import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { FleetUsbDevice } from '../components/fleet/FleetUsbDevice';
import type { FleetApplyPlan, FleetConfigSummary, FleetDeviceReadPreview } from '../types';

const KEY = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);

const mocks = vi.hoisted(() => ({
  fleetDeviceReadStep: vi.fn(),
  storeFleetDeviceRead: vi.fn(),
  fleetConfigApplyPlan: vi.fn(),
  checkFleetApplyStep: vi.fn(),
  logFleetConfigApply: vi.fn(),
}));

const serial = vi.hoisted(() => ({
  status: 'ok' as 'ok' | 'no_api' | 'insecure',
  sent: [] as string[],
  closed: 0,
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

vi.mock('../utils/serialCli', () => ({
  webSerialStatus: () => serial.status,
  webSerial: () => ({ requestPort: async () => ({}) }),
  SerialCli: class {
    async open() {}
    async close() {
      serial.closed += 1;
    }
    async send(command: string) {
      serial.sent.push(command);
      return command === 'ver' ? 'v1.14.0' : 'OK';
    }
  },
}));

function preview(publicKey: string = KEY): FleetDeviceReadPreview {
  return {
    identity: {
      public_key: publicKey,
      role: 'repeater',
      firmware_version: 'v1.14.0',
      board: 'Heltec V3',
      name: 'NL-TST-RPT',
    },
    profile: 'stock',
    document: { vars: { name: 'NL-TST-RPT', 'prv.key': { $secret: null } } },
    secrets: 1,
    warnings: ['region_cut_off'],
  };
}

function summary(overrides: Partial<FleetConfigSummary> = {}): FleetConfigSummary {
  return {
    id: 4,
    asset_id: 5,
    kind: 'desired',
    source: 'template',
    profile: 'stock',
    role: 'repeater',
    firmware_version: null,
    label: 'Mast base',
    created_at: 1700000000,
    secrets_stored: 0,
    secrets_missing: 0,
    ...overrides,
  };
}

const PLAN: FleetApplyPlan = {
  identity: preview().identity,
  steps: [
    {
      index: 0,
      section: 'vars',
      path: ['vars', 'tx'],
      command: 'set tx 20',
      display: 'set tx 20',
      secret: false,
      reboot: false,
      readback: ['get tx'],
      expect: 20,
      check: 'value',
    },
    {
      index: 1,
      section: 'vars',
      path: ['vars', 'guest.password'],
      command: 'set guest.password hunter2',
      display: 'set guest.password ********',
      secret: true,
      reboot: false,
      readback: ['get guest.password'],
      expect: 'hunter2',
      check: 'value',
    },
  ],
  rows: [
    { path: ['vars', 'tx'], status: 'change', configured: '20', device: '22', reason: null },
    { path: ['vars', 'name'], status: 'same', configured: 'X', device: 'X', reason: null },
    {
      path: ['vars', 'radio'],
      status: 'skip',
      configured: '{}',
      device: '{}',
      reason: 'needs_radio_tick',
    },
  ],
  reboot: false,
  rekey: false,
  vault: 'open',
};

function renderUsb(
  props: Partial<{
    assetPublicKey: string | null;
    configs: FleetConfigSummary[];
  }> = {}
) {
  const onStored = vi.fn();
  const onAssetChanged = vi.fn();
  render(
    <I18nProvider>
      <FleetUsbDevice
        assetId={5}
        assetPublicKey={props.assetPublicKey === undefined ? KEY : props.assetPublicKey}
        configs={props.configs ?? [summary()]}
        vault="open"
        onStored={onStored}
        onAssetChanged={onAssetChanged}
        onLogChanged={vi.fn()}
      />
    </I18nProvider>
  );
  return { onStored, onAssetChanged };
}

async function connectAndRead() {
  fireEvent.click(screen.getByTestId('fleet-usb-connect'));
  fireEvent.click(await screen.findByTestId('fleet-usb-read'));
  return screen.findByTestId('fleet-usb-identity');
}

beforeEach(() => {
  vi.clearAllMocks();
  serial.status = 'ok';
  serial.sent = [];
  serial.closed = 0;
  mocks.fleetDeviceReadStep.mockImplementation(async (replies: Record<string, unknown>) =>
    'ver' in replies
      ? { done: true, commands: [], read: preview() }
      : { done: false, commands: ['ver'], read: null }
  );
});

describe('FleetUsbDevice', () => {
  it('explains when this browser cannot open a USB port', () => {
    serial.status = 'no_api';
    renderUsb();

    expect(screen.getByTestId('fleet-usb-unsupported')).toHaveTextContent(/Chrome or Edge/);
    expect(screen.queryByTestId('fleet-usb-connect')).not.toBeInTheDocument();
  });

  it('asks for localhost or HTTPS when the page is not a secure context', () => {
    serial.status = 'insecure';
    renderUsb();

    expect(screen.getByTestId('fleet-usb-unsupported')).toHaveTextContent(/localhost/);
  });

  it('reads the device and stores it as a snapshot', async () => {
    mocks.storeFleetDeviceRead.mockResolvedValue({
      config: summary({ id: 9, kind: 'snapshot' }),
      secrets_stored: 1,
      secrets_left_out: 0,
      identity: preview().identity,
      public_key_set: false,
      warnings: [],
    });
    const { onStored } = renderUsb();

    const identity = await connectAndRead();
    expect(identity).toHaveTextContent('NL-TST-RPT');
    expect(identity).toHaveTextContent('Heltec V3');
    expect(screen.getByTestId('fleet-usb-match')).toHaveAttribute('data-match', 'same');
    expect(screen.getByTestId('fleet-usb-warnings')).toHaveTextContent(/160 characters/);
    expect(serial.sent).toEqual(['ver']);

    fireEvent.change(screen.getByTestId('fleet-usb-label'), { target: { value: 'bench' } });
    fireEvent.click(screen.getByTestId('fleet-usb-store'));

    await waitFor(() => expect(onStored).toHaveBeenCalled());
    expect(mocks.storeFleetDeviceRead).toHaveBeenCalledWith(5, { ver: 'v1.14.0' }, 'bench', false);
  });

  it('does not store another node on this asset', async () => {
    mocks.fleetDeviceReadStep.mockImplementation(async (replies: Record<string, unknown>) =>
      'ver' in replies
        ? { done: true, commands: [], read: preview(OTHER) }
        : { done: false, commands: ['ver'], read: null }
    );
    renderUsb();

    await connectAndRead();
    expect(screen.getByTestId('fleet-usb-match')).toHaveAttribute('data-match', 'other');
    expect(screen.getByTestId('fleet-usb-store')).toBeDisabled();
  });

  it('gives an asset without a key the device key only when ticked', async () => {
    mocks.storeFleetDeviceRead.mockResolvedValue({
      config: summary({ id: 9 }),
      secrets_stored: 0,
      secrets_left_out: 1,
      identity: preview().identity,
      public_key_set: true,
      warnings: [],
    });
    const { onAssetChanged } = renderUsb({ assetPublicKey: null });

    await connectAndRead();
    expect(screen.getByTestId('fleet-usb-match')).toHaveAttribute('data-match', 'no_key');
    expect(screen.getByTestId('fleet-usb-store')).toBeDisabled();
    fireEvent.click(screen.getByTestId('fleet-usb-set-key'));
    fireEvent.click(screen.getByTestId('fleet-usb-store'));

    await waitFor(() => expect(onAssetChanged).toHaveBeenCalled());
    expect(mocks.storeFleetDeviceRead).toHaveBeenCalledWith(5, { ver: 'v1.14.0' }, null, true);
  });

  it('shows the commands first and sends them only after the confirm', async () => {
    mocks.fleetConfigApplyPlan.mockResolvedValue(PLAN);
    mocks.checkFleetApplyStep.mockResolvedValue({ ok: true, reason: null, reply: 'OK' });
    mocks.logFleetConfigApply.mockResolvedValue({ id: 1 });
    renderUsb();

    fireEvent.click(screen.getByTestId('fleet-usb-connect'));
    expect(await screen.findByTestId('fleet-usb-allow-key')).not.toBeChecked();
    expect(screen.getByTestId('fleet-usb-allow-radio')).not.toBeChecked();
    fireEvent.click(screen.getByTestId('fleet-usb-prepare'));

    const commands = await screen.findByTestId('fleet-usb-commands');
    expect(within(commands).getByText('set tx 20')).toBeInTheDocument();
    expect(within(commands).getByText('set guest.password ********')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-usb-plan')).not.toHaveTextContent('hunter2');
    expect(screen.getByTestId('fleet-usb-skips')).toHaveTextContent(/radio tick/i);
    // The plan is made from a fresh read: only "ver" was sent so far.
    expect(serial.sent).toEqual(['ver']);
    expect(mocks.fleetConfigApplyPlan).toHaveBeenCalledWith(4, { ver: 'v1.14.0' }, false, false);

    const send = screen.getByTestId('fleet-usb-send');
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByTestId('fleet-usb-confirm'));
    fireEvent.click(send);

    expect(await screen.findByTestId('fleet-usb-outcome')).toHaveTextContent(/2 of 2/);
    expect(serial.sent).toEqual([
      'ver',
      'set tx 20',
      'get tx',
      'set guest.password hunter2',
      'get guest.password',
    ]);
    expect(mocks.logFleetConfigApply).toHaveBeenCalled();
  });

  it('shows where an apply stopped', async () => {
    mocks.fleetConfigApplyPlan.mockResolvedValue(PLAN);
    mocks.checkFleetApplyStep.mockResolvedValue({
      ok: false,
      reason: 'readback_differs',
      reply: 'OK',
    });
    mocks.logFleetConfigApply.mockResolvedValue({ id: 1 });
    renderUsb();

    fireEvent.click(screen.getByTestId('fleet-usb-connect'));
    fireEvent.click(await screen.findByTestId('fleet-usb-prepare'));
    fireEvent.click(await screen.findByTestId('fleet-usb-confirm'));
    fireEvent.click(screen.getByTestId('fleet-usb-send'));

    const outcome = await screen.findByTestId('fleet-usb-outcome');
    expect(outcome).toHaveTextContent(/command 1/);
    expect(outcome).toHaveTextContent(/read back/i);
    expect(serial.sent).not.toContain('set guest.password hunter2');
  });

  it('asks for a new plan when a tick changes', async () => {
    mocks.fleetConfigApplyPlan.mockResolvedValue(PLAN);
    renderUsb();

    fireEvent.click(screen.getByTestId('fleet-usb-connect'));
    fireEvent.click(await screen.findByTestId('fleet-usb-prepare'));
    await screen.findByTestId('fleet-usb-commands');
    fireEvent.click(screen.getByTestId('fleet-usb-allow-radio'));

    expect(screen.queryByTestId('fleet-usb-commands')).not.toBeInTheDocument();
  });

  it('offers only toolbox configs to apply', async () => {
    renderUsb({ configs: [summary({ id: 7, profile: 'companion_v1', label: 'Pocket' })] });

    fireEvent.click(screen.getByTestId('fleet-usb-connect'));
    expect(await screen.findByTestId('fleet-usb-no-configs')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-usb-prepare')).not.toBeInTheDocument();
  });

  it('closes the port on disconnect', async () => {
    renderUsb();

    fireEvent.click(screen.getByTestId('fleet-usb-connect'));
    fireEvent.click(await screen.findByTestId('fleet-usb-disconnect'));

    await waitFor(() => expect(serial.closed).toBe(1));
    expect(screen.getByTestId('fleet-usb-connect')).toBeInTheDocument();
  });
});
