import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { DEFAULT_FILTER } from '../../wardrive/filters';
import { FilterSheet } from '../../wardrive/screen/FilterSheet';

function renderSheet(over: Partial<ComponentProps<typeof FilterSheet>> = {}) {
  const props: ComponentProps<typeof FilterSheet> = {
    open: true,
    onOpenChange: vi.fn(),
    filter: DEFAULT_FILTER,
    onChange: vi.fn(),
    ignore: [],
    ignoreNames: {},
    onUnignore: vi.fn(),
    channels: ['#test'],
    driverChannels: [],
    onDriverChannels: vi.fn(),
    ...over,
  };
  render(
    <I18nProvider>
      <FilterSheet {...props} />
    </I18nProvider>
  );
  return props;
}

describe('wardrive filter sheet', () => {
  it('keeps its content off the screen edges', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.paddingLeft).toContain('1rem');
    expect(dialog.style.paddingRight).toContain('1rem');
  });

  it('describes itself', () => {
    renderSheet();
    expect(screen.getByText(/What the map, the log and the HUD show/)).toBeTruthy();
  });

  it('picks a time window', () => {
    const props = renderSheet();
    fireEvent.change(screen.getByLabelText('Time window'), { target: { value: '300000' } });
    expect(props.onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTER, windowMs: 300000 });
    fireEvent.change(screen.getByLabelText('Time window'), { target: { value: '0' } });
    expect(props.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTER, windowMs: 0 });
  });

  it('ticks a packet type chip', () => {
    const props = renderSheet();
    const chip = screen.getByRole('button', { name: 'Advert' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(props.onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTER, types: ['Advert'] });
  });

  it('unticks a chip that is on', () => {
    const props = renderSheet({ filter: { ...DEFAULT_FILTER, idClasses: ['3b'] } });
    fireEvent.click(screen.getByRole('button', { name: '3 bytes' }));
    expect(props.onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTER, idClasses: [] });
  });

  it('keeps only receptions without a path', () => {
    const props = renderSheet();
    fireEvent.click(screen.getByLabelText('No path (heard straight from the sender)'));
    expect(props.onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTER, directOnly: true });
  });

  it('clears the filters but keeps the targets', () => {
    const filter = { ...DEFAULT_FILTER, targets: ['a1b2'], types: ['Advert'], directOnly: true };
    const props = renderSheet({ filter });
    fireEvent.click(screen.getByRole('button', { name: 'Clear 2 filters' }));
    expect(props.onChange).toHaveBeenCalledWith({ ...DEFAULT_FILTER, targets: ['a1b2'] });
  });

  it('offers no Clear without filters', () => {
    renderSheet();
    expect(screen.queryByRole('button', { name: /^Clear/ })).toBeNull();
  });

  it('lists the ignored senders and takes one off', () => {
    const props = renderSheet({ ignore: ['a1b2', 'ffee'], ignoreNames: { a1b2: 'Toren' } });
    expect(screen.getByText('Toren')).toBeTruthy();
    expect(screen.getByText('ffee')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop ignoring Toren' }));
    expect(props.onUnignore).toHaveBeenCalledWith('a1b2');
  });

  it('shows the served channels and adds one of the driver', () => {
    const props = renderSheet({ driverChannels: ['#own'] });
    expect(screen.getByText('#test')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Channel name'), { target: { value: 'zwolle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    expect(props.onDriverChannels).toHaveBeenCalledWith(['#own', '#zwolle']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove #own' }));
    expect(props.onDriverChannels).toHaveBeenLastCalledWith([]);
  });

  it('adds the first driver channel as #name', () => {
    const props = renderSheet();
    fireEvent.change(screen.getByLabelText('Channel name'), { target: { value: 'zwolle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add channel' }));
    expect(props.onDriverChannels).toHaveBeenCalledWith(['#zwolle']);
  });
});
