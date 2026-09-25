import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RadioDefaultScope } from '../components/settings/RadioDefaultScope';
import { api } from '../api';
import type { RadioDefaultFloodScope } from '../types';

describe('RadioDefaultScope', () => {
  it('renders nothing while the radio is disconnected and does not call the API', () => {
    const spy = vi.spyOn(api, 'getRadioDefaultFloodScope');
    const { container } = render(<RadioDefaultScope connected={false} appFloodScope="" />);
    expect(container).toBeEmptyDOMElement();
    expect(spy).not.toHaveBeenCalled();
  });

  it('shows the radio default without the # prefix and flags a difference', async () => {
    vi.spyOn(api, 'getRadioDefaultFloodScope').mockResolvedValue({
      supported: true,
      scope_name: '#nl-gr',
      scope_key: 'ab'.repeat(16),
    });
    render(<RadioDefaultScope connected={true} appFloodScope="nl" />);
    await waitFor(() =>
      expect(screen.getByTestId('radio-default-scope-value')).toHaveTextContent('nl-gr')
    );
    expect(screen.getByText(/differs from the outbound scope/)).toBeInTheDocument();
  });

  it('does not flag a difference when both scopes match (case-insensitive)', async () => {
    vi.spyOn(api, 'getRadioDefaultFloodScope').mockResolvedValue({
      supported: true,
      scope_name: '#NL-GR',
      scope_key: null,
    });
    render(<RadioDefaultScope connected={true} appFloodScope="nl-gr" />);
    await waitFor(() =>
      expect(screen.getByTestId('radio-default-scope-value')).toHaveTextContent('NL-GR')
    );
    expect(screen.queryByText(/differs from the outbound scope/)).not.toBeInTheDocument();
  });

  it('reports no default, unsupported firmware and read errors', async () => {
    let next: Promise<RadioDefaultFloodScope> = Promise.resolve({
      supported: true,
      scope_name: null,
      scope_key: null,
    });
    vi.spyOn(api, 'getRadioDefaultFloodScope').mockImplementation(() => next);
    render(<RadioDefaultScope connected={true} appFloodScope="" />);
    await waitFor(() =>
      expect(screen.getByTestId('radio-default-scope-value')).toHaveTextContent('none (unscoped)')
    );

    next = Promise.resolve({ supported: false, scope_name: null, scope_key: null });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(screen.getByTestId('radio-default-scope-value')).toHaveTextContent(
        'not reported by this firmware'
      )
    );

    next = Promise.reject(new Error('boom'));
    next.catch(() => undefined); // avoid an unhandled rejection before the click
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect(screen.getByTestId('radio-default-scope-value')).toHaveTextContent('could not read')
    );
  });
});
