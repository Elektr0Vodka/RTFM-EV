import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RepeaterConfigHistoryPane } from '../components/repeater/RepeaterConfigHistoryPane';
import { buildConfigHistory, formatConfigValue } from '../utils/deviceConfigHistory';
import type { DeviceConfigHistoryEntry } from '../types';

const { repeaterConfigHistory } = vi.hoisted(() => ({ repeaterConfigHistory: vi.fn() }));

vi.mock('../api', () => ({ api: { repeaterConfigHistory } }));

const KEY = 'ab'.repeat(32);

const ENTRIES: DeviceConfigHistoryEntry[] = [
  { kind: 'radio_settings', timestamp: 300, data: { tx_power: '22', radio: '869.525,250,11,5' } },
  { kind: 'node_info', timestamp: 200, data: { name: 'R1-new', lat: '52.1', lon: '4.3' } },
  { kind: 'node_info', timestamp: 100, data: { name: 'R1', lat: '52.1', lon: '4.3' } },
  { kind: 'radio_settings', timestamp: 50, data: { tx_power: '20', radio: '869.525,250,11,5' } },
];

describe('buildConfigHistory', () => {
  it('groups by kind in dashboard order and diffs against the previous snapshot', () => {
    const history = buildConfigHistory(ENTRIES);
    expect(history.map((h) => h.kind)).toEqual(['node_info', 'radio_settings']);

    const [newest, oldest] = history[0].snapshots;
    expect(newest.timestamp).toBe(200);
    expect(newest.changes).toEqual([{ field: 'name', before: 'R1', after: 'R1-new' }]);
    expect(oldest.changes).toBeNull();

    expect(history[1].snapshots[0].changes).toEqual([
      { field: 'tx_power', before: '20', after: '22' },
    ]);
  });

  it('compares nested values and fields present on one side only', () => {
    const history = buildConfigHistory([
      { kind: 'regions', timestamp: 2, data: { regions: [{ name: 'nl' }, { name: 'be' }] } },
      { kind: 'regions', timestamp: 1, data: { regions: [{ name: 'nl' }], truncated: false } },
    ]);
    const changes = history[0].snapshots[0].changes ?? [];
    expect(changes.map((c) => c.field).sort()).toEqual(['regions', 'truncated']);
  });

  it('formats empty, scalar and structured values', () => {
    expect(formatConfigValue(null)).toBe('-');
    expect(formatConfigValue('')).toBe('-');
    expect(formatConfigValue(20)).toBe('20');
    expect(formatConfigValue([{ name: 'nl' }])).toBe('[{"name":"nl"}]');
  });
});

describe('RepeaterConfigHistoryPane', () => {
  beforeEach(() => {
    repeaterConfigHistory.mockReset();
  });

  it('shows each pane kind with its changes and the first stored snapshot', async () => {
    repeaterConfigHistory.mockResolvedValue(ENTRIES);
    render(<RepeaterConfigHistoryPane publicKey={KEY} />);

    const nodeInfo = await screen.findByTestId('config-history-node_info');
    expect(repeaterConfigHistory).toHaveBeenCalledWith(KEY);
    expect(within(nodeInfo).getByText('Node Info')).toBeInTheDocument();
    expect(
      within(nodeInfo)
        .getAllByText('R1')
        .some((el) => el.classList.contains('line-through'))
    ).toBe(true);
    expect(within(nodeInfo).getByText('R1-new')).toBeInTheDocument();
    expect(within(nodeInfo).getByText(/First stored snapshot/)).toBeInTheDocument();
    expect(screen.getByTestId('config-history-radio_settings')).toHaveTextContent('Radio Settings');
  });

  it('explains when nothing is stored yet', async () => {
    repeaterConfigHistory.mockResolvedValue([]);
    render(<RepeaterConfigHistoryPane publicKey={KEY} />);
    expect(await screen.findByText(/No snapshots stored yet/)).toBeInTheDocument();
  });

  it('collapses long histories behind "Show all"', async () => {
    repeaterConfigHistory.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({
        kind: 'advert_intervals' as const,
        timestamp: 100 + i,
        data: { advert_interval: String(i), flood_advert_interval: '3' },
      }))
    );
    render(<RepeaterConfigHistoryPane publicKey={KEY} />);

    const block = await screen.findByTestId('config-history-advert_intervals');
    expect(within(block).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(within(block).getByRole('button', { name: 'Show all (7)' }));
    await waitFor(() => expect(within(block).getAllByRole('listitem')).toHaveLength(7));
  });

  it('re-reads when the reload key changes', async () => {
    repeaterConfigHistory.mockResolvedValue([]);
    const { rerender } = render(<RepeaterConfigHistoryPane publicKey={KEY} reloadKey="0" />);
    await waitFor(() => expect(repeaterConfigHistory).toHaveBeenCalledTimes(1));
    rerender(<RepeaterConfigHistoryPane publicKey={KEY} reloadKey="1" />);
    await waitFor(() => expect(repeaterConfigHistory).toHaveBeenCalledTimes(2));
  });
});
