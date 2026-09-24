import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api';
import { HostRepeaterSettings } from '../components/settings/hostRepeater/HostRepeaterSettings';
import { toast } from '../components/ui/sonner';
import type {
  Contact,
  HealthStatus,
  HostRepeaterSettings as Settings,
  HostRepeaterState,
  HostRepeaterStats,
} from '../types';
import { emitHostRepeaterEvent } from '../utils/hostRepeaterEvents';

function health(is_openhop: boolean): HealthStatus {
  return {
    status: 'ok',
    radio_connected: true,
    radio_initializing: false,
    connection_info: 'TCP',
    radio_device_info: {
      model: is_openhop ? 'openHop-Repeater-Companion' : 'Heltec V3',
      firmware_build: 'b',
      firmware_version: '1.16',
      max_contacts: 350,
      max_channels: 40,
      is_meshcomod: false,
      is_openhop,
    },
    database_size_mb: 1,
  } as HealthStatus;
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    admin_enabled: false,
    shadow_enabled: false,
    auto_rearm_after_reconnect: false,
    tx_delay_factor: 1,
    direct_tx_delay_factor: 0.5,
    max_tx_delay_ms: 5000,
    max_forward_latency_ms: 5000,
    preamble_symbols: 16,
    duty_cycle_enforced: true,
    max_airtime_per_minute_ms: 3600,
    flood_max: 64,
    flood_max_unscoped: 64,
    flood_max_advert: 8,
    loop_detect: 'minimal',
    unscoped_flood_allow: true,
    regions: [],
    home_region: null,
    seen_ttl_seconds: 3600,
    filter_enabled: false,
    filter_acl_bypass: 'favorites',
    filter_min_hash_bytes: 1,
    filter_malformed: false,
    filter_types: { GRP_TXT: { hops_max: 32, rate_limit: 20, rate_secs: 60, soft: 0 } },
    filter_channels: [],
    dc_gate_enabled: false,
    dc_gate_threshold: 70,
    dc_gate_hysteresis: 10,
    arm_min_sub_band_percent: 1,
    max_pending_forwards: 20,
    max_in_flight: 2,
    policy: {
      enabled: false,
      default_action: 'allow',
      rules: [],
      objects: { channel_hash_groups: {}, pubkey_groups: {} },
    },
    ...overrides,
  };
}

function state(
  version: number,
  s: Settings = settings(),
  live: Partial<HostRepeaterState> = {}
): HostRepeaterState {
  return {
    version,
    settings: s,
    state: s.shadow_enabled ? 'shadow' : 'off',
    env_enabled: false,
    armed_since: null,
    disarm_reason: null,
    rearm_pending: false,
    capabilities: {
      connected: true,
      identity_known: true,
      firmware_ver_code: 13,
      raw_send_supported: true,
      firmware_repeat: false,
      openhop: false,
      freq_mhz: 869.618,
      sub_band_limit_percent: 10,
      arm_blockers: ['env_switch_off', 'admin_switch_off'],
    },
    ...live,
  };
}

/** A state where every arming precondition passes (env on, admin on, no blockers). */
function armable(version: number, extra: Partial<HostRepeaterState> = {}): HostRepeaterState {
  const base = state(version, settings({ admin_enabled: true, shadow_enabled: true }));
  return {
    ...base,
    env_enabled: true,
    capabilities: { ...base.capabilities, arm_blockers: [] },
    ...extra,
  };
}

