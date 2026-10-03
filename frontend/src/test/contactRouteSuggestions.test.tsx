import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactRouteSuggestionsSection } from '../components/ContactRouteSuggestions';
import { toast } from '../components/ui/sonner';
import type { ContactRouteSuggestion, ContactRouteSuggestions } from '../types';

const { contactRouteSuggestions, setContactRoutingOverride } = vi.hoisted(() => ({
  contactRouteSuggestions: vi.fn(),
  setContactRoutingOverride: vi.fn(),
}));

vi.mock('../api', () => ({
  api: { contactRouteSuggestions, setContactRoutingOverride },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const KEY = 'aa'.repeat(32);

function suggestion(overrides: Partial<ContactRouteSuggestion> = {}): ContactRouteSuggestion {
  return {
    path: 'bb22aa11',
    path_len: 2,
    path_hash_mode: 1,
    route: 'bb22,aa11',
    sources: ['advert'],
    heard_count: 4,
    last_seen: 1_700_000_000,
    attempt_count: 0,
    success_count: 0,
    failure_count: 0,
    score: 0.82,
    freshness: 1,
    heard: 1,
    hops: 0.33,
    delivery: 0.5,
    is_current: false,
    validation: null,
    ...overrides,
  };
}

function payload(
  suggestions: ContactRouteSuggestion[],
  overrides: Partial<ContactRouteSuggestions> = {}
): ContactRouteSuggestions {
  return {
    public_key: KEY,
    suggestions,
    analyzer_url: 'https://analyzer.example',
    validated: false,
    validation_error: null,
    ...overrides,
  };
}

describe('ContactRouteSuggestionsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setContactRoutingOverride.mockResolvedValue({ status: 'ok', public_key: KEY });
  });

  it('renders nothing when no route is known', async () => {
    contactRouteSuggestions.mockResolvedValue(payload([]));

    const { container } = render(<ContactRouteSuggestionsSection publicKey={KEY} />);

    await waitFor(() => expect(contactRouteSuggestions).toHaveBeenCalledWith(KEY));
    expect(container).toBeEmptyDOMElement();
  });

  it('lists routes in send order without asking the analyzer', async () => {
    contactRouteSuggestions.mockResolvedValue(
      payload([
        suggestion({ attempt_count: 3, success_count: 2 }),
        suggestion({ path: '', path_len: 0, path_hash_mode: 0, route: '0', is_current: true }),
      ])
    );

    render(<ContactRouteSuggestionsSection publicKey={KEY} />);

    const rows = await screen.findAllByTestId('contact-route-suggestion');
    expect(rows[0]).toHaveTextContent('bb22 → aa11');
    expect(rows[0]).toHaveTextContent('score 82 · heard 4x · 2/3 delivered');
    expect(within(rows[0]).getByRole('button', { name: 'Use' })).toBeEnabled();
    expect(rows[1]).toHaveTextContent('(direct)');
    expect(rows[1]).toHaveTextContent('In use');
    expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument();
    // The host the check would talk to is stated up front.
    expect(screen.getByTestId('contact-route-suggestions')).toHaveTextContent('analyzer.example');
    expect(contactRouteSuggestions).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('contact-route-validation')).not.toBeInTheDocument();
  });

  it('sets the picked route as the routing override', async () => {
    contactRouteSuggestions.mockResolvedValue(payload([suggestion()]));
    render(<ContactRouteSuggestionsSection publicKey={KEY} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Use' }));

    expect(setContactRoutingOverride).toHaveBeenCalledWith(KEY, 'bb22,aa11');
    expect(await screen.findByText('In use')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith('Routing override set');
  });

  it('reports a failed override and leaves the route unpicked', async () => {
    contactRouteSuggestions.mockResolvedValue(payload([suggestion()]));
    setContactRoutingOverride.mockRejectedValue(new Error('radio busy'));
    render(<ContactRouteSuggestionsSection publicKey={KEY} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Use' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('radio busy'));
    expect(screen.queryByText('In use')).not.toBeInTheDocument();
  });

  it('asks the analyzer only on request and shows its verdict', async () => {
    contactRouteSuggestions.mockResolvedValueOnce(payload([suggestion()])).mockResolvedValueOnce(
      payload(
        [
          suggestion({
            validation: {
              status: 'partial',
              chain: 'observed',
              last_hop: 'hop_hears_contact',
              hop_names: ['Hop B', 'Hop A'],
              ambiguous_hops: 1,
            },
          }),
        ],
        { validated: true }
      )
    );
    render(<ContactRouteSuggestionsSection publicKey={KEY} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Check with analyzer' }));

    expect(contactRouteSuggestions).toHaveBeenLastCalledWith(KEY, true);
    const verdict = await screen.findByTestId('contact-route-validation');
    expect(verdict).toHaveTextContent('Analyzer: partly seen');
    expect(verdict).toHaveTextContent('every hop link seen');
    expect(verdict).toHaveTextContent('last hop hears the contact');
    expect(verdict).toHaveTextContent('1 hop ID matches several nodes');
  });

  it('keeps the suggestions when the analyzer check fails', async () => {
    contactRouteSuggestions
      .mockResolvedValueOnce(payload([suggestion()]))
      .mockResolvedValueOnce(payload([suggestion()], { validation_error: 'HTTP 503' }));
    render(<ContactRouteSuggestionsSection publicKey={KEY} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Check with analyzer' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Analyzer check failed: HTTP 503')
    );
    expect(screen.getByTestId('contact-route-suggestion')).toHaveTextContent('bb22 → aa11');
  });
});
