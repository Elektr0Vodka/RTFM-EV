import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { FleetOnboardView } from '../components/FleetOnboardView';
import type {
  FleetApplyPlan,
  FleetAsset,
  FleetConfigTemplate,
  FleetDeviceReadPreview,
} from '../types';
import { setFleetVaultToken } from '../utils/fleetVault';

const KEY = 'ab'.repeat(32);
const NEW_KEY = 'cd'.repeat(32);

const mocks = vi.hoisted(() => ({
  fleetVaultStatus: vi.fn(),
  fleetAssetForKey: vi.fn(),
  createFleetAsset: vi.fn(),
  generateFleetKey: vi.fn(),
  storeFleetDeviceRead: vi.fn(),
  fleetConfigTemplates: vi.fn(),
  createFleetConfigFromTemplate: vi.fn(),
  fleetDeviceReadStep: vi.fn(),
  fleetConfigApplyPlan: vi.fn(),
  checkFleetApplyStep: vi.fn(),
  logFleetConfigApply: vi.fn(),
  updateFleetAsset: vi.fn(),
  addFleetAssetEvent: vi.fn(),
}));

const serial = vi.hoisted(() => ({
  status: 'ok' as 'ok' | 'no_api' | 'insecure',
  sent: [] as string[],
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

vi.mock('../utils/serialCli', () => ({
  webSerialStatus: () => serial.status,
  webSerial: () => ({ requestPort: async () => ({}) }),
  SerialCli: class {
    async open() {}
    async close() {}
    async send(command: string) {
      serial.sent.push(command);
      return command === 'ver' ? 'v1.14.0' : 'OK';
    }
  },
}));

const VAULT_OPEN = { enabled: true, initialised: true, unlocked: true, idle_seconds: 900 };
const VAULT_OFF = { enabled: false, initialised: false, unlocked: false, idle_seconds: 900 };

const READ: FleetDeviceReadPreview = {
  identity: {
    public_key: KEY,
    role: 'repeater',
    firmware_version: 'v1.14.0',
    board: 'Heltec V3',
    name: 'NL-NEW-RPT',
  },
  profile: 'stock',
  document: { vars: { name: 'NL-NEW-RPT' } },
  secrets: 1,
  warnings: [],
};

function asset(overrides: Partial<FleetAsset> = {}): FleetAsset {
  return {
    id: 5,
    public_key: KEY,
    label: 'Mast 7',
    org_serial: null,
    hw_serial: null,
    model: null,
    role: 'repeater',
    wifi_mac: null,
    ble_mac: null,
    assigned_to: null,
    site_name: null,
    status: 'in_stock',
    target_firmware: null,
    notes: null,
    created_at: 1700000000,
    updated_at: 1700000000,
    ...overrides,
  } as FleetAsset;
}

const TEMPLATE: FleetConfigTemplate = {
  id: 3,
  name: 'Mast base',
  description: null,
  profile: 'stock',
  role: 'repeater',
  document: { vars: { name: '{{asset.label}}', tx: '{{power}}' } },
  variables: [{ name: 'power', description: 'TX power', default: '20', type: 'number' }],
  created_at: 1700000000,
  updated_at: 1700000000,
};

function plan(overrides: Partial<FleetApplyPlan> = {}): FleetApplyPlan {
  return {
    identity: READ.identity,
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
    ],
    rows: [
      { path: ['vars', 'tx'], status: 'change', configured: '20', device: '22', reason: null },
    ],
    reboot: false,
    rekey: false,
    vault: 'open',
    ...overrides,
  };
}

function renderWizard() {
  const onOpenAsset = vi.fn();
  render(
    <I18nProvider>
      <FleetOnboardView onBack={vi.fn()} onOpenAsset={onOpenAsset} />
    </I18nProvider>
  );
  return { onOpenAsset };
}

async function connectAndRead() {
  fireEvent.click(await screen.findByTestId('fleet-onboard-connect'));
  fireEvent.click(await screen.findByTestId('fleet-onboard-read'));
  return screen.findByTestId('fleet-onboard-identity');
}

async function applyAndCompare(comparePlan: FleetApplyPlan) {
  fireEvent.click(await screen.findByTestId('fleet-onboard-prepare'));
  fireEvent.click(await screen.findByTestId('fleet-usb-confirm'));
  fireEvent.click(screen.getByTestId('fleet-usb-send'));
  await screen.findByTestId('fleet-usb-outcome');
  mocks.fleetConfigApplyPlan.mockResolvedValueOnce(comparePlan);
  fireEvent.click(screen.getByTestId('fleet-onboard-compare'));
  return screen.findByTestId('fleet-onboard-compare-result');
}

beforeEach(() => {
  vi.clearAllMocks();
  serial.status = 'ok';
  serial.sent = [];
  setFleetVaultToken('token');
  mocks.fleetVaultStatus.mockResolvedValue(VAULT_OPEN);
  mocks.fleetAssetForKey.mockResolvedValue(null);
  mocks.fleetConfigTemplates.mockResolvedValue([TEMPLATE]);
  mocks.fleetDeviceReadStep.mockImplementation(async (replies: Record<string, unknown>) =>
    'ver' in replies
      ? { done: true, commands: [], read: READ }
      : { done: false, commands: ['ver'], read: null }
  );
  mocks.storeFleetDeviceRead.mockResolvedValue({
    config: { id: 11 },
    secrets_stored: 1,
    secrets_left_out: 0,
    identity: READ.identity,
    public_key_set: false,
    warnings: [],
  });
  mocks.createFleetConfigFromTemplate.mockResolvedValue({ id: 12, profile: 'stock' });
  mocks.fleetConfigApplyPlan.mockResolvedValue(plan());
  mocks.checkFleetApplyStep.mockResolvedValue({ ok: true, reason: null, reply: 'OK' });
  mocks.logFleetConfigApply.mockResolvedValue({ id: 1 });
  mocks.updateFleetAsset.mockImplementation(async (id: number, changes: Partial<FleetAsset>) =>
    asset({ id, ...changes })
  );
  mocks.addFleetAssetEvent.mockResolvedValue({ id: 2 });
});

afterEach(() => {
  setFleetVaultToken(null);
});

describe('FleetOnboardView', () => {
  it('explains when this browser cannot open a USB port', async () => {
    serial.status = 'insecure';
    renderWizard();

    expect(await screen.findByTestId('fleet-onboard-unsupported')).toHaveTextContent(/localhost/);
    expect(screen.queryByTestId('fleet-onboard-connect')).not.toBeInTheDocument();
  });

  it('walks a known device from read to deployed', async () => {
    mocks.fleetAssetForKey.mockResolvedValue(asset());
    const { onOpenAsset } = renderWizard();

    const identity = await connectAndRead();
    expect(identity).toHaveTextContent('NL-NEW-RPT');
    expect(mocks.fleetAssetForKey).toHaveBeenCalledWith(KEY);
    expect(await screen.findByTestId('fleet-onboard-match')).toHaveTextContent('Mast 7');
    fireEvent.click(screen.getByTestId('fleet-onboard-use-asset'));

    fireEvent.click(await screen.findByTestId('fleet-onboard-store-before'));
    await waitFor(() =>
      expect(mocks.storeFleetDeviceRead).toHaveBeenCalledWith(
        5,
        { ver: 'v1.14.0' },
        'Before onboarding',
        false
      )
    );

    fireEvent.change(await screen.findByTestId('fleet-onboard-template-select'), {
      target: { value: '3' },
    });
    expect(screen.getByTestId('fleet-onboard-var-power')).toHaveValue('20');
    fireEvent.change(screen.getByTestId('fleet-onboard-var-power'), { target: { value: '18' } });
    fireEvent.click(screen.getByTestId('fleet-onboard-make-config'));
    await waitFor(() =>
      expect(mocks.createFleetConfigFromTemplate).toHaveBeenCalledWith(
        5,
        3,
        { power: '18' },
        'Onboarding',
        false
      )
    );

    // Both ticks start off, also here.
    expect(await screen.findByTestId('fleet-onboard-allow-key')).not.toBeChecked();
    expect(screen.getByTestId('fleet-onboard-allow-radio')).not.toBeChecked();
    const result = await applyAndCompare(plan({ steps: [], rows: [] }));
    expect(result).toHaveAttribute('data-result', 'same');
    expect(mocks.fleetConfigApplyPlan).toHaveBeenLastCalledWith(
      12,
      { ver: 'v1.14.0' },
      false,
      false
    );

    fireEvent.click(screen.getByTestId('fleet-onboard-store-after'));
    await waitFor(() =>
      expect(mocks.storeFleetDeviceRead).toHaveBeenLastCalledWith(
        5,
        { ver: 'v1.14.0' },
        'After onboarding',
        false
      )
    );

    expect(screen.getByTestId('fleet-onboard-status')).toHaveValue('deployed');
    fireEvent.click(screen.getByTestId('fleet-onboard-finish'));
    await screen.findByTestId('fleet-onboard-done');
    expect(mocks.updateFleetAsset).toHaveBeenCalledWith(5, { status: 'deployed' });
    expect(mocks.addFleetAssetEvent).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ kind: 'note' })
    );
    expect(mocks.addFleetAssetEvent.mock.calls[0][1].summary).toContain('NL-NEW-RPT');

    fireEvent.click(screen.getByTestId('fleet-onboard-open-asset'));
    expect(onOpenAsset).toHaveBeenCalledWith(5);
  });

  it('creates an asset with the device key for a new device', async () => {
    mocks.createFleetAsset.mockResolvedValue(asset({ id: 8, label: 'NL-NEW-RPT' }));
    renderWizard();

    await connectAndRead();
    expect(await screen.findByTestId('fleet-onboard-new-label')).toHaveValue('NL-NEW-RPT');
    expect(screen.getByTestId('fleet-onboard-key-device')).toBeChecked();
    fireEvent.click(screen.getByTestId('fleet-onboard-create'));

    await waitFor(() =>
      expect(mocks.createFleetAsset).toHaveBeenCalledWith({
        label: 'NL-NEW-RPT',
        public_key: KEY,
        role: 'repeater',
        model: 'Heltec V3',
        status: 'in_stock',
      })
    );
    expect(mocks.generateFleetKey).not.toHaveBeenCalled();
    expect(await screen.findByTestId('fleet-onboard-store-before')).toBeInTheDocument();
  });

  it('gives a new device a key from the vault', async () => {
    mocks.createFleetAsset.mockResolvedValue(asset({ id: 8, public_key: null }));
    mocks.generateFleetKey.mockResolvedValue({
      asset: asset({ id: 8, public_key: NEW_KEY }),
      attempts: 1,
    });
    renderWizard();

    await connectAndRead();
    fireEvent.click(await screen.findByTestId('fleet-onboard-key-new'));
    fireEvent.click(screen.getByTestId('fleet-onboard-create'));

    await waitFor(() => expect(mocks.generateFleetKey).toHaveBeenCalledWith(8, '', 1));
    expect(mocks.createFleetAsset.mock.calls[0][0]).not.toHaveProperty('public_key');
    // The device's old identity is not stored on the new asset.
    expect(await screen.findByTestId('fleet-onboard-before-skipped')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('fleet-onboard-continue-before'));

    fireEvent.click(await screen.findByTestId('fleet-onboard-make-config'));
    await waitFor(() =>
      expect(mocks.createFleetConfigFromTemplate).toHaveBeenCalledWith(
        8,
        null,
        {},
        'Onboarding',
        true
      )
    );
    expect(await screen.findByTestId('fleet-onboard-key-hint')).toBeInTheDocument();
    expect(screen.getByTestId('fleet-onboard-allow-key')).not.toBeChecked();

    const result = await applyAndCompare(
      plan({
        rekey: true,
        steps: [
          {
            ...plan().steps[0],
            path: ['vars', 'prv.key'],
            command: 'set prv.key x',
            display: 'set prv.key ********',
            check: 'public_key',
            secret: true,
          },
        ],
      })
    );
    expect(result).toHaveAttribute('data-result', 'restart');
    expect(screen.queryByTestId('fleet-onboard-store-after')).not.toBeInTheDocument();
  });

  it('offers a new key only with the vault unlocked', async () => {
    mocks.fleetVaultStatus.mockResolvedValue(VAULT_OFF);
    renderWizard();

    await connectAndRead();
    expect(await screen.findByTestId('fleet-onboard-key-new')).toBeDisabled();
  });

  it('skips the apply when there is nothing to apply', async () => {
    mocks.fleetAssetForKey.mockResolvedValue(asset());
    renderWizard();

    await connectAndRead();
    fireEvent.click(await screen.findByTestId('fleet-onboard-use-asset'));
    fireEvent.click(await screen.findByTestId('fleet-onboard-skip-before'));
    // No template, and the device keeps its key: nothing to make or apply.
    fireEvent.click(await screen.findByTestId('fleet-onboard-make-config'));

    expect(await screen.findByTestId('fleet-onboard-nothing-to-apply')).toBeInTheDocument();
    expect(mocks.createFleetConfigFromTemplate).not.toHaveBeenCalled();
    expect(screen.getByTestId('fleet-onboard-finish')).toBeInTheDocument();
  });

  it('reports what still differs after an apply', async () => {
    mocks.fleetAssetForKey.mockResolvedValue(asset());
    renderWizard();

    await connectAndRead();
    fireEvent.click(await screen.findByTestId('fleet-onboard-use-asset'));
    fireEvent.click(await screen.findByTestId('fleet-onboard-skip-before'));
    fireEvent.change(await screen.findByTestId('fleet-onboard-template-select'), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByTestId('fleet-onboard-make-config'));

    const result = await applyAndCompare(plan());
    expect(result).toHaveAttribute('data-result', 'differs');
  });
});
