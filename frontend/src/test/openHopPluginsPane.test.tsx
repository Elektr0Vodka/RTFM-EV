import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenHopPluginsPane } from '../components/settings/openhop/plugins/OpenHopPluginsPane';
import { api, ApiError } from '../api';
import type { HealthStatus } from '../types';

const oh = { radio_device_info: { is_openhop: true } } as unknown as HealthStatus;

class MockEventSource {
  static last: MockEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.last = this;
  }
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  MockEventSource.last = null;
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('OpenHopPluginsPane', () => {
  it('shows the empty installed list', async () => {
    vi.spyOn(api, 'listOpenHopPlugins').mockResolvedValue({ success: true, plugins: [] });
    render(<OpenHopPluginsPane health={oh} />);
    expect(await screen.findByText(/no plugins installed/i)).toBeInTheDocument();
  });

  it('shows the configure-first message on 409', async () => {
    vi.spyOn(api, 'listOpenHopPlugins').mockRejectedValue(new ApiError('nope', 409));
    render(<OpenHopPluginsPane health={oh} />);
    expect(await screen.findByText(/configure openhop management/i)).toBeInTheDocument();
  });

  it('shows the unavailable message on 503', async () => {
    vi.spyOn(api, 'listOpenHopPlugins').mockRejectedValue(new ApiError('down', 503));
    render(<OpenHopPluginsPane health={oh} />);
    expect(await screen.findByText(/plugin manager unavailable/i)).toBeInTheDocument();
  });

  it('loads the catalogue when the Catalogue tab is opened', async () => {
    vi.spyOn(api, 'listOpenHopPlugins').mockResolvedValue({ success: true, plugins: [] });
    const cat = vi
      .spyOn(api, 'getOpenHopPluginCatalogue')
      .mockResolvedValue({ success: true, plugins: [] });
    render(<OpenHopPluginsPane health={oh} />);
    await userEvent.click(await screen.findByRole('button', { name: /catalogue/i }));
    await waitFor(() => expect(cat).toHaveBeenCalled());
  });

  it('runs a lifecycle action then reloads', async () => {
    const plugin = {
      id: 'p1',
      name: 'MQTT Bridge',
      version: '1.4.2',
      enabled: true,
      state: 'running',
    };
    const list = vi
      .spyOn(api, 'listOpenHopPlugins')
      .mockResolvedValue({ success: true, plugins: [plugin] });
    const disable = vi.spyOn(api, 'openHopPluginLifecycle').mockResolvedValue({ success: true });
    render(<OpenHopPluginsPane health={oh} />);
    await userEvent.click(await screen.findByRole('button', { name: /disable/i }));
    expect(disable).toHaveBeenCalledWith('disable', 'p1');
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  });

  it('validates and saves plugin settings', async () => {
    const plugin = { id: 'p1', name: 'MQTT', version: '1', enabled: true, state: 'running' };
    vi.spyOn(api, 'listOpenHopPlugins').mockResolvedValue({ success: true, plugins: [plugin] });
    vi.spyOn(api, 'getOpenHopPluginConfig').mockResolvedValue({
      success: true,
      config: { qos: 0 },
    });
    const save = vi.spyOn(api, 'setOpenHopPluginConfig').mockResolvedValue({ success: true });
    render(<OpenHopPluginsPane health={oh} />);
    await userEvent.click(await screen.findByRole('button', { name: /^settings$/i }));
    const editor = await screen.findByRole('textbox');
    await userEvent.clear(editor);
    await userEvent.type(editor, '{{"qos":1}');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(save).toHaveBeenCalledWith('p1', { qos: 1 }, false);
  });

  it('streams a live install log and reloads on done', async () => {
    const entry = { id: 'openhop.nomad', name: 'Nomad', version: '2.0.0' };
    const list = vi
      .spyOn(api, 'listOpenHopPlugins')
      .mockResolvedValue({ success: true, plugins: [] });
    vi.spyOn(api, 'getOpenHopPluginCatalogue').mockResolvedValue({
      success: true,
      plugins: [entry],
    });
    vi.spyOn(api, 'installOpenHopCataloguePlugin').mockResolvedValue({ success: true });
    render(<OpenHopPluginsPane health={oh} />);
    await userEvent.click(await screen.findByRole('button', { name: /catalogue/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^install$/i }));
    const es = MockEventSource.last!;
    expect(es).toBeTruthy();
    es.emit({ type: 'connected', id: 'openhop.nomad' });
    es.emit({ type: 'line', line: 'installing wheel' });
    expect(await screen.findByText(/installing wheel/i)).toBeInTheDocument();
    const before = list.mock.calls.length;
    es.emit({ type: 'done', state: 'complete' });
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(before));
    expect(es.closed).toBe(true);
  });
});
