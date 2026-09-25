import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  OpenHopConditionBuilder,
  type ConditionVocabulary,
} from '../components/settings/openhop/OpenHopConditionBuilder';
import { OpenHopPolicyRules } from '../components/settings/openhop/OpenHopPolicyRules';
import { OpenHopRuleForm } from '../components/settings/openhop/OpenHopRuleForm';
import { HostRepeaterStatsPane } from '../components/settings/hostRepeater/HostRepeaterStatsPane';
import type { HostRepeaterStats, OpenHopPolicyEngine, OpenHopRule } from '../types';

const objects = { channel_hash_groups: {}, pubkey_groups: {} };

const hostVocabulary: ConditionVocabulary = {
  fields: ['payload_type', 'channel_sender', 'channel_name', 'region', 'path_first'],
  operators: ['equals', 'contains', 'matches'],
  ruleGates: true,
};

function rule(overrides: Partial<OpenHopRule> = {}): OpenHopRule {
  return {
    id: 'r1',
    name: 'Slow bob',
    enabled: true,
    if: { field: 'channel_sender', op: 'equals', value: 'bob' },
    then: { action: 'drop' },
    ...overrides,
  };
}

function engine(rules: OpenHopRule[]): OpenHopPolicyEngine {
  return { enabled: true, default_action: 'allow', rules, objects };
}

const stats: HostRepeaterStats = {
  active: true,
  since: 1_700_000_000,
  observed: 12,
  would_forward: 5,
  would_drop: 7,
  by_reason: { 'forward:flood': 5, policy_drop: 7 },
  by_type: {},
  policy_matches: { r1: 7 },
  policy_passes: { r1: 3 },
  saved_airtime_by_rule: { r1: 2140 },
  saved_airtime_by_reason: { policy_drop: 2140 },
  latency_ms: { count: 12, p50: 4, p95: 9, p99: 11, max: 12 },
  delay_ms: { count: 5, p50: 300, p95: 900, p99: 950, max: 960 },
  lock_busy: 0,
  airtime: {
    would_forward_total_ms: 1500,
    would_forward_last_minute_ms: 300,
    would_forward_last_hour_ms: 1500,
    would_forward_percent_last_hour: 0.04,
    saved_total_ms: 2140,
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
  lifetime: {
    since: 1_600_000_000,
    runs: 3,
    persisted: true,
    observed: 100,
    would_forward: 40,
    would_drop: 60,
    forward_airtime_total_ms: 9000,
    saved_airtime_total_ms: 5000,
    rx_delayed: 0,
    rx_delay_yielded: 0,
    by_reason: {},
    by_type: {},
    policy_matches: { r1: 20 },
    policy_passes: { r1: 9 },
    saved_airtime_by_rule: { r1: 5000 },
    saved_airtime_by_reason: { policy_drop: 5000 },
  },
  recent: [],
};

describe('host repeater policy rule gates', () => {
  it('hides prob and throttle for the OpenHop API vocabulary', () => {
    render(<OpenHopRuleForm rule={rule()} objects={objects} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByLabelText(/match probability/i)).toBeNull();
    expect(screen.queryByLabelText(/^throttle \(seconds\)/i)).toBeNull();
  });

  it('saves prob, throttle and throttle key when the vocabulary enables rule gates', async () => {
    const onSave = vi.fn();
    render(
      <OpenHopRuleForm
        rule={rule()}
        objects={objects}
        vocabulary={hostVocabulary}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/match probability/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/^throttle \(seconds\)/i), {
      target: { value: '60' },
    });
    await userEvent.selectOptions(screen.getByLabelText(/throttle budget/i), 'sender');
    await userEvent.click(screen.getByRole('button', { name: /save rule/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        then: { action: 'drop', prob: 50, throttle_seconds: 60, throttle_key: 'sender' },
      })
    );
  });

  it('drops the gate fields again when they are cleared', async () => {
    const onSave = vi.fn();
    render(
      <OpenHopRuleForm
        rule={rule({
          then: { action: 'drop', prob: 50, throttle_seconds: 60, throttle_key: 'sender' },
        })}
        objects={objects}
        vocabulary={hostVocabulary}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText(/match probability/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^throttle \(seconds\)/i), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: /save rule/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ then: { action: 'drop' } }));
  });

  it('shows per-rule hits, passes and saved airtime next to the rule', () => {
    render(
      <OpenHopPolicyRules
        engine={engine([rule({ then: { action: 'drop', prob: 50, throttle_seconds: 60 } })])}
        onChange={vi.fn()}
        vocabulary={hostVocabulary}
        ruleStats={{
          hits: stats.policy_matches,
          passes: stats.policy_passes,
          savedMs: stats.saved_airtime_by_rule,
        }}
      />
    );
    expect(screen.getByText(/7 hits/i)).toBeInTheDocument();
    expect(screen.getByText(/3 passes/i)).toBeInTheDocument();
    expect(screen.getByText(/2\.1 s saved/i)).toBeInTheDocument();
    expect(screen.getByText('prob 50%')).toBeInTheDocument();
    expect(screen.getByText('throttle 60 s')).toBeInTheDocument();
  });

  it('offers the matches operator and a payload type picker from the host vocabulary', async () => {
    const onChange = vi.fn();
    render(
      <OpenHopConditionBuilder
        value={{ field: 'channel_sender', op: 'equals', value: '' }}
        objects={objects}
        vocabulary={hostVocabulary}
        onChange={onChange}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText(/^operator$/i), 'matches');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ op: 'matches' }));
    onChange.mockClear();
    await userEvent.selectOptions(screen.getByLabelText(/^field$/i), 'payload_type');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: 'payload_type', value: '' })
    );
  });

  it('renders payload type names as the value picker', async () => {
    const onChange = vi.fn();
    render(
      <OpenHopConditionBuilder
        value={{ field: 'payload_type', op: 'equals', value: '' }}
        objects={objects}
        vocabulary={hostVocabulary}
        onChange={onChange}
      />
    );
    await userEvent.selectOptions(screen.getByLabelText(/^value$/i), '5');
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ value: '5' }));
    expect(screen.getByRole('option', { name: /GRP_TXT/ })).toBeInTheDocument();
  });

  it('shows the saved airtime in the session and lifetime blocks', () => {
    render(<HostRepeaterStatsPane stats={stats} onReset={vi.fn()} />);
    expect(screen.getByText(/saved airtime.*2140 ms/i)).toBeInTheDocument();
    expect(screen.getByText(/saved airtime.*5000 ms/i)).toBeInTheDocument();
  });
});
