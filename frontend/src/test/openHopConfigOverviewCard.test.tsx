import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigOverviewCard } from '../components/settings/openhop/config/ConfigOverviewCard';
import { api } from '../api';

beforeEach(() => vi.restoreAllMocks());

describe('ConfigOverviewCard', () => {
  it('shows the valid result after validating', async () => {
    vi.spyOn(api, 'validateOpenHopConfig').mockResolvedValue({
      success: true,
      data: { valid: true, errors: [], warnings: [] },
    });
    render(<ConfigOverviewCard />);
    await userEvent.click(screen.getByRole('button', { name: /validate/i }));
    expect(await screen.findByText(/configuration is valid/i)).toBeInTheDocument();
  });

  it('lists errors when invalid', async () => {
    vi.spyOn(api, 'validateOpenHopConfig').mockResolvedValue({
      success: true,
      data: {
        valid: false,
        errors: [{ path: 'repeater.node_name', message: 'required' }],
        warnings: [],
      },
    });
    render(<ConfigOverviewCard />);
    await userEvent.click(screen.getByRole('button', { name: /validate/i }));
    expect(await screen.findByText(/repeater.node_name/i)).toBeInTheDocument();
  });
});
