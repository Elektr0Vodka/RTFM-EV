import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChannelInfoPane } from '../components/ChannelInfoPane';
import type { Channel, ChannelDetail, ContactGroup } from '../types';

// Mock the api module
vi.mock('../api', () => ({
  api: {
    getChannelDetail: vi.fn(),
  },
}));

import { api } from '../api';
const mockGetChannelDetail = vi.mocked(api.getChannelDetail);

function makeChannel(key: string, name: string, isHashtag: boolean): Channel {
  return {
    key,
    name,
    is_hashtag: isHashtag,
    on_radio: false,
    last_read_at: null,
    favorite: false,
    muted: false,
  };
}

function makeDetail(channel: Channel): ChannelDetail {
  return {
    channel,
    message_counts: { last_1h: 0, last_24h: 0, last_48h: 0, last_7d: 0, all_time: 0 },
    first_message_at: null,
    unique_sender_count: 0,
    top_senders_24h: [],
    path_hash_width_24h: {
      total_packets: 0,
      single_byte: 0,
      double_byte: 0,
      triple_byte: 0,
      single_byte_pct: 0,
      double_byte_pct: 0,
      triple_byte_pct: 0,
    },
  };
}

const noop = () => {};

const baseProps = {
  onClose: noop,
  onToggleFavorite: noop,
};

describe('ChannelInfoPane key visibility', () => {
  it('shows key directly for hashtag channels', async () => {
    const key = 'AA'.repeat(16);
    const channel = makeChannel(key, '#general', true);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));

    render(<ChannelInfoPane {...baseProps} channelKey={key} channels={[channel]} />);

    await waitFor(() => {
      expect(screen.getByText(key.toLowerCase())).toBeInTheDocument();
    });
    expect(screen.queryByText('Show Key')).not.toBeInTheDocument();
  });

  it('hides key behind "Show Key" button for private channels', async () => {
    const key = 'BB'.repeat(16);
    const channel = makeChannel(key, 'Secret', false);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));

    render(<ChannelInfoPane {...baseProps} channelKey={key} channels={[channel]} />);

    await waitFor(() => {
      expect(screen.getByText('Secret')).toBeInTheDocument();
    });
    expect(screen.queryByText(key.toLowerCase())).not.toBeInTheDocument();
    expect(screen.getByText('Show Key')).toBeInTheDocument();
  });

  it('reveals key when "Show Key" is clicked', async () => {
    const key = 'CC'.repeat(16);
    const channel = makeChannel(key, 'Private', false);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));

    render(<ChannelInfoPane {...baseProps} channelKey={key} channels={[channel]} />);

    await waitFor(() => {
      expect(screen.getByText('Show Key')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Show Key'));

    expect(screen.getByText(key.toLowerCase())).toBeInTheDocument();
    expect(screen.queryByText('Show Key')).not.toBeInTheDocument();
  });

  it('resets key visibility when channel changes', async () => {
    const key1 = 'DD'.repeat(16);
    const key2 = 'EE'.repeat(16);
    const ch1 = makeChannel(key1, 'Room1', false);
    const ch2 = makeChannel(key2, 'Room2', false);
    mockGetChannelDetail.mockImplementation((key) =>
      Promise.resolve(key === key1 ? makeDetail(ch1) : makeDetail(ch2))
    );

    const { rerender } = render(
      <ChannelInfoPane {...baseProps} channelKey={key1} channels={[ch1, ch2]} />
    );

    await waitFor(() => {
      expect(screen.getByText('Show Key')).toBeInTheDocument();
    });

    // Reveal key for first channel
    fireEvent.click(screen.getByText('Show Key'));
    expect(screen.getByText(key1.toLowerCase())).toBeInTheDocument();

    // Switch channel - key should be hidden again
    rerender(<ChannelInfoPane {...baseProps} channelKey={key2} channels={[ch1, ch2]} />);

    await waitFor(() => {
      expect(screen.getByText('Room2')).toBeInTheDocument();
    });
    expect(screen.queryByText(key2.toLowerCase())).not.toBeInTheDocument();
    expect(screen.getByText('Show Key')).toBeInTheDocument();
  });
});

