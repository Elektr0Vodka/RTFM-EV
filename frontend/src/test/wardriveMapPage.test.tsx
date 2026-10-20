import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { WardriveMapPage } from '../components/WardriveMapPage';
import type { WardriveGroup, WardriveUser } from '../types';
import type { WardriveData, WardriveLiveDriver } from '../wardrive/api';

vi.mock('../wardrive/map/WardriveMap', () => ({
  WardriveMap: ({
    data,
    fill,
    live,
    focus,
  }: {
    data: WardriveData;
    fill?: boolean;
    live?: unknown[];
    focus?: { lat: number; lon: number } | null;
  }) => (
    <div
      data-testid="fake-map"
      data-fill={fill ? 'yes' : 'no'}
      data-live={live?.length ?? 0}
      data-focus={focus ? `${focus.lat},${focus.lon}` : ''}
    >{`${data.obs.length} obs`}</div>
  ),
}));

const KEY = 'AB'.repeat(32);

const USER: WardriveUser = {
  id: 1,
  username: 'mike',
  visibility: 'own',
  disabled: false,
  created_at: 1,
  radios: [{ public_key: KEY, name: 'car', added_at: 1 }],
  group_ids: [],
  obs_count: 12,
};

const LIVE: WardriveLiveDriver = {
  user_id: 1,
  username: 'mike',
  radio_key: KEY,
  radio_name: 'car',
  last_upload_at: Math.floor(Date.now() / 1000) - 20,
  last_ts: Math.floor(Date.now() / 1000) - 30,
  lat: 52.3,
  lon: 5.3,
  accuracy: 5,
  last_rssi: -97,
  last_snr: 3.5,
  drive_id: 7,
  drive_name: 'Ochtend',
  receptions: 12,
};

function mockApi(groups: WardriveGroup[] = [], live: WardriveLiveDriver[] = []) {
  vi.spyOn(api, 'getWardriveAdminLive').mockResolvedValue({ window_s: 600, drivers: live });
  vi.spyOn(api, 'getWardriveUsers').mockResolvedValue([USER]);
  vi.spyOn(api, 'getWardriveGroups').mockResolvedValue(groups);
  return vi
    .spyOn(api, 'getWardriveAdminData')
    .mockResolvedValue({ obs: [], tracks: [], truncated: false });
}

describe('Tools: wardrive map', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says what it shows and loads all wardrive data for the last 24 hours', async () => {
    const data = mockApi();
    render(<WardriveMapPage />);
    expect(screen.getByText(/Everything the wardrive drivers stored/)).toBeTruthy();
    expect(await screen.findByTestId('fake-map')).toBeTruthy();
    const params = data.mock.calls[0][0];
    expect(params.until - params.since).toBe(86400);
    expect(params.user_id).toBeUndefined();
    expect(params.group_id).toBeUndefined();
  });

  it('filters by radio', async () => {
    const data = mockApi();
    render(<WardriveMapPage />);
    await screen.findByTestId('fake-map');
    await screen.findByRole('option', { name: 'car (mike)' });
    fireEvent.change(screen.getByLabelText('Radio'), { target: { value: KEY } });
    await waitFor(() =>
      expect(data.mock.calls[data.mock.calls.length - 1]?.[0]).toMatchObject({ radio_key: KEY })
    );
  });

  it('filters by user and by group', async () => {
    const data = mockApi([{ id: 5, name: 'crew', created_at: 1, member_ids: [1] }]);
    render(<WardriveMapPage />);
    await screen.findByTestId('fake-map');
    await screen.findByRole('option', { name: 'crew' });
    fireEvent.change(screen.getByLabelText('User'), { target: { value: '1' } });
    await waitFor(() =>
      expect(data.mock.calls[data.mock.calls.length - 1]?.[0]).toMatchObject({ user_id: 1 })
    );
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: '5' } });
    await waitFor(() =>
      expect(data.mock.calls[data.mock.calls.length - 1]?.[0]).toMatchObject({ group_id: 5 })
    );
  });

  it('shows the error when the users cannot be read', async () => {
    mockApi();
    vi.spyOn(api, 'getWardriveUsers').mockRejectedValue(new Error('Not Found'));
    render(<WardriveMapPage />);
    expect(await screen.findByText(/Not Found/)).toBeTruthy();
  });

  it('gives the map the height left on the page', async () => {
    mockApi();
    render(<WardriveMapPage />);
    expect((await screen.findByTestId('fake-map')).getAttribute('data-fill')).toBe('yes');
  });

  it('lists the drivers on the road now and flies to one', async () => {
    mockApi([], [LIVE]);
    render(<WardriveMapPage />);
    const map = await screen.findByTestId('fake-map');
    await waitFor(() => expect(map.getAttribute('data-live')).toBe('1'));
    const row = await screen.findByText(/mike/, { selector: 'li *' });
    expect(row.closest('li')?.textContent).toContain('Ochtend');
    expect(row.closest('li')?.textContent).toContain('-97 dBm');
    fireEvent.click(screen.getByRole('button', { name: 'Show mike on the map' }));
    expect(map.getAttribute('data-focus')).toBe('52.3,5.3');
  });

  it('says when nobody is on the road', async () => {
    mockApi();
    render(<WardriveMapPage />);
    expect(await screen.findByText('Nobody is on the road now.')).toBeTruthy();
  });

  it('asks again for the drivers on the road every 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockApi();
      render(<WardriveMapPage />);
      await waitFor(() => expect(api.getWardriveAdminLive).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(30000);
      await waitFor(() => expect(api.getWardriveAdminLive).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });
});
