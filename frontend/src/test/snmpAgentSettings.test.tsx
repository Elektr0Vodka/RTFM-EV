import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { SnmpAgentSettings } from '../components/settings/SnmpAgentSettings';
import type { SnmpAgentState } from '../types';

const mocks = vi.hoisted(() => ({
  getSnmpAgent: vi.fn(),
  saveSnmpAgent: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks, isAbortError: () => false }));

function state(overrides: Partial<SnmpAgentState> = {}): SnmpAgentState {
  return {
    settings: { enabled: false, port: 161, community: 'public' },
    running: false,
    error: null,
    requests: 0,
    bad_community: 0,
    ...overrides,
  };
}

async function renderCard() {
  render(
    <I18nProvider>
      <SnmpAgentSettings />
    </I18nProvider>
  );
  await waitFor(() => expect(screen.getByTestId('snmp-agent-status')).toBeInTheDocument());
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
});

describe('SnmpAgentSettings', () => {
  it('shows the stored settings and that the agent is off', async () => {
    mocks.getSnmpAgent.mockResolvedValue(state());
    await renderCard();
    expect(screen.getByLabelText('Answer SNMP requests')).not.toBeChecked();
    expect(screen.getByLabelText('UDP port')).toHaveValue('161');
    expect(screen.getByLabelText('Community')).toHaveValue('public');
    expect(screen.getByTestId('snmp-agent-status')).toHaveTextContent('Off.');
    // Nothing changed yet, so nothing to save.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves the settings and shows the running listener', async () => {
    mocks.getSnmpAgent.mockResolvedValue(state());
    mocks.saveSnmpAgent.mockResolvedValue(
      state({ settings: { enabled: true, port: 1161, community: 'mon' }, running: true })
    );
    await renderCard();
    fireEvent.click(screen.getByLabelText('Answer SNMP requests'));
    fireEvent.change(screen.getByLabelText('UDP port'), { target: { value: '1161' } });
    fireEvent.change(screen.getByLabelText('Community'), { target: { value: 'mon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.saveSnmpAgent).toHaveBeenCalledTimes(1));
    expect(mocks.saveSnmpAgent).toHaveBeenCalledWith({
      enabled: true,
      port: 1161,
      community: 'mon',
    });
    await waitFor(() =>
      expect(screen.getByTestId('snmp-agent-status')).toHaveTextContent(
        'Listening on UDP port 1161. Answered 0, refused for a wrong community 0.'
      )
    );
  });

  it('shows why the listener is not running', async () => {
    mocks.getSnmpAgent.mockResolvedValue(
      state({
        settings: { enabled: true, port: 161, community: 'public' },
        error: 'cannot listen on UDP port 161: [Errno 13] Permission denied',
      })
    );
    await renderCard();
    expect(screen.getByTestId('snmp-agent-status')).toHaveTextContent(
      'Not running: cannot listen on UDP port 161: [Errno 13] Permission denied'
    );
  });

  it('shows request counters while running', async () => {
    mocks.getSnmpAgent.mockResolvedValue(
      state({
        settings: { enabled: true, port: 161, community: 'public' },
        running: true,
        requests: 42,
        bad_community: 3,
      })
    );
    await renderCard();
    expect(screen.getByTestId('snmp-agent-status')).toHaveTextContent(
      'Answered 42, refused for a wrong community 3.'
    );
  });

  it.each([
    ['0', 'public', 'Port must be between 1 and 65535'],
    ['70000', 'public', 'Port must be between 1 and 65535'],
    ['161', '', 'Community: 1 to 64 printable ASCII characters'],
    ['161', 'x'.repeat(65), 'Community: 1 to 64 printable ASCII characters'],
  ])('refuses port=%s community=%s before any request', async (port, community, message) => {
    mocks.getSnmpAgent.mockResolvedValue(state());
    await renderCard();
    fireEvent.change(screen.getByLabelText('UDP port'), { target: { value: port } });
    fireEvent.change(screen.getByLabelText('Community'), { target: { value: community } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(mocks.saveSnmpAgent).not.toHaveBeenCalled();
  });
});
