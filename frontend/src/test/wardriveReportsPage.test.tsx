import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../api';
import { WardriveReportsPage } from '../components/WardriveReportsPage';
import type { WardriveUser } from '../types';
import { drive, report } from './wardrive/reports/fixtures';

const KEY = 'AA'.repeat(32);
const USER: WardriveUser = {
  id: 1,
  username: 'anna',
  visibility: 'own',
  disabled: false,
  created_at: 1,
  radios: [{ public_key: KEY, name: 'car', added_at: 1 }],
  group_ids: [],
  obs_count: 42,
};

function mockApi() {
  vi.spyOn(api, 'getWardriveUsers').mockResolvedValue([USER]);
  vi.spyOn(api, 'getWardriveGroups').mockResolvedValue([]);
  return vi.spyOn(api, 'wardriveAdmin').mockImplementation(async (path: string) => {
    if (path.startsWith('/drives')) {
      return {
        drives: [
          drive({ id: 3, name: 'Anna rit' }),
          drive({ id: 4, name: 'Bert rit', user_id: 2, username: 'bert' }),
        ],
        truncated: false,
      } as never;
    }
    return report() as never;
  });
}

describe('Tools: wardrive reports', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists every driver and reports on the picked drives', async () => {
    const calls = mockApi();
    render(<WardriveReportsPage />);
    expect(screen.getByRole('heading', { name: 'Wardrive reports' })).toBeTruthy();
    expect(await screen.findByText('Bert rit')).toBeTruthy();
    expect(screen.getByText('bert')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pick Anna rit' }));
    await waitFor(() =>
      expect(calls.mock.calls.map((c) => c[0])).toContain('/report?drive=3&res=9')
    );
    expect(await screen.findByRole('heading', { name: 'What was driven' })).toBeTruthy();
  });

  it('narrows the list by user', async () => {
    const calls = mockApi();
    render(<WardriveReportsPage />);
    await screen.findByRole('option', { name: 'anna' });
    fireEvent.change(screen.getByLabelText('User'), { target: { value: '1' } });
    await waitFor(() =>
      expect(calls.mock.calls.map((c) => c[0])).toContainEqual(
        expect.stringMatching(/^\/drives\?since=\d+&user_id=1$/)
      )
    );
  });
});
