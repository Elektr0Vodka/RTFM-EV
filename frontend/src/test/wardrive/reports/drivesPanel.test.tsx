import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { I18nProvider } from '../../../i18n';
import { DrivesPanel } from '../../../wardrive/reports/DrivesPanel';
import type { DrivesApi } from '../../../wardrive/reports/types';
import { T0, drive, fakeApi } from './fixtures';

function Harness({ api, initial = [] }: { api: DrivesApi; initial?: number[] }) {
  const [selected, setSelected] = useState<number[]>(initial);
  return (
    <>
      <DrivesPanel api={api} filter={{}} selected={selected} onSelectedChange={setSelected} />
      <output data-testid="picked">{selected.join(',')}</output>
    </>
  );
}

function renderPanel(api: DrivesApi, initial: number[] = []) {
  render(
    <I18nProvider>
      <Harness api={api} initial={initial} />
    </I18nProvider>
  );
}

const two = [
  drive({ id: 1, name: 'Ochtend' }),
  drive({ id: 2, name: 'Avond', start_ts: T0 + 7200, end_ts: T0 + 7800 }),
];

describe('drives panel', () => {
  it('lists drives with their numbers', async () => {
    renderPanel(fakeApi(two));
    const row = (await screen.findByText('Ochtend')).closest('li')!;
    expect(within(row).getByText('1 h 5 min')).toBeTruthy();
    expect(within(row).getByText('42 receptions')).toBeTruthy();
    expect(within(row).getByText('car')).toBeTruthy();
  });

  it('says when there is nothing', async () => {
    renderPanel(fakeApi([]));
    expect(await screen.findByText('No drives in this selection yet.')).toBeTruthy();
  });

  it('picks drives with their checkbox', async () => {
    renderPanel(fakeApi(two));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Pick Ochtend' }));
    expect(screen.getByTestId('picked').textContent).toBe('1');
  });

  it('renames a drive', async () => {
    const api = fakeApi(two);
    renderPanel(api);
    const row = (await screen.findByText('Ochtend')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    const name = within(row).getByLabelText('Name');
    fireEvent.change(name, { target: { value: 'Rondje Ens' } });
    fireEvent.change(within(row).getByLabelText('Notes'), { target: { value: 'dijk' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(1, { name: 'Rondje Ens', notes: 'dijk' })
    );
    await waitFor(() => expect(api.drives).toHaveBeenCalledTimes(2));
  });

  it('asks before deleting and says the collectors keep theirs', async () => {
    const api = fakeApi(two);
    renderPanel(api);
    const row = (await screen.findByText('Ochtend')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/collectors keep/)).toBeTruthy();
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete drive' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(1));
  });

  it('merges two editable drives of one radio', async () => {
    const api = fakeApi(two);
    renderPanel(api);
    const merge = await screen.findByRole('button', { name: 'Merge picked' });
    expect((merge as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pick Ochtend' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pick Avond' }));
    expect((merge as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(merge);
    await waitFor(() => expect(api.merge).toHaveBeenCalledWith([1, 2]));
  });

  it('does not merge drives of two radios', async () => {
    renderPanel(fakeApi([two[0], { ...two[1], radio_key: 'BB'.repeat(32) }]), [1, 2]);
    const merge = await screen.findByRole('button', { name: 'Merge picked' });
    expect((merge as HTMLButtonElement).disabled).toBe(true);
  });

  it('splits a drive at a time inside it', async () => {
    const api = fakeApi(two);
    renderPanel(api);
    const row = (await screen.findByText('Ochtend')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Split' }));
    const at = within(row).getByLabelText('Split at') as HTMLInputElement;
    // datetime-local in local time; one minute after the start.
    const d = new Date((T0 + 60) * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    fireEvent.change(at, { target: { value: local } });
    fireEvent.click(within(row).getByRole('button', { name: 'Split here' }));
    await waitFor(() => expect(api.split).toHaveBeenCalledWith(1, T0 + 60));
  });

  it('shows no changes for a drive of someone else', async () => {
    renderPanel(fakeApi([drive({ id: 5, name: 'Bert rit', username: 'bert', can_edit: false })]));
    const row = (await screen.findByText('Bert rit')).closest('li')!;
    expect(within(row).getByText('bert')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('shows the server message when a change fails', async () => {
    const api = fakeApi(two);
    api.merge.mockRejectedValueOnce(new Error('Only drives of one radio can be merged'));
    renderPanel(api, [1, 2]);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge picked' }));
    expect(await screen.findByText('Only drives of one radio can be merged')).toBeTruthy();
  });
});
