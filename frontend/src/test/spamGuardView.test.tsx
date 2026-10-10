import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { SpamGuardView } from '../components/SpamGuardView';
import { SpamGuardStatusLine } from '../components/spamGuard/SpamGuardStatusLine';
import { CONTACT_TYPE_REPEATER } from '../types';
import type {
  Channel,
  Contact,
  SpamBlock,
  SpamGuardReplayResult,
  SpamGuardState,
  SpamGuardTunables,
  SpamTotals,
} from '../types';
import { emitSpamGuardEvent } from '../utils/spamGuardEvents';

const mocks = vi.hoisted(() => ({
  getSpamGuard: vi.fn(),
  saveSpamGuardSettings: vi.fn(),
  spamGuardAction: vi.fn(),
  getSpamGuardRules: vi.fn(),
  spamGuardEvidenceUrl: vi.fn(),
  replaySpamGuard: vi.fn(),
}));

vi.mock('../api', () => ({
  api: mocks,
  ApiError: class ApiError extends Error {
    status = 0;
  },
}));

vi.mock('../components/spamGuard/SpamSourcesMap', () => ({
  SpamSourcesMap: ({ points }: { points: { label: string }[] }) => (
    <div data-testid="spam-map">{points.map((p) => p.label).join(';')}</div>
  ),
}));

const PUBLIC = '8B3387E9C5CDEA6AC9E5EDBAA115CD72';
const OTHER = 'EE'.repeat(16);
const NOW = Date.now() / 1000;

const TUNABLES: SpamGuardTunables = {
  enable_hop_rules: true,
  hop_match_mode: 'contains_known',
  hop_random_senders: 3,
  hop_new_senders: 6,
  hop_campaign_senders: 3,
  hop_random_senders_long: 5,
  enable_rotation_guard: true,
  rotate_first_hops: 3,
  route_memory_days: 7,
  max_paths_per_hop: 50,
  max_origins_per_route: 60,
  enable_text_rules: true,
  text_distinct_senders: 3,
  similarity: 65,
  min_rule_chars: 14,
  dedupe_enabled: true,
  dedupe_seconds: 900,
  dedupe_min_chars: 30,
  text_rule_chars: 40,
  known_min_msgs: 1,
  known_days: 30,
  hold_links: 'campaign',
  name_score_threshold: 3,
  random_name_patterns: ['(?=.*\\d)(?=.*[a-z])[a-z0-9]{8}'],
  window_seconds: 600,
  long_window_seconds: 7200,
  block_ttl_seconds: 21600,
  hop_block_ttl_seconds: 7200,
  spam_text_days: 7,
  max_total_rules: 300,
  evidence_log: false,
  evidence_days: 7,
};

function totals(overrides: Partial<SpamTotals> = {}): SpamTotals {
  return {
    messages: 40,
    stopped: 6,
    let_through: 2,
    held_genuine: 1,
    airtime_ms: 4200,
    spam: 8,
    stop_rate: 75,
    spam_share: 20,
    ...overrides,
  };
}

function block(overrides: Partial<SpamBlock>): SpamBlock {
  return {
    key: 'hop:27',
    kind: 'hop',
    value: '27',
    channel: null,
    reason: 'hop_random',
    source: 'hop',
    created: NOW - 60,
    expires: NOW + 3600,
    detail: { count: 3 },
    hits: 4,
    last_hit: NOW - 10,
    observe: false,
    match: null,
    sender: null,
    paths: [],
    ignored_paths: [],
    user_allowed: [],
    gated: true,
    mode: 'contains_known',
    ...overrides,
  };
}

