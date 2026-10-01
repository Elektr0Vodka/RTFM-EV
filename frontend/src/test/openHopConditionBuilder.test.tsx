import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  OpenHopConditionList,
  fromConditionGroup,
  toConditionGroup,
} from '../components/settings/openhop/OpenHopConditionBuilder';
import { OpenHopRuleForm } from '../components/settings/openhop/OpenHopRuleForm';
import { summarizeCondition } from '../components/settings/openhop/OpenHopPolicyRules';
import type { OpenHopCondition, OpenHopRule } from '../types';

const objects = { channel_hash_groups: {}, pubkey_groups: {} };
const groupObjects = { channel_hash_groups: { grpA: ['0x1F'] }, pubkey_groups: {} };

// Rule 1 as exported by an OpenHop node's own policy editor.
const openHopRule: OpenHopRule = {
  id: '1',
  name: '1- T-flood txt-msg 1byte spam',
  enabled: true,
  if: {
    all: [
      { field: 'route_type', op: 'equals', value: 0 },
      { field: 'payload_type', op: 'equals', value: 2 },
      { field: 'path_hash_size', op: 'equals', value: 1 },
    ],
  },
  then: { action: 'drop' },
};

function renderList(items: OpenHopCondition[], objs = objects) {
  const onChange = vi.fn();
  render(<OpenHopConditionList items={items} objects={objs} onChange={onChange} />);
  return onChange;
}

function renderRow(condition: OpenHopCondition) {
  return renderList([condition]);
}

describe('OpenHopConditionList', () => {
  it('emits the row when field and value change', async () => {
    const onChange = renderList([{ field: '', op: 'equals', value: '' }], groupObjects);
    await userEvent.selectOptions(screen.getByLabelText(/^field$/i), 'channel_hash');
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ field: 'channel_hash', op: 'equals' }),
    ]);
    onChange.mockClear();
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: '0x1f' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ value: '0x1f' })]);
  });

  it('offers group references from objects', async () => {
    const onChange = renderList([{ field: 'channel_hash', op: 'equals', value: '' }], groupObjects);
    await userEvent.selectOptions(screen.getByLabelText(/use group/i), '@channel_hash_groups.grpA');
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ value: '@channel_hash_groups.grpA' }),
    ]);
  });

  it('has no per-row match selector and always shows Add condition', async () => {
    const onChange = renderList([{ field: 'route_type', op: 'equals', value: 0 }]);
    expect(screen.queryByLabelText(/condition mode/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /add condition/i }));
    expect(onChange).toHaveBeenLastCalledWith([
      { field: 'route_type', op: 'equals', value: 0 },
      { field: '', op: 'equals', value: '' },
    ]);
  });

  it('offers every field the OpenHop policy engine evaluates', () => {
    renderRow({ field: '', op: 'equals', value: '' });
    const field = screen.getByLabelText(/^field$/i);
    for (const name of [
      'route_type',
      'payload_type',
      'payload_length',
      'path_hash_size',
      'hop_count',
      'rssi',
      'snr',
      'mode',
      'local_transmission',
      'path_hashes',
      'channel_hash',
      'channel_decryptable',
      'channel_message_body',
      'channel_sender',
      'payload_hex',
      'transport_code_0',
      'transport_code_1',
    ]) {
      expect(within(field).getByRole('option', { name })).toBeInTheDocument();
    }
  });

  it('stores the route type picker choice as a number', async () => {
    const onChange = renderRow({ field: 'route_type', op: 'equals', value: '' });
    expect(screen.getByRole('option', { name: '0 TRANSPORT_FLOOD' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/^value$/i), '0');
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'route_type', op: 'equals', value: 0 }]);
  });

  it('stores the path hash size picker choice as a number', async () => {
    const onChange = renderRow({ field: 'path_hash_size', op: 'equals', value: '' });
    await userEvent.selectOptions(screen.getByLabelText(/^value$/i), '2');
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ value: 2 })]);
  });

  it('stores a typed numeric value as a number', () => {
    const onChange = renderRow({ field: 'rssi', op: 'less_than', value: '' });
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: '-110' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ value: -110 })]);
  });

  it('stores boolean fields as booleans', async () => {
    const onChange = renderRow({ field: 'channel_decryptable', op: 'equals', value: '' });
    await userEvent.selectOptions(screen.getByLabelText(/^value$/i), 'true');
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ value: true })]);
  });

  it('keeps text fields as strings', () => {
    const onChange = renderRow({ field: 'channel_sender', op: 'equals', value: '' });
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: '123' } });
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ value: '123' })]);
  });

  it('only offers the operators that apply to the field', () => {
    renderRow({ field: 'path_hashes', op: 'contains', value: '' });
    const ops = within(screen.getByLabelText(/^operator$/i))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(ops).toEqual(['contains', 'intersects']);
  });

  it('switches to a valid operator when the field changes', async () => {
    const onChange = renderRow({ field: 'channel_sender', op: 'starts_with', value: '' });
    await userEvent.selectOptions(screen.getByLabelText(/^field$/i), 'hop_count');
    expect(onChange).toHaveBeenLastCalledWith([{ field: 'hop_count', op: 'equals', value: '' }]);
  });

  it('shows the decrypt-order hint for channel_message_body', () => {
    renderRow({ field: 'channel_message_body', op: 'contains', value: 'spam' });
    expect(screen.getByText(/checked top to bottom/i)).toBeInTheDocument();
  });

  it('removes and reorders conditions', async () => {
    const items = toConditionGroup(openHopRule.if).items;
    const onChange = renderList(items);
    await userEvent.click(screen.getAllByRole('button', { name: /remove condition/i })[0]);
    expect(onChange).toHaveBeenLastCalledWith([items[1], items[2]]);
    await userEvent.click(screen.getAllByRole('button', { name: /move condition down/i })[0]);
    expect(onChange).toHaveBeenLastCalledWith([items[1], items[0], items[2]]);
  });

  it('warns that OpenHop ignores a nested group', () => {
    renderList([{ any: [{ field: 'hop_count', op: 'greater_than', value: 3 }] }]);
    expect(screen.getByText(/does not evaluate nested groups/i)).toBeInTheDocument();
  });
});

