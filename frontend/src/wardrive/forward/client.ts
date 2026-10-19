// MQTT over WebSocket to one broker, behind a small interface so the
// forwarder can be tested without a broker.
import mqtt from 'mqtt';

/** How long a publish may wait for its PUBACK. */
export const ACK_TIMEOUT_MS = 10000;
const KEEPALIVE_S = 30;
const CONNECT_TIMEOUT_MS = 10000;
/** Our own limit on a connect attempt, on top of mqtt's CONNACK timeout. */
export const CONNECT_GIVE_UP_MS = 15000;

export interface MqttLike {
  /** Resolves on the broker's PUBACK (QoS 1); rejects after 10 s. */
  publish(topic: string, payload: string): Promise<void>;
  end(): Promise<void>;
  onClose(cb: () => void): void;
}

export interface MqttCredentials {
  username: string;
  password: string;
  clientId: string;
}

export async function connectMqtt(url: string, creds: MqttCredentials): Promise<MqttLike> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The broker did not answer')), CONNECT_GIVE_UP_MS);
  });
  // allowRetries false: a socket that closes before CONNACK (no network, DNS,
  // TLS, broker down) rejects the attempt. With the default, mqtt waits for a
  // reconnect that reconnectPeriod 0 never makes, and the promise never settles.
  const attempt = mqtt.connectAsync(
    url,
    {
      username: creds.username,
      password: creds.password,
      clientId: creds.clientId,
      clean: true,
      keepalive: KEEPALIVE_S,
      connectTimeout: CONNECT_TIMEOUT_MS,
      // The forwarder reconnects on its own tick, with a fresh token if needed.
      reconnectPeriod: 0,
    },
    false
  );
  let client: Awaited<typeof attempt>;
  try {
    client = await Promise.race([attempt, giveUp]);
  } catch (e) {
    // A connection that still comes up after we gave up is closed at once.
    attempt.then((late) => late.endAsync(true)).catch(() => undefined);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  // A keepalive timeout is emitted as 'error'; without a listener it throws.
  // The 'close' that follows is what the forwarder acts on.
  client.on('error', () => undefined);
  return {
    publish(topic, payload) {
      return new Promise((resolve, reject) => {
        // A broker that takes the connection but drops the message sends no
        // PUBACK; without a timeout the queue would wait for ever.
        const timer = setTimeout(
          () => reject(new Error('Publish not acknowledged')),
          ACK_TIMEOUT_MS
        );
        client.publish(topic, payload, { qos: 1 }, (err) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        });
      });
    },
    async end() {
      await client.endAsync(true);
    },
    onClose(cb) {
      client.on('close', cb);
    },
  };
}
