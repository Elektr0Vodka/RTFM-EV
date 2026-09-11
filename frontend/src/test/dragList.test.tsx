import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DragList } from '../components/sidebar/DragList';

const items = ['a', 'b', 'c'];
const labels = { a: 'Alpha', b: 'Bravo', c: 'Charlie' };

describe('DragList move buttons', () => {
  it('moves an item down when its move-down button is clicked', () => {
    const onReorder = vi.fn();
    render(
      <DragList
        items={items}
        labels={labels}
        onReorder={onReorder}
        moveUpLabel="Move up"
        moveDownLabel="Move down"
      />
    );
    const rows = screen.getAllByRole('listitem');
    const downBtn = within(rows[0]).getByRole('button', { name: 'Move down' });
    fireEvent.click(downBtn);
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('disables move-up on the first row and move-down on the last', () => {
    render(
      <DragList
        items={items}
        labels={labels}
        onReorder={vi.fn()}
        moveUpLabel="Move up"
        moveDownLabel="Move down"
      />
    );
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(within(rows[2]).getByRole('button', { name: 'Move down' })).toBeDisabled();
  });

  it('reorders via HTML5 drag drop', () => {
    const onReorder = vi.fn();
    render(
      <DragList
        items={items}
        labels={labels}
        onReorder={onReorder}
        moveUpLabel="Move up"
        moveDownLabel="Move down"
      />
    );
    const rows = screen.getAllByRole('listitem');
    fireEvent.dragStart(rows[2]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    expect(onReorder).toHaveBeenCalledWith(['c', 'a', 'b']);
  });
});
