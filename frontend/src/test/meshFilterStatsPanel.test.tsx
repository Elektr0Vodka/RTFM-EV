import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MeshHealthView } from '../components/MeshHealthView';
import type { Contact } from '../types';

// The Add to bot list dialog saves through the API client; the panel itself uses fetch.
vi.mock('../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api')>();
  const state = {
    lists: [],
    exceptions: [],
    effective: { names: [], keys: [] },
    limits: { entries_per_list: 2000, effective: 5000 },
    forward: {},
  };
  return {
    ...original,
    api: {
      ...original.api,
      createBotList: vi.fn(async () => ({ ...state, created_id: 7 })),
      updateBotList: vi.fn(async () => state),
      addBotListEntry: vi.fn(async () => state),
    },
  };
});

const PUBLIC = '8B3387E9C5CDEA6AC9E5EDBAA115CD72';
const FAMILY = 'EE'.repeat(16);
const counts = { messages: 0, spam: 0, malformed: 0, duplicate: 0, bot_now: 0, flagged: 0 };

const REPORT = {
  window: { start_ts: 0, end_ts: 1800, bucket_seconds: 900, channel: null },
  totals: {
    ...counts,
    messages: 40,
    spam: 10,
    malformed: 4,
    duplicate: 2,
    bot_now: 8,
    flagged: 20,
    malformed_text: 3,
    malformed_clock: 1,
    malformed_both: 0,
    malformed_unknown: 0,
    bot_flagged: 6,
    bot_listed_later: 2,
    bot_no_longer_listed: 0,
    multi_flag: 4,
  },
  series: [
    { ...counts, bucket_ts: 0, messages: 30, spam: 9 },
    { ...counts, bucket_ts: 900, messages: 10, spam: 1 },
  ],
  senders: [
    {
      ...counts,
      name: 'UD6DWREK',
      public_key: 'cd'.repeat(32),
      messages: 10,
      spam: 10,
      flagged: 10,
      bot_flagged: 0,
      bot_lists: [],
      channels: 1,
      first_seen: 100,
      last_seen: 900,
    },
    {
      ...counts,
      name: 'PingBot',
      public_key: null,
      messages: 8,
      bot_now: 8,
      flagged: 8,
      bot_flagged: 6,
      bot_lists: ['Mine'],
      channels: 2,
      first_seen: 50,
      last_seen: 1700,
    },
  ],
  senders_truncated: false,
  channels: [
    { ...counts, key: PUBLIC, name: 'Public', public: true, messages: 30, flagged: 15 },
    { ...counts, key: FAMILY, name: 'Family', public: false, messages: 10, flagged: 5 },
  ],
  sources: [
    { ...counts, hop: '27', messages: 12, spam: 10, flagged: 10, last_seen: 900 },
    { ...counts, hop: 'DIRECT', messages: 3, malformed: 3, flagged: 3, last_seen: 400 },
  ],
  sources_truncated: false,
  filters: {
    analysed: 30,
    clean: 18,
    stopped: 9,
    let_through: 3,
    held: 0,
    enforced: 0,
    not_enforced: 9,
    stop_rate: 75,
    blocks: [{ source: 'campaign', count: 9 }],
    confirmed: 1,
    missed: 0,
    false_positive: 0,
    flagged_later: 1,
    not_recorded: 10,
  },
  policy_rules: [],
  spam_guard_enabled: true,
  bot_lists_enabled: true,
  app_version: '3.18.0-EV.0.2',
};

const ADVERTS = {
  start_ts: 0,
  end_ts: 3600,
  window_hours: 1,
  total_contacts: 0,
  high_alert_count: 0,
  medium_alert_count: 0,
  high_advert_threshold: 8,
  medium_advert_threshold: 2,
  alerts: [],
  contacts: [],
};

let requested: string[] = [];

function mockFetch(report: unknown) {
  requested = [];
  global.fetch = vi.fn((url: string) => {
    requested.push(String(url));
    // Like the other Mesh Health tests: the Adverts tab mounts first and asks
    // for its own data, and every other endpoint answers an empty list.
    const body = String(url).includes('filter-stats')
      ? report
      : String(url).includes('mesh-health')
        ? ADVERTS
        : [];
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
  }) as unknown as typeof fetch;
}

