import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { WardriveMapPage } from '../components/WardriveMapPage';
import type { WardriveGroup, WardriveUser } from '../types';
import type { WardriveData } from '../wardrive/api';

vi.mock('../wardrive/map/WardriveMap', () => ({
  WardriveMap: ({ data }: { data: WardriveData }) => (
    <div data-testid="fake-map">{`${data.obs.length} obs`}</div>
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

function mockApi(groups: WardriveGroup[] = []) {
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

  it('has a heading and loads all wardrive data for the last 24 hours', async () => {
    const data = mockApi();
    render(<WardriveMapPage />);
    expect(screen.getByRole('heading', { name: 'Wardrive map' })).toBeTruthy();
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
});
