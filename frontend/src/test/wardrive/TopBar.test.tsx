import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import type { ForwardStatus } from '../../wardrive/forward/forwarder';
import { brokerDot, radioDot, uploadDot } from '../../wardrive/screen/StatusDots';
import { TopBar } from '../../wardrive/screen/TopBar';
import type { UploadStatus } from '../../wardrive/uploader';

const st = (state: ForwardStatus['state']): ForwardStatus => ({ state, pending: 0 });
const up = (over: Partial<UploadStatus>): UploadStatus => ({
  state: 'idle',
  pendingObs: 0,
  pendingTracks: 0,
  setAside: 0,
  otherAccounts: 0,
  reached: true,
  ...over,
});

describe('wardrive status dots', () => {
  it('tells the radio state', () => {
    expect(radioDot(true, false)).toBe('on');
    expect(radioDot(false, true)).toBe('lost');
    expect(radioDot(false, false)).toBe('off');
  });

  it('tells how many switched-on brokers are connected', () => {
    expect(brokerDot([], {})).toBe('off');
    expect(brokerDot(['a', 'b'], { a: st('connected'), b: st('connecting') })).toBe('some');
    expect(brokerDot(['a', 'b'], { a: st('connected'), b: st('connected') })).toBe('all');
    expect(brokerDot(['a'], { a: st('error') })).toBe('none');
    expect(brokerDot(['a'], {})).toBe('none');
  });

  it('tells the upload state', () => {
    expect(uploadDot(null, true)).toBe('offline');
    expect(uploadDot(up({ state: 'logged-out' }), false)).toBe('logged-out');
    expect(uploadDot(up({ pendingObs: 3 }), false)).toBe('waiting');
    expect(uploadDot(up({}), false)).toBe('ok');
  });
});

describe('wardrive top bar', () => {
  const dots = { radio: 'on', brokers: 'all', upload: 'ok' } as const;
  const bar = {
    dots,
    targetLabel: 'All senders',
    onTargets: () => {},
    filterCount: 0,
    onFilters: () => {},
  };

  it('shows the target chip and the filters pill with a count', () => {
    const onTargets = vi.fn();
    const onFilters = vi.fn();
    render(
      <I18nProvider>
        <TopBar
          {...bar}
          targetLabel="2 targets"
          onTargets={onTargets}
          filterCount={3}
          onFilters={onFilters}
          logHidden={false}
          onShowLog={() => {}}
          onMenu={() => {}}
        />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /2 targets/ }));
    expect(onTargets).toHaveBeenCalled();
    const pill = screen.getByRole('button', { name: /Filters/ });
    expect(pill.textContent).toContain('3');
    fireEvent.click(pill);
    expect(onFilters).toHaveBeenCalled();
  });

  it('shows no badge without filters', () => {
    render(
      <I18nProvider>
        <TopBar {...bar} logHidden={false} onShowLog={() => {}} onMenu={() => {}} />
      </I18nProvider>
    );
    expect(screen.getByRole('button', { name: /All senders/ })).toBeTruthy();
    expect(screen.queryByTestId('wardrive-filter-count')).toBeNull();
  });

  it('opens the menu', () => {
    const onMenu = vi.fn();
    render(
      <I18nProvider>
        <TopBar {...bar} logHidden={false} onShowLog={() => {}} onMenu={onMenu} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(onMenu).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Show the log' })).toBeNull();
  });

  it('offers the log back while it is hidden', () => {
    const onShowLog = vi.fn();
    render(
      <I18nProvider>
        <TopBar {...bar} logHidden onShowLog={onShowLog} onMenu={() => {}} />
      </I18nProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show the log' }));
    expect(onShowLog).toHaveBeenCalled();
  });
});
