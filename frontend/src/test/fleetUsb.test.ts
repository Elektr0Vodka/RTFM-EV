import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FleetApplyPlan, FleetApplyStep } from '../types';
import { readDevice, runApply } from '../utils/fleetUsb';

const mocks = vi.hoisted(() => ({
  fleetDeviceReadStep: vi.fn(),
  checkFleetApplyStep: vi.fn(),
  logFleetConfigApply: vi.fn(),
}));

vi.mock('../api', () => ({ api: mocks }));

const READ = {
  identity: { public_key: 'ab'.repeat(32), role: 'repeater', firmware_version: 'v1.14.0' },
  profile: 'stock',
  document: { vars: { name: 'NL-TST-RPT' } },
  secrets: 0,
  warnings: [],
};

function fakeCli(replies: Record<string, string | null>) {
  const sent: string[] = [];
  return {
    sent,
    cli: {
      send: vi.fn(async (command: string) => {
        sent.push(command);
        return command in replies ? replies[command] : `??: ${command}`;
      }),
    },
  };
}

function step(index: number, overrides: Partial<FleetApplyStep> = {}): FleetApplyStep {
  return {
    index,
    section: 'vars',
    path: ['vars', 'tx'],
    command: `set tx ${index}`,
    display: `set tx ${index}`,
    secret: false,
    reboot: false,
    readback: ['get tx'],
    expect: index,
    check: 'value',
    ...overrides,
  };
}

function plan(steps: FleetApplyStep[], reboot = false): FleetApplyPlan {
  return {
    identity: READ.identity as FleetApplyPlan['identity'],
    steps,
    rows: [],
    reboot,
    rekey: false,
    vault: 'off',
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('readDevice', () => {
  it('asks the server round by round and sends each command once', async () => {
    mocks.fleetDeviceReadStep
      .mockResolvedValueOnce({ done: false, commands: ['ver', 'get role'], read: null })
      .mockResolvedValueOnce({ done: false, commands: ['get name'], read: null })
      .mockResolvedValueOnce({ done: true, commands: [], read: READ });
    const { cli, sent } = fakeCli({ ver: 'v1.14.0', 'get role': '> repeater', 'get name': null });
    const progress = vi.fn();

    const result = await readDevice(cli, progress);

    expect(sent).toEqual(['ver', 'get role', 'get name']);
    expect(result.read).toEqual(READ);
    expect(result.replies).toEqual({ ver: 'v1.14.0', 'get role': '> repeater', 'get name': null });
    expect(mocks.fleetDeviceReadStep).toHaveBeenLastCalledWith(result.replies);
    expect(progress).toHaveBeenLastCalledWith(3);
  });

  it('gives up when the rounds do not end', async () => {
    mocks.fleetDeviceReadStep.mockResolvedValue({ done: false, commands: ['ver'], read: null });
    const { cli } = fakeCli({});

    await expect(readDevice(cli)).rejects.toThrow();
  });
});

describe('runApply', () => {
  it('sends each command, reads it back, checks it and writes the log', async () => {
    mocks.checkFleetApplyStep.mockResolvedValue({ ok: true, reason: null, reply: 'OK' });
    mocks.logFleetConfigApply.mockResolvedValue({ id: 1 });
    const { cli, sent } = fakeCli({ 'set tx 0': 'OK', 'set tx 1': 'OK', 'get tx': '> 1' });
    const onStep = vi.fn();

    const outcome = await runApply(
      cli,
      12,
      plan([step(0), step(1, { reboot: true })], true),
      onStep
    );

    expect(sent).toEqual(['set tx 0', 'get tx', 'set tx 1', 'get tx']);
    expect(mocks.checkFleetApplyStep).toHaveBeenCalledWith(step(1, { reboot: true }), 'OK', {
      'get tx': '> 1',
    });
    expect(outcome).toMatchObject({ completed: true, stopped: null, logged: true });
    expect(onStep).toHaveBeenCalledTimes(2);
    expect(mocks.logFleetConfigApply).toHaveBeenCalledWith(12, {
      transport: 'usb_browser',
      total: 2,
      results: [
        { display: 'set tx 0', ok: true, reply: 'OK' },
        { display: 'set tx 1', ok: true, reply: 'OK' },
      ],
      stopped_reason: null,
      reboot_needed: true,
    });
  });

  it('stops at the first unexpected reply and sends nothing after it', async () => {
    mocks.checkFleetApplyStep
      .mockResolvedValueOnce({ ok: true, reason: null, reply: 'OK' })
      .mockResolvedValueOnce({ ok: false, reason: 'unexpected_reply', reply: 'Error' });
    mocks.logFleetConfigApply.mockResolvedValue({ id: 1 });
    const { cli, sent } = fakeCli({ 'set tx 0': 'OK', 'set tx 1': 'Error', 'get tx': '> 0' });

    const outcome = await runApply(cli, 12, plan([step(0), step(1), step(2)]), vi.fn());

    expect(sent).toEqual(['set tx 0', 'get tx', 'set tx 1', 'get tx']);
    expect(outcome).toMatchObject({
      completed: false,
      stopped: { index: 1, reason: 'unexpected_reply' },
    });
    expect(mocks.logFleetConfigApply.mock.calls[0][1]).toMatchObject({
      total: 3,
      stopped_reason: 'unexpected_reply',
    });
  });

  it('does not read back a step that cannot be read back', async () => {
    mocks.checkFleetApplyStep.mockResolvedValue({ ok: true, reason: null, reply: 'OK' });
    mocks.logFleetConfigApply.mockResolvedValue({ id: 1 });
    const { cli, sent } = fakeCli({ 'region save': 'OK' });

    await runApply(
      cli,
      12,
      plan([
        step(0, { command: 'region save', display: 'region save', readback: [], check: 'reply' }),
      ]),
      vi.fn()
    );

    expect(sent).toEqual(['region save']);
  });

  it('says so when the log could not be written', async () => {
    mocks.checkFleetApplyStep.mockResolvedValue({ ok: true, reason: null, reply: 'OK' });
    mocks.logFleetConfigApply.mockRejectedValue(new Error('offline'));
    const { cli } = fakeCli({ 'set tx 0': 'OK', 'get tx': '> 0' });

    const outcome = await runApply(cli, 12, plan([step(0)]), vi.fn());

    expect(outcome).toMatchObject({ completed: true, logged: false });
  });
});
