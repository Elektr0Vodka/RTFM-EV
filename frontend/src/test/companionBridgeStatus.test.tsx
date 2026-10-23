import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { api } from '../api';
import { I18nProvider } from '../i18n/I18nProvider';
import { CompanionBridgeStatus } from '../components/settings/CompanionBridgeStatus';

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderStatus() {
  render(
    <I18nProvider>
      <CompanionBridgeStatus />
    </I18nProvider>
  );
}

describe('CompanionBridgeStatus', () => {
  it('shows where it listens and which apps are connected', async () => {
    vi.spyOn(api, 'getCompanionBridgeStatus').mockResolvedValue({
      enabled: true,
      host: '0.0.0.0',
      port: 5000,
      allow_send: false,
      clients: [{ address: '192.168.1.20:51234', app_name: 'MeshCore', connected_at: 1 }],
    });
    renderStatus();
    expect(await screen.findByText(/0\.0\.0\.0:5000, 1 app/)).toBeInTheDocument();
    expect(screen.getByText('MeshCore from 192.168.1.20:51234')).toBeInTheDocument();
    expect(screen.getByText(/they can read, not send/)).toBeInTheDocument();
  });

  it('explains the env var when the bridge is off', async () => {
    vi.spyOn(api, 'getCompanionBridgeStatus').mockResolvedValue({
      enabled: false,
      host: null,
      port: null,
      allow_send: true,
      clients: [],
    });
    renderStatus();
    expect(await screen.findByText(/MESHCORE_COMPANION_BRIDGE_ENABLED=true/)).toBeInTheDocument();
  });
});
