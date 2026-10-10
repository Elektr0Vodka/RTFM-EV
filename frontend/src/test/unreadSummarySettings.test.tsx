import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UnreadSummarySettings } from '../components/settings/UnreadSummarySettings';

const settings = (
  over: Partial<Parameters<typeof UnreadSummarySettings>[0]['appSettings']> = {}
) => ({
  ollama_enabled: false,
  ollama_base_url: 'http://localhost:11434',
  ollama_model: '',
  ...over,
});

describe('UnreadSummarySettings', () => {
  it('says that channel messages are sent to the Ollama server', () => {
    render(<UnreadSummarySettings appSettings={settings()} onSaveAppSettings={vi.fn()} />);

    expect(screen.getByText(/channel messages are sent to that server/)).toBeInTheDocument();
  });

  it('saves the switch', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<UnreadSummarySettings appSettings={settings()} onSaveAppSettings={onSave} />);

    fireEvent.click(screen.getByLabelText('Summarize unread messages when opening a channel'));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ollama_enabled: true }));
  });

  it('saves a changed model on blur and leaves an unchanged one alone', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <UnreadSummarySettings
        appSettings={settings({ ollama_model: 'phi3:mini' })}
        onSaveAppSettings={onSave}
      />
    );
    const model = screen.getByLabelText('Ollama model');

    fireEvent.blur(model);
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(model, { target: { value: ' llama3.2 ' } });
    fireEvent.blur(model);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ollama_model: 'llama3.2' }));
  });

  it('puts the saved address back when the server rejects a new one', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Ollama URL must start with http://'));
    render(<UnreadSummarySettings appSettings={settings()} onSaveAppSettings={onSave} />);
    const url = screen.getByLabelText('Ollama server URL');

    fireEvent.change(url, { target: { value: 'ftp://nope' } });
    fireEvent.blur(url);

    await waitFor(() => expect(url).toHaveValue('http://localhost:11434'));
  });
});
