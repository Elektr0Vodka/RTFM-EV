import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { ReportsTab } from '../../wardrive/components/ReportsTab';
import { fakeApi } from './reports/fixtures';

function renderTab(api: ReturnType<typeof fakeApi>, picked: number[] = []) {
  render(
    <I18nProvider>
      <ReportsTab api={api} picked={picked} />
    </I18nProvider>
  );
}

describe('page Reports tab', () => {
  it('narrows a window report to one of the driver groups', async () => {
    const api = {
      ...fakeApi(),
      groups: vi.fn(async () => [
        { id: 4, name: 'Team Noord' },
        { id: 5, name: 'Club' },
      ]),
    };
    renderTab(api);
    const select = (await screen.findByLabelText('Group')) as HTMLSelectElement;
    await screen.findByRole('option', { name: 'Team Noord' });
    fireEvent.change(select, { target: { value: '4' } });
    await waitFor(() =>
      expect(api.report).toHaveBeenLastCalledWith(
        expect.objectContaining({ group_id: 4, since: expect.any(Number) })
      )
    );
  });

  it('shows no group filter to a driver in no group', async () => {
    const api = { ...fakeApi(), groups: vi.fn(async () => []) };
    renderTab(api);
    await waitFor(() => expect(api.groups).toHaveBeenCalled());
    await waitFor(() => expect(api.report).toHaveBeenCalled());
    expect(screen.queryByLabelText('Group')).toBeNull();
  });
});
