import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '../api';
import { CommandPalette } from '../components/CommandPalette';
import { SettingsWardriveSection } from '../components/settings/SettingsWardriveSection';
import type {
  WardriveAdminConfig,
  WardriveAdminStatus,
  WardriveGroup,
  WardriveUser,
} from '../types';
import type { WardriveData } from '../wardrive/api';

vi.mock('../wardrive/map/WardriveMap', () => ({
  WardriveMap: ({ data }: { data: WardriveData }) => (
    <div data-testid="fake-map">{`${data.obs.length} obs`}</div>
  ),
}));

const KEY = 'AB'.repeat(32);

function makeUser(overrides: Partial<WardriveUser> = {}): WardriveUser {
  return {
    id: 1,
    username: 'mike',
    visibility: 'own',
    disabled: false,
    created_at: 1,
    radios: [{ public_key: KEY, name: 'car', added_at: 1 }],
    group_ids: [],
    obs_count: 12,
    ...overrides,
  };
}

function mockApi({
  status = { active: true, unprotected: false, page_path: '/wardrive/' },
  users = [makeUser()],
  groups = [] as WardriveGroup[],
  config = { hashtag_channels: null, default_hashtag_channels: [] } as WardriveAdminConfig,
}: {
  status?: WardriveAdminStatus;
  users?: WardriveUser[];
  groups?: WardriveGroup[];
  config?: WardriveAdminConfig;
} = {}) {
  vi.spyOn(api, 'getWardriveAdminStatus').mockResolvedValue(status);
  vi.spyOn(api, 'getWardriveUsers').mockResolvedValue(users);
  vi.spyOn(api, 'getWardriveGroups').mockResolvedValue(groups);
  vi.spyOn(api, 'getWardriveConfig').mockResolvedValue(config);
  return vi
    .spyOn(api, 'getWardriveAdminData')
    .mockResolvedValue({ obs: [], tracks: [], truncated: false });
}

