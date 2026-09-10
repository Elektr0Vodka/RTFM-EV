import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConsolePane } from '../components/repeater/RepeaterConsolePane';

type Entry = { command: string; response: string; timestamp: number; outgoing: boolean };

function outgoing(command: string, timestamp: number): Entry {
  return { command, response: '', timestamp, outgoing: true };
}

function renderPane(history: Entry[] = []) {
  const onSend = vi.fn(async () => {});
  render(<ConsolePane history={history} loading={false} onSend={onSend} />);
  const input = screen.getByLabelText('Console command') as HTMLInputElement;
  return { input, onSend };
}

describe('ConsolePane command history recall', () => {
  it('ArrowUp walks back through previously sent commands, most recent first', () => {
    const { input } = renderPane([outgoing('get radio', 1), outgoing('reboot', 2)]);

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('reboot');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('get radio');
  });

  it('ArrowDown returns toward the live (empty) input', () => {
    const { input } = renderPane([outgoing('get radio', 1), outgoing('reboot', 2)]);

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('get radio');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('reboot');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('');
  });

  it('dedupes consecutive repeats like a shell', () => {
    const { input } = renderPane([
      outgoing('get radio', 1),
      outgoing('get radio', 2),
      outgoing('reboot', 3),
    ]);

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('reboot');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('get radio');

    // Only two distinct entries; a third ArrowUp is a no-op.
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('get radio');
  });

  it('does nothing on arrows when there is no history', () => {
    const { input } = renderPane([]);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('');
  });

  it('links out to the DMC CLI wiki', () => {
    renderPane([]);
    const link = screen.getByRole('link', { name: 'CLI docs' });
    expect(link).toHaveAttribute('href', 'https://toolbox.dutchmeshcore.nl/#/cli-wiki');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
