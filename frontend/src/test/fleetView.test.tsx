import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { FleetView } from '../components/FleetView';
import { FleetAssetView } from '../components/FleetAssetView';
import { ContactFleetSection } from '../components/fleet/ContactFleetSection';
import type { Contact, FleetAsset } from '../types';
import { setFleetVaultToken } from '../utils/fleetVault';

const mocks = vi.hoisted(() => ({
  fleetAssets: vi.fn(),
  fleetAsset: vi.fn(),
  fleetAssetForKey: vi.fn(),
  createFleetAsset: vi.fn(),
  updateFleetAsset: vi.fn(),
  deleteFleetAsset: vi.fn(),
  addFleetAssetsFromContacts: vi.fn(),
  fleetSettings: vi.fn(),
  saveFleetSettings: vi.fn(),
  fleetAssetEvents: vi.fn(),
  addFleetAssetEvent: vi.fn(),
  deleteFleetAssetEvent: vi.fn(),
  contactLocationHistory: vi.fn(),
  fleetVaultStatus: vi.fn(),
  initFleetVault: vi.fn(),
  unlockFleetVault: vi.fn(),
  lockFleetVault: vi.fn(),
  fleetVaultAudit: vi.fn(),
  fleetSecrets: vi.fn(),
  addFleetSecret: vi.fn(),
  revealFleetSecret: vi.fn(),
  deleteFleetSecret: vi.fn(),
  generateFleetKey: vi.fn(),
  fleetConfigs: vi.fn(),
  fleetConfigTemplates: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

const KEY_A = 'aa'.repeat(32);
const KEY_B = 'bb'.repeat(32);
const OWNER = 'ee'.repeat(32);
const RULES = { silent_hours: 48, low_battery_volts: 3.5 };
const VAULT_OFF = { enabled: false, initialised: false, unlocked: false, idle_seconds: 900 };
const VAULT_LOCKED = { enabled: true, initialised: true, unlocked: false, idle_seconds: 900 };
const VAULT_OPEN = { enabled: true, initialised: true, unlocked: true, idle_seconds: 900 };

function asset(overrides: Partial<FleetAsset> = {}): FleetAsset {
  return {
    id: 1,
    public_key: null,
    label: null,
    org_serial: null,
    hw_serial: null,
    model: null,
    role: null,
    wifi_mac: null,
    ble_mac: null,
    assigned_to: null,
    site_name: null,
    status: 'in_stock',
    notes: null,
    target_firmware: null,
    last_maintenance: null,
    last_failure: null,
    health: null,
    created_at: 1700000000,
    updated_at: 1700000000,
    contact: null,
    ...overrides,
  };
}

const TOWER = asset({
  id: 1,
  public_key: KEY_A,
  status: 'deployed',
  org_serial: 'DTIS-0042',
  model: 'Heltec V3',
  site_name: 'Water tower',
  contact: { name: 'Tower RPT', type: 2, last_seen: 1700000000, lat: 52.1, lon: 5.2 },
});
const SPARE = asset({ id: 2, label: 'Spare T-Beam', status: 'in_stock', assigned_to: 'Depot' });

function ownedContact(publicKey: string): Contact {
  return { public_key: publicKey, name: 'Owned', type: 2, owner_key: OWNER } as Contact;
}

function renderList(props: Partial<Parameters<typeof FleetView>[0]> = {}) {
  const onOpenAsset = vi.fn();
  const onOpenTemplates = vi.fn();
  const onOpenContactInfo = vi.fn();
  render(
    <I18nProvider>
      <FleetView
        contacts={[]}
        ownerKeys={[]}
        onOpenAsset={onOpenAsset}
        onOpenTemplates={onOpenTemplates}
        onOpenContactInfo={onOpenContactInfo}
        {...props}
      />
    </I18nProvider>
  );
  return { onOpenAsset, onOpenTemplates, onOpenContactInfo };
}

function renderAsset(assetId: number | 'new') {
  const onBack = vi.fn();
  const onOpenAsset = vi.fn();
  const onOpenTemplates = vi.fn();
  const onOpenContactInfo = vi.fn();
  render(
    <I18nProvider>
      <FleetAssetView
        assetId={assetId}
        onBack={onBack}
        onOpenAsset={onOpenAsset}
        onOpenTemplates={onOpenTemplates}
        onOpenContactInfo={onOpenContactInfo}
      />
    </I18nProvider>
  );
  return { onBack, onOpenAsset, onOpenTemplates, onOpenContactInfo };
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.fleetSettings.mockResolvedValue(RULES);
  mocks.fleetAssetEvents.mockResolvedValue([]);
  mocks.contactLocationHistory.mockResolvedValue([]);
  mocks.fleetVaultStatus.mockResolvedValue(VAULT_OFF);
  mocks.fleetVaultAudit.mockResolvedValue([]);
  mocks.fleetSecrets.mockResolvedValue([]);
  mocks.fleetConfigs.mockResolvedValue([]);
  mocks.fleetConfigTemplates.mockResolvedValue([]);
  setFleetVaultToken(null);
});

describe('FleetView', () => {
  it('opens the config templates page', async () => {
    mocks.fleetAssets.mockResolvedValue([]);
    const { onOpenTemplates } = renderList();

    fireEvent.click(await screen.findByTestId('fleet-open-templates'));

    expect(onOpenTemplates).toHaveBeenCalledTimes(1);
  });

  it('explains how to start when the register is empty', async () => {
    mocks.fleetAssets.mockResolvedValue([]);
    const { onOpenAsset } = renderList();

    expect(await screen.findByTestId('fleet-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('fleet-add'));
    expect(onOpenAsset).toHaveBeenCalledWith('new');
  });

  it('lists every asset and opens one on a row click', async () => {
    mocks.fleetAssets.mockResolvedValue([TOWER, SPARE]);
    const { onOpenAsset } = renderList();

    const tower = await screen.findByTestId('fleet-asset-1');
    expect(within(tower).getByText('Tower RPT')).toBeInTheDocument();
    expect(within(tower).getByText('DTIS-0042')).toBeInTheDocument();
    expect(within(tower).getByText('Deployed')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('fleet-asset-2')).getByText('Spare T-Beam')
    ).toBeInTheDocument();

    fireEvent.click(tower);
    expect(onOpenAsset).toHaveBeenCalledWith(1);
  });

  it('opens the contact from the node name without opening the asset', async () => {
    mocks.fleetAssets.mockResolvedValue([TOWER]);
    const { onOpenAsset, onOpenContactInfo } = renderList();

    fireEvent.click(await screen.findByTestId('fleet-contact-1'));

    expect(onOpenContactInfo).toHaveBeenCalledWith(KEY_A);
    expect(onOpenAsset).not.toHaveBeenCalled();
  });

  it('narrows the list by search text and by status', async () => {
    mocks.fleetAssets.mockResolvedValue([TOWER, SPARE]);
    renderList();
    await screen.findByTestId('fleet-asset-1');

    fireEvent.change(screen.getByTestId('fleet-search'), { target: { value: 'depot' } });
    expect(screen.queryByTestId('fleet-asset-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('fleet-asset-2')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('fleet-search'), { target: { value: '' } });
    fireEvent.change(screen.getByTestId('fleet-status-filter'), { target: { value: 'deployed' } });
    expect(screen.getByTestId('fleet-asset-1')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-asset-2')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('fleet-status-filter'), { target: { value: 'stolen' } });
    expect(screen.getByTestId('fleet-no-match')).toBeInTheDocument();
  });

  it('offers to add owned nodes that have no asset yet', async () => {
    mocks.fleetAssets.mockResolvedValueOnce([TOWER]);
    mocks.addFleetAssetsFromContacts.mockResolvedValue({ created: [], skipped: 0 });
    renderList({ contacts: [ownedContact(KEY_A), ownedContact(KEY_B)], ownerKeys: [OWNER] });
    await screen.findByTestId('fleet-asset-1');

    const added = asset({ id: 3, public_key: KEY_B, status: 'deployed' });
    mocks.fleetAssets.mockResolvedValueOnce([TOWER, added]);
    fireEvent.click(screen.getByTestId('fleet-add-owned'));

    await waitFor(() => expect(mocks.addFleetAssetsFromContacts).toHaveBeenCalledWith([KEY_B]));
    expect(await screen.findByTestId('fleet-asset-3')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-add-owned')).not.toBeInTheDocument();
  });

  it('hides the owned-nodes button when there is nothing to add', async () => {
    mocks.fleetAssets.mockResolvedValue([TOWER]);
    renderList({ contacts: [ownedContact(KEY_A)], ownerKeys: [OWNER] });
    await screen.findByTestId('fleet-asset-1');

    expect(screen.queryByTestId('fleet-add-owned')).not.toBeInTheDocument();
  });

  it('shows a load error', async () => {
    mocks.fleetAssets.mockRejectedValue(new Error('boom'));
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});

describe('FleetAssetView', () => {
  it('shows the stored configs of an existing asset, not of a new one', async () => {
    mocks.fleetAsset.mockResolvedValue(asset({ id: 4, label: 'Mast' }));
    const { onOpenTemplates } = renderAsset(4);

    expect(await screen.findByTestId('fleet-configs')).toBeInTheDocument();
    await waitFor(() => expect(mocks.fleetConfigs).toHaveBeenCalledWith(4, expect.anything()));
    fireEvent.click(screen.getByTestId('fleet-config-open-templates'));
    expect(onOpenTemplates).toHaveBeenCalledTimes(1);
  });

  it('has no configs block on the empty form', () => {
    renderAsset('new');

    expect(screen.queryByTestId('fleet-configs')).not.toBeInTheDocument();
    expect(mocks.fleetConfigs).not.toHaveBeenCalled();
  });

  it('creates an asset from the empty form and opens it', async () => {
    mocks.createFleetAsset.mockResolvedValue(asset({ id: 9, label: 'Spare' }));
    const { onOpenAsset } = renderAsset('new');

    fireEvent.change(screen.getByTestId('fleet-field-label'), { target: { value: ' Spare ' } });
    fireEvent.change(screen.getByTestId('fleet-field-org_serial'), { target: { value: 'S-9' } });
    fireEvent.change(screen.getByTestId('fleet-field-status'), {
      target: { value: 'maintenance' },
    });
    fireEvent.click(screen.getByTestId('fleet-save'));

    await waitFor(() => expect(onOpenAsset).toHaveBeenCalledWith(9));
    expect(mocks.createFleetAsset).toHaveBeenCalledWith({
      label: 'Spare',
      org_serial: 'S-9',
      status: 'maintenance',
    });
    expect(mocks.fleetAsset).not.toHaveBeenCalled();
  });

  it('loads an asset and sends only what changed', async () => {
    mocks.fleetAsset.mockResolvedValue(TOWER);
    mocks.updateFleetAsset.mockResolvedValue({ ...TOWER, model: null, notes: 'New mast' });
    renderAsset(1);

    const model = (await screen.findByTestId('fleet-field-model')) as HTMLInputElement;
    expect(model.value).toBe('Heltec V3');
    expect((screen.getByTestId('fleet-field-public_key') as HTMLInputElement).value).toBe(KEY_A);

    fireEvent.change(model, { target: { value: '' } });
    fireEvent.change(screen.getByTestId('fleet-field-notes'), { target: { value: 'New mast' } });
    fireEvent.click(screen.getByTestId('fleet-save'));

    await waitFor(() =>
      expect(mocks.updateFleetAsset).toHaveBeenCalledWith(1, { model: null, notes: 'New mast' })
    );
    expect(await screen.findByTestId('fleet-saved')).toBeInTheDocument();
  });

  it('keeps Save off until something changed', async () => {
    mocks.fleetAsset.mockResolvedValue(TOWER);
    renderAsset(1);

    const save = (await screen.findByTestId('fleet-save')) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('fleet-field-role'), { target: { value: 'Repeater' } });
    expect(save.disabled).toBe(false);
  });

  it('shows what the server refused', async () => {
    mocks.createFleetAsset.mockRejectedValue(new Error('public_key must be 64-char hex'));
    renderAsset('new');

    fireEvent.change(screen.getByTestId('fleet-field-public_key'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByTestId('fleet-save'));

    expect(await screen.findByRole('alert')).toHaveTextContent('public_key must be 64-char hex');
  });

  it('shows the node on the mesh and opens its contact', async () => {
    mocks.fleetAsset.mockResolvedValue(TOWER);
    const { onOpenContactInfo } = renderAsset(1);

    const mesh = await screen.findByTestId('fleet-mesh');
    expect(within(mesh).getByText('Tower RPT')).toBeInTheDocument();
    fireEvent.click(within(mesh).getByTestId('fleet-open-contact'));
    expect(onOpenContactInfo).toHaveBeenCalledWith(KEY_A);
  });

  it('deletes only after a second click and goes back', async () => {
    mocks.fleetAsset.mockResolvedValue(SPARE);
    mocks.deleteFleetAsset.mockResolvedValue({ status: 'ok' });
    const { onBack } = renderAsset(2);

    const remove = await screen.findByTestId('fleet-delete');
    fireEvent.click(remove);
    expect(mocks.deleteFleetAsset).not.toHaveBeenCalled();
    fireEvent.click(remove);

    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(mocks.deleteFleetAsset).toHaveBeenCalledWith(2);
  });

  it('has no delete button on the empty form', () => {
    renderAsset('new');

    expect(screen.queryByTestId('fleet-delete')).not.toBeInTheDocument();
  });

  it('says so when the asset does not exist', async () => {
    mocks.fleetAsset.mockRejectedValue(new Error('Asset not found'));
    renderAsset(77);

    expect(await screen.findByRole('alert')).toHaveTextContent('Asset not found');
    expect(screen.queryByTestId('fleet-save')).not.toBeInTheDocument();
  });
});

describe('ContactFleetSection', () => {
  function renderSection(onOpenFleetAsset?: (id: number) => void) {
    render(
      <I18nProvider>
        <ContactFleetSection publicKey={KEY_A} onOpenFleetAsset={onOpenFleetAsset} />
      </I18nProvider>
    );
  }

  it('adds the node to the register', async () => {
    mocks.fleetAssetForKey.mockResolvedValue(null);
    mocks.addFleetAssetsFromContacts.mockResolvedValue({ created: [TOWER], skipped: 0 });
    const onOpen = vi.fn();
    renderSection(onOpen);

    fireEvent.click(await screen.findByTestId('contact-fleet-add'));

    await waitFor(() => expect(mocks.addFleetAssetsFromContacts).toHaveBeenCalledWith([KEY_A]));
    fireEvent.click(await screen.findByTestId('contact-fleet-open'));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('shows the status of a node that is in the register', async () => {
    mocks.fleetAssetForKey.mockResolvedValue(TOWER);
    renderSection(vi.fn());

    expect(await screen.findByText('Deployed')).toBeInTheDocument();
    expect(screen.queryByTestId('contact-fleet-add')).not.toBeInTheDocument();
  });

  it('has no open button where the fleet page cannot be reached', async () => {
    mocks.fleetAssetForKey.mockResolvedValue(TOWER);
    renderSection(undefined);

    expect(await screen.findByText('Deployed')).toBeInTheDocument();
    expect(screen.queryByTestId('contact-fleet-open')).not.toBeInTheDocument();
  });
});

describe('Fleet attention, log, vault and key generation', () => {
  const LOW_BATTERY = {
    battery_volts: 3.2,
    temperature: 18.5,
    telemetry_at: 1700000000,
    firmware_version: 'v1.9.0',
    firmware_at: 1700000000,
    firmware_source: 'snmp' as const,
  };
  const SECRET = {
    id: 5,
    asset_id: 2,
    kind: 'admin_password' as const,
    label: 'admin',
    created_at: 1700000000,
    updated_at: 1700000000,
  };

  it('marks assets that need attention and can show only those', async () => {
    const tower = { ...TOWER, target_firmware: 'v1.10.0', health: LOW_BATTERY };
    mocks.fleetAssets.mockResolvedValue([tower, SPARE]);
    renderList();

    const marker = await screen.findByTestId('fleet-attention-1');
    expect(marker.dataset.reasons).toBe('silent battery firmware');
    expect(screen.queryByTestId('fleet-attention-2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('fleet-attention-only'));
    expect(screen.getByTestId('fleet-asset-1')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-asset-2')).not.toBeInTheDocument();
  });

  it('saves the attention rules', async () => {
    mocks.fleetAssets.mockResolvedValue([TOWER]);
    mocks.saveFleetSettings.mockResolvedValue({ silent_hours: 12, low_battery_volts: 3.3 });
    renderList();
    await screen.findByTestId('fleet-asset-1');
    await waitFor(() =>
      expect((screen.getByTestId('fleet-rule-silent') as HTMLInputElement).value).toBe('48')
    );

    fireEvent.change(screen.getByTestId('fleet-rule-silent'), { target: { value: '12' } });
    fireEvent.change(screen.getByTestId('fleet-rule-battery'), { target: { value: '3.3' } });
    fireEvent.click(screen.getByTestId('fleet-rule-save'));

    await waitFor(() =>
      expect(mocks.saveFleetSettings).toHaveBeenCalledWith({
        silent_hours: 12,
        low_battery_volts: 3.3,
      })
    );
  });

  it('shows what the node reported on the asset page', async () => {
    mocks.fleetAsset.mockResolvedValue({
      ...TOWER,
      target_firmware: 'v1.10.0',
      health: LOW_BATTERY,
    });
    renderAsset(1);

    expect(await screen.findByTestId('fleet-health-battery')).toHaveTextContent('3.20 V');
    expect(screen.getByTestId('fleet-health-firmware')).toHaveTextContent('v1.9.0 (SNMP poll)');
    expect(await screen.findByTestId('fleet-attention')).toHaveTextContent(
      'Reports a firmware other than the target.'
    );
  });

  it('shows the last known positions of a lost device', async () => {
    mocks.fleetAsset.mockResolvedValue({ ...TOWER, status: 'lost' });
    mocks.contactLocationHistory.mockResolvedValue([
      { lat: 52.1, lon: 5.2, first_seen: 1700000000, last_seen: 1700000500 },
    ]);
    renderAsset(1);

    const panel = await screen.findByTestId('fleet-last-positions');
    await waitFor(() => expect(panel).toHaveTextContent('52.1'));
    expect(mocks.contactLocationHistory).toHaveBeenCalledWith(KEY_A);
  });

  it('lists the log and renders a logged status change in words', async () => {
    mocks.fleetAsset.mockResolvedValue(SPARE);
    mocks.fleetAssetEvents.mockResolvedValue([
      {
        id: 8,
        asset_id: 2,
        kind: 'status',
        occurred_at: 1700000500,
        summary: null,
        detail: null,
        actor: null,
        from_value: 'in_stock',
        to_value: 'deployed',
        created_at: 1700000500,
      },
      {
        id: 7,
        asset_id: 2,
        kind: 'maintenance',
        occurred_at: 1700000000,
        summary: 'Replaced the antenna',
        detail: 'Corroded connector',
        actor: 'Mike',
        from_value: null,
        to_value: null,
        created_at: 1700000000,
      },
    ]);
    renderAsset(2);

    expect(await screen.findByTestId('fleet-log-entry-8')).toHaveTextContent('In stock → Deployed');
    const manual = screen.getByTestId('fleet-log-entry-7');
    expect(manual).toHaveTextContent('Replaced the antenna');
    expect(manual).toHaveTextContent('by Mike');
    expect(manual).toHaveTextContent('Corroded connector');
  });

  it('adds a log entry', async () => {
    mocks.fleetAsset.mockResolvedValue(SPARE);
    mocks.addFleetAssetEvent.mockResolvedValue({});
    renderAsset(2);
    await screen.findByTestId('fleet-log');

    fireEvent.change(screen.getByTestId('fleet-log-kind'), { target: { value: 'failure' } });
    fireEvent.change(screen.getByTestId('fleet-log-when'), {
      target: { value: '2026-10-13T08:30' },
    });
    fireEvent.change(screen.getByTestId('fleet-log-summary'), { target: { value: ' No power ' } });
    fireEvent.click(screen.getByTestId('fleet-log-add'));

    await waitFor(() => expect(mocks.addFleetAssetEvent).toHaveBeenCalled());
    const [assetId, body] = mocks.addFleetAssetEvent.mock.calls[0];
    expect(assetId).toBe(2);
    expect(body).toEqual({
      kind: 'failure',
      summary: 'No power',
      detail: null,
      actor: null,
      occurred_at: Math.floor(new Date('2026-10-13T08:30').getTime() / 1000),
    });
  });

  it('shows no vault section while the server has the vault switched off', async () => {
    mocks.fleetAsset.mockResolvedValue(SPARE);
    renderAsset(2);
    await screen.findByTestId('fleet-log');

    expect(screen.queryByTestId('fleet-secrets')).not.toBeInTheDocument();
  });

  it('unlocks the vault and reveals a secret only on request', async () => {
    mocks.fleetAsset.mockResolvedValue(SPARE);
    mocks.fleetVaultStatus.mockResolvedValueOnce(VAULT_LOCKED).mockResolvedValue(VAULT_OPEN);
    mocks.unlockFleetVault.mockResolvedValue({ token: 'tok', idle_seconds: 900 });
    mocks.fleetSecrets.mockResolvedValue([SECRET]);
    mocks.revealFleetSecret.mockResolvedValue({ value: 's3cret-pass' });
    renderAsset(2);

    fireEvent.change(await screen.findByTestId('fleet-vault-passphrase'), {
      target: { value: 'correct horse battery' },
    });
    fireEvent.click(screen.getByTestId('fleet-vault-unlock'));

    const row = await screen.findByTestId('fleet-secret-5');
    expect(mocks.unlockFleetVault).toHaveBeenCalledWith('correct horse battery');
    expect(row).toHaveTextContent('Admin password');
    expect(screen.queryByTestId('fleet-secret-value-5')).not.toBeInTheDocument();
    expect(mocks.revealFleetSecret).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('fleet-secret-reveal-5'));
    expect(await screen.findByTestId('fleet-secret-value-5')).toHaveTextContent('s3cret-pass');
    fireEvent.click(screen.getByTestId('fleet-secret-reveal-5'));
    expect(screen.queryByTestId('fleet-secret-value-5')).not.toBeInTheDocument();
  });

  it('asks for the passphrase twice on first use and warns that it cannot be recovered', async () => {
    mocks.fleetAsset.mockResolvedValue(SPARE);
    mocks.fleetVaultStatus.mockResolvedValue({ ...VAULT_LOCKED, initialised: false });
    renderAsset(2);

    const gate = await screen.findByTestId('fleet-vault-gate');
    expect(gate).toHaveTextContent('no way to recover');
    const button = screen.getByTestId('fleet-vault-unlock') as HTMLButtonElement;
    fireEvent.change(screen.getByTestId('fleet-vault-passphrase'), {
      target: { value: 'correct horse battery' },
    });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('fleet-vault-passphrase-repeat'), {
      target: { value: 'correct horse battery' },
    });
    expect(button.disabled).toBe(false);
  });

  it('locks the tab again when the server says the session ended', async () => {
    setFleetVaultToken('tok');
    mocks.fleetAsset.mockResolvedValue(SPARE);
    mocks.fleetVaultStatus.mockResolvedValueOnce(VAULT_OPEN).mockResolvedValue(VAULT_LOCKED);
    mocks.fleetSecrets.mockRejectedValue(
      Object.assign(new Error('The vault is locked'), { status: 401 })
    );
    renderAsset(2);

    expect(await screen.findByTestId('fleet-vault-gate')).toBeInTheDocument();
  });

  it('generates a key for an asset without one and shows the new public key', async () => {
    setFleetVaultToken('tok');
    mocks.fleetAsset.mockResolvedValue(SPARE);
    mocks.fleetVaultStatus.mockResolvedValue(VAULT_OPEN);
    mocks.generateFleetKey.mockResolvedValue({
      asset: { ...SPARE, public_key: KEY_B },
      attempts: 40,
    });
    renderAsset(2);

    fireEvent.change(await screen.findByTestId('fleet-keygen-prefix'), {
      target: { value: 'bb' },
    });
    fireEvent.change(screen.getByTestId('fleet-keygen-free'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('fleet-keygen-run'));

    await waitFor(() => expect(mocks.generateFleetKey).toHaveBeenCalledWith(2, 'bb', 1));
    await waitFor(() =>
      expect((screen.getByTestId('fleet-field-public_key') as HTMLInputElement).value).toBe(KEY_B)
    );
    expect(screen.queryByTestId('fleet-keygen')).not.toBeInTheDocument();
  });

  it('offers no key generation for an asset that has a public key', async () => {
    setFleetVaultToken('tok');
    mocks.fleetAsset.mockResolvedValue(TOWER);
    mocks.fleetVaultStatus.mockResolvedValue(VAULT_OPEN);
    renderAsset(1);

    await screen.findByTestId('fleet-secret-add');
    expect(screen.queryByTestId('fleet-keygen')).not.toBeInTheDocument();
  });
});
