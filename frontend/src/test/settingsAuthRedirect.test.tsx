import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { SettingsLocalSection } from '../components/settings/SettingsLocalSection';
import { getAuthRedirectUrl, setAuthRedirectUrl } from '../utils/authRedirect';

describe('Settings > Local: sign-in redirect', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the saved address and stores a new one as it is typed', () => {
    setAuthRedirectUrl('/login');
    render(<SettingsLocalSection />);

    const field = screen.getByLabelText('Sign-in address');
    expect(field).toHaveValue('/login');

    fireEvent.change(field, { target: { value: 'https://auth.example.com/' } });
    expect(getAuthRedirectUrl()).toBe('https://auth.example.com/');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so and keeps the old address when the value is not usable', () => {
    setAuthRedirectUrl('/login');
    render(<SettingsLocalSection />);

    fireEvent.change(screen.getByLabelText('Sign-in address'), {
      target: { value: 'javascript:alert(1)' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/http/i);
    expect(getAuthRedirectUrl()).toBe('/login');
  });
});