const emptyStats: HostRepeaterStats = {
  active: true,
  since: 1_700_000_000,
  observed: 12,
  would_forward: 5,
  would_drop: 7,
  by_reason: { 'forward:flood': 5, duplicate: 7 },
  by_type: {},
  policy_matches: {},
  latency_ms: { count: 12, p50: 4, p95: 9, p99: 11, max: 12 },
  delay_ms: { count: 5, p50: 300, p95: 900, p99: 950, max: 960 },
  lock_busy: 0,
  airtime: {
    would_forward_total_ms: 1500,
    would_forward_last_minute_ms: 300,
    would_forward_last_hour_ms: 1500,
    would_forward_percent_last_hour: 0.04,
    budget_per_minute_ms: 3600,
    own_tx_last_hour_ms: 0,
    sub_band_limit_percent: 10,
  },
  echo: {
    gap_ms: { count: 0, p50: null, p95: null, p99: null, max: null },
    neighbour_before_our_tx: 0,
    neighbour_after_our_tx: 0,
    late_fraction: null,
  },
  invisible_rx: { samples: 0, radio_recv: 0, pushes: 0, estimate: null },
  rx_airtime_calibration: { model_ms: 0, radio_ms: 0, ratio: null },
  tx: {
    armed: false,
    armed_since: null,
    disarm_reason: null,
    rearm_pending: false,
    queued: 0,
    in_flight: 0,
    sent: 0,
    sent_airtime_ms: 0,
    send_errors: 0,
    table_full: 0,
    dropped_queue_full: 0,
    dropped_too_late: 0,
    dropped_lock_busy: 0,
    dropped_disarmed: 0,
    lock_retries: 0,
    last_error: null,
    last_sent_at: null,
  },
  recent: [],
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'validateHostRepeaterSettings').mockResolvedValue({ valid: true, errors: [] });
  vi.spyOn(api, 'getHostRepeaterStats').mockResolvedValue(emptyStats);
});

