import { useEffect, useRef, useState } from 'react';
import { toast } from '../../ui/sonner';
import { Button } from '../../ui/button';
import { Checkbox } from '../../ui/checkbox';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Separator } from '../../ui/separator';
import { useT } from '../../../i18n';
import { useHostRepeater } from '../../../hooks/useHostRepeater';
import type {
  Contact,
  HealthStatus,
  HostRepeaterAclBypass,
  HostRepeaterLoopDetect,
  HostRepeaterSettings as Settings,
  HostRepeaterTypeLimits,
  OpenHopOperator,
} from '../../../types';
import { OpenHopPolicyEngineCard } from '../openhop/OpenHopPolicyEngineCard';
import { OpenHopPolicyRules } from '../openhop/OpenHopPolicyRules';
import type { ConditionVocabulary } from '../openhop/OpenHopConditionBuilder';
import { HostRepeaterStatsPane } from './HostRepeaterStatsPane';
import { HostRepeaterRegions } from './HostRepeaterRegions';

/** Policy fields the host evaluates (app/services/host_repeater_settings.py POLICY_FIELDS). */
const POLICY_VOCABULARY: ConditionVocabulary = {
  fields: [
    'route_type',
    'payload_type',
    'payload_length',
    'path_hash_size',
    'hop_count',
    'rssi',
    'snr',
    'channel_hash',
    'channel_sender',
    'channel_message_body',
    'channel_decryptable',
    'path_hashes',
    'transport_code_0',
    'transport_code_1',
    'payload_hex',
  ],
  operators: [
    'equals',
    'not_equals',
    'greater_than',
    'greater_or_equal',
    'less_than',
    'less_or_equal',
    'contains',
    'in',
    'intersects',
    'starts_with',
    'ends_with',
  ] satisfies OpenHopOperator[],
};

const LOOP_MODES: HostRepeaterLoopDetect[] = ['off', 'minimal', 'moderate', 'strict'];
const ACL_MODES: HostRepeaterAclBypass[] = ['off', 'contacts', 'favorites'];
const selectClass = 'rounded border border-input bg-background px-2 py-1 text-sm';

interface Props {
  health: HealthStatus | null;
  /** Region names the radio floods with; they pre-fill an empty region list. */
  floodScopeRegions: string[];
  /** Repeater contacts the region tree can be imported from. */
  repeaters: Contact[];
}

interface NumFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
  onChange: (v: number) => void;
}

function NumField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  hint,
  onChange,
}: NumFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        className="w-32"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface ToggleProps {
  id: string;
  label: string;
  desc?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}

function Toggle({ id, label, desc, checked, disabled, onChange }: ToggleProps) {
  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <div className="flex-1">
        <Label htmlFor={id}>{label}</Label>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
    </div>
  );
}

/**
 * Settings > Host repeater (plan 29, Phases 1-4): its own settings section.
 *
 * RTFM-EV itself acts as the repeater (firmware client repeat stays off). Shadow
 * mode judges and counts every received frame without transmitting. Armed mode
 * (Phase 3) forwards for real: it needs the server switch (env), the admin switch,
 * every capability check and an explicit confirmation here; the Disarm button is
 * the kill switch. OpenHop radios repeat internally, so the section is shown
 * disabled for them.
 */