function makeState(overrides: Partial<SpamGuardState> = {}): SpamGuardState {
  return {
    enabled: true,
    version: 4,
    mode: 'monitor',
    paused: false,
    backend: 'host',
    backend_state: 'off',
    blocks: 2,
    lockdown: false,
    settings: {
      mode: 'monitor',
      paused: false,
      sensitivity: 'balanced',
      overrides: {},
      channels: [{ key: PUBLIC, name: 'Public' }],
      allow_hops: [],
      allow_senders: [],
      allow_texts: [],
    },
    tunables: TUNABLES,
    defaults: TUNABLES,
    presets: {
      relaxed: { similarity: 80, text_distinct_senders: 4 },
      balanced: { similarity: 65, text_distinct_senders: 3 },
      strict: { similarity: 55, text_distinct_senders: 2 },
    },
    health: {
      state: 'ok',
      problems: [],
      warnings: [],
      running: true,
      backend: 'host',
      backend_state: 'off',
      rules_expected: 0,
      rules_present: 0,
      sync_state: null,
      repairs: 0,
      last_sync_at: null,
      last_message_at: NOW - 120,
      last_saved_at: NOW - 30,
    },
    metrics: {
      d1: totals(),
      d7: totals({ stopped: 30 }),
      hourly: Array.from({ length: 24 }, (_, i) => ({
        t: Math.floor(NOW / 3600) * 3600 - (23 - i) * 3600,
        messages: i,
        stopped: i % 3,
        let_through: i % 2,
      })),
      daily: Array.from({ length: 7 }, (_, i) => ({
        t: Math.floor(NOW / 86400) * 86400 - (6 - i) * 86400,
        messages: 10,
        stopped: i,
        let_through: 1,
      })),
      by_hour: Array.from({ length: 24 }, (_, i) => i),
      sources: [
        { hop: '27', d7: 9, d1: 4, last: NOW - 300, blocked: true, allowed: false },
        { hop: 'A1', d7: 2, d1: 0, last: NOW - 90000, blocked: false, allowed: false },
        { hop: 'DIRECT', d7: 1, d1: 1, last: NOW - 50, blocked: false, allowed: false },
      ],
      since: NOW - 86400,
    },
    block_list: [
      block({}),
      block({
        key: 'text:abc',
        kind: 'text',
        value: 'cheap radios today',
        channel: PUBLIC,
        reason: 'campaign',
        source: 'campaign',
        detail: { senders: 3 },
        gated: false,
        mode: null,
      }),
    ],
    held: [
      {
        ts: NOW - 40,
        sender: 'Newcomer',
        text: 'hello from a new person',
        channel: PUBLIC,
        path: ['27', 'B1'],
        matched: 'hop:27',
        kind: 'hop',
        message_id: 77,
      },
    ],
    messages: [
      {
        ts: NOW - 20,
        message_id: 91,
        sender: 'UD6DWREK',
        text: 'Amazing offer cheap radios today',
        channel: PUBLIC,
        path: ['27', 'B1'],
        name_score: 6,
        random: true,
        disguised: false,
        known: false,
        exempt: false,
        matched: 'text:abc',
        spam: true,
        campaign: 0,
      },
      {
        ts: NOW - 30,
        message_id: 90,
        sender: 'Dave',
        text: 'evening all',
        channel: PUBLIC,
        path: [],
        name_score: 0,
        random: false,
        disguised: false,
        known: true,
        exempt: false,
        matched: null,
        spam: false,
        campaign: null,
      },
    ],
    campaigns: [
      {
        id: 0,
        senders: 3,
        messages: 3,
        suspect: true,
        strong: true,
        confirmed: true,
        sample: 'Amazing offer cheap radios today',
        last: NOW - 20,
      },
    ],
    activity: [{ ts: NOW - 60, event: 'block_started', key: 'hop:27', kind: 'hop' }],
    known_names: ['Dave'],
    suppressed: {},
    private_channels: [],
    ...overrides,
  };
}

const CHANNELS = [
  { key: PUBLIC, name: 'Public' },
  { key: OTHER, name: '#other' },
] as Channel[];

const CONTACTS = [
  {
    public_key: '27ab' + '00'.repeat(30),
    name: 'Hilltop',
    type: CONTACT_TYPE_REPEATER,
    lat: 52.1,
    lon: 5.1,
  },
  { public_key: '27cd' + '00'.repeat(30), name: 'Valley', type: CONTACT_TYPE_REPEATER },
  { public_key: '27ef' + '00'.repeat(30), name: 'Not a repeater', type: 1 },
] as Contact[];

async function renderView(state: SpamGuardState = makeState(), channels: Channel[] = CHANNELS) {
  mocks.getSpamGuard.mockResolvedValue(state);
  render(
    <I18nProvider>
      <SpamGuardView contacts={CONTACTS} channels={channels} />
    </I18nProvider>
  );
  await screen.findByRole('tab', { name: 'Overview' });
  await waitFor(() => expect(screen.queryByText('Loading Spam Guard...')).toBeNull());
}

