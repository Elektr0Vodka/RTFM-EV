import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { wardriveApi, type WardriveData } from '../../wardrive/api';
import { MapPanel } from '../../wardrive/components/MapPanel';

vi.mock('../../wardrive/map/WardriveMap', () => ({
  WardriveMap: ({ data }: { data: WardriveData }) => (
    <div data-testid="fake-map">{`${data.obs.length} obs`}</div>
  ),
}));

const EMPTY: WardriveData = { obs: [], tracks: [], truncated: false };
const ONE: WardriveData = {
  obs: [
    {
      user_id: 1,
      username: 'mike',
      radio_key: 'AA'.repeat(32),
      rx_at: '2026-10-19T10:00:00.000Z',
      hash: '0123456789abcdef',
      packet_type: 5,
      route: 'F',
      path: [],
      rssi: -90,
      snr: 5,
      lat: 52,
      lon: 5,
      accuracy: 4,
    },
  ],
  tracks: [],
  truncated: false,
};

function renderPanel() {
  render(
    <I18nProvider>
      <MapPanel />
    </I18nProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wardrive page map', () => {
  it('loads the last 24 hours when the map is opened', async () => {
    const data = vi.spyOn(wardriveApi, 'data').mockResolvedValue(ONE);
    renderPanel();
    expect(data).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show map' }));
    expect(await screen.findByTestId('fake-map')).toHaveTextContent('1 obs');
    const params = data.mock.calls[0][0]!;
    expect(params.until! - params.since!).toBe(86400);
  });

  it('reloads for the chosen window', async () => {
    const data = vi.spyOn(wardriveApi, 'data').mockResolvedValue(ONE);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show map' }));
    await screen.findByTestId('fake-map');
    fireEvent.change(screen.getByLabelText('Time window'), { target: { value: '7d' } });
    await waitFor(() => expect(data).toHaveBeenCalledTimes(2));
    const params = data.mock.calls[1][0]!;
    expect(params.until! - params.since!).toBe(7 * 86400);
  });

  it('shows the empty state when there is no data', async () => {
    vi.spyOn(wardriveApi, 'data').mockResolvedValue(EMPTY);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show map' }));
    expect(await screen.findByText('Nothing stored in this time window yet.')).toBeTruthy();
  });

  it('says when only the newest rows are shown', async () => {
    vi.spyOn(wardriveApi, 'data').mockResolvedValue({ ...ONE, truncated: true });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show map' }));
    expect(await screen.findByText(/only the newest/i)).toBeTruthy();
  });
});