describe('HostRepeaterSettings', () => {
  it('shows a disabled option for OpenHop radios and never loads settings', () => {
    const get = vi.spyOn(api, 'getHostRepeater');
    render(<HostRepeaterSettings health={health(true)} floodScopeRegions={[]} repeaters={[]} />);

    expect(screen.getByRole('checkbox', { name: 'Shadow mode' })).toBeDisabled();
    expect(screen.getByText(/OpenHop already repeats packets itself/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('turns shadow mode on with the loaded version and then shows statistics', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(state(2));
    const save = vi
      .spyOn(api, 'saveHostRepeaterSettings')
      .mockResolvedValue(state(3, settings({ shadow_enabled: true })));
    render(
      <HostRepeaterSettings health={health(false)} floodScopeRegions={['nl']} repeaters={[]} />
    );

    const shadow = await screen.findByRole('checkbox', { name: 'Shadow mode' });
    expect(screen.getByText('State:').nextSibling).toHaveTextContent('Off');
    await userEvent.click(shadow);
    await userEvent.click(screen.getByRole('button', { name: 'Save host repeater settings' }));

    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toBe(2);
    expect(save.mock.calls[0][1].shadow_enabled).toBe(true);
    // The empty region list was pre-filled with the radio's flood scope.
    expect(save.mock.calls[0][1].regions).toEqual([
      { name: 'nl', parent: null, deny_flood: false },
    ]);
    expect(await screen.findByText('Shadow statistics')).toBeInTheDocument();
    expect(await screen.findByText('Would forward: 5')).toBeInTheDocument();
    expect(screen.getByText('Duplicate (already seen)')).toBeInTheDocument();
  });

  it('reloads the latest version after a 409 conflict', async () => {
    const get = vi
      .spyOn(api, 'getHostRepeater')
      .mockResolvedValueOnce(state(1))
      .mockResolvedValueOnce(state(4, settings({ flood_max: 10 })));
    vi.spyOn(api, 'saveHostRepeaterSettings').mockRejectedValue(new ApiError('stale', 409));
    render(<HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[]} />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Admin switch' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save host repeater settings' }));

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('checkbox', { name: 'Admin switch' })).not.toBeChecked();
  });

  it('shows validation errors instead of saving', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(state(1));
    vi.spyOn(api, 'validateHostRepeaterSettings').mockResolvedValue({
      valid: false,
      errors: [{ loc: 'flood_max', msg: 'Input should be less than or equal to 64' }],
    });
    const save = vi.spyOn(api, 'saveHostRepeaterSettings');
    render(<HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[]} />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Admin switch' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save host repeater settings' }));

    expect(await screen.findByText(/less than or equal to 64/)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('follows a change made in another browser when there are no local edits', async () => {
    const get = vi
      .spyOn(api, 'getHostRepeater')
      .mockResolvedValueOnce(state(1))
      .mockResolvedValueOnce(state(2, settings({ admin_enabled: true })));
    render(<HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[]} />);
    const admin = await screen.findByRole('checkbox', { name: 'Admin switch' });
    expect(admin).not.toBeChecked();

    act(() => {
      emitHostRepeaterEvent({
        version: 2,
        settings: settings({ admin_enabled: true }),
        state: 'off',
        env_enabled: false,
      });
    });

    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Admin switch' })).toBeChecked()
    );
  });

  it('keeps local edits and offers a reload when another browser saves', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(state(1));
    render(<HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[]} />);
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Admin switch' }));

    act(() => {
      emitHostRepeaterEvent({ version: 2, settings: settings(), state: 'off', env_enabled: false });
    });

    expect(
      await screen.findByText('These settings were changed in another browser.')
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Admin switch' })).toBeChecked();
  });

  it("pre-fills an empty region list with the radio's flood scopes without saving", async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(state(1));
    const save = vi.spyOn(api, 'saveHostRepeaterSettings');
    render(
      <HostRepeaterSettings
        health={health(false)}
        floodScopeRegions={['nl', 'be']}
        repeaters={[]}
      />
    );

    expect(await screen.findByText(/Pre-filled with the radio's flood scopes/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rule for region nl' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rule for region be' })).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('does not pre-fill when regions were already saved', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(
      state(1, settings({ regions: [{ name: 'de', parent: null, deny_flood: false }] }))
    );
    render(
      <HostRepeaterSettings health={health(false)} floodScopeRegions={['nl']} repeaters={[]} />
    );

    expect(await screen.findByRole('combobox', { name: 'Rule for region de' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Rule for region nl' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Pre-filled/)).not.toBeInTheDocument();
  });

  it('imports a region tree from a repeater only after confirmation', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(state(1));
    const fetchRegions = vi.spyOn(api, 'repeaterRegions').mockResolvedValue({
      regions: [
        { name: '*', depth: 0, flood_allowed: false, is_home: false },
        { name: 'nl', depth: 1, flood_allowed: true, is_home: false },
        { name: 'nl-nh', depth: 2, flood_allowed: true, is_home: true },
      ],
      raw: null,
      truncated: false,
      source: 'cli',
    });
    const repeater = { public_key: 'ab'.repeat(32), name: 'Hill', type: 2 } as Contact;
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(
      <HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[repeater]} />
    );

    await userEvent.selectOptions(
      await screen.findByLabelText('Import from a repeater'),
      repeater.public_key
    );
    const importButton = screen.getByRole('button', { name: 'Import' });
    await userEvent.click(importButton);
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetchRegions).not.toHaveBeenCalled();

    await userEvent.click(importButton);
    await waitFor(() => expect(fetchRegions).toHaveBeenCalledWith(repeater.public_key));
    expect(await screen.findByRole('combobox', { name: 'Parent of region nl-nh' })).toHaveValue(
      'nl'
    );
    expect(screen.getByLabelText('Home region')).toHaveValue('nl-nh');
    expect(
      screen.getByRole('checkbox', { name: 'Forward floods without a region' })
    ).not.toBeChecked();
  });

  it('hides the arm controls entirely while the server switch (env) is off', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(state(1));
    render(<HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[]} />);

    await screen.findByRole('checkbox', { name: 'Shadow mode' });
    expect(
      screen.getByText(/Server switch MESHCORE_HOST_REPEATER_ENABLED: off/)
    ).toBeInTheDocument();
    expect(screen.queryByText('Live repeating (armed mode)')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Arm live repeating...' })).not.toBeInTheDocument();
  });

  it('keeps Arm disabled and lists the blockers while a precondition fails', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(
      armable(1, {
        settings: settings({ admin_enabled: false, shadow_enabled: true }),
        capabilities: { ...armable(1).capabilities, arm_blockers: ['admin_switch_off'] },
      })
    );
    render(<HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[]} />);

    expect(await screen.findByRole('button', { name: 'Arm live repeating...' })).toBeDisabled();
    expect(screen.getByText(/admin switch is off/)).toBeInTheDocument();
  });

  it('arms only after the confirmation checkbox and shows the kill switch', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(armable(1));
    const setMode = vi.spyOn(api, 'setHostRepeaterMode').mockImplementation(async () => {
      // Once armed, the stats poll reports live forwards.
      vi.spyOn(api, 'getHostRepeaterStats').mockResolvedValue({
        ...emptyStats,
        tx: { ...emptyStats.tx!, armed: true, sent: 3, sent_airtime_ms: 360 },
      });
      return armable(1, { state: 'armed', armed_since: 1_700_000_000 });
    });
    const disarm = vi
      .spyOn(api, 'disarmHostRepeater')
      .mockResolvedValue(armable(1, { disarm_reason: 'user' }));
    render(<HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[]} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Arm live repeating...' }));
    const armNow = screen.getByRole('button', { name: 'Arm now' });
    expect(armNow).toBeDisabled();
    expect(screen.getByText(/retransmit other nodes' packets on 869.618 MHz/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('checkbox', { name: /I understand this transmits on air/ })
    );
    expect(armNow).toBeEnabled();
    expect(setMode).not.toHaveBeenCalled();

    await userEvent.click(armNow);
    await waitFor(() => expect(setMode).toHaveBeenCalledWith('armed', true));
    expect(await screen.findByText('Live repeating is ON')).toBeInTheDocument();
    expect(screen.getByText('State:').nextSibling).toHaveTextContent('Armed (live)');
    expect(screen.getByText('Live forwards')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Disarm (kill switch)' }));
    await waitFor(() => expect(disarm).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Disarmed: stopped by the operator/)).toBeInTheDocument();
    expect(screen.queryByText('Live repeating is ON')).not.toBeInTheDocument();
  });

  it('shows the blockers from a 409 when arming is refused', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(armable(1));
    vi.spyOn(api, 'setHostRepeaterMode').mockRejectedValue(
      new ApiError('cannot arm', 409, { message: 'cannot arm', blockers: ['firmware_repeat_on'] })
    );
    const errorToast = vi.spyOn(toast, 'error');
    render(<HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[]} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Arm live repeating...' }));
    await userEvent.click(
      screen.getByRole('checkbox', { name: /I understand this transmits on air/ })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Arm now' }));

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith('Could not arm the host repeater', {
        description: 'firmware client repeat is on',
      })
    );
    expect(screen.queryByText('Live repeating is ON')).not.toBeInTheDocument();
  });

  it('follows an armed state pushed by another browser even with local edits', async () => {
    vi.spyOn(api, 'getHostRepeater').mockResolvedValue(armable(1));
    render(<HostRepeaterSettings health={health(false)} floodScopeRegions={[]} repeaters={[]} />);
    await userEvent.click(
      await screen.findByRole('checkbox', { name: 'Re-arm after a radio reconnect' })
    );

    act(() => {
      emitHostRepeaterEvent({
        version: 2,
        settings: settings({ admin_enabled: true, shadow_enabled: true }),
        state: 'armed',
        env_enabled: true,
        armed_since: 1_700_000_000,
        disarm_reason: null,
        rearm_pending: false,
      });
    });

    expect(await screen.findByText('Live repeating is ON')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Re-arm after a radio reconnect' })).toBeChecked();
  });
});