function openTab(name: RegExp | string) {
  fireEvent.click(screen.getByRole('tab', { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spamGuardAction.mockImplementation(async () => ({ result: {}, state: makeState() }));
  mocks.saveSpamGuardSettings.mockImplementation(async () => makeState({ version: 5 }));
});

describe('SpamGuardView overview', () => {
  it('shows mode, health and the numbers', async () => {
    await renderView();
    expect(screen.getByRole('button', { name: 'Monitor' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Protect' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByText('Working')).toBeInTheDocument();
    expect(screen.getByText('Forwarding backend: host repeater (off)')).toBeInTheDocument();
    expect(screen.getByText('Known people: 1')).toBeInTheDocument();
    // Stop rate, once for 24 hours and once for 7 days.
    expect(screen.getAllByText('75%')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Spam per hour, last 24 hours' })).toBeInTheDocument();
    // The Protection tab carries the number of active blocks.
    expect(screen.getByRole('tab', { name: 'Protection (2)' })).toBeInTheDocument();
  });

  it('saves the whole settings document with the current version when the mode changes', async () => {
    await renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Protect' }));
    await waitFor(() => expect(mocks.saveSpamGuardSettings).toHaveBeenCalledTimes(1));
    const [version, settings] = mocks.saveSpamGuardSettings.mock.calls[0];
    expect(version).toBe(4);
    expect(settings).toMatchObject({ mode: 'protect', sensitivity: 'balanced' });
  });

  it('changes sensitivity and pauses through the same save', async () => {
    await renderView();
    fireEvent.change(screen.getByLabelText('Sensitivity'), { target: { value: 'strict' } });
    await waitFor(() => expect(mocks.saveSpamGuardSettings).toHaveBeenCalledTimes(1));
    expect(mocks.saveSpamGuardSettings.mock.calls[0][1]).toMatchObject({ sensitivity: 'strict' });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(mocks.saveSpamGuardSettings).toHaveBeenCalledTimes(2));
    expect(mocks.saveSpamGuardSettings.mock.calls[1][1]).toMatchObject({ paused: true });
  });

  it('words health problems and warnings', async () => {
    const state = makeState();
    await renderView({
      ...state,
      mode: 'protect',
      health: { ...state.health, state: 'warn', warnings: ['host_not_armed'] },
    });
    expect(screen.getByText('Check')).toBeInTheDocument();
    expect(screen.getByText(/host repeater is not armed/)).toBeInTheDocument();
  });

  it('says so when Spam Guard is switched off, and locks the controls', async () => {
    const state = makeState();
    await renderView({
      ...state,
      enabled: false,
      health: { ...state.health, state: 'off', running: false },
    });
    expect(screen.getByText(/Spam Guard is switched off/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Protect' })).toBeDisabled();
  });

  it('refetches when a spam_guard event arrives', async () => {
    await renderView();
    expect(mocks.getSpamGuard).toHaveBeenCalledTimes(1);
    emitSpamGuardEvent({
      enabled: true,
      version: 4,
      mode: 'monitor',
      paused: false,
      backend: 'host',
      backend_state: 'off',
      blocks: 3,
      lockdown: false,
    });
    await waitFor(() => expect(mocks.getSpamGuard).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });

  it('shows a load error', async () => {
    mocks.getSpamGuard.mockRejectedValue(new Error('boom'));
    render(
      <I18nProvider>
        <SpamGuardView contacts={[]} channels={[]} />
      </I18nProvider>
    );
    expect(await screen.findByText('Could not load Spam Guard: boom')).toBeInTheDocument();
  });
});

describe('SpamGuardView protection', () => {
  it('words each block and its reason', async () => {
    await renderView();
    openTab(/Protection/);
    const rows = screen.getAllByTestId('spam-block');
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0]).getByText('Anything via repeater 27, except people it knows')
    ).toBeInTheDocument();
    expect(within(rows[0]).getByText('3 random-looking names')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Text "cheap radios today"')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Sent under 3 different names/)).toBeInTheDocument();
  });

  it('keeps routine duplicate blocks out of the list until asked', async () => {
    const state = makeState();
    await renderView({
      ...state,
      block_list: [
        ...state.block_list,
        block({
          key: 'text:dup',
          kind: 'text',
          value: 'evening all, anyone on tonight',
          channel: PUBLIC,
          reason: 'duplicate',
          source: 'dedupe',
          detail: {},
          gated: false,
          mode: null,
        }),
      ],
    });
    openTab(/Protection/);
    expect(screen.getByText('Active blocks (2)')).toBeInTheDocument();
    expect(screen.getAllByTestId('spam-block')).toHaveLength(2);
    fireEvent.click(screen.getByLabelText('Also show duplicate suppression (1)'));
    expect(screen.getAllByTestId('spam-block')).toHaveLength(3);
    expect(screen.getByText('Copies under other names are blocked | Public')).toBeInTheDocument();
  });

  it('removes, extends and observes a block', async () => {
    await renderView();
    openTab(/Protection/);
    const row = screen.getAllByTestId('spam-block')[0];
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith('unblock', { key: 'hop:27' }, undefined)
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Keep' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith(
        'extend',
        { key: 'hop:27', permanent: true },
        undefined
      )
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Observe only' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith(
        'block_action',
        { key: 'hop:27', observe: true },
        undefined
      )
    );
  });

  it('offers the first-hop mode on the host repeater only', async () => {
    await renderView();
    openTab(/Protection/);
    const row = screen.getAllByTestId('spam-block')[0];
    const select = within(row).getByRole('combobox');
    expect(within(select).getByText(/host repeater only/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'starts_at' } });
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith(
        'hop_mode',
        { key: 'hop:27', match: 'starts_at' },
        undefined
      )
    );
  });

  it('starts and ends a lockdown', async () => {
    await renderView();
    openTab(/Protection/);
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start lockdown' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith('lockdown', { minutes: 120 }, undefined)
    );
    // Monitor mode: the page says a lockdown blocks nothing yet.
    expect(screen.getByText(/nothing is actually blocked/)).toBeInTheDocument();
  });

  it('shows an active lockdown with a way to end it', async () => {
    const state = makeState();
    await renderView({
      ...state,
      lockdown: true,
      block_list: [
        block({
          key: 'lockdown',
          kind: 'lockdown',
          value: null,
          reason: 'lockdown',
          source: 'lockdown',
          detail: { minutes: 30 },
          mode: null,
        }),
      ],
    });
    openTab(/Protection/);
    expect(screen.getByText(/Lockdown active/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End lockdown' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith('lockdown', { minutes: 0 }, undefined)
    );
  });

  it('lets a held genuine sender through', async () => {
    await renderView();
    openTab(/Protection/);
    expect(screen.getByText('Possibly genuine, held')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Let through' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith(
        'not_spam',
        { sender: 'Newcomer', matched: 'hop:27' },
        77
      )
    );
  });

  it('blocks a repeater and a text by hand', async () => {
    await renderView();
    openTab(/Protection/);
    fireEvent.change(screen.getByLabelText('Repeater hash'), { target: { value: '5C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Block repeater' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith('block_hop', { hop: '5C' }, undefined)
    );
    const blockText = screen.getByRole('button', { name: 'Block text' });
    fireEvent.change(screen.getByLabelText(/Text \(at least 5/), { target: { value: 'abc' } });
    expect(blockText).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Text \(at least 5/), {
      target: { value: 'buy this now' },
    });
    fireEvent.click(blockText);
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith(
        'block_text',
        { text: 'buy this now', channel: PUBLIC },
        undefined
      )
    );
  });

  it('has no way to block a sender by name', async () => {
    await renderView();
    openTab(/Protection/);
    expect(screen.queryByRole('button', { name: /block sender/i })).toBeNull();
  });
});

describe('SpamGuardView messages', () => {
  it('shows the signals and feeds answers back with the message id', async () => {
    await renderView();
    openTab('Messages');
    const rows = screen.getAllByTestId('spam-message');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Random name')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Campaign')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/Caught by: Text "cheap radios today"/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Known')).toBeInTheDocument();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'This is spam' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith(
        'mark_spam',
        { text: 'evening all', channel: PUBLIC },
        90
      )
    );
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Not spam' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith(
        'not_spam',
        { sender: 'UD6DWREK', matched: 'text:abc' },
        91
      )
    );
  });

  it('lists campaigns and activity in words', async () => {
    await renderView();
    openTab('Messages');
    expect(screen.getByText('3 names, 3 messages')).toBeInTheDocument();
    expect(screen.getByText(/Started blocking hop:27/)).toBeInTheDocument();
  });
});

