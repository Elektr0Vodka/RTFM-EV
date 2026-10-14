import { describe, expect, it } from 'vitest';

import {
  CommandRefusedError,
  SerialCli,
  commandAllowed,
  webSerialStatus,
  type SerialPortLike,
} from '../utils/serialCli';

type Responder = (command: string) => string | null;

/**
 * A port that answers like a repeater's console: it echoes the line, then
 * writes "  -> <reply>\r\n" (examples/simple_repeater/main.cpp). Output is cut
 * into small pieces so the reader has to put replies back together.
 */
function fakePort(respond: Responder, chunk = 3) {
  const written: string[] = [];
  let push: (text: string) => void = () => {};
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (text: string) => {
        for (let i = 0; i < text.length; i += chunk) {
          controller.enqueue(encoder.encode(text.slice(i, i + chunk)));
        }
      };
    },
  });
  const decoder = new TextDecoder();
  const writable = new WritableStream<Uint8Array>({
    write(data) {
      const text = decoder.decode(data);
      written.push(text);
      const command = text.replace(/\r$/, '');
      const reply = respond(command);
      setTimeout(() => {
        push(`${command}\r\n`);
        if (reply !== null) push(`  -> ${reply}\r\n`);
      }, 1);
    },
  });
  let opened = false;
  const port: SerialPortLike = {
    readable,
    writable,
    open: async () => {
      opened = true;
    },
    close: async () => {
      opened = false;
    },
  };
  return {
    port,
    written,
    push: (text: string) => push(text),
    isOpen: () => opened,
  };
}

const REPLIES: Record<string, string> = {
  ver: 'v1.14.0 (Build: 01-Sep-2026)',
  'get tx': '> 22',
  'filter hops': '[TYPE: MAX_HOPS]\n00: 8\n01: 8',
};

async function openCli(respond: Responder = (command) => REPLIES[command] ?? null, timeoutMs = 80) {
  const fake = fakePort(respond);
  const cli = new SerialCli(fake.port, { timeoutMs, gapMs: 0 });
  await cli.open();
  return { cli, fake };
}

describe('commandAllowed', () => {
  it.each([
    'ver',
    'board',
    'get name',
    'set tx 20',
    'set mqtt.origin',
    'filter',
    'filter hops 3 8',
    'filter channel add #test',
    'region',
    'region home nl',
    'region save',
  ])('allows %s', (command) => {
    expect(commandAllowed(command)).toBe(true);
  });

  it.each([
    'erase',
    'reboot',
    'advert',
    'start ota',
    'password x',
    'region put nl *',
    'region load',
    'filter reset',
    'set freq 869.5',
    'set name a\rerase',
    'get',
    ' ver',
    `set owner.info ${'x'.repeat(200)}`,
  ])('refuses %s', (command) => {
    expect(commandAllowed(command)).toBe(false);
  });
});

describe('SerialCli', () => {
  it('sends a line and returns the reply after the echo', async () => {
    const { cli, fake } = await openCli();

    expect(await cli.send('get tx')).toBe('> 22');
    expect(fake.written).toEqual(['get tx\r']);
    await cli.close();
    expect(fake.isOpen()).toBe(false);
  });

  it('keeps a reply of several lines together', async () => {
    const { cli } = await openCli();

    expect(await cli.send('filter hops')).toBe('[TYPE: MAX_HOPS]\n00: 8\n01: 8');
    await cli.close();
  });

  it('answers null when the device says nothing', async () => {
    const { cli } = await openCli();

    expect(await cli.send('get unknown')).toBeNull();
    // The next command still works.
    expect(await cli.send('ver')).toBe('v1.14.0 (Build: 01-Sep-2026)');
    await cli.close();
  });

  it('sends one command at a time, in order', async () => {
    const { cli, fake } = await openCli();

    const results = await Promise.all([cli.send('ver'), cli.send('get tx'), cli.send('ver')]);
    expect(results).toEqual([REPLIES.ver, '> 22', REPLIES.ver]);
    expect(fake.written).toEqual(['ver\r', 'get tx\r', 'ver\r']);
    await cli.close();
  });

  it('ignores what the device printed before the command', async () => {
    const { cli, fake } = await openCli();
    fake.push('boot noise  -> stale\r\n');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await cli.send('get tx')).toBe('> 22');
    await cli.close();
  });

  it('never writes a refused command', async () => {
    const { cli, fake } = await openCli();

    await expect(cli.send('erase')).rejects.toBeInstanceOf(CommandRefusedError);
    expect(fake.written).toEqual([]);
    await cli.close();
  });
});

describe('webSerialStatus', () => {
  it('says when the browser has no Web Serial', () => {
    expect(webSerialStatus({} as Navigator, true)).toBe('no_api');
    expect(webSerialStatus({ serial: {} } as unknown as Navigator, false)).toBe('insecure');
    expect(webSerialStatus({ serial: {} } as unknown as Navigator, true)).toBe('ok');
  });
});