async function openTab(props: Partial<Parameters<typeof MeshHealthView>[0]> = {}) {
  render(<MeshHealthView config={null} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Spam & bots' }));
  await waitFor(() => expect(screen.getByText('Offenders')).toBeInTheDocument());
}

describe('Mesh Health Spam & bots tab', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFetch(REPORT);
  });

  it('shows the tiles and the senders table', async () => {
    await openTab();
    const tiles = screen.getByTestId('filter-stats-tiles');
    expect(within(tiles).getByText('40')).toBeInTheDocument();
    expect(within(tiles).getByText('25% of traffic')).toBeInTheDocument();
    expect(within(tiles).getByText('20% of traffic, 6 flagged on arrival')).toBeInTheDocument();
    const table = screen.getByTestId('filter-stats-table');
    expect(within(table).getByText('UD6DWREK')).toBeInTheDocument();
    expect(within(table).getByText('PingBot')).toBeInTheDocument();
    expect(within(table).getByText('Mine')).toBeInTheDocument();
  });

  it('opens a node when a sender with a known key is clicked', async () => {
    const onOpenNode = vi.fn();
    await openTab({ onOpenNode });
    fireEvent.click(screen.getByRole('button', { name: 'UD6DWREK' }));
    expect(onOpenNode).toHaveBeenCalledWith('cd'.repeat(32), 'UD6DWREK');
    // No key stored for this one: plain text, not a button.
    expect(screen.queryByRole('button', { name: 'PingBot' })).not.toBeInTheDocument();
  });

  it('offers Add to bot list only for a sender that is not listed', async () => {
    await openTab();
    expect(screen.getAllByRole('button', { name: 'Add to bot list' })).toHaveLength(1);
  });

  it('switches to the channel and source repeater tables', async () => {
    await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Channels' }));
    const table = screen.getByTestId('filter-stats-table');
    expect(within(table).getByText('Family')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Source repeaters' }));
    expect(
      within(screen.getByTestId('filter-stats-table')).getByText('Heard directly')
    ).toBeInTheDocument();
  });

  it('scramble hides sender names, private channel names and sender actions', async () => {
    await openTab();
    fireEvent.click(screen.getByLabelText('Scramble names'));
    const table = screen.getByTestId('filter-stats-table');
    expect(within(table).queryByText('UD6DWREK')).not.toBeInTheDocument();
    expect(within(table).getAllByText(/^user-[0-9a-f]{8}$/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Add to bot list' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Channels' }));
    const channels = screen.getByTestId('filter-stats-table');
    expect(within(channels).getByText('Public')).toBeInTheDocument();
    expect(within(channels).queryByText('Family')).not.toBeInTheDocument();
    expect(within(channels).getByText(/^channel-[0-9a-f]{8}$/)).toBeInTheDocument();
  });

  it('shows the Spam Guard outcome with Monitor stops as would-have-stopped', async () => {
    await openTab();
    const filters = screen.getByTestId('filter-stats-filters');
    expect(within(filters).getByText('Would have stopped')).toBeInTheDocument();
    // "Stop rate" would claim messages were stopped while Monitor withholds nothing.
    expect(within(filters).getByText('Catch rate 75%')).toBeInTheDocument();
    expect(within(filters).getByText('Campaign')).toBeInTheDocument();
    expect(within(filters).getByText('10 messages have no recorded outcome.')).toBeInTheDocument();
    expect(within(filters).queryByText('OpenHop rules')).not.toBeInTheDocument();
  });

  it('says so when Spam Guard is off and when no bot list is on', async () => {
    mockFetch({ ...REPORT, spam_guard_enabled: false, bot_lists_enabled: false });
    await openTab();
    expect(screen.getByText(/Spam Guard is off/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Spam Guard' })).toHaveAttribute(
      'href',
      '#spam-guard'
    );
    expect(screen.getByText('No bot list is on (Settings, Bot lists)')).toBeInTheDocument();
  });

  it('shows the empty state for a window without channel messages', async () => {
    mockFetch({
      ...REPORT,
      totals: { ...REPORT.totals, messages: 0, spam: 0, flagged: 0 },
      senders: [],
      channels: [],
      sources: [],
    });
    render(<MeshHealthView config={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Spam & bots' }));
    await waitFor(() =>
      expect(screen.getByText('No channel messages in the last 30m.')).toBeInTheDocument()
    );
    expect(screen.queryByText('Offenders')).not.toBeInTheDocument();
  });

  it('asks the server for one channel when the filter is used', async () => {
    await openTab();
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: FAMILY } });
    await waitFor(() =>
      expect(requested.some((url) => url.includes(`channel=${FAMILY}`))).toBe(true)
    );
    // The other channel is still offered after the filtered answer came back.
    expect(
      within(screen.getByLabelText('Channel')).getByRole('option', { name: 'Public' })
    ).toBeInTheDocument();
  });

  it('keeps the time range selector on this tab', async () => {
    await openTab();
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
  });
});