describe('condition group conversion', () => {
  it('reads a bare condition as a one-row Match all', () => {
    expect(toConditionGroup({ field: 'snr', op: 'less_than', value: -5 })).toEqual({
      logic: 'all',
      items: [{ field: 'snr', op: 'less_than', value: -5 }],
    });
  });

  it('never stores an empty list (OpenHop matches every packet on all: [])', () => {
    expect(
      fromConditionGroup({ logic: 'all', items: [{ field: '', op: 'equals', value: '' }] })
    ).toEqual({});
  });

  it('drops empty rows and keeps the chosen logic', () => {
    expect(
      fromConditionGroup({
        logic: 'any',
        items: [
          { field: 'hop_count', op: 'greater_than', value: 3 },
          { field: '', op: 'equals', value: '' },
        ],
      })
    ).toEqual({ any: [{ field: 'hop_count', op: 'greater_than', value: 3 }] });
  });
});

describe('OpenHop rule form', () => {
  it('puts Match all / Match any next to the action, defaulting to Match all', () => {
    render(
      <OpenHopRuleForm
        rule={{ ...openHopRule, if: {} }}
        objects={objects}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const logic = screen.getByLabelText(/match logic/i) as HTMLSelectElement;
    expect(logic.value).toBe('all');
    expect(
      within(logic)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Match all (AND)', 'Match any (OR)']);
    expect(screen.queryByRole('option', { name: /single condition/i })).toBeNull();
    expect(screen.getAllByLabelText(/^field$/i)).toHaveLength(1);
  });

  it('saves Match any for every condition', async () => {
    const onSave = vi.fn();
    render(
      <OpenHopRuleForm rule={openHopRule} objects={objects} onSave={onSave} onCancel={vi.fn()} />
    );
    await userEvent.selectOptions(screen.getByLabelText(/match logic/i), 'any');
    await userEvent.click(screen.getByRole('button', { name: /save rule/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ if: { any: toConditionGroup(openHopRule.if).items } })
    );
  });

  it('summarizes numeric values with their names', () => {
    expect(summarizeCondition(openHopRule.if)).toBe(
      'route_type equals 0 TRANSPORT_FLOOD AND payload_type equals 2 TXT_MSG AND path_hash_size equals 1 byte'
    );
  });

  it('keeps numeric values numeric when an unchanged rule is saved', async () => {
    const onSave = vi.fn();
    render(
      <OpenHopRuleForm rule={openHopRule} objects={objects} onSave={onSave} onCancel={vi.fn()} />
    );
    expect(
      screen.getAllByLabelText(/^value$/i).map((el) => (el as HTMLSelectElement).value)
    ).toEqual(['0', '2', '1']);
    await userEvent.click(screen.getByRole('button', { name: /save rule/i }));
    expect(onSave).toHaveBeenCalledWith(openHopRule);
  });
});
