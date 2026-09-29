import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioStatPicker } from '../components/MyNodeView';
import type { RadioIdentity, RadioIdentityList } from '../types';

const radio = (id: number, key: string, name: string): RadioIdentity => ({
  id,
  public_key: key.repeat(32),
  name,
  notes: null,
  first_connected: 1,
  last_connected: 1,
  status: 'confirmed',
  pending_reason: null,
  replaced_by: null,
  carry_stats: false,
  carry_owned: false,
  is_active: id === 2,
});

const list: RadioIdentityList = {
  radios: [radio(2, 'bb', 'Bravo'), radio(1, 'aa', 'Alpha')],
  has_unassigned_history: true,
};

describe('My Node radio picker (plan 18)', () => {
  it('offers the current radio, every radio, and pre-tracking history', () => {
    render(<RadioStatPicker list={list} value={null} onChange={vi.fn()} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      'Current radio',
      'Bravo (bbbbbbbbbbbb)',
      'Alpha (aaaaaaaaaaaa)',
      'Before radio tracking',
    ]);
    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  it('emits the matching filter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RadioStatPicker list={list} value={{ radioId: 1 }} onChange={onChange} />);
    expect(screen.getByRole('combobox')).toHaveValue('1');

    await user.selectOptions(screen.getByRole('combobox'), 'unassigned');
    await user.selectOptions(screen.getByRole('combobox'), '2');
    await user.selectOptions(screen.getByRole('combobox'), '');
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { unassigned: true },
      { radioId: 2 },
      null,
    ]);
  });
});