describe('Mesh Health Spam & bots tab, details', () => {
  const REPEATER = { public_key: '27' + 'a'.repeat(62), name: 'Relay27', type: 2 };
  // Same first byte, but a companion: it is not a repeater and cannot be the first hop.
  const COMPANION = { public_key: '27' + 'b'.repeat(62), name: 'Chatty', type: 1 };
  const contacts = [REPEATER, COMPANION] as unknown as Contact[];

  beforeEach(() => {
    localStorage.clear();
    mockFetch(REPORT);
  });

  async function openSources(props: Partial<Parameters<typeof MeshHealthView>[0]> = {}) {
    await openTab({ contacts, ...props });
    fireEvent.click(screen.getByRole('button', { name: 'Source repeaters' }));
  }

  it('names a source repeater from repeater contacts only', async () => {
    await openSources();
    // Plain text here: no onOpenNode was given, so the name is not a button.
    const table = screen.getByTestId('filter-stats-table');
    expect(within(table).getByText('Relay27')).toBeInTheDocument();
    expect(within(table).queryByText('Chatty')).not.toBeInTheDocument();
  });

  it('still opens a source repeater while names are scrambled', async () => {
    const onOpenNode = vi.fn();
    await openSources({ onOpenNode });
    fireEvent.click(screen.getByLabelText('Scramble names'));
    fireEvent.click(screen.getByRole('button', { name: 'Relay27' }));
    expect(onOpenNode).toHaveBeenCalledWith(REPEATER.public_key, 'Relay27');
  });

  it('marks the chosen table and the chosen trend mode for a screen reader', async () => {
    await openTab();
    expect(screen.getByRole('button', { name: 'Senders', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Channels', pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Counts', pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByRole('button', { name: 'Share', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Counts', pressed: false })).toBeInTheDocument();
  });

  it('explains Scramble names to a screen reader, not only in a tooltip', async () => {
    await openTab();
    expect(screen.getByLabelText('Scramble names')).toHaveAccessibleDescription(
      /Replaces sender names/
    );
  });

  it('words the OpenHop action and says the rules are not filtered by channel', async () => {
    mockFetch({
      ...REPORT,
      policy_rules: [
        { action: 'drop', rule: 'rtfm-spam:bots:Public (bot list)', packets: 3 },
        { action: 'log_only', rule: 'watch', packets: 2 },
        { action: 'allow', rule: null, packets: 1 },
        { action: 'quarantine', rule: 'later', packets: 1 },
      ],
    });
    await openTab();
    const filters = screen.getByTestId('filter-stats-filters');
    expect(within(filters).getByText('Drop')).toBeInTheDocument();
    expect(within(filters).getByText('Log only')).toBeInTheDocument();
    expect(within(filters).getByText('Allow')).toBeInTheDocument();
    // An action this version does not know is shown as the node names it.
    expect(within(filters).getByText('quarantine')).toBeInTheDocument();
    expect(within(filters).queryByText(/all channels, whatever the channel/i)).toBeNull();
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: FAMILY } });
    await waitFor(() =>
      expect(
        within(screen.getByTestId('filter-stats-filters')).getByText(
          /all channels, whatever the channel/i
        )
      ).toBeInTheDocument()
    );
  });

  it('shows a block source it does not know by its own name', async () => {
    mockFetch({
      ...REPORT,
      filters: { ...REPORT.filters, blocks: [{ source: 'future_kind', count: 2 }] },
    });
    await openTab();
    const filters = screen.getByTestId('filter-stats-filters');
    expect(within(filters).getByText('future_kind')).toBeInTheDocument();
    expect(within(filters).queryByText('Block has ended')).not.toBeInTheDocument();
  });

  it('uses the singular for one message', async () => {
    mockFetch({ ...REPORT, filters: { ...REPORT.filters, not_recorded: 1, flagged_later: 1 } });
    await openTab();
    const filters = screen.getByTestId('filter-stats-filters');
    expect(within(filters).getByText('1 message has no recorded outcome.')).toBeInTheDocument();
    expect(within(filters).getByText('1 flagged after it was let through.')).toBeInTheDocument();
  });

  it('loads the report again after a sender was added to a bot list', async () => {
    await openTab();
    const before = requested.filter((url) => url.includes('filter-stats')).length;
    fireEvent.click(screen.getByRole('button', { name: 'Add to bot list' }));
    fireEvent.change(await screen.findByLabelText('Name of the new list'), {
      target: { value: 'Mine' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(requested.filter((url) => url.includes('filter-stats')).length).toBe(before + 1)
    );
  });

  it('ignores an auto-refresh answer for a channel that is no longer selected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let answerLate: (() => void) | null = null;
      let calls = 0;
      const respond = (body: unknown) =>
        ({ ok: true, json: () => Promise.resolve(body) }) as Response;
      global.fetch = vi.fn((url: string) => {
        const text = String(url);
        if (!text.includes('filter-stats')) {
          return Promise.resolve(respond(text.includes('mesh-health') ? ADVERTS : []));
        }
        calls += 1;
        if (calls === 2) {
          // The 30 second refresh: answered only after the channel changed.
          return new Promise<Response>((resolve) => {
            answerLate = () =>
              resolve(respond({ ...REPORT, totals: { ...REPORT.totals, messages: 999 } }));
          });
        }
        return Promise.resolve(respond(REPORT));
      }) as unknown as typeof fetch;

      await openTab();
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      expect(calls).toBe(2);
      fireEvent.change(screen.getByLabelText('Channel'), { target: { value: FAMILY } });
      await waitFor(() => expect(calls).toBe(3));
      await act(async () => {
        answerLate?.();
        await Promise.resolve();
        await Promise.resolve();
      });
      const tiles = screen.getByTestId('filter-stats-tiles');
      expect(within(tiles).queryByText('999')).not.toBeInTheDocument();
      expect(within(tiles).getByText('40')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
