import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KnowledgeBaseView } from '../components/KnowledgeBaseView';
import type { HandyInfoSettings } from '../types';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: toastSuccess, error: toastError, info: vi.fn() },
}));

const overlay: HandyInfoSettings = {
  overrides: { 'link-triangulator': { kb: true } },
  custom: [
    {
      id: 'c1',
      group: 'links',
      category: 'fun',
      label: 'My KB link',
      url: 'https://kb.example',
      kb: true,
    },
    { id: 'c2', group: 'links', category: 'fun', label: 'Not in KB', url: 'https://no.example' },
  ],
};

describe('KnowledgeBaseView', () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('shows an empty state when nothing is flagged', () => {
    render(<KnowledgeBaseView handyInfo={null} onSaveAppSettings={vi.fn()} />);
    expect(screen.getByText(/No links yet/)).toBeInTheDocument();
  });

  it('lists only flagged links, grouped by category, opening in a new tab', () => {
    render(<KnowledgeBaseView handyInfo={overlay} onSaveAppSettings={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fun' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open My KB link' });
    expect(link).toHaveAttribute('href', 'https://kb.example');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Open Triangulator' })).toBeInTheDocument();
    expect(screen.queryByText('Not in KB')).not.toBeInTheDocument();
    expect(screen.queryByText('MeshCore.io')).not.toBeInTheDocument();
  });

  it('removing a built-in unflags it without deleting anything', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<KnowledgeBaseView handyInfo={overlay} onSaveAppSettings={onSave} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove Triangulator from the Knowledge base' })
    );
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0].handy_info as HandyInfoSettings;
    expect(saved.overrides['link-triangulator']).toBeUndefined();
    expect(saved.custom).toEqual(overlay.custom);
  });

  it('removing a custom link sets kb false and keeps the entry', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<KnowledgeBaseView handyInfo={overlay} onSaveAppSettings={onSave} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove My KB link from the Knowledge base' })
    );
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0].handy_info as HandyInfoSettings;
    expect(saved.custom.find((c) => c.id === 'c1')).toMatchObject({ kb: false });
  });

  it('adds a new flagged custom link', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<KnowledgeBaseView handyInfo={null} onSaveAppSettings={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Wiki');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://wiki.example');
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), 'technical');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0].handy_info as HandyInfoSettings;
    expect(saved.custom).toHaveLength(1);
    expect(saved.custom[0]).toMatchObject({
      group: 'links',
      category: 'technical',
      label: 'Wiki',
      url: 'https://wiki.example',
      kb: true,
    });
    expect(toastSuccess).toHaveBeenCalledWith('Added to the Knowledge base');
  });

  it('rejects a non-http URL', async () => {
    const onSave = vi.fn();
    render(<KnowledgeBaseView handyInfo={null} onSaveAppSettings={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add link' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Bad');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'javascript:alert(1)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });
});