describe('ChannelInfoPane analyzer channel lookup', () => {
  const nameSite = {
    name: 'meshcore-analyzer.eu',
    node_url_template: 'https://meshcore-analyzer.eu/#node?id={pubkey}',
    channel_url_template: 'https://meshcore-analyzer.eu/#channels?channel={name}',
  };

  it('opens a private channel on the analyzer using its name', async () => {
    const key = 'AB'.repeat(16);
    const channel = makeChannel(key, 'Public', false);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ChannelInfoPane
        {...baseProps}
        channelKey={key}
        channels={[channel]}
        analyzerSites={[nameSite]}
      />
    );

    const button = await screen.findByText('Open channel on meshcore-analyzer.eu');
    button.click();
    expect(openSpy).toHaveBeenCalledWith(
      'https://meshcore-analyzer.eu/#channels?channel=Public',
      '_blank',
      'noopener,noreferrer'
    );
    openSpy.mockRestore();
  });

  it('prefixes and encodes a hashtag channel name stored without a leading #', async () => {
    const key = 'CD'.repeat(16);
    const channel = makeChannel(key, 'test', true);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <ChannelInfoPane
        {...baseProps}
        channelKey={key}
        channels={[channel]}
        analyzerSites={[nameSite]}
      />
    );

    const button = await screen.findByText('Open channel on meshcore-analyzer.eu');
    button.click();
    expect(openSpy).toHaveBeenCalledWith(
      'https://meshcore-analyzer.eu/#channels?channel=%23test',
      '_blank',
      'noopener,noreferrer'
    );
    openSpy.mockRestore();
  });

  it('hides the channel lookup for a site with no channel template', async () => {
    const key = 'EF'.repeat(16);
    const channel = makeChannel(key, 'Public', false);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));

    render(
      <ChannelInfoPane
        {...baseProps}
        channelKey={key}
        channels={[channel]}
        analyzerSites={[
          { name: 'mc-radar', node_url_template: 'https://mc-radar.woodwar.com/node/{pubkey}' },
        ]}
      />
    );

    await screen.findByText('Public');
    expect(screen.queryByText(/Open channel on/)).not.toBeInTheDocument();
  });

  it('shows no channel lookup when no sites are configured', async () => {
    const key = 'BA'.repeat(16);
    const channel = makeChannel(key, 'Public', false);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));

    render(<ChannelInfoPane {...baseProps} channelKey={key} channels={[channel]} />);

    await screen.findByText('Public');
    expect(screen.queryByText(/Open channel on/)).not.toBeInTheDocument();
  });
});

describe('ChannelInfoPane group membership (plan 28 item 1.16)', () => {
  it('lists existing groups and toggles this channel into one', async () => {
    const user = userEvent.setup();
    const key = 'FA'.repeat(16);
    const channel = makeChannel(key, 'Ops', false);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));
    const groups: ContactGroup[] = [
      { id: 'grp-1', name: 'Field Team', contact_keys: [], channel_keys: [] },
    ];
    const onUpdateContactGroups = vi.fn();

    render(
      <ChannelInfoPane
        {...baseProps}
        channelKey={key}
        channels={[channel]}
        contactGroups={groups}
        onUpdateContactGroups={onUpdateContactGroups}
      />
    );

    const checkbox = await screen.findByRole('checkbox', { name: 'Field Team' });
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);

    expect(onUpdateContactGroups).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'grp-1', channel_keys: [key] }),
    ]);
  });

  it('shows an already-grouped channel as checked and removes it on uncheck', async () => {
    const user = userEvent.setup();
    const key = 'FB'.repeat(16);
    const channel = makeChannel(key, 'Ops', false);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));
    const groups: ContactGroup[] = [
      { id: 'grp-1', name: 'Field Team', contact_keys: [], channel_keys: [key] },
    ];
    const onUpdateContactGroups = vi.fn();

    render(
      <ChannelInfoPane
        {...baseProps}
        channelKey={key}
        channels={[channel]}
        contactGroups={groups}
        onUpdateContactGroups={onUpdateContactGroups}
      />
    );

    const checkbox = await screen.findByRole('checkbox', { name: 'Field Team' });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);

    expect(onUpdateContactGroups).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'grp-1', channel_keys: [] }),
    ]);
  });

  it('creates a new group and adds this channel to it in one step', async () => {
    const user = userEvent.setup();
    const key = 'FC'.repeat(16);
    const channel = makeChannel(key, 'Ops', false);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));
    const onUpdateContactGroups = vi.fn();

    render(
      <ChannelInfoPane
        {...baseProps}
        channelKey={key}
        channels={[channel]}
        contactGroups={[]}
        onUpdateContactGroups={onUpdateContactGroups}
      />
    );

    const input = await screen.findByPlaceholderText('New group name');
    await user.type(input, 'Night Shift');
    await user.click(screen.getByRole('button', { name: 'Create & add' }));

    expect(onUpdateContactGroups).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Night Shift', channel_keys: [key] }),
    ]);
  });

  it('hides the Groups section when contactGroups is not supplied', async () => {
    const key = 'FD'.repeat(16);
    const channel = makeChannel(key, 'Ops', false);
    mockGetChannelDetail.mockResolvedValue(makeDetail(channel));

    render(<ChannelInfoPane {...baseProps} channelKey={key} channels={[channel]} />);

    await screen.findByText('Ops');
    expect(screen.queryByText('Groups')).not.toBeInTheDocument();
  });
});
