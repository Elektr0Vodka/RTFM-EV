import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '../api';
import { CommandPalette } from '../components/CommandPalette';
import { SettingsWardriveSection } from '../components/settings/SettingsWardriveSection';
import { brokerIdFor } from '../components/settings/WardriveBrokersCard';
import type {
  WardriveAdminConfig,
  WardriveAdminStatus,
  WardriveBroker,
  WardriveBrokerIn,
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

const BUILTINS: WardriveBroker[] = [
  {
    id: 'dmc-hunter',
    name: 'DutchMeshCore hunter',
    url: 'wss://collector1.dutchmeshcore.nl:443',
    audience: 'collector1.dutchmeshcore.nl',
    auth: 'companion',
    format: 'wardrive',
    label: 'hunter',
    builtin: true,
  },
  {
    id: 'dmc-wardriver',
    name: 'DutchMeshCore wardriver',
    url: 'wss://collector2.dutchmeshcore.nl:443',
    audience: 'collector2.dutchmeshcore.nl',
    auth: 'companion',
    format: 'wardrive',
    label: 'wardriver',
    builtin: true,
  },
  {
    id: 'meshcore-analyzer',
    name: 'meshcore-analyzer.eu',
    url: 'wss://mqtt.meshcore-analyzer.eu:443',
    audience: 'mqtt.meshcore-analyzer.eu',
    auth: 'companion',
    format: 'packets',
    region: 'nl',
    builtin: true,
  },
];

const NO_BROKERS = {
  rssi_calibration_db: 0,
  builtin_brokers: BUILTINS,
  brokers: [] as WardriveBrokerIn[],
  analyzer_region: 'nl',
};

const CLUB: WardriveBrokerIn = {
  id: 'club-mqtt',
  name: 'Club MQTT',
  url: 'wss://mqtt.example.org:8084/mqtt',
  auth: 'password',
  username: 'club',
  password: 's3cret-pass',
  format: 'packets',
  region: 'ams',
};

function mockApi({
  status = { active: true, unprotected: false, page_path: '/wardrive/' },
  users = [makeUser()],
  groups = [] as WardriveGroup[],
  config = {
    ...NO_BROKERS,
    hashtag_channels: null,
    default_hashtag_channels: [],
  } as WardriveAdminConfig,
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
    mockApi({
      config: { ...NO_BROKERS, hashtag_channels: null, default_hashtag_channels: ['#test'] },
    });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-channels');
    await within(card).findByText('#test');
    expect(within(card).getByText(/from your radio/i)).toBeTruthy();
    expect(within(card).getByText(/only the names/i)).toBeTruthy();
  });

  it('adds a channel on top of the list in use', async () => {
    mockApi({
      config: { ...NO_BROKERS, hashtag_channels: null, default_hashtag_channels: ['#test'] },
    });
    const put = vi.spyOn(api, 'putWardriveConfig').mockResolvedValue({
      ...NO_BROKERS,
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
    mockApi({
      config: { ...NO_BROKERS, hashtag_channels: ['#a', '#test'], default_hashtag_channels: [] },
    });
    const put = vi
      .spyOn(api, 'putWardriveConfig')
      .mockResolvedValue({ ...NO_BROKERS, hashtag_channels: ['#a'], default_hashtag_channels: [] });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-channels');
    fireEvent.click(await within(card).findByRole('button', { name: 'Remove #test' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ hashtag_channels: ['#a'] }));
  });

  it('goes back to the radio channels', async () => {
    mockApi({
      config: { ...NO_BROKERS, hashtag_channels: ['#a'], default_hashtag_channels: ['#test'] },
    });
    const put = vi.spyOn(api, 'putWardriveConfig').mockResolvedValue({
      ...NO_BROKERS,
      hashtag_channels: null,
      default_hashtag_channels: ['#test'],
    });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-channels');
    fireEvent.click(
      await within(card).findByRole('button', { name: "Use my radio's hashtag channels" })
    );
    await waitFor(() => expect(put).toHaveBeenCalledWith({ hashtag_channels: null }));
  });

  it('shows the server message when a name is refused', async () => {
    mockApi({ config: { ...NO_BROKERS, hashtag_channels: [], default_hashtag_channels: [] } });
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

describe('Settings: wardrive brokers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const base = { ...NO_BROKERS, hashtag_channels: null, default_hashtag_channels: [] };

  it('lists the built-in brokers without a remove button', async () => {
    mockApi({ config: base });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-brokers');
    await within(card).findByText('meshcore-analyzer.eu');
    expect(within(card).getByText('DutchMeshCore hunter')).toBeTruthy();
    expect(within(card).getByText('DutchMeshCore wardriver')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Remove/ })).toBeNull();
    expect((within(card).getByLabelText(/Analyzer region/) as HTMLInputElement).value).toBe('nl');
  });

  it('saves the analyzer region', async () => {
    mockApi({ config: base });
    const put = vi
      .spyOn(api, 'putWardriveConfig')
      .mockResolvedValue({ ...base, analyzer_region: 'be' });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-brokers');
    fireEvent.change(await within(card).findByLabelText(/Analyzer region/), {
      target: { value: 'be' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Save region' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ analyzer_region: 'be' }));
  });

  it('adds a broker with a password', async () => {
    mockApi({ config: base });
    const put = vi.spyOn(api, 'putWardriveConfig').mockResolvedValue({ ...base, brokers: [CLUB] });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-brokers');
    await within(card).findByText('meshcore-analyzer.eu');
    fireEvent.change(within(card).getByLabelText('Broker name'), {
      target: { value: 'Club MQTT' },
    });
    fireEvent.change(within(card).getByLabelText('Address'), {
      target: { value: 'wss://mqtt.example.org:8084/mqtt' },
    });
    fireEvent.change(within(card).getByLabelText('Sign-in'), { target: { value: 'password' } });
    fireEvent.change(within(card).getByLabelText('Broker username'), {
      target: { value: 'club' },
    });
    fireEvent.change(within(card).getByLabelText('Broker password'), {
      target: { value: 's3cret-pass' },
    });
    fireEvent.change(within(card).getByLabelText('Region code'), { target: { value: 'ams' } });
    expect(within(card).getByText(/every wardrive driver/i)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Add broker' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ brokers: [CLUB] }));
    expect(await within(card).findByText('Club MQTT')).toBeTruthy();
  });

  it('adds a wardrive-format broker with a stream label and no account', async () => {
    mockApi({ config: base });
    const put = vi.spyOn(api, 'putWardriveConfig').mockResolvedValue(base);
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-brokers');
    await within(card).findByText('meshcore-analyzer.eu');
    fireEvent.change(within(card).getByLabelText('Broker name'), { target: { value: 'Ours' } });
    fireEvent.change(within(card).getByLabelText('Address'), {
      target: { value: 'wss://c.example.org' },
    });
    fireEvent.change(within(card).getByLabelText('Format'), { target: { value: 'wardrive' } });
    fireEvent.change(within(card).getByLabelText('Stream label'), {
      target: { value: 'wardriver' },
    });
    expect(within(card).queryByLabelText('Broker password')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Add broker' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith({
        brokers: [
          {
            id: 'ours',
            name: 'Ours',
            url: 'wss://c.example.org',
            auth: 'companion',
            format: 'wardrive',
            label: 'wardriver',
          },
        ],
      })
    );
  });

  it('removes an added broker after a confirmation', async () => {
    mockApi({ config: { ...base, brokers: [CLUB] } });
    const put = vi.spyOn(api, 'putWardriveConfig').mockResolvedValue(base);
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-brokers');
    fireEvent.click(await within(card).findByRole('button', { name: 'Remove Club MQTT' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Club MQTT');
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove broker' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ brokers: [] }));
  });

  it('keeps a broker when the removal is cancelled', async () => {
    mockApi({ config: { ...base, brokers: [CLUB] } });
    const put = vi.spyOn(api, 'putWardriveConfig').mockResolvedValue(base);
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-brokers');
    fireEvent.click(await within(card).findByRole('button', { name: 'Remove Club MQTT' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(put).not.toHaveBeenCalled();
  });

  it('takes region codes in lower case', async () => {
    mockApi({ config: base });
    const put = vi.spyOn(api, 'putWardriveConfig').mockResolvedValue(base);
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-brokers');
    const region = (await within(card).findByLabelText(/Analyzer region/)) as HTMLInputElement;
    fireEvent.change(region, { target: { value: 'BE' } });
    expect(region.value).toBe('be');
    const code = within(card).getByLabelText('Region code') as HTMLInputElement;
    fireEvent.change(code, { target: { value: 'AMS' } });
    expect(code.value).toBe('ams');
    fireEvent.click(within(card).getByRole('button', { name: 'Save region' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ analyzer_region: 'be' }));
  });

  it('shows the server message when a broker is refused', async () => {
    mockApi({ config: base });
    vi.spyOn(api, 'putWardriveConfig').mockRejectedValue(
      new ApiError('Value error, Use a wss:// address', 422)
    );
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-brokers');
    await within(card).findByText('meshcore-analyzer.eu');
    fireEvent.change(within(card).getByLabelText('Broker name'), { target: { value: 'X' } });
    fireEvent.change(within(card).getByLabelText('Address'), {
      target: { value: 'http://x.example.org' },
    });
    fireEvent.change(within(card).getByLabelText('Region code'), { target: { value: 'nl' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add broker' }));
    expect(await within(card).findByText(/Use a wss:\/\/ address/)).toBeTruthy();
  });
});

describe('Settings: wardrive RSSI calibration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the calibration', async () => {
    const base = { ...NO_BROKERS, hashtag_channels: null, default_hashtag_channels: [] };
    mockApi({ config: base });
    const put = vi
      .spyOn(api, 'putWardriveConfig')
      .mockResolvedValue({ ...base, rssi_calibration_db: -6 });
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-calibration');
    fireEvent.change(await within(card).findByLabelText(/RSSI calibration/), {
      target: { value: '-6' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Save calibration' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith({ rssi_calibration_db: -6 }));
  });

  it('refuses a value outside -30 to 30 without asking the server', async () => {
    const base = { ...NO_BROKERS, hashtag_channels: null, default_hashtag_channels: [] };
    mockApi({ config: base });
    const put = vi.spyOn(api, 'putWardriveConfig');
    render(<SettingsWardriveSection />);
    const card = await screen.findByTestId('wardrive-calibration');
    fireEvent.change(await within(card).findByLabelText(/RSSI calibration/), {
      target: { value: '45' },
    });
    expect(
      (within(card).getByRole('button', { name: 'Save calibration' }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(put).not.toHaveBeenCalled();
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

  it('never makes the id of RTFM-EV own upload destination', () => {
    expect(brokerIdFor('RTFM', new Set())).not.toBe('rtfm');
    expect(brokerIdFor('Club', new Set(['club']))).toBe('club-2');
  });
});
