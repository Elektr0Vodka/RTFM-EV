import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NameFilterSettings } from '../components/settings/NameFilterSettings';

const mocks = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

const patterns = () => screen.getByRole('textbox', { name: /name patterns/i });
const saveButton = () => screen.getByRole('button', { name: /save patterns/i });

describe('NameFilterSettings', () => {
  beforeEach(() => {
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
  });

  it('shows the saved patterns, one per line', () => {
    render(
      <NameFilterSettings
        appSettings={{ name_filter_patterns: ['Adriaan\\d+', 'B2-\\d+'], hide_name_filtered: true }}
        onSaveAppSettings={vi.fn()}
      />
    );
    expect(patterns()).toHaveValue('Adriaan\\d+\nB2-\\d+');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(saveButton()).toBeDisabled();
  });

  it('saves the lines without blanks', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <NameFilterSettings
        appSettings={{ name_filter_patterns: [], hide_name_filtered: false }}
        onSaveAppSettings={onSave}
      />
    );

    await user.type(patterns(), ' Robin\\d+ {Enter}{Enter}DeBaron\\d+');
    await user.click(saveButton());

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ name_filter_patterns: ['Robin\\d+', 'DeBaron\\d+'] })
    );
    expect(mocks.toastSuccess).toHaveBeenCalled();
  });

  it('keeps a refused list in the box and shows the reason', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error("Invalid name pattern 'Adriaan('"));
    render(
      <NameFilterSettings
        appSettings={{ name_filter_patterns: [], hide_name_filtered: false }}
        onSaveAppSettings={onSave}
      />
    );

    await user.type(patterns(), 'Adriaan((');
    await user.click(saveButton());

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(mocks.toastError.mock.calls[0][1]).toEqual({
      description: "Invalid name pattern 'Adriaan('",
    });
    expect(patterns()).toHaveValue('Adriaan((');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('saves the switch on its own', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <NameFilterSettings
        appSettings={{ name_filter_patterns: ['Robin\\d+'], hide_name_filtered: false }}
        onSaveAppSettings={onSave}
      />
    );

    await user.click(screen.getByRole('checkbox'));

    expect(onSave).toHaveBeenCalledWith({ hide_name_filtered: true });
  });
});
