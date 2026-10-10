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

describe('ConsolePane sends what was typed', () => {
  it('keeps leading spaces, which set the nesting depth of a region load line', () => {
    const { input, onSend } = renderPane();

    fireEvent.change(input, { target: { value: '  nl-nh' } });
    fireEvent.submit(input.closest('form')!);

    expect(onSend).toHaveBeenCalledWith('  nl-nh');
  });

  it('sends an empty line, which ends a region load', () => {
    const { input, onSend } = renderPane();

    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    fireEvent.submit(input.closest('form')!);

    expect(onSend).toHaveBeenCalledWith('');
  });

  it('shows the leading spaces of a sent line', () => {
    renderPane([outgoing('  nl-nh', 1)]);

    const line = screen.getByText(
      (_, node) => node?.textContent === '>   nl-nh' && node.children.length === 0
    );
    expect(line.className).toContain('whitespace-pre-wrap');
  });

  it('leaves empty lines out of the history recall', () => {
    const { input } = renderPane([outgoing('region load', 1), outgoing('', 2)]);

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('region load');
  });
});
