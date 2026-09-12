import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { OpenHopConditionBuilder } from '../components/settings/openhop/OpenHopConditionBuilder';

const objects = {
  channel_hash_groups: { grpA: ['0x1F'] },
  pubkey_groups: {},
};

describe('OpenHopConditionBuilder', () => {
  it('emits a simple condition when field and value change', async () => {
    const onChange = vi.fn();
    render(
      <OpenHopConditionBuilder
        value={{ field: '', op: 'equals', value: '' }}
        objects={objects}
        onChange={onChange}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText(/^field$/i), 'channel_hash');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: 'channel_hash', op: 'equals' })
    );
    onChange.mockClear();
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: '0x1f' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ value: '0x1f' }));
  });

  it('wraps into an all-group when switching to match all', async () => {
    const onChange = vi.fn();
    render(
      <OpenHopConditionBuilder
        value={{ field: 'channel_hash', op: 'equals', value: '0x1f' }}
        objects={objects}
        onChange={onChange}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText(/condition mode/i), 'all');
    expect(onChange).toHaveBeenLastCalledWith({
      all: [{ field: 'channel_hash', op: 'equals', value: '0x1f' }],
    });
  });

  it('offers group references from objects', async () => {
    const onChange = vi.fn();
    render(
      <OpenHopConditionBuilder
        value={{ field: 'channel_hash', op: 'equals', value: '' }}
        objects={objects}
        onChange={onChange}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText(/use group/i), '@channel_hash_groups.grpA');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: '@channel_hash_groups.grpA' })
    );
  });
});
