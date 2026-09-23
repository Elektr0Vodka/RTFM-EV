import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('maplibre-gl', async () => {
  const { mockMaplibreModule } = await import('./mocks/maplibre');
  return mockMaplibreModule();
});
vi.mock('../map/engine/webgl', () => ({ isWebglAvailable: () => true }));

const mockApi = vi.hoisted(() => ({
  getTileCacheConfig: vi.fn(),
  updateTileCacheConfig: vi.fn(),
  getTileCacheStats: vi.fn(),
  clearTileCache: vi.fn(),
  estimateTileDownload: vi.fn(),
  startTileDownload: vi.fn(),
  getTileDownload: vi.fn(),
  cancelTileDownload: vi.fn(),
}));
vi.mock('../api', () => ({ api: mockApi }));

import { SettingsTileCacheSection } from '../components/settings/SettingsTileCacheSection';
import { proxiedUrl } from '../map/engine/tileProxy';
import type { TileCacheConfig, TileCacheStats } from '../types';

function config(overrides: Partial<TileCacheConfig> = {}): TileCacheConfig {
  return {
    enabled: false,
    max_size_mb: 1024,
    max_age_days: 365,
    limits: {
      min_size_mb: 50,
      max_size_mb: 50000,
      min_age_days: 1,
      max_age_days: 3650,
      predownload_min_zoom: 0,
      predownload_max_zoom: 15,
      predownload_max_tiles: 5000,
      predownload_concurrency: 4,
    },
    sources: [
      {
        id: 'osm',
        label: 'OpenStreetMap',
        client_prefixes: ['https://tile.openstreetmap.org/'],
        proxy: true,
        predownload: false,
        max_zoom: 19,
        policy_url: 'https://operations.osmfoundation.org/policies/tiles/',
      },
      {
        id: 'esri',
        label: 'Esri',
        client_prefixes: ['https://server.arcgisonline.com/'],
        proxy: false,
        predownload: false,
        max_zoom: 19,
        policy_url: 'https://www.esri.com/',
      },
    ],
    ...overrides,
  };
}

const STATS: TileCacheStats = {
  entries: 3,
  bytes: 3 * 1024 * 1024,
  max_bytes: 1024 * 1024 * 1024,
  per_source: { osm: { entries: 3, bytes: 3 * 1024 * 1024 } },
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('remoteterm-map-layer', 'light');
  mockApi.getTileCacheConfig.mockResolvedValue(config());
  mockApi.getTileCacheStats.mockResolvedValue(STATS);
});

describe('SettingsTileCacheSection', () => {
  it('shows stats, per-source verdicts, and no area download when no source allows it', async () => {
    render(<SettingsTileCacheSection />);
    expect(await screen.findByText(/3 cached files, 3\.0 MB of 1024\.0 MB/)).toBeInTheDocument();
    expect(screen.getByText(/loaded directly, not cached/)).toBeInTheDocument();
    expect(screen.getByText(/Area download is not available/)).toBeInTheDocument();
    expect(screen.queryByText('Download an area')).not.toBeInTheDocument();
  });

  it('enabling the cache saves it and turns on request rewriting in this browser', async () => {
    mockApi.updateTileCacheConfig.mockResolvedValue(config({ enabled: true }));
    render(<SettingsTileCacheSection />);
    fireEvent.click(await screen.findByLabelText('Cache map tiles on the server'));
    await waitFor(() =>
      expect(mockApi.updateTileCacheConfig).toHaveBeenCalledWith({ enabled: true })
    );
    await waitFor(() =>
      expect(proxiedUrl('https://tile.openstreetmap.org/3/1/2.png')).toContain(
        '/api/tiles/proxy/osm/3/1/2.png'
      )
    );
  });

  it('clears the cache after confirmation', async () => {
    mockApi.clearTileCache.mockResolvedValue({ ...STATS, entries: 0, bytes: 0, per_source: {} });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsTileCacheSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear cache' }));
    await waitFor(() => expect(mockApi.clearTileCache).toHaveBeenCalled());
    expect(await screen.findByText(/0 cached files/)).toBeInTheDocument();
    confirm.mockRestore();
  });

  it('offers area download with an estimate only for a policy-allowed source', async () => {
    const cfg = config({ enabled: true });
    cfg.sources.push({
      id: 'selfhosted',
      label: 'Self-hosted',
      client_prefixes: ['https://tiles.example.org/'],
      proxy: true,
      predownload: true,
      max_zoom: 14,
      policy_url: 'https://tiles.example.org/policy',
    });
    mockApi.getTileCacheConfig.mockResolvedValue(cfg);
    mockApi.getTileDownload.mockResolvedValue({
      state: 'idle',
      source: null,
      total: 0,
      done: 0,
      failed: 0,
      started_at: null,
      finished_at: null,
      error: null,
    });
    mockApi.estimateTileDownload.mockResolvedValue({ tiles: 42, max_tiles: 5000, allowed: true });
    render(<SettingsTileCacheSection />);
    expect(await screen.findByText('Download an area')).toBeInTheDocument();
    const source = screen.getByLabelText('Map source') as HTMLSelectElement;
    expect(Array.from(source.options).map((o) => o.value)).toEqual(['selfhosted']);
    // Zoom options stop at the source's max zoom (14), below the global cap (15).
    const maxZoom = screen.getByLabelText('To zoom') as HTMLSelectElement;
    expect(maxZoom.value).toBe('14');
  });
});
