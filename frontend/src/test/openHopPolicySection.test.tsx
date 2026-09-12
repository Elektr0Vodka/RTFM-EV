import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsOpenHopSection } from '../components/settings/openhop/SettingsOpenHopSection';
import { api } from '../api';
import type { AppSettings, HealthStatus, OpenHopPolicyDoc } from '../types';

function health(is_openhop: boolean): HealthStatus {
  return {
    status: 'ok',
    radio_connected: true,
    radio_initializing: false,
    connection_info: 'TCP',
    radio_device_info: {
      model: is_openhop ? 'openHop-Repeater-Companion' : 'Heltec V3',
      firmware_build: 'b',
      firmware_version: '13.0',
      max_contacts: 510,
      max_channels: 40,
      is_meshcomod: false,
      is_openhop,
    },
    database_size_mb: 1,
  } as HealthStatus;
}
const settings = { openhop_api_url: 'http://n:8000', openhop_api_token: 't' } as AppSettings;

function policyDoc(overrides: Partial<OpenHopPolicyDoc> = {}): OpenHopPolicyDoc {
  return {
    policy_file: '/p',
    exists: false,
    policy_engine: {
      enabled: false,
      default_action: 'allow',
      rules: [],
      objects: { channel_hash_groups: {}, pubkey_groups: {} },
    },
    groups: { channel_hashes: [], pubkeys: [] },
    ...overrides,
  };
}

function renderSection() {
  return render(
    <SettingsOpenHopSection
      health={health(true)}
      appSettings={settings}
      onSaveAppSettings={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'getOpenHopPolicy').mockResolvedValue({ success: true, data: policyDoc() });
});

describe('SettingsOpenHopSection', () => {
  it('renders nothing when the node is not OpenHop', () => {
    const { container } = render(
      <SettingsOpenHopSection
        health={health(false)}
        appSettings={settings}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the policy engine heading when OpenHop', async () => {
    renderSection();
    expect(await screen.findByRole('heading', { name: /policy engine/i })).toBeInTheDocument();
  });

  it('shows the configure-first prompt when policy is not available', async () => {
    vi.spyOn(api, 'getOpenHopPolicy').mockResolvedValue({ success: false });
    renderSection();
    expect(await screen.findByText(/configure openhop management/i)).toBeInTheDocument();
  });

  it('validates then saves the engine on Save policy', async () => {
    const validate = vi
      .spyOn(api, 'validateOpenHopPolicy')
      .mockResolvedValue({ success: true, data: { valid: true } });
    const update = vi.spyOn(api, 'updateOpenHopPolicy').mockResolvedValue({ success: true });
    renderSection();
    const toggle = await screen.findByLabelText(/policy engine enabled/i);
    await userEvent.click(toggle);
    await userEvent.click(screen.getByRole('button', { name: /save policy/i }));
    await waitFor(() => expect(validate).toHaveBeenCalled());
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
    );
  });

  it('does not save when validation fails', async () => {
    const validate = vi
      .spyOn(api, 'validateOpenHopPolicy')
      .mockResolvedValue({ success: true, data: { valid: false } });
    const update = vi.spyOn(api, 'updateOpenHopPolicy').mockResolvedValue({ success: true });
    renderSection();
    await screen.findByRole('heading', { name: /policy engine/i });
    await userEvent.click(screen.getByRole('button', { name: /save policy/i }));
    await waitFor(() => expect(validate).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByText(/policy is invalid/i)).toBeInTheDocument();
  });

  it('creates a group via the api and refetches', async () => {
    const create = vi.spyOn(api, 'createOpenHopGroup').mockResolvedValue({ success: true });
    renderSection();
    await screen.findByRole('heading', { name: /policy engine/i });
    const idInput = screen.getByLabelText(/group id channel_hashes/i);
    await userEvent.type(idInput, 'grpA');
    const createButtons = screen.getAllByRole('button', { name: /create group/i });
    await userEvent.click(createButtons[0]);
    await waitFor(() => expect(create).toHaveBeenCalledWith('channel_hashes', 'grpA', ''));
  });

  it('adds a rule and shows the rule form', async () => {
    renderSection();
    await screen.findByRole('heading', { name: /policy engine/i });
    await userEvent.click(screen.getByRole('button', { name: /add rule/i }));
    expect(await screen.findByLabelText(/rule name/i)).toBeInTheDocument();
  });
});
