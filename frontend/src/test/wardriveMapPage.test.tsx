import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { WardriveMapPage } from '../components/WardriveMapPage';
import type { WardriveGroup, WardriveUser } from '../types';
import type { WardriveLiveDriver } from '../wardrive/api';
import type { CoverageMapProps } from '../wardrive/coverage/CoverageMap';

let cov: CoverageMapProps;
vi.mock('../wardrive/coverage/CoverageMap', () => ({
  CoverageMap: (props: CoverageMapProps) => {
    cov = props;
    return (
      <div data-testid="coverage-map">
        {props.extraBar}
        {props.banner}
      </div>
    );
  },
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
  return vi.spyOn(api, 'wardriveAdmin').mockResolvedValue({ points: [] });
}

describe('Tools: wardrive map', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('says what it shows and opens the coverage map over the admin API', async () => {
    const admin = mockApi();
    render(<WardriveMapPage />);
    expect(
      screen.getByText(/The coverage map of everything the wardrive drivers stored/)
    ).toBeTruthy();
    await screen.findByTestId('coverage-map');
    await act(async () => {
      await cov.api.points({ since: '1' });
    });
    expect(admin).toHaveBeenCalledWith('/map/points?since=1', undefined);
    expect(cov.extraParams).toEqual({});
  });

  it('keeps the map state in the query string', async () => {
    mockApi();
    window.history.replaceState(null, '', '/?mode=points#wardrive');
    render(<WardriveMapPage />);
    await screen.findByTestId('coverage-map');
    expect(cov.urlState?.read().get('mode')).toBe('points');
  });

  it('filters by radio and by group', async () => {
    mockApi([{ id: 5, name: 'crew', created_at: 1, member_ids: [1] }]);
    render(<WardriveMapPage />);
    await screen.findByRole('option', { name: 'car (mike)' });
    fireEvent.change(screen.getByLabelText('Radio'), { target: { value: KEY } });
    await waitFor(() => expect(cov.extraParams).toEqual({ radio_key: KEY }));
    await screen.findByRole('option', { name: 'crew' });
    fireEvent.change(screen.getByLabelText('Group'), { target: { value: '5' } });
    await waitFor(() => expect(cov.extraParams).toEqual({ radio_key: KEY, group_id: '5' }));
  });

  it('shows the error when the users cannot be read', async () => {
    mockApi();
    vi.spyOn(api, 'getWardriveUsers').mockRejectedValue(new Error('Not Found'));
    render(<WardriveMapPage />);
    expect(await screen.findByText(/Not Found/)).toBeTruthy();
  });

  it('lists the drivers on the road now, puts them on the map and flies to one', async () => {
    mockApi([], [LIVE]);
    render(<WardriveMapPage />);
    await screen.findByTestId('coverage-map');
    await waitFor(() => expect(cov.live).toEqual([{ lat: 52.3, lon: 5.3, label: 'mike' }]));
    const row = await screen.findByText(/mike/, { selector: 'li *' });
    expect(row.closest('li')?.textContent).toContain('Ochtend');
    expect(row.closest('li')?.textContent).toContain('-97 dBm');
    fireEvent.click(screen.getByRole('button', { name: 'Show mike on the map' }));
    expect(cov.focus).toMatchObject({ lat: 52.3, lon: 5.3 });
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

  it('views the map as a driver, says so, and goes back', async () => {
    const admin = mockApi([{ id: 5, name: 'crew', created_at: 1, member_ids: [1] }]);
    const onViewAs = vi.fn();
    render(<WardriveMapPage viewAs={{ asUser: 1 }} onViewAs={onViewAs} />);
    expect(await screen.findByText(/Viewing as mike \(visibility: Own data only\)/)).toBeTruthy();
    await act(async () => {
      await cov.api.points({ since: '1' });
    });
    expect(admin).toHaveBeenCalledWith('/map/points?since=1&as_user=1', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Back to everything' }));
    expect(onViewAs).toHaveBeenCalledWith(null);
  });

  it('picks whom to view as from the bar', async () => {
    mockApi([{ id: 5, name: 'crew', created_at: 1, member_ids: [1] }]);
    const onViewAs = vi.fn();
    render(<WardriveMapPage onViewAs={onViewAs} />);
    await screen.findByRole('option', { name: 'Group: crew' });
    fireEvent.change(screen.getByLabelText('View as'), { target: { value: 'g:5' } });
    expect(onViewAs).toHaveBeenCalledWith({ asGroup: 5 });
    fireEvent.change(screen.getByLabelText('View as'), { target: { value: 'u:1' } });
    expect(onViewAs).toHaveBeenCalledWith({ asUser: 1 });
  });
});
