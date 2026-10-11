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

describe('ConsolePane command suggestions', () => {
  function type(input: HTMLInputElement, value: string) {
    fireEvent.change(input, { target: { value } });
  }

  function suggestionTexts(): string[] {
    return screen.queryAllByRole('option').map((el) => el.textContent ?? '');
  }

  it('shows nothing until something is typed', () => {
    renderPane();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('lists matching commands with their parameters and a description', () => {
    const { input } = renderPane();
    type(input, 'set tx');

    const list = screen.getByRole('listbox', { name: 'CLI command suggestions' });
    expect(list).toBeInTheDocument();
    // The command typed exactly comes first; longer names it begins follow.
    expect(suggestionTexts()).toEqual([
      'set tx <dbm>Set transmit power level',
      'set txdelay <value>Set flood traffic retransmit delay',
    ]);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('Tab completes the first suggestion and never sends', () => {
    const { input, onSend } = renderPane();
    type(input, 'set tx');

    fireEvent.keyDown(input, { key: 'Tab' });

    // A command with a parameter is left ready for it.
    expect(input.value).toBe('set tx ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('arrows pick a suggestion and Enter fills it in instead of sending', () => {
    const { input, onSend } = renderPane();
    type(input, 'clo');
    expect(suggestionTexts().map((text) => text.split(/[A-Z]/)[0])).toEqual([
      'clock sync',
      'clock',
    ]);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('clock');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Enter with nothing highlighted sends what was typed', () => {
    const { input, onSend } = renderPane();
    type(input, 'get radio');

    fireEvent.submit(input.closest('form')!);

    expect(onSend).toHaveBeenCalledWith('get radio');
  });

  it('Escape hides the list until the text changes', () => {
    const { input } = renderPane();
    type(input, 'get na');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    type(input, 'get nam');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('clicking a suggestion fills it in', () => {
    const { input, onSend } = renderPane();
    type(input, 'adv');

    fireEvent.mouseDown(screen.getAllByRole('option')[0]);

    expect(input.value).toBe('advert');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('stays out of the way while stepping through history', () => {
    const { input } = renderPane([outgoing('get radio', 1), outgoing('get name', 2)]);

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('get name');
    // The recalled text matches commands, but the arrows must keep recalling.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('get radio');
  });

  it('shows no suggestions for text that matches no command', () => {
    const { input } = renderPane();
    type(input, 'xyzzy');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('leaves a line that starts with a space alone, so a region load line goes out as typed', () => {
    const { input, onSend } = renderPane();
    // "  set tx" would match commands, but the leading spaces are the nesting
    // depth of a region name and a completion would replace them.
    type(input, '  set tx');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('  set tx');

    fireEvent.submit(input.closest('form')!);
    expect(onSend).toHaveBeenCalledWith('  set tx');
  });

  it('an empty line is still sent while the suggestion list is closed', () => {
    const { input, onSend } = renderPane();
    type(input, 'clo');
    type(input, '');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.submit(input.closest('form')!);
    expect(onSend).toHaveBeenCalledWith('');
  });
});
