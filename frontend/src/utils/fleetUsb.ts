/**
 * Reading a device and applying a config over a USB cable in this browser
 * (plan 32, Phase 3). The server decides what to send and what a reply means;
 * this only moves commands and replies between it and the device.
 */
import { api } from '../api';
import type {
  FleetApplyLogResult,
  FleetApplyPlan,
  FleetApplyStep,
  FleetDeviceReadPreview,
  FleetDeviceReplies,
} from '../types';

/** What sends one command and gives its reply (null: no answer). See SerialCli. */
export interface CommandSender {
  send(command: string): Promise<string | null>;
}

// A full read of an observer is three rounds; more means something is wrong.
const MAX_ROUNDS = 6;

export async function readDevice(
  cli: CommandSender,
  onProgress?: (sent: number) => void
): Promise<{ replies: FleetDeviceReplies; read: FleetDeviceReadPreview }> {
  const replies: FleetDeviceReplies = {};
  let sent = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const step = await api.fleetDeviceReadStep(replies);
    if (step.done && step.read) return { replies, read: step.read };
    for (const command of step.commands) {
      replies[command] = await cli.send(command);
      sent += 1;
      onProgress?.(sent);
    }
  }
  throw new Error('The device read did not finish');
}

export interface ApplyStepResult {
  step: FleetApplyStep;
  ok: boolean;
  reason: string | null;
  reply: string;
}

export interface ApplyOutcome {
  results: ApplyStepResult[];
  completed: boolean;
  stopped: { index: number; reason: string | null } | null;
  /** The log entry on the asset was written. */
  logged: boolean;
}

/**
 * Send the plan's commands one at a time. After each, read the setting back
 * and let the server check both; stop at the first that is not as expected.
 * The outcome is written to the asset's log, with the shown commands only.
 */
export async function runApply(
  cli: CommandSender,
  configId: number,
  plan: FleetApplyPlan,
  onStep: (result: ApplyStepResult) => void
): Promise<ApplyOutcome> {
  const results: ApplyStepResult[] = [];
  let stopped: ApplyOutcome['stopped'] = null;
  for (const step of plan.steps) {
    const reply = await cli.send(step.command);
    const readback: FleetDeviceReplies = {};
    if (reply !== null && step.check === 'value') {
      for (const command of step.readback) readback[command] = await cli.send(command);
    }
    const check = await api.checkFleetApplyStep(step, reply, readback);
    const result = { step, ok: check.ok, reason: check.reason, reply: check.reply };
    results.push(result);
    onStep(result);
    if (!check.ok) {
      stopped = { index: step.index, reason: check.reason };
      break;
    }
  }
  const logResults: FleetApplyLogResult[] = results.map((result) => ({
    display: result.step.display,
    ok: result.ok,
    reply: result.reply,
  }));
  let logged = true;
  try {
    await api.logFleetConfigApply(configId, {
      transport: 'usb_browser',
      total: plan.steps.length,
      results: logResults,
      stopped_reason: stopped?.reason ?? null,
      reboot_needed: plan.reboot && results.some((result) => result.ok && result.step.reboot),
    });
  } catch {
    logged = false;
  }
  return { results, completed: stopped === null, stopped, logged };
}
