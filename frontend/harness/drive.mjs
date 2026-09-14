/**
 * Minimal CDP driver: launches the Playwright-cached Chromium, loads the harness,
 * and evaluates assertions in-page. No dependencies - Node 22+ ships fetch/WebSocket.
 *
 * Usage: node harness/drive.mjs <harness-url>
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const URL_ARG = process.argv[2] ?? 'http://localhost:5199/';
const CHROME =
  process.env.CHROME_BIN ??
  `${process.env.HOME}/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`;
const PORT = 9333;

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--window-size=1000,700',
    // Start blank so the driver can enable Runtime before anything renders,
    // otherwise early console output is missed.
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws;
let nextId = 1;
const pending = new Map();

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ?? JSON.stringify(res.exceptionDetails)
    );
  }
  return res.result.value;
}

async function connect() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(100);
  }
  throw new Error('Chromium did not expose a debugging target');
}

async function main() {
  const wsUrl = await connect();
  ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });

  const consoleLines = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
  });
  globalThis.__consoleLines = consoleLines;

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_ARG });

  // Wait for the harness to mount and settle.
  for (let i = 0; i < 100; i++) {
    const ready = await evaluate(
      `!!document.querySelector('[data-message-id]') && !!window.__setHarness`
    ).catch(() => false);
    if (ready) break;
    await sleep(100);
  }
  await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);

  const script = process.env.HARNESS_SCRIPT;
  // A wedged page (render loop) would otherwise leave evaluate pending forever.
  const out = await Promise.race([
    evaluate(script),
    sleep(20000).then(() => {
      throw new Error('page did not respond within 20s (main thread wedged?)');
    }),
  ]);
  console.log(JSON.stringify(out, null, 2));
  if (process.env.HARNESS_CONSOLE === '1') {
    console.log('--- page console ---');
    for (const line of globalThis.__consoleLines) console.log('  ' + line);
  }

  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error('DRIVER ERROR:', err.message);
  chrome.kill();
  process.exit(1);
});