describe('Settings: wardrive admin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the unprotected warning', async () => {
    mockApi({ status: { active: true, unprotected: true, page_path: '/wardrive/' } });
    render(<SettingsWardriveSection />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('MESHCORE_BASIC_AUTH_USERNAME');
  });

  it('shows no warning when the main login is set', async () => {
    mockApi();
    render(<SettingsWardriveSection />);
    await screen.findByTestId('wardrive-user');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the page address', async () => {
    mockApi();
    render(<SettingsWardriveSection />);
    expect(await screen.findByText(`${window.location.origin}/wardrive/`)).toBeTruthy();
  });

  it('lists users with their radios and reception count', async () => {
    mockApi();
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-user');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText(/ABABABAB/)).toBeTruthy();
    expect(within(card as HTMLElement).getByText(/car/)).toBeTruthy();
    expect(within(card as HTMLElement).getByText(/12/)).toBeTruthy();
  });

  it('changes a user visibility', async () => {
    mockApi();
    const patch = vi
      .spyOn(api, 'patchWardriveUser')
      .mockResolvedValue(makeUser({ visibility: 'all' }));
    render(<SettingsWardriveSection />);
    const select = (await screen.findByLabelText('Visibility for mike')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'all' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith(1, { visibility: 'all' }));
  });

  it('disables a user', async () => {
    mockApi();
    const patch = vi
      .spyOn(api, 'patchWardriveUser')
      .mockResolvedValue(makeUser({ disabled: true }));
    render(<SettingsWardriveSection />);
    fireEvent.click(await screen.findByLabelText('Disabled: mike'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(1, { disabled: true }));
  });

  it('asks before deleting a user', async () => {
    mockApi();
    const del = vi.spyOn(api, 'deleteWardriveUser').mockResolvedValue({ status: 'deleted' });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<SettingsWardriveSection />);
    const button = await screen.findByRole('button', { name: 'Delete user mike' });
    fireEvent.click(button);
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(del).toHaveBeenCalledWith(1));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('asks before removing a radio', async () => {
    mockApi();
    const del = vi.spyOn(api, 'deleteWardriveRadio').mockResolvedValue({ status: 'deleted' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsWardriveSection />);
    fireEvent.click(await screen.findByRole('button', { name: `Remove radio ${KEY.slice(0, 8)}` }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(KEY));
  });

  it('creates a group', async () => {
    mockApi();
    const create = vi
      .spyOn(api, 'createWardriveGroup')
      .mockResolvedValue({ id: 5, name: 'crew', created_at: 1, member_ids: [] });
    render(<SettingsWardriveSection />);
    fireEvent.change(await screen.findByLabelText('New group name'), {
      target: { value: 'crew' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('crew'));
  });

  it('puts a user in a group', async () => {
    mockApi({ groups: [{ id: 5, name: 'crew', created_at: 1, member_ids: [] }] });
    const setMembers = vi
      .spyOn(api, 'setWardriveGroupMembers')
      .mockResolvedValue({ id: 5, name: 'crew', created_at: 1, member_ids: [1] });
    render(<SettingsWardriveSection />);
    fireEvent.click(await screen.findByLabelText('mike in crew'));
    await waitFor(() => expect(setMembers).toHaveBeenCalledWith(5, [1]));
  });

  it('puts the stored name back when a rename is refused', async () => {
    mockApi({ groups: [{ id: 5, name: 'crew', created_at: 1, member_ids: [] }] });
    const rename = vi
      .spyOn(api, 'renameWardriveGroup')
      .mockRejectedValue(new Error('A group with that name exists'));
    render(<SettingsWardriveSection />);
    const input = (await screen.findByLabelText('Name of group crew')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'taken' } });
    fireEvent.blur(input);
    await waitFor(() => expect(rename).toHaveBeenCalledWith(5, 'taken'));
    await waitFor(() => expect(input.value).toBe('crew'));
    expect(await screen.findByText(/A group with that name exists/)).toBeTruthy();
  });

  it('names the group on its delete button', async () => {
    mockApi({ groups: [{ id: 5, name: 'crew', created_at: 1, member_ids: [] }] });
    const del = vi.spyOn(api, 'deleteWardriveGroup').mockResolvedValue({ status: 'deleted' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SettingsWardriveSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete group crew' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(5));
  });
});

describe('Settings: wardrive group membership', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps both users when two are ticked before the first save returns', async () => {
    mockApi({
      users: [makeUser(), makeUser({ id: 2, username: 'anna', radios: [] })],
      groups: [{ id: 5, name: 'crew', created_at: 1, member_ids: [] }],
    });
    const pending: Array<() => void> = [];
    const setMembers = vi
      .spyOn(api, 'setWardriveGroupMembers')
      .mockImplementation(
        (groupId, userIds) =>
          new Promise((resolve) =>
            pending.push(() =>
              resolve({ id: groupId, name: 'crew', created_at: 1, member_ids: userIds })
            )
          )
      );
    render(<SettingsWardriveSection />);
    fireEvent.click(await screen.findByLabelText('mike in crew'));
    fireEvent.click(screen.getByLabelText('anna in crew'));
    await waitFor(() => expect(setMembers).toHaveBeenCalledTimes(2));
    expect(setMembers.mock.calls[1]).toEqual([5, [1, 2]]);
    pending.forEach((resolve) => resolve());
  });
});

describe('Settings: wardrive channels for drivers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the radio default and says where it comes from', async () => {
    mockApi({ config: { hashtag_channels: null, default_hashtag_channels: ['#test'] } });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-channels');
    await within(card).findByText('#test');
    expect(within(card).getByText(/from your radio/i)).toBeTruthy();
    expect(within(card).getByText(/only the names/i)).toBeTruthy();
  });

  it('adds a channel on top of the list in use', async () => {
    mockApi({ config: { hashtag_channels: null, default_hashtag_channels: ['#test'] } });
    const put = vi.spyOn(api, 'putWardriveConfig').mockResolvedValue({
      hashtag_channels: ['#test', '#zwolle'],
      default_hashtag_channels: ['#test'],
    });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-channels');
    await within(card).findByText('#test');
    fireEvent.change(within(card).getByLabelText('Channel name'), { target: { value: 'zwolle' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add channel' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({ hashtag_channels: ['#test', 'zwolle'] })
    );
    expect(await within(card).findByText('#zwolle')).toBeTruthy();
  });

  it('removes a channel from the owner list', async () => {
    mockApi({ config: { hashtag_channels: ['#a', '#test'], default_hashtag_channels: [] } });
    const put = vi
      .spyOn(api, 'putWardriveConfig')
      .mockResolvedValue({ hashtag_channels: ['#a'], default_hashtag_channels: [] });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-channels');
    fireEvent.click(await within(card).findByRole('button', { name: 'Remove #test' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ hashtag_channels: ['#a'] }));
  });

  it('goes back to the radio channels', async () => {
    mockApi({ config: { hashtag_channels: ['#a'], default_hashtag_channels: ['#test'] } });
    const put = vi
      .spyOn(api, 'putWardriveConfig')
      .mockResolvedValue({ hashtag_channels: null, default_hashtag_channels: ['#test'] });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-channels');
    fireEvent.click(
      await within(card).findByRole('button', { name: "Use my radio's hashtag channels" })
    );
    await waitFor(() => expect(put).toHaveBeenCalledWith({ hashtag_channels: null }));
  });

  it('shows the server message when a name is refused', async () => {
    mockApi({ config: { hashtag_channels: [], default_hashtag_channels: [] } });
    vi.spyOn(api, 'putWardriveConfig').mockRejectedValue(
      new ApiError('Value error, Not a usable channel name', 422)
    );
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-channels');
    fireEvent.change(within(card).getByLabelText('Channel name'), { target: { value: '#' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add channel' }));
    expect(await within(card).findByText(/Not a usable channel name/)).toBeTruthy();
  });
});

describe('Settings: wardrive coverage map', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is no longer in Settings and says where it went', async () => {
    const data = mockApi();
    render(<SettingsWardriveSection />);
    await screen.findByTestId('wardrive-user');
    expect(screen.queryByTestId('fake-map')).toBeNull();
    expect(data).not.toHaveBeenCalled();
    expect(screen.getByText(/Tools > Wardrive map/)).toBeTruthy();
  });
});

describe('Settings: wardrive section visibility', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  function renderPalette(isWardrive: boolean) {
    render(
      <CommandPalette
        contacts={[]}
        channels={[]}
        onSelectConversation={vi.fn()}
        onOpenSettings={vi.fn()}
        onRepeaterAutoLogin={vi.fn()}
        isWardrive={isWardrive}
      />
    );
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  }

  it('is hidden when wardrive is off', () => {
    renderPalette(false);
    expect(screen.queryByText('Wardrive')).toBeNull();
  });

  it('is listed when wardrive is on', () => {
    renderPalette(true);
    expect(screen.getByText('Wardrive')).toBeTruthy();
  });
});
