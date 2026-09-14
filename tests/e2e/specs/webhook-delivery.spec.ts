import { test, expect } from '@playwright/test';
import http from 'http';
import {
  createFanoutConfig,
  deleteFanoutConfig,
  ensureFlightlessChannel,
  sendChannelMessage,
} from '../helpers/api';

/**
 * Spin up a local HTTP server that captures incoming webhook requests.
 * Returns the server, its URL, and a promise-based helper to wait for
 * the next request body.
 */
function createWebhookReceiver() {
  const requests: { body: string; headers: http.IncomingHttpHeaders }[] = [];
  let resolve: (() => void) | null = null;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ body, headers: req.headers });
      resolve?.();
      resolve = null;
      res.writeHead(200);
      res.end('ok');
    });
  });

  return {
    server,
    requests,
    /** Wait until at least `count` requests have been received. */
    waitForRequests(count: number, timeoutMs = 30_000): Promise<void> {
      if (requests.length >= count) return Promise.resolve();
      return new Promise<void>((res, rej) => {
        const timer = setTimeout(
          () => rej(new Error(`Timed out waiting for ${count} webhook request(s), got ${requests.length}`)),
          timeoutMs
        );
        const check = () => {
          if (requests.length >= count) {
            clearTimeout(timer);
            res();
          } else {
            resolve = check;
          }
        };
        resolve = check;
      });
    },
    /** Start listening on a random port and return the URL. */
    async listen(): Promise<string> {
      return new Promise((res) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address();
          if (typeof addr === 'object' && addr) {
            res(`http://127.0.0.1:${addr.port}`);
          }
        });
      });
    },
  };
}

test.describe('Webhook delivery', () => {
  let webhookId: string | null = null;
  let receiver: ReturnType<typeof createWebhookReceiver>;
  let webhookUrl: string;

  test.beforeAll(async () => {
    await ensureFlightlessChannel();
    receiver = createWebhookReceiver();
    webhookUrl = await receiver.listen();
  });

  test.afterAll(async () => {
    receiver.server.close();
    if (webhookId) {
      try {
        await deleteFanoutConfig(webhookId);
      } catch {
        // Best-effort cleanup
      }
    }
  });

  test('webhook receives message payload when a channel message is sent', async () => {
    // Create an enabled webhook pointing at our local receiver
    const webhook = await createFanoutConfig({
      type: 'webhook',
      name: 'E2E Delivery Test',
      config: { url: webhookUrl, method: 'POST', headers: {} },
      enabled: true,
    });
    webhookId = webhook.id;

    // Send a message via API - this triggers broadcast_event → fanout → webhook
    const channel = await ensureFlightlessChannel();
    const testText = `webhook-delivery-${Date.now()}`;
    await sendChannelMessage(channel.key, testText);

    // Wait for the webhook to receive the request
    await receiver.waitForRequests(1);

    const req = receiver.requests[0];
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-webhook-event']).toBe('message');

    const payload = JSON.parse(req.body);
    expect(payload.text).toContain(testText);
    expect(payload.type).toBe('CHAN');
    expect(payload.conversation_key).toBe(channel.key);
  });

  test('webhook respects HMAC signing when configured', async () => {
    // Clean up previous webhook
    if (webhookId) {
      await deleteFanoutConfig(webhookId);
    }

    const hmacSecret = 'e2e-test-secret';
    const webhook = await createFanoutConfig({
      type: 'webhook',
      name: 'E2E HMAC Test',
      config: {
        url: webhookUrl,
        method: 'POST',
        headers: {},
        hmac_secret: hmacSecret,
      },
      enabled: true,
    });
    webhookId = webhook.id;

    // Clear previous requests
    const baselineCount = receiver.requests.length;

    const channel = await ensureFlightlessChannel();
    const testText = `hmac-test-${Date.now()}`;
    await sendChannelMessage(channel.key, testText);

    await receiver.waitForRequests(baselineCount + 1);

    const req = receiver.requests[baselineCount];
    const signature = req.headers['x-webhook-signature'];
    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');
    expect((signature as string).startsWith('sha256=')).toBe(true);

    // Verify the HMAC is valid
    const crypto = await import('crypto');
    const expectedSig = crypto
      .createHmac('sha256', hmacSecret)
      .update(req.body)
      .digest('hex');
    expect(signature).toBe(`sha256=${expectedSig}`);
  });
});
