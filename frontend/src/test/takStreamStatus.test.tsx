import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { api } from '../api';
import { I18nProvider } from '../i18n/I18nProvider';
import { TakStreamStatus } from '../components/settings/TakStreamStatus';

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderStatus() {
  render(
    <I18nProvider>
      <TakStreamStatus />
    </I18nProvider>
  );
}

describe('TakStreamStatus', () => {
  it('shows the port and client count when the stream runs', async () => {
    vi.spyOn(api, 'getTakStreamStatus').mockResolvedValue({
      enabled: true,
      host: '0.0.0.0',
      port: 8088,
      clients: 2,
    });
    renderStatus();
    expect(await screen.findByText(/port 8088, 2 ATAK/)).toBeInTheDocument();
  });

  it('explains the env var when the stream is off', async () => {
    vi.spyOn(api, 'getTakStreamStatus').mockResolvedValue({
      enabled: false,
      host: null,
      port: null,
      clients: 0,
    });
    renderStatus();
    expect(await screen.findByText(/MESHCORE_TAK_STREAM_ENABLED=true/)).toBeInTheDocument();
  });
});
