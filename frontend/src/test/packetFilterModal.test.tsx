import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PacketFilterModal } from '../components/PacketFilterModal';
import { KNOWN_PAYLOAD_TYPES } from '../utils/rawPacketStats';

function baseProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    enabledTypes: new Set(KNOWN_PAYLOAD_TYPES),
    enabledHopWidths: new Set<string>(),
    allTypesEnabled: true,
    allHopWidthsEnabled: false,
    groupByHash: false,
    onToggleAll: vi.fn(),
    onToggleType: vi.fn(),
    onOnlyType: vi.fn(),
    onToggleAllHopWidths: vi.fn(),
    onToggleHopWidth: vi.fn(),
    onOnlyHopWidth: vi.fn(),
    onGroupByHashChange: vi.fn(),
    onReset: vi.fn(),
    matchCount: 12,
    totalCount: 40,
  };
}

describe('PacketFilterModal', () => {
  it('renders every payload-type checkbox and the group toggle', () => {
    render(<PacketFilterModal {...baseProps()} />);
    for (const type of KNOWN_PAYLOAD_TYPES) {
      expect(screen.getByLabelText(type)).toBeInTheDocument();
    }
    expect(screen.getByText('Group repeats by content')).toBeInTheDocument();
  });

  it('fires onGroupByHashChange when the group toggle is clicked', () => {
    const props = baseProps();
    render(<PacketFilterModal {...props} />);
    fireEvent.click(screen.getByLabelText('Group repeats by content'));
    expect(props.onGroupByHashChange).toHaveBeenCalledWith(true);
  });

  it('fires onOnlyType from a type "only" button', () => {
    const props = baseProps();
    render(<PacketFilterModal {...props} />);
    const row = screen.getByLabelText(KNOWN_PAYLOAD_TYPES[0]).closest('span')!;
    fireEvent.click(within(row).getByRole('button', { name: /only/i }));
    expect(props.onOnlyType).toHaveBeenCalledWith(KNOWN_PAYLOAD_TYPES[0]);
  });

  it('fires onReset from Reset all', () => {
    const props = baseProps();
    render(<PacketFilterModal {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /reset all/i }));
    expect(props.onReset).toHaveBeenCalled();
  });
});
