import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import type { Sender } from '../../wardrive/decode/reception';
import { TargetSheet } from '../../wardrive/screen/TargetSheet';
import type { TargetRow } from '../../wardrive/targets';

const NOW = 1_800_000_000_000;

function row(id: string, name: string, rssi = -80, kind: Sender['kind'] = 'relay'): TargetRow {
  return {
    id,
    sender: { kind, id, label: null, role: null },
    name: { mark: '', name },
    rssi,
    at: NOW - 5000,
  };
}

const ROWS = [row('a1b2c3', ''), row('ffee', 'Toren', -70), row('cdcd', 'Kerk', -90)];

function renderSheet(over: Partial<ComponentProps<typeof TargetSheet>> = {}) {
  const props: ComponentProps<typeof TargetSheet> = {
    open: true,
    onOpenChange: vi.fn(),
    rows: ROWS,
    selected: [],
    nowMs: NOW,
    onToggle: vi.fn(),
    onClear: vi.fn(),
    ...over,
  };
  const view = render(
    <I18nProvider>
      <TargetSheet {...props} />
    </I18nProvider>
  );
  return { ...view, props };
}

const search = () => screen.getByRole('searchbox') as HTMLInputElement;

describe('wardrive target sheet', () => {
  it('lists the senders with name, id and signal, and says when a name is not known', () => {
    renderSheet();
    const list = screen.getByTestId('wardrive-target-list');
    expect(within(list).getAllByRole('button')).toHaveLength(3);
    expect(list.textContent).toContain('a1b2c3 (name not known)');
    expect(list.textContent).toContain('Toren');
    expect(list.textContent).toContain('-70');
    expect(screen.getByText(/Pick the senders/)).toBeTruthy();
  });

  it('keeps its content off the screen edges', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.paddingLeft).toContain('1rem');
    expect(dialog.style.paddingRight).toContain('1rem');
  });

  it('finds by name', () => {
    renderSheet();
    fireEvent.change(search(), { target: { value: 'tor' } });
    const list = screen.getByTestId('wardrive-target-list');
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual([expect.stringContaining('Toren')]);
  });

  it('says when nothing matches', () => {
    renderSheet();
    fireEvent.change(search(), { target: { value: 'zzzz' } });
    expect(screen.getByText('No senders match')).toBeTruthy();
  });

  it('starts with an empty search each time it opens', () => {
    const { props, rerender } = renderSheet();
    fireEvent.change(search(), { target: { value: 'tor' } });
    rerender(
      <I18nProvider>
        <TargetSheet {...props} open={false} />
      </I18nProvider>
    );
    rerender(
      <I18nProvider>
        <TargetSheet {...props} open />
      </I18nProvider>
    );
    expect(search().value).toBe('');
    expect(document.activeElement).toBe(search());
  });

  it('toggles a sender and shows which are picked', () => {
    const { props } = renderSheet({ selected: ['ffee'] });
    const list = screen.getByTestId('wardrive-target-list');
    const toren = within(list).getByRole('button', { name: /Toren/ });
    expect(toren.getAttribute('aria-pressed')).toBe('true');
    const kerk = within(list).getByRole('button', { name: /Kerk/ });
    expect(kerk.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(kerk);
    expect(props.onToggle).toHaveBeenCalledWith('cdcd');
    fireEvent.click(screen.getByRole('button', { name: 'Clear targets' }));
    expect(props.onClear).toHaveBeenCalled();
  });

  it('shows the Top block only with more senders than it holds', () => {
    renderSheet();
    expect(screen.queryByTestId('wardrive-target-top')).toBeNull();
  });

  it('shows the Top block with four senders, not while searching', () => {
    renderSheet({ rows: [...ROWS, row('abab', 'Molen', -60)] });
    const top = screen.getByTestId('wardrive-target-top');
    expect(within(top).getAllByRole('button')).toHaveLength(3);
    fireEvent.change(search(), { target: { value: 'mol' } });
    expect(screen.queryByTestId('wardrive-target-top')).toBeNull();
  });

  it('shows six senders at first', () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`aa0${i}`, `Node ${i}`));
    renderSheet({ rows: many });
    const list = screen.getByTestId('wardrive-target-list');
    expect(within(list).getAllByRole('button', { pressed: false })).toHaveLength(6);
  });

  it('shows six more with Show more, also when the list does not scroll', () => {
    const many = Array.from({ length: 9 }, (_, i) => row(`aa0${i}`, `Node ${i}`));
    renderSheet({ rows: many });
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    const list = screen.getByTestId('wardrive-target-list');
    expect(within(list).getAllByRole('button', { pressed: false })).toHaveLength(9);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('offers no Show more when every sender is listed', () => {
    renderSheet();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
