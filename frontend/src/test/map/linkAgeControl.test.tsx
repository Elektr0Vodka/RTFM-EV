import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n/I18nProvider';
import { LinkAgeControl } from '../../map/controls/LinkAgeControl';

const PRESETS = [
  { id: '24h', labelKey: 'time_range_24h', seconds: 86400 },
  { id: 'all', labelKey: 'time_range_all', seconds: null },
];

function setup(follow: boolean) {
  const props = {
    follow,
    onFollow: vi.fn(),
    presets: PRESETS,
    presetId: '24h',
    onPreset: vi.fn(),
    customFrom: '',
    onCustomFrom: vi.fn(),
    customUntil: '',
    onCustomUntil: vi.fn(),
  };
  render(
    <I18nProvider>
      <LinkAgeControl {...props} />
    </I18nProvider>
  );
  return props;
}

describe('LinkAgeControl', () => {
  it('hides presets while following the node filter', () => {
    const props = setup(true);
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Same as node time filter' }));
    expect(props.onFollow).toHaveBeenCalledWith(false);
  });

  it('shows presets when overriding and selects one', () => {
    const props = setup(false);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(props.onPreset).toHaveBeenCalledWith('all');
    expect(screen.getByLabelText('Links from')).toBeInTheDocument();
  });
});
