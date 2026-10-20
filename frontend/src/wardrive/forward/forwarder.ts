// Forwards one radio's queued receptions and tracks to one broker. Runs only
// while that radio is connected (a collector accepts the radio that signed
// in, with a token that radio signed) and the driver switched the broker on.
// A row is acknowledged in the queue only after the broker's PUBACK; any
// failure drops the connection and the next tick starts over.
import type { Queue, QueueKind } from '../queue';
import type { ObsMessage } from '../messages';
import type { Companion } from '../radio/companion';
import { destId, type Broker, type BrokerId } from './brokers';
import type { MqttCredentials, MqttLike } from './client';
import { observerPacket, observerTopic, obsTopic, trackTopic, withPubAt } from './payloads';
import type { BrokerSettings } from './settings';
import { brokerUsername, buildToken, tokenUsable } from './token';

const BATCH = 50;
const MAX_BATCHES_PER_TICK = 20;

export interface ForwardStatus {
  state: 'off' | 'connecting' | 'connected' | 'sign-failed' | 'error';
  pending: number;
  lastError?: string;
}

export interface ForwarderOptions {
  broker: Broker;
  radioKey: string;
  queue: Queue;
  companion: Companion;
  /** The radio's own name, sent as `origin` in the observer packets. */
  radioName?: string;
  connect: (url: string, creds: MqttCredentials) => Promise<MqttLike>;
  settings: () => BrokerSettings;
  saveToken: (key: string, token: string) => void;
  nowSec?: () => number;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Forwarder {
  private client: MqttLike | null = null;
  private running = false;
  /** Set by stop(): a forwarder is not reused once its broker is switched off. */
  private stopped = false;
  private state: ForwardStatus['state'] = 'off';
  private lastError: string | undefined;
  private readonly key: string;
  private readonly dest: string;

  constructor(private opts: ForwarderOptions) {
    this.key = opts.radioKey.toUpperCase();
    this.dest = destId(opts.broker.id, this.key);
  }

  private now(): number {
    return this.opts.nowSec ? this.opts.nowSec() : Math.floor(Date.now() / 1000);
  }

  private async credentials(): Promise<MqttCredentials | null> {
    const { broker, companion } = this.opts;
    if (broker.auth === 'password') {
      if (!broker.username || !broker.password) {
        this.state = 'error';
        this.lastError = 'No account set for this broker';
        return null;
      }
      return {
        username: broker.username,
        password: broker.password,
        clientId: `wardrive-${this.key.toLowerCase()}`,
      };
    }
    const audience = broker.audience;
    const tokenKey = `${audience}@${this.key}`;
    let token: string | undefined = this.opts.settings().tokens[tokenKey];
    if (!tokenUsable(token, this.key, audience, this.now())) {
      try {
        token = await buildToken(this.key, audience, this.now(), (b) => companion.sign(b));
      } catch (e) {
        this.state = 'sign-failed';
        this.lastError = errorText(e);
        return null;
      }
      this.opts.saveToken(tokenKey, token);
    }
    return {
      username: brokerUsername(this.key),
      password: token as string,
      // Its own client id, so a core-hunter session with the same radio on
      // the same collector is not kicked off.
      clientId: `wardrive-${this.key.toLowerCase()}`,
    };
  }

  private async ensureClient(): Promise<boolean> {
    if (this.client) return true;
    this.state = 'connecting';
    const creds = await this.credentials();
    if (!creds || this.stopped) return false;
    try {
      const client = await this.opts.connect(this.opts.broker.url, creds);
      if (this.stopped) {
        // Switched off while connecting: this session must not drain.
        await client.end().catch(() => undefined);
        return false;
      }
      client.onClose(() => {
        if (this.client === client) this.client = null;
      });
      this.client = client;
      return true;
    } catch (e) {
      this.state = 'error';
      this.lastError = errorText(e);
      return false;
    }
  }

  private topicFor(kind: QueueKind): string {
    const label = this.opts.broker.label ?? 'hunter';
    return kind === 'obs' ? obsTopic(label, this.key) : trackTopic(label, this.key);
  }

  /** Publishes one kind; false when a publish failed. */
  private async drain(kind: QueueKind): Promise<boolean> {
    const { broker, queue } = this.opts;
    if (broker.format === 'packets' && kind === 'track') {
      // An observer packets stream has no tracks: mark them done.
      await queue.ack(this.dest, kind, await queue.lastId(kind));
      return true;
    }
    for (let i = 0; i < MAX_BATCHES_PER_TICK; i++) {
      const rows = await queue.batchForRadio(this.dest, kind, this.key, BATCH);
      if (rows.length === 0) return true;
      for (const row of rows) {
        if (this.stopped || !this.client) return true;
        const topic =
          broker.format === 'packets'
            ? observerTopic(broker.region ?? 'nl', this.key)
            : this.topicFor(kind);
        const payload =
          broker.format === 'packets'
            ? observerPacket(row.message as ObsMessage, this.opts.radioName)
            : kind === 'obs'
              ? withPubAt(row.message as ObsMessage, new Date().toISOString())
              : row.message;
        try {
          await this.client!.publish(topic, JSON.stringify(payload));
        } catch (e) {
          this.lastError = errorText(e);
          return false;
        }
        await queue.ack(this.dest, kind, row.id);
      }
    }
    return true;
  }

  async tick(): Promise<ForwardStatus> {
    if (this.running) return this.status();
    this.running = true;
    try {
      if (!(await this.ensureClient())) {
        if (this.stopped) this.state = 'off';
        return await this.status();
      }
      for (const kind of ['obs', 'track'] as QueueKind[]) {
        if (!(await this.drain(kind))) {
          this.state = 'error';
          const client = this.client;
          this.client = null;
          await client?.end().catch(() => undefined);
          return await this.status();
        }
      }
      this.state = this.stopped ? 'off' : 'connected';
      this.lastError = undefined;
      return await this.status();
    } finally {
      this.running = false;
    }
  }

  async status(): Promise<ForwardStatus> {
    const { queue } = this.opts;
    const obs = await queue.countForRadio(this.dest, 'obs', this.key);
    const tracks =
      this.opts.broker.format === 'packets'
        ? 0
        : await queue.countForRadio(this.dest, 'track', this.key);
    return {
      state: this.state,
      pending: obs + tracks,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    this.client = null;
    this.state = 'off';
    await client?.end().catch(() => undefined);
  }
}

/** Switches a broker on for a radio. Like core-hunter, it gets what is heard
 * from then on, not the backlog. */
export async function enableBroker(
  queue: Queue,
  settings: BrokerSettings,
  id: BrokerId,
  radioKey: string
): Promise<BrokerSettings> {
  const dest = destId(id, radioKey);
  await queue.ack(dest, 'obs', await queue.lastId('obs'));
  await queue.ack(dest, 'track', await queue.lastId('track'));
  return { ...settings, enabled: { ...settings.enabled, [dest]: true } };
}

export function disableBroker(
  settings: BrokerSettings,
  id: BrokerId,
  radioKey: string
): BrokerSettings {
  const enabled = { ...settings.enabled };
  delete enabled[destId(id, radioKey)];
  return { ...settings, enabled };
}
