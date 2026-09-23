import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { MessageRowActions } from '../components/MessageRowActions';

describe('MessageRowActions', () => {
  it('replies on click', () => {
    const onReply = vi.fn();
    render(<MessageRowActions onReply={onReply} onReact={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('opens quick emojis and reacts with the picked one', () => {
    const onReact = vi.fn();
    render(<MessageRowActions onReply={vi.fn()} onReact={onReact} />);
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    fireEvent.click(screen.getByRole('button', { name: 'React with 👍' }));
    expect(onReact).toHaveBeenCalledWith('👍');
    expect(screen.queryByRole('button', { name: 'React with 👍' })).toBeNull();
  });

  it('renders only the actions it has handlers for', () => {
    render(<MessageRowActions onReply={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'React' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();
  });
});
