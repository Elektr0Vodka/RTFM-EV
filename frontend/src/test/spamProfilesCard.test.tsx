import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FilterProfile, FilterProfilesState } from '../types';

const mocks = vi.hoisted(() => ({
  getFilterProfiles: vi.fn(),
  createFilterProfile: vi.fn(),
  updateFilterProfile: vi.fn(),
  deleteFilterProfile: vi.fn(),
  importFilterProfile: vi.fn(),
  filterProfileExportUrl: vi.fn((id: number) => `./api/filter-profiles/${id}/export`),
  getFilterProfileChanges: vi.fn(),
  applyFilterProfile: vi.fn(),
}));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ api: mocks }));
vi.mock('../components/ui/sonner', () => ({ toast: { error: toastError } }));

import { SpamProfilesCard } from '../components/spamGuard/SpamProfilesCard';

function profile(over: Partial<FilterProfile>): FilterProfile {
  return {
    id: 1,
    kind: 'spam_guard',
    name: 'Spam wave',
    description: '',
    source: 'local',
    payload: { mode: 'protect', sensitivity: 'strict', overrides: {} },
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

function state(
  profiles: FilterProfile[],
  inUse: FilterProfilesState['in_use'] = null
): FilterProfilesState {
  return { kind: 'spam_guard', profiles, in_use: inUse, limits: { per_kind: 100 } };
}

const NORMAL = profile({
  id: 2,
  name: 'Normal',
  payload: { mode: 'monitor', sensitivity: 'balanced', overrides: {} },
});
const WAVE = profile({});

function renderCard(props: Partial<Parameters<typeof SpamProfilesCard>[0]> = {}) {
  const onApplied = vi.fn();
  const view = render(
    <SpamProfilesCard
      version={4}
      enabled
      busy={false}
      formDirty={false}
      onApplied={onApplied}
      {...props}
    />
  );
  return { onApplied, ...view };
}

describe('SpamProfilesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFilterProfiles.mockResolvedValue(state([NORMAL, WAVE]));
  });
  afterEach(() => vi.restoreAllMocks());

  it('says so when there are no profiles and none is in use', async () => {
    mocks.getFilterProfiles.mockResolvedValue(state([]));
    renderCard();
    expect(await screen.findByText('No profiles saved yet.')).toBeInTheDocument();
    expect(screen.getByText('No profile in use')).toBeInTheDocument();
    expect(mocks.getFilterProfiles).toHaveBeenCalledWith('spam_guard');
  });

  it('lists the profiles with mode and sensitivity', async () => {
    renderCard();
    const row = await screen.findByTestId('spam-profile-1');
    expect(within(row).getByText('Spam wave')).toBeInTheDocument();
    expect(within(row).getByText('Protect, Strict')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('spam-profile-2')).getByText('Monitor, Balanced')
    ).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Export' })).toHaveAttribute(
      'href',
      './api/filter-profiles/1/export'
    );
  });

  it('shows the profile in use, and nothing to save while it is unmodified', async () => {
    mocks.getFilterProfiles.mockResolvedValue(
      state([NORMAL, WAVE], { profile_id: 2, modified: false })
    );
    renderCard();
    expect(await screen.findByText('In use: Normal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revert' })).not.toBeInTheDocument();
  });

  it('offers Save to profile and Revert when the live values moved away', async () => {
    mocks.getFilterProfiles.mockResolvedValue(
      state([NORMAL, WAVE], { profile_id: 2, modified: true })
    );
    mocks.updateFilterProfile.mockResolvedValue(
      state([NORMAL, WAVE], { profile_id: 2, modified: false })
    );
    renderCard();
    expect(await screen.findByText('In use: Normal (modified)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save to profile' }));
    await waitFor(() =>
      expect(mocks.updateFilterProfile).toHaveBeenCalledWith(2, { capture: true })
    );
    expect(await screen.findByText('In use: Normal')).toBeInTheDocument();
  });

  it('saves the current settings under a name', async () => {
    mocks.createFilterProfile.mockResolvedValue(
      state([NORMAL, WAVE, profile({ id: 3, name: 'Event' })], { profile_id: 3, modified: false })
    );
    renderCard();
    await screen.findByTestId('spam-profile-1');

    const save = screen.getByRole('button', { name: 'Save current as profile' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Name of a new profile'), {
      target: { value: '  Event ' },
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(mocks.createFilterProfile).toHaveBeenCalledWith('spam_guard', 'Event')
    );
    expect(await screen.findByText('In use: Event')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Name of a new profile')).toHaveValue('');
  });

  it('shows what changes and warns before a switch to Protect', async () => {
    mocks.getFilterProfileChanges.mockResolvedValue({
      profile_id: 1,
      changes: [
        { key: 'mode', from: 'monitor', to: 'protect' },
        { key: 'sensitivity', from: 'balanced', to: 'strict' },
        { key: 'similarity', from: 65, to: 55 },
        { key: 'dedupe_enabled', from: true, to: false },
        { key: 'random_name_patterns', from: [], to: ['[a-z]{9}', '\\d{6}'] },
      ],
    });
    mocks.applyFilterProfile.mockResolvedValue(
      state([NORMAL, WAVE], { profile_id: 1, modified: false })
    );
    const { onApplied } = renderCard();
    const row = await screen.findByTestId('spam-profile-1');

    fireEvent.click(within(row).getByRole('button', { name: 'Apply the profile Spam wave' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Apply the profile Spam wave?')).toBeInTheDocument();
    expect(within(dialog).getByTestId('profile-change-mode')).toHaveTextContent(
      'Monitor → Protect'
    );
    expect(within(dialog).getByTestId('profile-change-sensitivity')).toHaveTextContent(
      'Balanced → Strict'
    );
    expect(within(dialog).getByTestId('profile-change-similarity')).toHaveTextContent('65 → 55');
    expect(within(dialog).getByTestId('profile-change-dedupe_enabled')).toHaveTextContent(
      'On → Off'
    );
    expect(within(dialog).getByTestId('profile-change-random_name_patterns')).toHaveTextContent(
      '[a-z]{9}'
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Protect');
    expect(mocks.applyFilterProfile).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(mocks.applyFilterProfile).toHaveBeenCalledWith(1, true));
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('In use: Spam wave')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not send the Protect yes when the mode does not go to Protect', async () => {
    mocks.getFilterProfileChanges.mockResolvedValue({
      profile_id: 2,
      changes: [{ key: 'mode', from: 'protect', to: 'monitor' }],
    });
    mocks.applyFilterProfile.mockResolvedValue(
      state([NORMAL, WAVE], { profile_id: 2, modified: false })
    );
    renderCard();
    const row = await screen.findByTestId('spam-profile-2');
    fireEvent.click(within(row).getByRole('button', { name: 'Apply the profile Normal' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(mocks.applyFilterProfile).toHaveBeenCalledWith(2, false));
  });

  it('says when applying would change nothing', async () => {
    mocks.getFilterProfileChanges.mockResolvedValue({ profile_id: 2, changes: [] });
    renderCard();
    const row = await screen.findByTestId('spam-profile-2');
    fireEvent.click(within(row).getByRole('button', { name: 'Apply the profile Normal' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Nothing changes: the settings already match this profile.')
    ).toBeInTheDocument();
  });

  it('Cancel applies nothing', async () => {
    mocks.getFilterProfileChanges.mockResolvedValue({
      profile_id: 1,
      changes: [{ key: 'mode', from: 'monitor', to: 'protect' }],
    });
    const { onApplied } = renderCard();
    const row = await screen.findByTestId('spam-profile-1');
    fireEvent.click(within(row).getByRole('button', { name: 'Apply the profile Spam wave' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.applyFilterProfile).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('Revert opens the same dialog for the profile in use', async () => {
    mocks.getFilterProfiles.mockResolvedValue(
      state([NORMAL, WAVE], { profile_id: 2, modified: true })
    );
    mocks.getFilterProfileChanges.mockResolvedValue({
      profile_id: 2,
      changes: [{ key: 'similarity', from: 80, to: 65 }],
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Revert' }));
    await waitFor(() => expect(mocks.getFilterProfileChanges).toHaveBeenCalledWith(2));
    expect(await screen.findByText('Apply the profile Normal?')).toBeInTheDocument();
  });

  it('holds back while the settings form has unsaved edits', async () => {
    mocks.getFilterProfiles.mockResolvedValue(
      state([NORMAL, WAVE], { profile_id: 2, modified: true })
    );
    renderCard({ formDirty: true });
    const row = await screen.findByTestId('spam-profile-1');
    expect(within(row).getByRole('button', { name: 'Apply the profile Spam wave' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save to profile' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revert' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Name of a new profile'), {
      target: { value: 'Event' },
    });
    expect(screen.getByRole('button', { name: 'Save current as profile' })).toBeDisabled();
    expect(
      screen.getByText(
        'Save or discard the changes in the form below first. Profiles work with saved settings.'
      )
    ).toBeInTheDocument();
    // Looking and sharing stay possible.
    expect(within(row).getByRole('link', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import file' })).toBeEnabled();
  });

  it('cannot apply while Spam Guard is switched off', async () => {
    renderCard({ enabled: false });
    const row = await screen.findByTestId('spam-profile-1');
    expect(within(row).getByRole('button', { name: 'Apply the profile Spam wave' })).toBeDisabled();
  });

  it('imports a file and words a refusal', async () => {
    mocks.importFilterProfile.mockRejectedValueOnce(new Error('not_a_profile'));
    renderCard();
    await screen.findByTestId('spam-profile-1');
    const input = screen.getByTestId('spam-profile-file');

    fireEvent.change(input, {
      target: { files: [new File(['{"a": 1}'], 'x.json', { type: 'application/json' })] },
    });
    await waitFor(() => expect(mocks.importFilterProfile).toHaveBeenCalledWith('{"a": 1}'));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('This is not a filter profile file.')
    );

    mocks.importFilterProfile.mockResolvedValueOnce(
      state([NORMAL, WAVE, profile({ id: 5, name: 'Shared' })])
    );
    fireEvent.change(input, {
      target: { files: [new File(['{"b": 2}'], 'y.json', { type: 'application/json' })] },
    });
    expect(await screen.findByTestId('spam-profile-5')).toBeInTheDocument();
  });

  it('loads the list again when a change is refused', async () => {
    // Deleted in another tab: the row here is stale until the list is read again.
    mocks.getFilterProfileChanges.mockResolvedValue({ profile_id: 1, changes: [] });
    mocks.applyFilterProfile.mockRejectedValue(new Error('not_found'));
    const { onApplied } = renderCard();
    const row = await screen.findByTestId('spam-profile-1');
    mocks.getFilterProfiles.mockResolvedValue(state([NORMAL]));

    fireEvent.click(within(row).getByRole('button', { name: 'Apply the profile Spam wave' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('That profile no longer exists.'));
    await waitFor(() => expect(screen.queryByTestId('spam-profile-1')).not.toBeInTheDocument());
    expect(screen.getByTestId('spam-profile-2')).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('loads the list again when the changes cannot be read', async () => {
    mocks.getFilterProfileChanges.mockRejectedValue(new Error('not_found'));
    renderCard();
    const row = await screen.findByTestId('spam-profile-1');
    mocks.getFilterProfiles.mockResolvedValue(state([NORMAL]));

    fireEvent.click(within(row).getByRole('button', { name: 'Apply the profile Spam wave' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('That profile no longer exists.'));
    await waitFor(() => expect(screen.queryByTestId('spam-profile-1')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renames a profile', async () => {
    mocks.updateFilterProfile.mockResolvedValue(state([NORMAL, profile({ name: 'Storm' })]));
    renderCard();
    const row = await screen.findByTestId('spam-profile-1');
    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    const field = within(row).getByLabelText('New name for Spam wave');
    expect(field).toHaveValue('Spam wave');
    fireEvent.change(field, { target: { value: ' Storm ' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save name' }));
    await waitFor(() =>
      expect(mocks.updateFilterProfile).toHaveBeenCalledWith(1, { name: 'Storm' })
    );
    expect(await screen.findByText('Storm')).toBeInTheDocument();
  });

  it('deletes after a yes, and not after a no', async () => {
    mocks.deleteFilterProfile.mockResolvedValue(state([NORMAL]));
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderCard();
    const row = await screen.findByTestId('spam-profile-1');
    const remove = within(row).getByRole('button', { name: 'Delete the profile Spam wave' });

    fireEvent.click(remove);
    expect(confirm).toHaveBeenCalledWith(
      'Delete the profile Spam wave? The current settings stay as they are.'
    );
    expect(mocks.deleteFilterProfile).not.toHaveBeenCalled();

    fireEvent.click(remove);
    await waitFor(() => expect(mocks.deleteFilterProfile).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.queryByTestId('spam-profile-1')).not.toBeInTheDocument());
  });

  it('loads again when the settings version changes', async () => {
    const { rerender, onApplied } = renderCard();
    await screen.findByTestId('spam-profile-1');
    expect(mocks.getFilterProfiles).toHaveBeenCalledTimes(1);
    rerender(
      <SpamProfilesCard version={5} enabled busy={false} formDirty={false} onApplied={onApplied} />
    );
    await waitFor(() => expect(mocks.getFilterProfiles).toHaveBeenCalledTimes(2));
  });
});
