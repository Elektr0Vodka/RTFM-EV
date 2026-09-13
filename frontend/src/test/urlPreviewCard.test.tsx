import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { UrlPreviewCard } from '../components/UrlPreviewCard';
import { api } from '../api';

vi.mock('../api', () => ({ api: { unfurl: vi.fn() } }));

describe('UrlPreviewCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders title and site after fetch', async () => {
    (api.unfurl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      url: 'https://x.com',
      title: 'Hello',
      site_name: 'X',
    });
    render(<UrlPreviewCard url="https://x.com" />);
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());
  });

  it('renders nothing on failure', async () => {
    (api.unfurl as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('nope'));
    const { container } = render(<UrlPreviewCard url="https://x.com" />);
    await waitFor(() => expect(api.unfurl).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('a')).toBeNull());
  });

  it('renders nothing when metadata is empty', async () => {
    (api.unfurl as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ url: 'https://x.com' });
    const { container } = render(<UrlPreviewCard url="https://x.com" />);
    await waitFor(() => expect(api.unfurl).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('a')).toBeNull());
  });
});
