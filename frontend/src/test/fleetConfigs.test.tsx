import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { FleetAssetConfigs } from '../components/fleet/FleetAssetConfigs';
import { FleetTemplatesView } from '../components/FleetTemplatesView';
import type { FleetConfig, FleetConfigSummary, FleetConfigTemplate } from '../types';
import { setFleetVaultToken } from '../utils/fleetVault';

const mocks = vi.hoisted(() => ({
  fleetVaultStatus: vi.fn(),
  fleetConfigs: vi.fn(),
  importFleetConfig: vi.fn(),
  fleetConfig: vi.fn(),
  fleetConfigReported: vi.fn(),
  updateFleetConfig: vi.fn(),
  deleteFleetConfig: vi.fn(),
  exportFleetConfig: vi.fn(),
  saveFleetConfigAsTemplate: vi.fn(),
  createFleetConfigFromTemplate: vi.fn(),
  fleetConfigTemplates: vi.fn(),
  createFleetConfigTemplate: vi.fn(),
  updateFleetConfigTemplate: vi.fn(),
  deleteFleetConfigTemplate: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

const VAULT_OFF = { enabled: false, initialised: false, unlocked: false, idle_seconds: 900 };
const VAULT_LOCKED = { enabled: true, initialised: true, unlocked: false, idle_seconds: 900 };
const VAULT_OPEN = { enabled: true, initialised: true, unlocked: true, idle_seconds: 900 };

const DOCUMENT = {
  vars: {
    name: 'NL-TST-RPT',
    tx: 22,
    'guest.password': { $secret: null },
    'prv.key': { $secret: 7 },
  },
  mqtt: { wifiSsid: 'mesh-lab', wifiPassword: { $secret: 8 } },
};

function summary(overrides: Partial<FleetConfigSummary> = {}): FleetConfigSummary {
  return {
    id: 1,
    asset_id: 5,
    kind: 'snapshot',
    source: 'file',
    profile: 'dmc_observer',
    role: 'repeater',
    firmware_version: 'v1.14.1',
    label: 'Before the swap',
    created_at: 1700000000,
    secrets_stored: 2,
    secrets_missing: 1,
    ...overrides,
  };
}

function config(overrides: Partial<FleetConfig> = {}): FleetConfig {
  return { ...summary(), document: DOCUMENT, ...overrides };
}

function template(overrides: Partial<FleetConfigTemplate> = {}): FleetConfigTemplate {
  return {
    id: 3,
    name: 'Repeater base',
    description: 'Defaults for a new repeater',
    profile: 'stock',
    role: 'repeater',
    document: { vars: { name: '{{asset.label}}', tx: '{{power}}' } },
    variables: [{ name: 'power', description: 'TX power', default: '20', type: 'number' }],
    created_at: 1700000000,
    updated_at: 1700000000,
    ...overrides,
  };
}

const NOTHING_REPORTED = { status: 'nothing_stored', rows: [], not_reported: [] };

const ASSET = { id: 5 };

function renderConfigs(onOpenTemplates = vi.fn()) {
  render(
    <I18nProvider>
      <FleetAssetConfigs assetId={ASSET.id} onOpenTemplates={onOpenTemplates} />
    </I18nProvider>
  );
  return onOpenTemplates;
}

function chooseFile(text: string, name = 'config-repeater-NL-TST-RPT.json') {
  const file = new File([text], name, { type: 'application/json' });
  fireEvent.change(screen.getByTestId('fleet-config-file'), { target: { files: [file] } });
}

const createObjectURL = vi.fn(() => 'blob:config');

beforeEach(() => {
  vi.clearAllMocks();
  setFleetVaultToken(null);
  mocks.fleetVaultStatus.mockResolvedValue(VAULT_OFF);
  mocks.fleetConfigs.mockResolvedValue([]);
  mocks.fleetConfigTemplates.mockResolvedValue([]);
  mocks.fleetConfigReported.mockResolvedValue(NOTHING_REPORTED);
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FleetAssetConfigs: history', () => {
  it('says so when nothing is stored', async () => {
    renderConfigs();

    expect(await screen.findByTestId('fleet-configs-empty')).toBeInTheDocument();
    expect(mocks.fleetConfigs).toHaveBeenCalledWith(5, expect.anything());
  });

  it('lists the stored configs with what is known beside the file', async () => {
    mocks.fleetConfigs.mockResolvedValue([
      summary(),
      summary({ id: 2, kind: 'desired', source: 'template', label: 'Plan', secrets_stored: 0 }),
    ]);
    renderConfigs();

    const first = await screen.findByTestId('fleet-config-1');
    expect(within(first).getByText('Before the swap')).toBeInTheDocument();
    expect(within(first).getByText('DMC observer')).toBeInTheDocument();
    expect(within(first).getByText('Read from the device')).toBeInTheDocument();
    expect(within(first).getByText('2 secrets in the vault')).toBeInTheDocument();
    expect(within(first).getByText('1 secret not stored')).toBeInTheDocument();
    expect(within(screen.getByTestId('fleet-config-2')).getByText('Wanted')).toBeInTheDocument();
  });

  it('shows an opened config by section and never a secret value', async () => {
    mocks.fleetConfigs.mockResolvedValue([summary()]);
    mocks.fleetConfig.mockResolvedValue(config());
    renderConfigs();

    fireEvent.click(await screen.findByTestId('fleet-config-open-1'));

    const vars = await screen.findByTestId('fleet-config-section-vars');
    expect(within(vars).getByText('NL-TST-RPT')).toBeInTheDocument();
    expect(within(vars).getByText('22')).toBeInTheDocument();
    const stored = within(vars).getByTestId('fleet-config-secret-prv.key');
    expect(stored).toHaveAttribute('data-secret', 'stored');
    expect(stored).toHaveTextContent('Secret, in the vault');
    const missing = within(vars).getByTestId('fleet-config-secret-guest.password');
    expect(missing).toHaveAttribute('data-secret', 'missing');
    expect(missing).toHaveTextContent('Secret, not stored');
    expect(screen.getByTestId('fleet-config-section-mqtt')).toHaveTextContent('mesh-lab');
  });

  it('shows the difference with another config', async () => {
    mocks.fleetConfigs.mockResolvedValue([summary(), summary({ id: 2, label: 'Older' })]);
    mocks.fleetConfig.mockImplementation(async (id: number) =>
      id === 1
        ? config()
        : config({
            id: 2,
            document: {
              ...DOCUMENT,
              vars: { ...DOCUMENT.vars, tx: 20, 'prv.key': { $secret: 9 } },
            },
          })
    );
    renderConfigs();

    fireEvent.click(await screen.findByTestId('fleet-config-open-1'));
    fireEvent.change(await screen.findByTestId('fleet-config-compare'), {
      target: { value: '2' },
    });

    const diff = await screen.findByTestId('fleet-config-diff');
    const rows = within(diff).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('vars/tx');
    expect(rows[0]).toHaveTextContent('22');
    expect(rows[0]).toHaveTextContent('20');
    expect(rows[1]).toHaveTextContent('vars/prv.key');
    expect(rows[1]).toHaveTextContent('Secret, in the vault');
    expect(screen.getByTestId('fleet-config-uncompared')).toHaveTextContent('vars/guest.password');
  });

  it('corrects the details beside the document', async () => {
    mocks.fleetConfigs.mockResolvedValue([summary()]);
    mocks.fleetConfig.mockResolvedValue(config());
    mocks.updateFleetConfig.mockResolvedValue(config({ profile: 'stock', label: 'Fixed' }));
    renderConfigs();

    fireEvent.click(await screen.findByTestId('fleet-config-open-1'));
    fireEvent.change(await screen.findByTestId('fleet-config-detail-profile'), {
      target: { value: 'stock' },
    });
    fireEvent.change(screen.getByTestId('fleet-config-detail-label'), {
      target: { value: 'Fixed' },
    });
    fireEvent.click(screen.getByTestId('fleet-config-detail-save'));

    await waitFor(() =>
      expect(mocks.updateFleetConfig).toHaveBeenCalledWith(1, {
        profile: 'stock',
        role: 'repeater',
        firmware_version: 'v1.14.1',
        label: 'Fixed',
      })
    );
  });

  it('deletes only after a second click', async () => {
    mocks.fleetConfigs.mockResolvedValue([summary()]);
    mocks.deleteFleetConfig.mockResolvedValue({ status: 'ok' });
    renderConfigs();

    const button = await screen.findByTestId('fleet-config-delete-1');
    fireEvent.click(button);
    expect(mocks.deleteFleetConfig).not.toHaveBeenCalled();
    fireEvent.click(button);

    await waitFor(() => expect(mocks.deleteFleetConfig).toHaveBeenCalledWith(1));
  });
});

describe('FleetAssetConfigs: what the node reported', () => {
  async function openConfig() {
    mocks.fleetConfigs.mockResolvedValue([summary()]);
    mocks.fleetConfig.mockResolvedValue(config());
    renderConfigs();
    fireEvent.click(await screen.findByTestId('fleet-config-open-1'));
    return screen.findByTestId('fleet-config-reported');
  }

  it('lists the settings the node reported differently, with where that came from', async () => {
    mocks.fleetConfigReported.mockResolvedValue({
      status: 'ok',
      rows: [
        {
          path: 'vars/tx',
          configured: '22',
          reported: '20',
          reported_at: 1700000000,
          source: 'radio_settings',
          same: false,
        },
        {
          path: 'vars/name',
          configured: 'NL-TST-RPT',
          reported: 'NL-TST-RPT',
          reported_at: 1700000100,
          source: 'snmp',
          same: true,
        },
        {
          path: 'vars/repeat',
          configured: 'true',
          reported: 'on',
          reported_at: 1700000000,
          source: 'radio_settings',
          same: true,
        },
      ],
      not_reported: ['vars/lat', 'vars/lon'],
    });

    const block = await openConfig();

    expect(mocks.fleetConfigReported).toHaveBeenCalledWith(1, expect.anything());
    const rows = within(await within(block).findByTestId('fleet-config-reported-diff'))
      .getAllByRole('row')
      .slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('vars/tx');
    expect(rows[0]).toHaveTextContent('22');
    expect(rows[0]).toHaveTextContent('20');
    expect(rows[0]).toHaveTextContent('Radio Settings, stored');
    expect(within(block).getByTestId('fleet-config-reported-same')).toHaveTextContent(
      '2 settings are as the node reported them'
    );
    expect(within(block).getByTestId('fleet-config-reported-missing')).toHaveTextContent(
      'vars/lat, vars/lon'
    );
  });

  it('says so when the node reported everything as configured', async () => {
    mocks.fleetConfigReported.mockResolvedValue({
      status: 'ok',
      rows: [
        {
          path: 'vars/tx',
          configured: '22',
          reported: '22',
          reported_at: 1700000000,
          source: 'radio_settings',
          same: true,
        },
      ],
      not_reported: [],
    });

    const block = await openConfig();

    expect(await within(block).findByTestId('fleet-config-reported-none')).toHaveTextContent(
      'No differences'
    );
    expect(within(block).queryByTestId('fleet-config-reported-diff')).not.toBeInTheDocument();
    expect(within(block).queryByTestId('fleet-config-reported-missing')).not.toBeInTheDocument();
  });

  it.each([
    ['nothing_stored', 'Nothing is stored'],
    ['no_public_key', 'no public key'],
    ['not_a_device_file', 'companion'],
  ])('explains the status %s instead of showing a table', async (status, text) => {
    mocks.fleetConfigReported.mockResolvedValue({ status, rows: [], not_reported: [] });

    const block = await openConfig();

    expect(await within(block).findByTestId('fleet-config-reported-status')).toHaveTextContent(
      text
    );
    expect(within(block).queryByTestId('fleet-config-reported-diff')).not.toBeInTheDocument();
  });
});

describe('FleetAssetConfigs: import', () => {
  it('sends the file with the role from its name and says how many secrets were left out', async () => {
    mocks.importFleetConfig.mockResolvedValue({
      config: config({ secrets_stored: 0, secrets_missing: 3 }),
      secrets_stored: 0,
      secrets_left_out: 3,
    });
    renderConfigs();
    await screen.findByTestId('fleet-configs-empty');

    chooseFile(JSON.stringify({ vars: { name: 'NL-TST-RPT' }, mqtt: {} }));
    await waitFor(() => expect(screen.getByTestId('fleet-config-role')).toHaveValue('repeater'));
    fireEvent.click(screen.getByTestId('fleet-config-import'));

    await waitFor(() =>
      expect(mocks.importFleetConfig).toHaveBeenCalledWith(5, {
        document: { vars: { name: 'NL-TST-RPT' }, mqtt: {} },
        kind: 'snapshot',
        role: 'repeater',
        firmware_version: null,
        label: null,
      })
    );
    const warning = await screen.findByTestId('fleet-config-left-out');
    expect(warning).toHaveTextContent('3 secrets in this file were not kept');
    expect(mocks.fleetConfigs).toHaveBeenCalledTimes(2);
  });

  it('says how many secrets went to the vault', async () => {
    mocks.fleetVaultStatus.mockResolvedValue(VAULT_OPEN);
    setFleetVaultToken('token');
    mocks.importFleetConfig.mockResolvedValue({
      config: config(),
      secrets_stored: 3,
      secrets_left_out: 0,
    });
    renderConfigs();
    await screen.findByTestId('fleet-configs-empty');

    chooseFile(JSON.stringify({ vars: {} }));
    await waitFor(() => expect(screen.getByTestId('fleet-config-import')).toBeEnabled());
    fireEvent.change(screen.getByTestId('fleet-config-kind'), { target: { value: 'desired' } });
    fireEvent.change(screen.getByTestId('fleet-config-profile'), {
      target: { value: 'dmc_repeater' },
    });
    fireEvent.click(screen.getByTestId('fleet-config-import'));

    expect(await screen.findByTestId('fleet-config-note')).toHaveTextContent(
      '3 secrets moved to the vault'
    );
    expect(mocks.importFleetConfig.mock.calls[0][1]).toMatchObject({
      kind: 'desired',
      profile: 'dmc_repeater',
    });
    expect(screen.queryByTestId('fleet-config-left-out')).not.toBeInTheDocument();
  });

  it('refuses a file that is not JSON without calling the server', async () => {
    renderConfigs();
    await screen.findByTestId('fleet-configs-empty');

    chooseFile('not json at all');

    expect(await screen.findByRole('alert')).toHaveTextContent('not a JSON file');
    expect(screen.getByTestId('fleet-config-import')).toBeDisabled();
    expect(mocks.importFleetConfig).not.toHaveBeenCalled();
  });

  it('warns before the import when secrets cannot be kept', async () => {
    mocks.fleetVaultStatus.mockResolvedValue(VAULT_LOCKED);
    renderConfigs();

    expect(await screen.findByTestId('fleet-config-vault-hint')).toHaveTextContent(
      'The vault is locked'
    );
  });

  it('says the vault is off when it is', async () => {
    renderConfigs();

    expect(await screen.findByTestId('fleet-config-vault-hint')).toHaveTextContent(
      'The key vault is switched off'
    );
  });
});

describe('FleetAssetConfigs: export', () => {
  it('downloads the file without secrets and says how many were left out', async () => {
    mocks.fleetConfigs.mockResolvedValue([summary()]);
    mocks.exportFleetConfig.mockResolvedValue({
      document: { vars: { name: 'NL-TST-RPT', tx: 22 }, mqtt: { wifiSsid: 'mesh-lab' } },
      secrets_included: 0,
      secrets_left_out: 3,
    });
    renderConfigs();

    fireEvent.click(await screen.findByTestId('fleet-config-export-1'));

    await waitFor(() => expect(mocks.exportFleetConfig).toHaveBeenCalledWith(1, false));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('fleet-config-note')).toHaveTextContent(
      'config-repeater-NL-TST-RPT.json'
    );
    expect(screen.getByTestId('fleet-config-note')).toHaveTextContent('3 secrets left out');
  });

  it('offers the export with secrets only while the vault is unlocked', async () => {
    mocks.fleetConfigs.mockResolvedValue([summary()]);
    mocks.fleetVaultStatus.mockResolvedValue(VAULT_LOCKED);
    renderConfigs();

    await screen.findByTestId('fleet-config-export-1');
    await screen.findByTestId('fleet-config-vault-hint');
    expect(screen.queryByTestId('fleet-config-export-secrets-1')).not.toBeInTheDocument();
  });

  it('exports with secrets after a second click', async () => {
    mocks.fleetConfigs.mockResolvedValue([summary()]);
    mocks.fleetVaultStatus.mockResolvedValue(VAULT_OPEN);
    setFleetVaultToken('token');
    mocks.exportFleetConfig.mockResolvedValue({
      document: { vars: { name: 'NL-TST-RPT' } },
      secrets_included: 2,
      secrets_left_out: 1,
    });
    renderConfigs();

    const button = await screen.findByTestId('fleet-config-export-secrets-1');
    fireEvent.click(button);
    expect(mocks.exportFleetConfig).not.toHaveBeenCalled();
    fireEvent.click(button);

    await waitFor(() => expect(mocks.exportFleetConfig).toHaveBeenCalledWith(1, true));
    expect(await screen.findByTestId('fleet-config-note')).toHaveTextContent('2 secrets included');
  });
});

describe('FleetAssetConfigs: templates', () => {
  it('saves an opened config as a template', async () => {
    mocks.fleetConfigs.mockResolvedValue([summary()]);
    mocks.fleetConfig.mockResolvedValue(config());
    mocks.saveFleetConfigAsTemplate.mockResolvedValue(template());
    renderConfigs();

    fireEvent.click(await screen.findByTestId('fleet-config-open-1'));
    fireEvent.change(await screen.findByTestId('fleet-config-template-name'), {
      target: { value: ' Observer base ' },
    });
    fireEvent.click(screen.getByTestId('fleet-config-save-template'));

    await waitFor(() =>
      expect(mocks.saveFleetConfigAsTemplate).toHaveBeenCalledWith(1, 'Observer base', null)
    );
    expect(await screen.findByTestId('fleet-config-note')).toHaveTextContent('Template saved');
  });

  it('creates a config from a template with its variables', async () => {
    mocks.fleetConfigTemplates.mockResolvedValue([template()]);
    mocks.createFleetConfigFromTemplate.mockResolvedValue(
      config({ id: 9, kind: 'desired', source: 'template' })
    );
    renderConfigs();

    fireEvent.change(await screen.findByTestId('fleet-config-template'), {
      target: { value: '3' },
    });
    const power = await screen.findByTestId('fleet-config-var-power');
    expect(power).toHaveValue('20');
    fireEvent.change(power, { target: { value: '14' } });
    fireEvent.click(screen.getByTestId('fleet-config-create'));

    await waitFor(() =>
      expect(mocks.createFleetConfigFromTemplate).toHaveBeenCalledWith(5, 3, { power: '14' }, null)
    );
    await waitFor(() => expect(mocks.fleetConfigs).toHaveBeenCalledTimes(2));
  });

  it('links to the templates page', async () => {
    const onOpenTemplates = renderConfigs();

    fireEvent.click(await screen.findByTestId('fleet-config-open-templates'));

    expect(onOpenTemplates).toHaveBeenCalledTimes(1);
  });
});

function renderTemplates(onBack = vi.fn()) {
  render(
    <I18nProvider>
      <FleetTemplatesView onBack={onBack} />
    </I18nProvider>
  );
  return onBack;
}

describe('FleetTemplatesView', () => {
  it('says so when there is no template yet', async () => {
    renderTemplates();

    expect(await screen.findByTestId('fleet-templates-empty')).toBeInTheDocument();
  });

  it('opens a template in the editor and saves the changes', async () => {
    mocks.fleetConfigTemplates.mockResolvedValue([template()]);
    mocks.updateFleetConfigTemplate.mockResolvedValue(template({ name: 'Repeater v2' }));
    renderTemplates();

    fireEvent.click(await screen.findByTestId('fleet-template-3'));
    const name = await screen.findByTestId('fleet-template-name');
    expect(name).toHaveValue('Repeater base');
    expect(screen.getByTestId('fleet-template-var-name-0')).toHaveValue('power');
    expect(
      JSON.parse((screen.getByTestId('fleet-template-document') as HTMLTextAreaElement).value)
    ).toEqual(template().document);

    fireEvent.change(name, { target: { value: 'Repeater v2' } });
    fireEvent.click(screen.getByTestId('fleet-template-var-add'));
    fireEvent.change(screen.getByTestId('fleet-template-var-name-1'), {
      target: { value: 'site' },
    });
    fireEvent.click(screen.getByTestId('fleet-template-save'));

    await waitFor(() =>
      expect(mocks.updateFleetConfigTemplate).toHaveBeenCalledWith(3, {
        name: 'Repeater v2',
        description: 'Defaults for a new repeater',
        profile: 'stock',
        role: 'repeater',
        document: template().document,
        variables: [
          { name: 'power', description: 'TX power', default: '20', type: 'number' },
          { name: 'site', description: '', default: '', type: 'text' },
        ],
      })
    );
    expect(await screen.findByTestId('fleet-template-saved')).toBeInTheDocument();
  });

  it('does not send a document that is not JSON', async () => {
    mocks.fleetConfigTemplates.mockResolvedValue([template()]);
    renderTemplates();

    fireEvent.click(await screen.findByTestId('fleet-template-3'));
    fireEvent.change(await screen.findByTestId('fleet-template-document'), {
      target: { value: '{ "vars": ' },
    });
    fireEvent.click(screen.getByTestId('fleet-template-save'));

    expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON');
    expect(mocks.updateFleetConfigTemplate).not.toHaveBeenCalled();
  });

  it('shows why the server refused a template', async () => {
    mocks.fleetConfigTemplates.mockResolvedValue([template()]);
    mocks.updateFleetConfigTemplate.mockRejectedValue(
      new Error('A template cannot hold a secret (vars/guest.password).')
    );
    renderTemplates();

    fireEvent.click(await screen.findByTestId('fleet-template-3'));
    fireEvent.click(await screen.findByTestId('fleet-template-save'));

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot hold a secret');
  });

  it('creates a new template', async () => {
    mocks.createFleetConfigTemplate.mockResolvedValue(template({ id: 4, name: 'Fresh' }));
    renderTemplates();

    fireEvent.click(await screen.findByTestId('fleet-template-new'));
    fireEvent.change(await screen.findByTestId('fleet-template-name'), {
      target: { value: 'Fresh' },
    });
    fireEvent.change(screen.getByTestId('fleet-template-profile'), {
      target: { value: 'companion_v1' },
    });
    fireEvent.change(screen.getByTestId('fleet-template-document'), {
      target: { value: '{"version": 1, "tx_power": 20}' },
    });
    fireEvent.click(screen.getByTestId('fleet-template-save'));

    await waitFor(() =>
      expect(mocks.createFleetConfigTemplate).toHaveBeenCalledWith({
        name: 'Fresh',
        description: null,
        profile: 'companion_v1',
        role: null,
        document: { version: 1, tx_power: 20 },
        variables: [],
      })
    );
  });

  it('deletes a template after a second click', async () => {
    mocks.fleetConfigTemplates.mockResolvedValue([template()]);
    mocks.deleteFleetConfigTemplate.mockResolvedValue({ status: 'ok' });
    renderTemplates();

    fireEvent.click(await screen.findByTestId('fleet-template-3'));
    const button = await screen.findByTestId('fleet-template-delete');
    fireEvent.click(button);
    expect(mocks.deleteFleetConfigTemplate).not.toHaveBeenCalled();
    fireEvent.click(button);

    await waitFor(() => expect(mocks.deleteFleetConfigTemplate).toHaveBeenCalledWith(3));
  });

  it('goes back to the fleet list', async () => {
    const onBack = renderTemplates();

    fireEvent.click(await screen.findByTestId('fleet-templates-back'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
