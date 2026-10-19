import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import type { LiveEntry } from '../../wardrive/liveLog';
import { ReceptionLog } from '../../wardrive/screen/ReceptionLog';

const NOW = 1_800_000_000_000;

const entry = (id: number, rssi: number): LiveEntry => ({
  id,
  at: NOW - id * 1000,
  rssi,
  snr: 3,
  payloadType: 4,
  typeName: `Type${id}`,
  direct: false,
  hops: 1,
  lat: null,
  lon: null,
  kept: id % 2 === 0,
});

const THREE = [entry(3, -70), entry(2, -95), entry(1, -120)];

function renderLog(over: Partial<ComponentProps<typeof ReceptionLog>> = {}) {
  const props: ComponentProps<typeof ReceptionLog> = {
    entries: THREE,
    selectedId: null,
    onSelect: vi.fn(),
    size: 'full',
    onSize: vi.fn(),
    nowMs: NOW,
    ...over,
  };
  render(
    <I18nProvider>
      <ReceptionLog {...props} />
    </I18nProvider>
  );
  return props;
}

describe('wardrive live log', () => {
  it('lists receptions newest first with a count', () => {
    renderLog();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Type3');
    expect(screen.getByText('3 rx')).toBeTruthy();
  });

  it('keeps the signal digits in the text colour with a tier dot', () => {
    renderLog();
    const row = screen.getAllByRole('listitem')[0];
    const digits = row.querySelector('[data-testid="wardrive-log-rssi"]') as HTMLElement;
    expect(digits.textContent).toBe('-70');
    expect(digits.style.color).toBe('');
    const dot = row.querySelector('[data-testid="wardrive-log-tier"]') as HTMLElement;
    expect(dot.style.backgroundColor).not.toBe('');
  });

  it('shows one lane when collapsed to one', () => {
    renderLog({ size: 'one' });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('selects a row on tap and marks the selected row', () => {
    const props = renderLog({ selectedId: 2 });
    const rows = screen.getAllByRole('listitem');
    expect(rows[1].getAttribute('aria-current')).toBe('true');
    expect(rows[0].getAttribute('aria-current')).toBeNull();
    fireEvent.click(rows[2]);
    expect(props.onSelect).toHaveBeenCalledWith(1);
  });

  it('cycles its size and can be hidden', () => {
    const props = renderLog({ size: 'full' });
    fireEvent.click(screen.getByRole('button', { name: 'Log size' }));
    expect(props.onSize).toHaveBeenCalledWith('three');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the log' }));
    expect(props.onSize).toHaveBeenCalledWith('hidden');
  });

  it('goes from three lanes to one and back to full', () => {
    const three = renderLog({ size: 'three' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Log size' })[0]);
    expect(three.onSize).toHaveBeenCalledWith('one');
  });

  it('renders nothing when hidden', () => {
    renderLog({ size: 'hidden' });
    expect(screen.queryByRole('list')).toBeNull();
  });
});