describe('SpamGuardView sources', () => {
  it('lists every repeater that fits a route code and maps the located ones', async () => {
    await renderView();
    openTab('Spam sources');
    const rows = screen.getAllByTestId('spam-source');
    expect(rows).toHaveLength(3);
    // Two repeaters share the code 27: both are listed, a non-repeater is not.
    expect(within(rows[0]).getByText('Hilltop, Valley')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Not in your contacts')).toBeInTheDocument();
    expect(within(rows[2]).getByText('direct')).toBeInTheDocument();
    expect(await screen.findByTestId('spam-map')).toHaveTextContent('Hilltop (27)');
  });

  it('blocks, unblocks and exempts a source', async () => {
    await renderView();
    openTab('Spam sources');
    const rows = screen.getAllByTestId('spam-source');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Unblock' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith('unblock', { key: 'hop:27' }, undefined)
    );
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Block' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith('block_hop', { hop: 'A1' }, undefined)
    );
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Never block' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith('allow_hop', { hop: 'A1' }, undefined)
    );
    // Heard directly: there is no repeater to act on.
    expect(within(rows[2]).queryByRole('button')).toBeNull();
  });
});

describe('SpamGuardView settings', () => {
  it('saves a changed tunable as an override and can reset it', async () => {
    await renderView();
    openTab('Settings');
    const save = screen.getByRole('button', { name: 'Save settings' });
    expect(save).toBeDisabled();

    const similarity = screen.getByLabelText('How similar counts as the same');
    expect(similarity).toHaveValue(65);
    fireEvent.change(similarity, { target: { value: '80' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(mocks.saveSpamGuardSettings).toHaveBeenCalledTimes(1));
    const [version, settings] = mocks.saveSpamGuardSettings.mock.calls[0];
    expect(version).toBe(4);
    expect(settings.overrides).toEqual({ similarity: 80 });

    // Back at the preset value is not an override any more.
    fireEvent.change(screen.getByLabelText('How similar counts as the same'), {
      target: { value: '65' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSpamGuardSettings).toHaveBeenCalledTimes(2));
    expect(mocks.saveSpamGuardSettings.mock.calls[1][1].overrides).toEqual({});
  });

  it('shows help and a watch-out note for every setting', async () => {
    await renderView();
    openTab('Settings');
    const setting = screen.getByTestId('spam-setting-dedupe_enabled');
    expect(
      within(setting).getByText('Only let the first copy of a message through')
    ).toBeInTheDocument();
    expect(within(setting).getByText(/^Watch out: /)).toBeInTheDocument();
    expect(screen.getAllByText(/^Watch out: /).length).toBeGreaterThanOrEqual(30);
  });

  it('protects another channel', async () => {
    await renderView();
    openTab('Settings');
    expect(screen.getByLabelText('Public')).toBeChecked();
    fireEvent.click(screen.getByLabelText('#other'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSpamGuardSettings).toHaveBeenCalledTimes(1));
    expect(mocks.saveSpamGuardSettings.mock.calls[0][1].channels).toEqual([
      { key: PUBLIC, name: 'Public' },
      { key: OTHER, name: '#other' },
    ]);
  });

  it('adds and removes exceptions at once', async () => {
    const state = makeState();
    await renderView({ ...state, settings: { ...state.settings, allow_senders: ['Sue'] } });
    openTab('Settings');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sue' }));
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith(
        'unallow_sender',
        { sender: 'Sue' },
        undefined
      )
    );
    fireEvent.change(screen.getByLabelText('Trusted names'), { target: { value: 'Dave' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    await waitFor(() =>
      expect(mocks.spamGuardAction).toHaveBeenCalledWith(
        'allow_sender',
        { sender: 'Dave' },
        undefined
      )
    );
  });

  it('previews the forwarding rules', async () => {
    mocks.getSpamGuardRules.mockResolvedValue({
      backend: 'host',
      before: [{ id: 'spam:text:abc', name: 'spam:text:abc' }],
      after: [],
      known_senders: ['Dave'],
      truncated: false,
    });
    await renderView();
    openTab('Settings');
    fireEvent.click(screen.getByRole('button', { name: 'Show rules' }));
    expect(
      await screen.findByText('1 before your rules, 0 after them, 1 known names')
    ).toBeInTheDocument();
    expect(mocks.getSpamGuardRules).toHaveBeenCalledWith(true);
    expect(screen.getByText(/spam:text:abc/)).toBeInTheDocument();
  });

  it('does not offer the first-hop match mode on an OpenHop radio', async () => {
    const state = makeState();
    await renderView({ ...state, backend: 'openhop', backend_state: 'idle' });
    openTab('Settings');
    const select = screen.getByLabelText('How to block a repeater');
    expect(within(select).queryByText(/host repeater only/)).toBeNull();
    expect(within(select).getByText(/recommended/)).toBeInTheDocument();
  });
});

const CLUB = 'CC'.repeat(16);
const WITH_CLUB = [...CHANNELS, { key: CLUB, name: 'Club' }] as Channel[];

function openHopState(
  overrides: Partial<SpamGuardState> = {},
  health: Partial<SpamGuardState['health']> = {}
): SpamGuardState {
  const state = makeState();
  return {
    ...state,
    backend: 'openhop',
    backend_state: 'synced',
    ...overrides,
    health: {
      ...state.health,
      backend: 'openhop',
      backend_state: 'synced',
      sync_state: 'synced',
      ...health,
    },
  };
}

describe('SpamGuardView on an OpenHop radio', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows where the rule sync stands and how often rules were put back', async () => {
    await renderView(
      openHopState({}, { rules_expected: 3, rules_present: 3, repairs: 2, last_sync_at: NOW - 30 })
    );
    expect(
      screen.getByText('Forwarding backend: OpenHop radio (rules in sync)')
    ).toBeInTheDocument();
    expect(screen.getByText('Forwarding rules in place: 3 of 3')).toBeInTheDocument();
    expect(
      screen.getByText('Rules put back after they were changed on the node: 2')
    ).toBeInTheDocument();
    expect(screen.getByText(/^Node last checked /)).toBeInTheDocument();
  });

  it('explains why nothing is written next to a real SpamGuard', async () => {
    await renderView(
      openHopState(
        { backend_state: 'refused' },
        { state: 'warn', warnings: ['openhop_spamguard_present'], sync_state: 'refused' }
      )
    );
    expect(screen.getByText('Forwarding backend: OpenHop radio (not syncing)')).toBeInTheDocument();
    expect(screen.getByText(/already has SpamGuard rules/)).toBeInTheDocument();
  });

  it.each([
    ['openhop_not_configured', /API address and token are not set/],
    ['openhop_sync_failed', /could not be synced to the OpenHop node/],
    ['openhop_key_not_shared', /private channel is not enforced on the OpenHop node/],
  ])('words the health issue %s', async (code, text) => {
    await renderView(openHopState({}, { state: 'warn', warnings: [code] }));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('asks before a private channel key is copied to the node', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const state = openHopState({ private_channels: [CLUB] });
    await renderView(
      {
        ...state,
        settings: {
          ...state.settings,
          channels: [
            { key: PUBLIC, name: 'Public', share_key: false },
            { key: CLUB, name: 'Club', share_key: false },
          ],
        },
      },
      WITH_CLUB
    );
    openTab('Settings');
    const share = screen.getByLabelText(/Also enforce on the OpenHop node/);
    expect(share).not.toBeChecked();

    fireEvent.click(share);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Club'));
    expect(share).not.toBeChecked();

    fireEvent.click(share);
    expect(share).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(mocks.saveSpamGuardSettings).toHaveBeenCalledTimes(1));
    expect(mocks.saveSpamGuardSettings.mock.calls[0][1].channels).toEqual([
      { key: PUBLIC, name: 'Public', share_key: false },
      { key: CLUB, name: 'Club', share_key: true },
    ]);
  });

  it('takes the agreement back without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const state = openHopState({ private_channels: [CLUB] });
    await renderView(
      {
        ...state,
        settings: {
          ...state.settings,
          channels: [
            { key: PUBLIC, name: 'Public' },
            { key: CLUB, name: 'Club', share_key: true },
          ],
        },
      },
      WITH_CLUB
    );
    openTab('Settings');
    const share = screen.getByLabelText(/Also enforce on the OpenHop node/);
    expect(share).toBeChecked();
    fireEvent.click(share);
    expect(share).not.toBeChecked();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('offers it for a private channel that is being added, off by default', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    await renderView(openHopState(), WITH_CLUB);
    openTab('Settings');
    expect(screen.queryByLabelText(/Also enforce on the OpenHop node/)).toBeNull();
    fireEvent.click(screen.getByLabelText('Club'));
    expect(screen.getByLabelText(/Also enforce on the OpenHop node/)).not.toBeChecked();
    expect(confirm).not.toHaveBeenCalled();
    // Public and hashtag channels have no secret key: nothing to agree to.
    fireEvent.click(screen.getByLabelText('#other'));
    expect(screen.getAllByLabelText(/Also enforce on the OpenHop node/)).toHaveLength(1);
  });

  it('does not bring it up on the host repeater', async () => {
    const state = makeState({ private_channels: [CLUB] });
    await renderView(
      {
        ...state,
        settings: {
          ...state.settings,
          channels: [
            { key: PUBLIC, name: 'Public' },
            { key: CLUB, name: 'Club' },
          ],
        },
      },
      WITH_CLUB
    );
    openTab('Settings');
    expect(screen.getByLabelText('Club')).toBeChecked();
    expect(screen.queryByLabelText(/Also enforce on the OpenHop node/)).toBeNull();
  });
});

const REPLAY_RESULT: SpamGuardReplayResult = {
  source: 'stored',
  scrambled: false,
  skipped: 0,
  messages: 120,
  first_ts: NOW - 3600,
  last_ts: NOW - 60,
  stopped: 31,
  flagged: 40,
  recorded_stopped: 12,
  blocks: { text: 2, hop: 1 },
  duplicate_blocks: 9,
  labels: { spam: 5, genuine: 2 },
  caught: 3,
  flagged_later: 1,
  missed: 1,
  passed: 1,
  wrongly_held: 1,
  missed_samples: [{ ts: NOW - 500, sender: 'TR9XK2LM', text: 'a one off advert', matched: null }],
  wrongly_held_samples: [{ ts: NOW - 400, sender: 'Dave', text: 'evening all', matched: 'hop:27' }],
};

describe('SpamGuardView evidence log', () => {
  beforeEach(() => {
    mocks.spamGuardEvidenceUrl.mockImplementation(
      (days: number, scramble: boolean) => `/evidence?days=${days}&scramble=${scramble}`
    );
    mocks.replaySpamGuard.mockResolvedValue(REPLAY_RESULT);
  });

  it('offers the evidence log switch and how long to keep it', async () => {
    await renderView();
    openTab('Settings');
    const log = screen.getByTestId('spam-setting-evidence_log');
    expect(within(log).getByText('Keep an evidence log')).toBeInTheDocument();
    expect(within(log).getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByTestId('spam-setting-evidence_days')).toBeInTheDocument();
  });

  it('links to the plain and the scrambled download for the chosen period', async () => {
    await renderView();
    openTab('Settings');
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/evidence?days=7&scramble=false'
    );
    fireEvent.change(screen.getByLabelText('Period'), { target: { value: '3' } });
    expect(screen.getByRole('link', { name: 'Download scrambled' })).toHaveAttribute(
      'href',
      '/evidence?days=3&scramble=true'
    );
  });

  it('replays the stored log with the settings in the form and shows the outcome', async () => {
    const state = makeState();
    await renderView(state);
    openTab('Settings');
    fireEvent.click(
      within(screen.getByTestId('spam-setting-dedupe_enabled')).getByRole('checkbox')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replay with the settings in this form' }));
    await waitFor(() => expect(mocks.replaySpamGuard).toHaveBeenCalledTimes(1));
    const body = mocks.replaySpamGuard.mock.calls[0][0];
    expect(body.days).toBe(7);
    expect(body.evidence).toBeUndefined();
    // The unsaved change in the form is what gets tried.
    expect(body.settings.overrides).toEqual({ dedupe_enabled: false });
    expect(mocks.saveSpamGuardSettings).not.toHaveBeenCalled();

    expect(await screen.findByText('120 messages replayed')).toBeInTheDocument();
    expect(screen.getByText('Stopped on arrival: 31 (at the time: 12)')).toBeInTheDocument();
    expect(screen.getByText('Flagged as spam: 40')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Of 5 messages you marked as spam: 3 stopped, 1 flagged afterwards, 1 missed'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Of 2 messages you marked as not spam: 1 let through, 1 wrongly held')
    ).toBeInTheDocument();
    expect(screen.getByText(/TR9XK2LM/)).toBeInTheDocument();
    expect(screen.getByText(/evening all/)).toBeInTheDocument();
  });

  it('replays an evidence file', async () => {
    mocks.replaySpamGuard.mockResolvedValue({
      ...REPLAY_RESULT,
      source: 'upload',
      scrambled: true,
      skipped: 2,
      labels: { spam: 0, genuine: 0 },
    });
    await renderView();
    openTab('Settings');
    fireEvent.click(screen.getByLabelText('An evidence file'));
    fireEvent.click(screen.getByRole('button', { name: 'Replay with the settings in this form' }));
    expect(await screen.findByText('Choose an evidence file first.')).toBeInTheDocument();
    expect(mocks.replaySpamGuard).not.toHaveBeenCalled();

    const file = new File(['{"type":"meta"}\n{"type":"msg"}\n'], 'evidence.jsonl');
    fireEvent.change(screen.getByLabelText('Evidence file'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Replay with the settings in this form' }));
    await waitFor(() => expect(mocks.replaySpamGuard).toHaveBeenCalledTimes(1));
    const body = mocks.replaySpamGuard.mock.calls[0][0];
    expect(body.evidence).toBe('{"type":"meta"}\n{"type":"msg"}\n');
    expect(body.days).toBeUndefined();
    expect(
      await screen.findByText('2 lines in the file were not usable and were skipped.')
    ).toBeInTheDocument();
    expect(screen.getByText(/This file is scrambled/)).toBeInTheDocument();
    expect(screen.getByText(/nothing to score against/)).toBeInTheDocument();
  });

  it('says why a replay failed', async () => {
    mocks.replaySpamGuard.mockRejectedValue(new Error('more than 20000 evidence records'));
    await renderView();
    openTab('Settings');
    fireEvent.click(screen.getByRole('button', { name: 'Replay with the settings in this form' }));
    expect(
      await screen.findByText('The replay failed: more than 20000 evidence records')
    ).toBeInTheDocument();
  });
});

describe('SpamGuardStatusLine', () => {
  it('says that the rules go to the node on an OpenHop radio', async () => {
    mocks.getSpamGuard.mockResolvedValue(
      makeState({ mode: 'protect', backend: 'openhop', backend_state: 'synced' })
    );
    render(
      <I18nProvider>
        <SpamGuardStatusLine />
      </I18nProvider>
    );
    expect(await screen.findByTestId('spam-guard-status-line')).toHaveTextContent(
      /written to this node's policy/
    );
  });

  it('summarises Spam Guard while it is on', async () => {
    mocks.getSpamGuard.mockResolvedValue(makeState({ mode: 'protect', blocks: 3 }));
    render(
      <I18nProvider>
        <SpamGuardStatusLine />
      </I18nProvider>
    );
    expect(await screen.findByTestId('spam-guard-status-line')).toHaveTextContent(
      'Spam Guard: Protect, 3 active blocks.'
    );
  });

  it('renders nothing while it is off', async () => {
    mocks.getSpamGuard.mockResolvedValue(makeState({ enabled: false }));
    const { container } = render(
      <I18nProvider>
        <SpamGuardStatusLine />
      </I18nProvider>
    );
    await waitFor(() => expect(mocks.getSpamGuard).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
