import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { LOG_RENDER_MAX, ReceptionLog } from '../../wardrive/screen/ReceptionLog';
import * as signal from '../../wardrive/signal';
import type { ViewEntry } from '../../wardrive/useReceptionView';

vi.mock('../../wardrive/signal', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../wardrive/signal')>();
  return { ...real, tierColor: vi.fn(real.tierColor) };
});

const NOW = 1_800_000_000_000;

const entry = (id: number, rssi: number, over: Partial<ViewEntry> = {}): ViewEntry => ({
  id,
  at: NOW - id * 1000,
  rssi,
  snr: 3,
  payloadType: 4,
  typeName: 'Advert',
  direct: false,
  hops: 1,
  lat: null,
  lon: null,
  kept: id % 2 === 0,
  packetType: 'Advert',
  heardDirect: false,
  sender: { kind: 'relay', id: `a1b2c${id}`, label: null, role: null },
  channel: null,
  text: null,
  stored: false,
  attr: null,
  name: { mark: '', name: '' },
  inFilter: true,
  ...over,
});

const THREE = [entry(3, -70), entry(2, -95), entry(1, -120)];

function renderLog(over: Partial<ComponentProps<typeof ReceptionLog>> = {}) {
  const props: ComponentProps<typeof ReceptionLog> = {
    entries: THREE,
    selectedId: null,
    onSelect: vi.fn(),
    onClearSelection: vi.fn(),
    size: 'full',
    onSize: vi.fn(),
    nowMs: NOW,
    ...over,
  };
  const view = render(
    <I18nProvider>
      <ReceptionLog {...props} />
    </I18nProvider>
  );
  return { ...view, props };
}

const rows = () => within(screen.getByRole('list')).getAllByRole('button');

describe('wardrive live log', () => {
  it('lists receptions newest first with a count, name or id and type', () => {
    renderLog({
      entries: [
        entry(3, -70, { name: { mark: '~', name: 'Toren' } }),
        entry(2, -95),
        entry(1, -120),
      ],
    });
    expect(rows()).toHaveLength(3);
    expect(rows()[0].textContent).toContain('~Toren');
    expect(rows()[0].textContent).toContain('Advert');
    expect(rows()[1].textContent).toContain('a1b2c2');
    expect(screen.getByText('3 rx')).toBeTruthy();
  });

  it('says how well a node answering our ask heard us', () => {
    renderLog({ entries: [entry(1, -90, { heardUsSnr: 6.5 }), entry(2, -90)] });
    expect(rows()[0].textContent).toContain('heard us at 6.5 dB');
    expect(rows()[1].textContent).not.toContain('heard us');
  });

  it('shows a channel message with its channel', () => {
    renderLog({
      entries: [
        entry(1, -80, {
          packetType: 'GroupText',
          sender: { kind: 'channel_name', id: 'Mike', label: 'Mike', role: null },
          name: { mark: '', name: 'Mike' },
          channel: '#test',
          text: 'hello',
        }),
        entry(2, -80, { packetType: 'GroupText', channel: '#test' }),
      ],
    });
    expect(rows()[0].textContent).toContain('Mike');
    expect(rows()[0].textContent).toContain('#test: hello');
    expect(rows()[1].textContent).toContain('#test');
  });

  it('mutes a row the filter leaves out', () => {
    renderLog({ entries: [entry(1, -80, { inFilter: false }), entry(2, -80)] });
    expect(rows()[0].className).toContain('opacity-60');
    expect(rows()[0].getAttribute('title')).toBe('outside filter');
    expect(rows()[1].className).not.toContain('opacity-60');
  });

  it('keeps the signal digits in the text colour with a tier dot', () => {
    renderLog();
    const row = rows()[0];
    const digits = row.querySelector('[data-testid="wardrive-log-rssi"]') as HTMLElement;
    expect(digits.textContent).toBe('-70');
    expect(digits.style.color).toBe('');
    const dot = row.querySelector('[data-testid="wardrive-log-tier"]') as HTMLElement;
    expect(dot.style.backgroundColor).not.toBe('');
  });

  it('renders at most a page of rows and counts them all', () => {
    const many = Array.from({ length: LOG_RENDER_MAX + 50 }, (_, i) => entry(i + 1, -80));
    renderLog({ entries: many });
    expect(rows()).toHaveLength(LOG_RENDER_MAX);
    expect(screen.getByText(`${LOG_RENDER_MAX + 50} rx`)).toBeTruthy();
  });

  it('shows one lane when collapsed to one', () => {
    renderLog({ size: 'one' });
    expect(rows()).toHaveLength(1);
  });

  it('selects a row on tap and marks the selected row', () => {
    const { props } = renderLog({ selectedId: 2 });
    expect(rows()[1].getAttribute('aria-current')).toBe('true');
    expect(rows()[0].getAttribute('aria-current')).toBeNull();
    fireEvent.click(rows()[2]);
    expect(props.onSelect).toHaveBeenCalledWith(1);
  });

  it('selects with Space without scrolling the page', () => {
    const { props } = renderLog();
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    rows()[0].dispatchEvent(ev);
    expect(props.onSelect).toHaveBeenCalledWith(3);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('offers Back to live while a row is selected', () => {
    renderLog();
    expect(screen.queryByRole('button', { name: 'Back to live' })).toBeNull();
    const { props } = renderLog({ selectedId: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }));
    expect(props.onClearSelection).toHaveBeenCalled();
  });

  it('does not render an old row again when only the clock moved', () => {
    const old = entry(120, -80);
    const { props, rerender } = renderLog({ entries: [old] });
    const colours = vi.mocked(signal.tierColor);
    colours.mockClear();
    rerender(
      <I18nProvider>
        <ReceptionLog {...props} entries={[old]} nowMs={NOW + 1000} />
      </I18nProvider>
    );
    expect(colours).not.toHaveBeenCalled();
  });

  it('cycles its size and can be hidden', () => {
    const { props } = renderLog({ size: 'full' });
    fireEvent.click(screen.getByRole('button', { name: 'Log size' }));
    expect(props.onSize).toHaveBeenCalledWith('three');
    fireEvent.click(screen.getByRole('button', { name: 'Hide the log' }));
    expect(props.onSize).toHaveBeenCalledWith('hidden');
  });

  it('goes from three lanes to one and back to full', () => {
    const { props } = renderLog({ size: 'three' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Log size' })[0]);
    expect(props.onSize).toHaveBeenCalledWith('one');
  });

  it('renders nothing when hidden', () => {
    renderLog({ size: 'hidden' });
    expect(screen.queryByRole('list')).toBeNull();
  });
});