export function HostRepeaterSettings({ health, floodScopeRegions, repeaters }: Props) {
  const t = useT();
  const isOpenHop = health?.radio_device_info?.is_openhop ?? false;
  const hr = useHostRepeater(!isOpenHop);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ loc: string; msg: string }[]>([]);
  const [prefilled, setPrefilled] = useState(false);
  const prefillDone = useRef(false);
  const [newChannelHash, setNewChannelHash] = useState('');
  const [newChannelLabel, setNewChannelLabel] = useState('');
  const [armOpen, setArmOpen] = useState(false);
  const [armAck, setArmAck] = useState(false);
  const [arming, setArming] = useState(false);

  // Pre-fill an empty, never-configured region list with the radio's flood scopes.
  // It only changes the draft; nothing applies until the operator saves.
  const { state: loadedState, draft: loadedDraft, update } = hr;
  useEffect(() => {
    if (prefillDone.current || !loadedState || !loadedDraft) return;
    prefillDone.current = true;
    if (
      loadedState.settings.regions.length === 0 &&
      loadedDraft.regions.length === 0 &&
      floodScopeRegions.length > 0
    ) {
      update({
        regions: floodScopeRegions.map((name) => ({ name, parent: null, deny_flood: false })),
      });
      setPrefilled(true);
    }
  }, [loadedState, loadedDraft, floodScopeRegions, update]);

  if (isOpenHop) {
    return (
      <div className="space-y-3" aria-disabled="true">
        <div className="flex items-start gap-2 opacity-60">
          <Checkbox id="host-repeater-openhop" className="mt-0.5" checked={false} disabled />
          <Label htmlFor="host-repeater-openhop">{t('settings_host_repeater_shadow_label')}</Label>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('settings_host_repeater_openhop_disabled')}
        </p>
      </div>
    );
  }

  const { state, draft } = hr;
  if (!state || !draft) {
    return (
      <div className="space-y-3">
        {hr.loadError && (
          <p className="text-sm text-destructive">
            {t('settings_host_repeater_load_error', { error: hr.loadError })}
          </p>
        )}
      </div>
    );
  }

  const caps = state.capabilities;
  const set = (patch: Partial<Settings>) => hr.update(patch);
  const setType = (name: string, patch: Partial<HostRepeaterTypeLimits>) =>
    set({
      filter_types: { ...draft.filter_types, [name]: { ...draft.filter_types[name], ...patch } },
    });

  const persist = async (next: Settings) => {
    setSaving(true);
    setErrors([]);
    try {
      const result = await hr.save(next);
      if (result.ok) {
        toast.success(t('settings_host_repeater_saved'));
      } else if (result.conflict) {
        toast.error(t('settings_host_repeater_conflict'));
        await hr.reload();
      } else {
        setErrors(result.errors);
        toast.error(t('settings_host_repeater_save_failed'), {
          description: result.message ?? undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const budgetPercent = (draft.max_airtime_per_minute_ms / 60000) * 100;
  const armBlockers = caps.arm_blockers;
  const armed = state.state === 'armed';
  const canArm = state.env_enabled && !armed && armBlockers.length === 0;

  const arm = async () => {
    setArming(true);
    try {
      const result = await hr.setMode('armed', true);
      if (result.ok) {
        toast.success(t('settings_host_repeater_armed_toast'));
        setArmOpen(false);
        setArmAck(false);
      } else {
        toast.error(t('settings_host_repeater_arm_failed'), {
          description:
            result.blockers.length > 0
              ? result.blockers.map((b) => t(`settings_host_repeater_blocker_${b}`)).join(', ')
              : (result.message ?? undefined),
        });
        await hr.reload();
      }
    } finally {
      setArming(false);
    }
  };

  const disarm = async () => {
    setArming(true);
    try {
      await hr.disarm();
      toast.success(t('settings_host_repeater_disarmed_toast'));
    } catch (err) {
      toast.error(t('settings_host_repeater_disarm_failed'), {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setArming(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('settings_host_repeater_intro')}</p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{t('settings_host_repeater_state_label')}</span>
        <span
          className={
            armed
              ? 'rounded bg-destructive/15 px-2 py-0.5 font-semibold text-destructive'
              : state.state === 'shadow'
                ? 'rounded bg-primary/15 px-2 py-0.5 text-primary'
                : 'rounded bg-muted px-2 py-0.5'
          }
        >
          {t(`settings_host_repeater_state_${state.state}`)}
        </span>
        <span className="text-xs text-muted-foreground">
          {armed
            ? t('settings_host_repeater_transmitting')
            : t('settings_host_repeater_no_transmit')}
        </span>
      </div>

      {caps.firmware_repeat && (
        <p className="rounded border border-destructive/40 p-2 text-sm text-destructive">
          {t('settings_host_repeater_firmware_repeat_on')}
        </p>
      )}

      <div className="grid gap-1 text-xs text-muted-foreground">
        <span>
          {t('settings_host_repeater_frequency', {
            freq: caps.freq_mhz != null ? caps.freq_mhz.toFixed(3) : '?',
            limit:
              caps.sub_band_limit_percent != null
                ? `${caps.sub_band_limit_percent}%`
                : t('settings_host_repeater_unknown'),
          })}
        </span>
        <span>
          {t(
            state.env_enabled ? 'settings_host_repeater_env_on' : 'settings_host_repeater_env_off'
          )}
        </span>
        {!armed && armBlockers.length > 0 && (
          <span>
            {t('settings_host_repeater_blockers', {
              list: armBlockers.map((b) => t(`settings_host_repeater_blocker_${b}`)).join(', '),
            })}
          </span>
        )}
        {!armed && state.disarm_reason && (
          <span className="text-warning" role="status">
            {t('settings_host_repeater_disarmed_because', {
              reason: t(`settings_host_repeater_disarm_${state.disarm_reason}`),
            })}
            {state.rearm_pending ? ` ${t('settings_host_repeater_rearm_pending')}` : ''}
          </span>
        )}
      </div>

      {/* Armed mode: arm (confirm first) / disarm (kill switch). Hidden entirely while the
          server switch (env) is off, so a browser alone can never bring it up. */}
      {state.env_enabled && (
        <div
          className={
            armed
              ? 'space-y-2 rounded border border-destructive/50 bg-destructive/10 p-3'
              : 'space-y-2 rounded border border-input p-3'
          }
        >
          {armed ? (
            <>
              <p className="text-sm font-semibold text-destructive">
                {t('settings_host_repeater_armed_banner')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('settings_host_repeater_armed_banner_desc')}
              </p>
              <Button
                type="button"
                variant="destructive"
                disabled={arming}
                onClick={() => void disarm()}
              >
                {t('settings_host_repeater_disarm')}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">{t('settings_host_repeater_arm_heading')}</p>
              <p className="text-xs text-muted-foreground">
                {t('settings_host_repeater_arm_desc')}
              </p>
              {!armOpen ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canArm || arming || hr.dirty}
                  title={hr.dirty ? t('settings_host_repeater_arm_save_first') : undefined}
                  onClick={() => setArmOpen(true)}
                >
                  {t('settings_host_repeater_arm')}
                </Button>
              ) : (
                <div className="space-y-2 rounded border border-destructive/40 p-3">
                  <p className="text-sm font-medium">
                    {t('settings_host_repeater_arm_confirm_title')}
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    <li>
                      {t('settings_host_repeater_arm_confirm_freq', {
                        freq: caps.freq_mhz != null ? caps.freq_mhz.toFixed(3) : '?',
                        limit:
                          caps.sub_band_limit_percent != null
                            ? `${caps.sub_band_limit_percent}%`
                            : '?',
                      })}
                    </li>
                    <li>
                      {t('settings_host_repeater_arm_confirm_budget', {
                        ms: draft.max_airtime_per_minute_ms,
                        percent: Number.isFinite(budgetPercent) ? budgetPercent.toFixed(1) : '?',
                      })}
                    </li>
                    <li>{t('settings_host_repeater_arm_confirm_stops')}</li>
                    <li>{t('settings_host_repeater_arm_confirm_firmware')}</li>
                    <li>{t('settings_host_repeater_arm_confirm_offgrid')}</li>
                  </ul>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="host-repeater-arm-ack"
                      className="mt-0.5"
                      checked={armAck}
                      onCheckedChange={(c) => setArmAck(c === true)}
                    />
                    <Label htmlFor="host-repeater-arm-ack" className="text-sm">
                      {t('settings_host_repeater_arm_ack')}
                    </Label>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={!armAck || !canArm || arming}
                      onClick={() => void arm()}
                    >
                      {arming
                        ? t('settings_host_repeater_arming')
                        : t('settings_host_repeater_arm_confirm_button')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={arming}
                      onClick={() => {
                        setArmOpen(false);
                        setArmAck(false);
                      }}
                    >
                      {t('settings_host_repeater_arm_cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <Toggle
        id="host-repeater-shadow"
        label={t('settings_host_repeater_shadow_label')}
        desc={t('settings_host_repeater_shadow_desc')}
        checked={draft.shadow_enabled}
        onChange={(v) => set({ shadow_enabled: v })}
      />
      <Toggle
        id="host-repeater-admin"
        label={t('settings_host_repeater_admin_label')}
        desc={t('settings_host_repeater_admin_desc')}
        checked={draft.admin_enabled}
        onChange={(v) => set({ admin_enabled: v })}
      />
      <Toggle
        id="host-repeater-rearm"
        label={t('settings_host_repeater_rearm_label')}
        desc={t('settings_host_repeater_rearm_desc')}
        checked={draft.auto_rearm_after_reconnect}
        onChange={(v) => set({ auto_rearm_after_reconnect: v })}
      />

      <details className="rounded border border-input p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          {t('settings_host_repeater_timing_heading')}
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <NumField
            id="hr-txdelay"
            label={t('settings_host_repeater_tx_delay_factor')}
            value={draft.tx_delay_factor}
            min={0}
            max={10}
            step={0.1}
            onChange={(v) => set({ tx_delay_factor: v })}
          />
          <NumField
            id="hr-direct-txdelay"
            label={t('settings_host_repeater_direct_tx_delay_factor')}
            value={draft.direct_tx_delay_factor}
            min={0}
            max={10}
            step={0.1}
            onChange={(v) => set({ direct_tx_delay_factor: v })}
          />
          <NumField
            id="hr-max-delay"
            label={t('settings_host_repeater_max_tx_delay')}
            value={draft.max_tx_delay_ms}
            min={0}
            max={30000}
            onChange={(v) => set({ max_tx_delay_ms: v })}
          />
          <NumField
            id="hr-max-latency"
            label={t('settings_host_repeater_max_latency')}
            hint={t('settings_host_repeater_max_latency_hint')}
            value={draft.max_forward_latency_ms}
            min={100}
            max={60000}
            onChange={(v) => set({ max_forward_latency_ms: v })}
          />
          <NumField
            id="hr-preamble"
            label={t('settings_host_repeater_preamble')}
            value={draft.preamble_symbols}
            min={6}
            max={65535}
            onChange={(v) => set({ preamble_symbols: v })}
          />
          <NumField
            id="hr-seen-ttl"
            label={t('settings_host_repeater_seen_ttl')}
            value={draft.seen_ttl_seconds}
            min={300}
            max={86400}
            onChange={(v) => set({ seen_ttl_seconds: v })}
          />
          <NumField
            id="hr-rx-delay-base"
            label={t('settings_host_repeater_rx_delay_base')}
            hint={t('settings_host_repeater_rx_delay_base_hint')}
            value={draft.rx_delay_base}
            min={0}
            max={20}
            step={0.5}
            onChange={(v) => set({ rx_delay_base: v })}
          />
          <Toggle
            id="hr-score-tx"
            label={t('settings_host_repeater_use_score_for_tx')}
            desc={t('settings_host_repeater_use_score_for_tx_desc')}
            checked={draft.use_score_for_tx}
            onChange={(v) => set({ use_score_for_tx: v })}
          />
          <NumField
            id="hr-max-pending"
            label={t('settings_host_repeater_max_pending')}
            hint={t('settings_host_repeater_max_pending_hint')}
            value={draft.max_pending_forwards}
            min={1}
            max={200}
            onChange={(v) => set({ max_pending_forwards: v })}
          />
          <NumField
            id="hr-max-in-flight"
            label={t('settings_host_repeater_max_in_flight')}
            hint={t('settings_host_repeater_max_in_flight_hint')}
            value={draft.max_in_flight}
            min={1}
            max={16}
            onChange={(v) => set({ max_in_flight: v })}
          />
          <NumField
            id="hr-arm-min-sub-band"
            label={t('settings_host_repeater_arm_min_sub_band')}
            hint={t('settings_host_repeater_arm_min_sub_band_hint')}
            value={draft.arm_min_sub_band_percent}
            min={0.1}
            max={100}
            step={0.1}
            onChange={(v) => set({ arm_min_sub_band_percent: v })}
          />
        </div>
      </details>

      <details className="rounded border border-input p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          {t('settings_host_repeater_duty_heading')}
        </summary>
        <div className="mt-3 space-y-3">
          <Toggle
            id="hr-duty-enforced"
            label={t('settings_host_repeater_duty_enforced')}
            checked={draft.duty_cycle_enforced}
            onChange={(v) => set({ duty_cycle_enforced: v })}
          />
          <NumField
            id="hr-airtime-minute"
            label={t('settings_host_repeater_airtime_per_minute')}
            hint={t('settings_host_repeater_airtime_per_minute_hint', {
              percent: Number.isFinite(budgetPercent) ? budgetPercent.toFixed(1) : '?',
            })}
            value={draft.max_airtime_per_minute_ms}
            min={0}
            max={60000}
            onChange={(v) => set({ max_airtime_per_minute_ms: v })}
          />
        </div>
      </details>

      <details className="rounded border border-input p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          {t('settings_host_repeater_parity_heading')}
        </summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <NumField
              id="hr-flood-max"
              label={t('settings_host_repeater_flood_max')}
              value={draft.flood_max}
              min={0}
              max={64}
              onChange={(v) => set({ flood_max: v })}
            />
            <NumField
              id="hr-flood-max-unscoped"
              label={t('settings_host_repeater_flood_max_unscoped')}
              value={draft.flood_max_unscoped}
              min={0}
              max={64}
              onChange={(v) => set({ flood_max_unscoped: v })}
            />
            <NumField
              id="hr-flood-max-advert"
              label={t('settings_host_repeater_flood_max_advert')}
              value={draft.flood_max_advert}
              min={0}
              max={64}
              onChange={(v) => set({ flood_max_advert: v })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="hr-loop">{t('settings_host_repeater_loop_detect')}</Label>
            <select
              id="hr-loop"
              className={selectClass}
              value={draft.loop_detect}
              onChange={(e) => set({ loop_detect: e.target.value as HostRepeaterLoopDetect })}
            >
              {LOOP_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`settings_host_repeater_loop_${m}`)}
                </option>
              ))}
            </select>
          </div>
          <Toggle
            id="hr-unscoped"
            label={t('settings_host_repeater_unscoped_allow')}
            desc={t('settings_host_repeater_unscoped_allow_desc')}
            checked={draft.unscoped_flood_allow}
            onChange={(v) => set({ unscoped_flood_allow: v })}
          />
        </div>
      </details>

      <details className="rounded border border-input p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          {t('settings_host_repeater_regions_heading')}
        </summary>
        <div className="mt-3 space-y-4">
          <HostRepeaterRegions
            draft={draft}
            onChange={set}
            repeaters={repeaters}
            prefilled={prefilled && hr.dirty}
          />
          <Separator />
          <p className="text-sm font-medium">{t('settings_host_repeater_gate_heading')}</p>
          <p className="text-xs text-muted-foreground">{t('settings_host_repeater_gate_desc')}</p>
          <Toggle
            id="hr-gate-enabled"
            label={t('settings_host_repeater_gate_enabled')}
            checked={draft.dc_gate_enabled}
            onChange={(v) => set({ dc_gate_enabled: v })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumField
              id="hr-gate-threshold"
              label={t('settings_host_repeater_gate_threshold')}
              value={draft.dc_gate_threshold}
              min={1}
              max={100}
              onChange={(v) => set({ dc_gate_threshold: v })}
            />
            <NumField
              id="hr-gate-hysteresis"
              label={t('settings_host_repeater_gate_hysteresis')}
              value={draft.dc_gate_hysteresis}
              min={0}
              max={50}
              onChange={(v) => set({ dc_gate_hysteresis: v })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {caps.sub_band_limit_percent != null && Number.isFinite(draft.dc_gate_threshold)
              ? t('settings_host_repeater_gate_budget', {
                  limit: `${caps.sub_band_limit_percent}%`,
                  seconds: Math.round(36 * caps.sub_band_limit_percent),
                  threshold: draft.dc_gate_threshold,
                  used: Math.round(0.36 * caps.sub_band_limit_percent * draft.dc_gate_threshold),
                })
              : t('settings_host_repeater_gate_unknown_band')}
          </p>
        </div>
      </details>

      <details className="rounded border border-input p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          {t('settings_host_repeater_advert_heading')}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">{t('settings_host_repeater_advert_desc')}</p>
          <Toggle
            id="hr-advert-enabled"
            label={t('settings_host_repeater_advert_enabled')}
            checked={draft.advert_limiter_enabled}
            onChange={(v) => set({ advert_limiter_enabled: v })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumField
              id="hr-advert-capacity"
              label={t('settings_host_repeater_advert_capacity')}
              value={draft.advert_bucket_capacity}
              min={1}
              max={100}
              onChange={(v) => set({ advert_bucket_capacity: v })}
            />
            <NumField
              id="hr-advert-refill-tokens"
              label={t('settings_host_repeater_advert_refill_tokens')}
              value={draft.advert_refill_tokens}
              min={1}
              max={100}
              onChange={(v) => set({ advert_refill_tokens: v })}
            />
            <NumField
              id="hr-advert-refill-interval"
              label={t('settings_host_repeater_advert_refill_interval')}
              value={draft.advert_refill_interval_seconds}
              min={60}
              max={604800}
              onChange={(v) => set({ advert_refill_interval_seconds: v })}
            />
            <NumField
              id="hr-advert-min-interval"
              label={t('settings_host_repeater_advert_min_interval')}
              value={draft.advert_min_interval_seconds}
              min={0}
              max={86400}
              onChange={(v) => set({ advert_min_interval_seconds: v })}
            />
          </div>
        </div>
      </details>

      <details className="rounded border border-input p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          {t('settings_host_repeater_filter_heading')}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">{t('settings_host_repeater_filter_desc')}</p>
          <Toggle
            id="hr-filter-enabled"
            label={t('settings_host_repeater_filter_enabled')}
            checked={draft.filter_enabled}
            onChange={(v) => set({ filter_enabled: v })}
          />
          <div className="space-y-1">
            <Label htmlFor="hr-acl">{t('settings_host_repeater_acl_bypass')}</Label>
            <select
              id="hr-acl"
              className={selectClass}
              value={draft.filter_acl_bypass}
              onChange={(e) => set({ filter_acl_bypass: e.target.value as HostRepeaterAclBypass })}
            >
              {ACL_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`settings_host_repeater_acl_${m}`)}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {t('settings_host_repeater_acl_bypass_desc')}
            </p>
          </div>
          <NumField
            id="hr-min-hash"
            label={t('settings_host_repeater_min_hash')}
            value={draft.filter_min_hash_bytes}
            min={1}
            max={3}
            onChange={(v) => set({ filter_min_hash_bytes: v })}
          />
          <Toggle
            id="hr-malformed"
            label={t('settings_host_repeater_malformed')}
            desc={t('settings_host_repeater_malformed_desc')}
            checked={draft.filter_malformed}
            onChange={(v) => set({ filter_malformed: v })}
          />
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pr-3">{t('settings_host_repeater_col_type')}</th>
                  <th className="pr-3">{t('settings_host_repeater_col_hops_max')}</th>
                  <th className="pr-3">{t('settings_host_repeater_col_rate_limit')}</th>
                  <th className="pr-3">{t('settings_host_repeater_col_rate_secs')}</th>
                  <th className="pr-3">{t('settings_host_repeater_col_soft')}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(draft.filter_types).map(([name, limits]) => (
                  <tr key={name}>
                    <td className="pr-3 font-mono text-xs">{name}</td>
                    {(['hops_max', 'rate_limit', 'rate_secs', 'soft'] as const).map((key) => (
                      <td key={key} className="pr-3 py-0.5">
                        <input
                          type="number"
                          aria-label={`${name} ${t(`settings_host_repeater_col_${key}`)}`}
                          className="w-20 rounded border border-input bg-background px-1 text-sm"
                          value={Number.isFinite(limits[key]) ? limits[key] : ''}
                          onChange={(e) =>
                            setType(name, {
                              [key]: e.target.value === '' ? NaN : Number(e.target.value),
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('settings_host_repeater_channels_heading')}</p>
            <ul className="space-y-1">
              {draft.filter_channels.map((entry, i) => (
                <li key={`${entry.hash}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="font-mono">{entry.hash}</span>
                  <span>{entry.label}</span>
                  <button
                    type="button"
                    className="text-xs text-destructive underline"
                    onClick={() =>
                      set({ filter_channels: draft.filter_channels.filter((_, k) => k !== i) })
                    }
                  >
                    {t('settings_host_repeater_channel_remove')}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label={t('settings_host_repeater_channel_hash_placeholder')}
                placeholder={t('settings_host_repeater_channel_hash_placeholder')}
                value={newChannelHash}
                onChange={(e) => setNewChannelHash(e.target.value)}
                className="w-24 font-mono"
              />
              <Input
                aria-label={t('settings_host_repeater_channel_label_placeholder')}
                placeholder={t('settings_host_repeater_channel_label_placeholder')}
                value={newChannelLabel}
                onChange={(e) => setNewChannelLabel(e.target.value)}
                className="w-40"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!/^[0-9a-fA-F]{2}$/.test(newChannelHash.trim())}
                onClick={() => {
                  set({
                    filter_channels: [
                      ...draft.filter_channels,
                      { hash: newChannelHash.trim().toLowerCase(), label: newChannelLabel.trim() },
                    ],
                  });
                  setNewChannelHash('');
                  setNewChannelLabel('');
                }}
              >
                {t('settings_host_repeater_channel_add')}
              </Button>
            </div>
          </div>
        </div>
      </details>

      <details className="rounded border border-input p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          {t('settings_host_repeater_policy_heading')}
        </summary>
        <div className="mt-3 space-y-4">
          <p className="text-xs text-muted-foreground">{t('settings_host_repeater_policy_desc')}</p>
          <OpenHopPolicyEngineCard engine={draft.policy} onChange={(p) => set({ policy: p })} />
          <OpenHopPolicyRules
            engine={draft.policy}
            vocabulary={POLICY_VOCABULARY}
            onChange={(p) => set({ policy: p })}
          />
        </div>
      </details>

      {hr.remoteChanged && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {t('settings_host_repeater_remote_changed')}{' '}
          <button type="button" className="underline" onClick={() => void hr.reload()}>
            {t('settings_host_repeater_reload')}
          </button>
        </p>
      )}
      {errors.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-destructive">
          {errors.map((e) => (
            <li key={`${e.loc}-${e.msg}`}>
              <span className="font-mono">{e.loc}</span>: {e.msg}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="button" disabled={!hr.dirty || saving} onClick={() => void persist(draft)}>
          {saving ? t('settings_host_repeater_saving') : t('settings_host_repeater_save')}
        </Button>
        <Button type="button" variant="outline" disabled={!hr.dirty || saving} onClick={hr.discard}>
          {t('settings_host_repeater_discard')}
        </Button>
      </div>

      {(state.state === 'shadow' || armed) && (
        <HostRepeaterStatsPane
          stats={hr.stats}
          onReset={(lifetime) => void hr.resetStats(lifetime)}
        />
      )}
    </div>
  );
}
