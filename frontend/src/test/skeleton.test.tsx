import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageListSkeleton, PaneSkeleton } from '../components/ui/skeleton';

describe('loading placeholders', () => {
  it('message list placeholder is a status with a readable label and pulsing bubbles', () => {
    const { container } = render(<MessageListSkeleton label="Loading messages..." />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading messages...');
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(5);
  });

  it('pane placeholder is a status with a readable label', () => {
    render(<PaneSkeleton label="Loading..." />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
    // The blocks themselves are hidden from screen readers.
    for (const block of screen.getByRole('status').querySelectorAll('.animate-pulse')) {
      expect(block).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
