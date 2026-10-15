import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SensorDashboardBody } from '../components/repeater/SensorDashboardBody';
import { SensorMmaPane } from '../components/repeater/SensorMmaPane';
import type { UseRepeaterDashboardResult } from '../hooks/useRepeaterDashboard';
import type { Contact, Conversation } from '../types';

const IDLE = { loading: false, attempt: 0, error: null };

const mockHook: {
  -readonly [K in keyof UseRepeaterDashboardResult]: UseRepeaterDashboardResult[K];
} = {
  loggedIn: false,
  loginLoading: false,
  loginError: null,
  lastLoginAttempt: null,
  paneData: {
    status: null,
    nodeInfo: null,
    neighbors: null,
    acl: null,
    radioSettings: null,
    advertIntervals: null,
    ownerInfo: null,
    lppTelemetry: null,
    regions: null,
    mma: null,
  },
  paneStates: {
    status: IDLE,
    nodeInfo: IDLE,
    neighbors: IDLE,
    acl: IDLE,
    radioSettings: IDLE,
    advertIntervals: IDLE,
    ownerInfo: IDLE,
    lppTelemetry: IDLE,
    regions: IDLE,
    mma: IDLE,
  },
  consoleHistory: [],
  consoleLoading: false,
  login: vi.fn(),
  loginAsGuest: vi.fn(),
  refreshPane: vi.fn(),
  loadAll: vi.fn(),
  sendConsoleCommand: vi.fn(),
  sendZeroHopAdvert: vi.fn(),
  sendFloodAdvert: vi.fn(),
  rebootRepeater: vi.fn(),
  syncClock: vi.fn(),
  readSettings: vi.fn(),
  applySetting: vi.fn(),
};

const hookCalls: unknown[][] = [];
vi.mock('../hooks/useRepeaterDashboard', () => ({
  useRepeaterDashboard: (...args: unknown[]) => {
    hookCalls.push(args);
    return mockHook;
  },
}));

vi.mock('../api', () => ({
  api: {
    repeaterTelemetryHistory: vi.fn().mockResolvedValue([]),
    repeaterConfigHistory: vi.fn().mockResolvedValue([]),
    repeaterNeighborHistory: vi.fn().mockResolvedValue({ neighbors: [] }),
    setContactRoutingOverride: vi.fn().mockResolvedValue({ status: 'ok' }),
    getSensorPush: vi.fn().mockResolvedValue({
      public_key: 'bb'.repeat(32),
      enabled: false,
      thresholds: [],
      threshold_bytes: 0,
      max_threshold_bytes: 14,
      supported_types: {},
      granted_until: null,
      scope_name: null,
      last_push_at: null,
      last_error: null,
    }),
  },
}));

vi.mock('../components/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const SENSOR_KEY = 'bb'.repeat(32);
const conversation: Conversation = { type: 'contact', id: SENSOR_KEY, name: 'Garden sensor' };
const sensor = {
  public_key: SENSOR_KEY,
  name: 'Garden sensor',
  type: 4,
  flags: 0,
  direct_path: null,
  direct_path_len: -1,
  direct_path_hash_mode: 0,
  last_advert: null,
  lat: null,
  lon: null,
  last_seen: null,
  on_radio: false,
  favorite: false,
  radio_policy: 'auto',
  last_contacted: null,
  last_read_at: null,
  first_seen: null,
} as Contact;

describe('sensor dashboard', () => {
  beforeEach(() => {
    hookCalls.length = 0;
    mockHook.loggedIn = true;
  });

  it('runs the dashboard hook with the sensor role', () => {
    render(<SensorDashboardBody conversation={conversation} contacts={[sensor]} />);
    const options = hookCalls[hookCalls.length - 1][1] as { role?: string };
    expect(options.role).toBe('sensor');
  });

  it('shows sensor panes, not repeater-only ones', () => {
    render(<SensorDashboardBody conversation={conversation} contacts={[sensor]} />);
    expect(screen.getByText('Min / max / average (24 h)')).toBeInTheDocument();
    expect(screen.getByText('LPP Sensors')).toBeInTheDocument();
    expect(screen.queryByText('Neighbors')).toBeNull();
  });

  it('shows the login form while logged out', () => {
    mockHook.loggedIn = false;
    render(<SensorDashboardBody conversation={conversation} contacts={[sensor]} />);
    expect(screen.queryByText('Min / max / average (24 h)')).toBeNull();
  });
});

describe('SensorMmaPane', () => {
  it('lists channels with min, max and avg', () => {
    render(
      <SensorMmaPane
        data={{
          hours: 24,
          entries: [{ channel: 1, type_name: 'temperature', min: 10.5, max: 21, avg: 15.2 }],
        }}
        state={IDLE}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText(/temperature/i)).toBeInTheDocument();
    expect(screen.getByText('15.2')).toBeInTheDocument();
  });

  it('says when there is no data', () => {
    render(<SensorMmaPane data={{ hours: 24, entries: [] }} state={IDLE} onRefresh={vi.fn()} />);
    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });
});
