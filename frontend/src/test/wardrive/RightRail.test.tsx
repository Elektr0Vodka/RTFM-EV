import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../i18n';
import { RightRail } from '../../wardrive/screen/RightRail';

describe('wardrive right rail', () => {
  it('toggles 3D, follow and sound, and shows their state', () => {
    const onTilt = vi.fn();
    const onFollow = vi.fn();
    const onSound = vi.fn();
    render(
      <I18nProvider>
        <RightRail
          tilt3D
          onTilt={onTilt}
          follow={false}
          onFollow={onFollow}
          sound="rx"
          onSound={onSound}
        />
      </I18nProvider>
    );
    const tilt = screen.getByRole('button', { name: '3D view' });
    const follow = screen.getByRole('button', { name: 'Follow my position' });
    const sound = screen.getByRole('button', { name: 'Sound' });
    expect(tilt.getAttribute('aria-pressed')).toBe('true');
    expect(follow.getAttribute('aria-pressed')).toBe('false');
    expect(sound.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tilt);
    fireEvent.click(follow);
    fireEvent.click(sound);
    expect(onTilt).toHaveBeenCalled();
    expect(onFollow).toHaveBeenCalled();
    expect(onSound).toHaveBeenCalled();
  });
});
