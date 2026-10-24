import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/I18nProvider';
import { PerformanceView } from '../components/PerformanceView';
import type { PerfHistory, PerfSnapshot, PerfSummary } from '../components/performance/perfTypes';

const mocks = vi.hoisted(() => ({
  getPerfSnapshot: vi.fn(),
  getPerfHistory: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks }));

const NOW = Math.floor(Date.now() / 1000);
const EMPTY: PerfSummary = { count: 0, p50: null, p95: null, max: null, avg: null };
const SOME: PerfSummary = { count: 10, p50: 1.2, p95: 4.1, max: 12, avg: 1.5 };

function snapshot(overrides: Partial<PerfSnapshot> = {}): PerfSnapshot {
  return {
    generated_at: NOW,
    health: {
      state: 'degraded',
      reasons: [{ key: 'loop_overdue', detail: 'bot_list_refresh', severity: 'degraded' }],
    },
    process: {
      pid: 1,
      python: '3.13.1',
      platform: 'Linux',
      started_at: NOW - 3600,
      uptime_s: 3600,
      cpu_percent: 7.4,
      cpu_seconds: 120,
      rss_mb: 186,
      threads: 23,
      fds: 141,
      load1: 0.42,
      host_cores: 4,
      host_mem_mb: 7800,
      mem_limit_mb: 512,
    },
    latest: null,
    loop: {
      lag: SOME,
      stalls: [
        {
          at: NOW - 60,
          duration_ms: 212,
          task: 'Task-7 (_loop)',
          stack: ['app/services/retention_pruner.py:42 in prune_once'],
        },
      ],
      stalls_last_hour: 1,
    },
    tasks: [
      {
        name: 'bot_list_refresh',
        state: 'overdue',
        every_s: 21600,
        running_since: null,
        last_start: NOW - 50000,
        last_duration_ms: 2400,
        p95_ms: 2400,
        runs: 3,
        errors: 1,
        last_error: 'TimeoutError: fetch',
        last_error_at: NOW - 50000,
        hourly: Array.from({ length: 24 }, () => ({ runs: 0, errors: 0, max_ms: null })),
      },
    ],
    asyncio_tasks: [{ name: 'Sampler._run', count: 1 }],
    pipeline: {
      per_minute: { received: 38, duplicate: 4, decrypted: 31, undecrypted: 7, malformed: 0 },
      total_received: 1000,
      stages: { parse: SOME, store: SOME, process: SOME, broadcast: SOME, total: SOME },
      by_type: [{ type: 'ADVERT', count: 500, avg_process_ms: 2.1 }],
      oldest_undecrypted: null,
    },
    database: {
      calls_per_minute: 412,
      read: { hold: SOME, wait: EMPTY },
      write: { hold: SOME, wait: SOME },
      slowest: [
        {
          caller: 'RawPacketRepository.create',
          kind: 'write',
          calls_last_hour: 2280,
          p95_ms: 9,
          max_ms: 40,
          wait_p95_ms: 1,
          errors: 0,
        },
      ],
      file_mb: 1840,
      wal_mb: 12,
      readers: 3,
      readers_busy: 1,
    },
    radio: {
      connected: true,
      desired: true,
      connection_info: 'Serial: /dev/ttyUSB0',
      hold: SOME,
      ops: [],
      errors: 0,
      reconnects: { attempts: 0, ok: 0 },
      last_reconnect_at: null,
    },
    outputs: {
      modules: [],
      websocket_clients: 2,
      tak_stream: { enabled: false, host: null, port: null, clients: 0 },
      push_subscriptions: 0,
    },
    routes: { all: SOME, routes: [] },
    logs: [
      {
        ts: NOW - 30,
        level: 'WARNING',
        logger: 'app.radio',
        message: 'radio command get_contacts took 1.94 s',
      },
    ],
    ...overrides,
  };
}

function renderView() {
  return render(
    <I18nProvider>
      <PerformanceView />
    </I18nProvider>
  );
}

describe('PerformanceView', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.getPerfSnapshot.mockResolvedValue(snapshot());
    const empty: PerfHistory = { range: '1h', step_s: 10, points: [] };
    mocks.getPerfHistory.mockResolvedValue(empty);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the health reason, an overdue loop and the pipeline', async () => {
    renderView();
    expect(await screen.findByText(/bot_list_refresh is overdue/)).toBeInTheDocument();
    expect(screen.getAllByText('bot_list_refresh').length).toBeGreaterThan(0);
    expect(screen.getByText('Packet pipeline', { selector: 'h3' })).toBeInTheDocument();
    expect(screen.getByText('RawPacketRepository.create')).toBeInTheDocument();
    expect(mocks.getPerfHistory).toHaveBeenCalledWith('1h');
  });

  it('shows what holds the radio and what waits for it', async () => {
    const base = snapshot();
    mocks.getPerfSnapshot.mockResolvedValue(
      snapshot({
        radio: {
          ...base.radio,
          queue: {
            holder: { name: 'send_channel_message', held_ms: 820 },
            waiting: [
              { name: 'retry_direct_message', waited_ms: 640 },
              { name: 'telemetry_poll', waited_ms: 120 },
            ],
          },
        },
      })
    );
    renderView();
    await screen.findByText('Process CPU');
    fireEvent.click(screen.getByRole('tab', { name: 'Radio link' }));

    expect(screen.getByText('Radio queue now')).toBeInTheDocument();
    expect(screen.getByText('send_channel_message')).toBeInTheDocument();
    expect(screen.getByText('Waiting #1:')).toBeInTheDocument();
    expect(screen.getByText('retry_direct_message')).toBeInTheDocument();
    expect(screen.getByText('telemetry_poll')).toBeInTheDocument();
  });

  it('says so when nothing uses the radio', async () => {
    const base = snapshot();
    mocks.getPerfSnapshot.mockResolvedValue(
      snapshot({ radio: { ...base.radio, queue: { holder: null, waiting: [] } } })
    );
    renderView();
    await screen.findByText('Process CPU');
    fireEvent.click(screen.getByRole('tab', { name: 'Radio link' }));
    expect(screen.getByText('Nothing is using the radio.')).toBeInTheDocument();
  });

  it('renders with empty history', async () => {
    renderView();
    expect(await screen.findByText('Process CPU')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'CPU' })).toBeInTheDocument();
  });

  it('switches tabs and ranges', async () => {
    renderView();
    await screen.findByText('Process CPU');

    fireEvent.click(screen.getByRole('tab', { name: 'Logs' }));
    expect(screen.getByText('radio command get_contacts took 1.94 s')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Event loop' }));
    expect(
      screen.getByText('app/services/retention_pruner.py:42 in prune_once')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(mocks.getPerfHistory).toHaveBeenCalledWith('7d'));
    expect(localStorage.getItem('rtfm-perf-range')).toBe('7d');
  });

  it('shows an error when the backend cannot be reached', async () => {
    mocks.getPerfSnapshot.mockRejectedValue(new Error('Network down'));
    renderView();
    expect(await screen.findByText(/Network down/)).toBeInTheDocument();
  });
});
