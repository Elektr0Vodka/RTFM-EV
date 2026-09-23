import type { Channel, Contact, HealthStatus, Message, MessagePath, RawPacket } from './types';

export interface MessageAckedPayload {
  message_id: number;
  ack_count: number;
  paths?: MessagePath[];
  packet_id?: number | null;
}

export interface MessageFailedPayload {
  message_id: number;
  failed_at: number;
}

export interface MessageDeletedPayload {
  message_id: number;
  type: 'PRIV' | 'CHAN';
  conversation_key: string;
}

export interface ContactDeletedPayload {
  public_key: string;
}

export interface ContactResolvedPayload {
  previous_public_key: string;
  contact: Contact;
}

export interface ChannelDeletedPayload {
  key: string;
}

export interface ToastPayload {
  message: string;
  details?: string;
}

/** A first-ever-seen contact, or a batched summary on a busy mesh.
 *
 * `batched=false` carries one contact's detail (`public_key`/`name`/`type`
 * set, `count` is always 1). `batched=true` is a summary only (those three
 * fields are null); `types` is a per-contact-type breakdown (e.g.
 * `{ "1": 2, "2": 1 }`) so the frontend can filter a batch by the user's
 * enabled notification types without per-node detail.
 */
export interface NewNodePayload {
  batched: boolean;
  count: number;
  public_key: string | null;
  name: string | null;
  type: number | null;
  types: Record<string, number>;
}

export type KnownWsEvent =
  | { type: 'health'; data: HealthStatus }
  | { type: 'message'; data: Message }
  | { type: 'contact'; data: Contact }
  | { type: 'contact_resolved'; data: ContactResolvedPayload }
  | { type: 'channel'; data: Channel }
  | { type: 'contact_deleted'; data: ContactDeletedPayload }
  | { type: 'channel_deleted'; data: ChannelDeletedPayload }
  | { type: 'raw_packet'; data: RawPacket }
  | { type: 'message_acked'; data: MessageAckedPayload }
  | { type: 'message_failed'; data: MessageFailedPayload }
  | { type: 'message_deleted'; data: MessageDeletedPayload }
  | { type: 'new_node'; data: NewNodePayload }
  | { type: 'error'; data: ToastPayload }
  | { type: 'success'; data: ToastPayload }
  | { type: 'pong'; data?: null };

export interface UnknownWsEvent {
  type: 'unknown';
  rawType: string;
  data: unknown;
}

export type ParsedWsEvent = KnownWsEvent | UnknownWsEvent;

interface RawWsEnvelope {
  type?: unknown;
  data?: unknown;
}

export function parseWsEvent(raw: string): ParsedWsEvent {
  const parsed: RawWsEnvelope = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
    throw new Error('Invalid WebSocket event envelope');
  }

  switch (parsed.type) {
    case 'health':
    case 'message':
    case 'contact':
    case 'contact_resolved':
    case 'channel':
    case 'contact_deleted':
    case 'channel_deleted':
    case 'raw_packet':
    case 'message_acked':
    case 'message_failed':
    case 'message_deleted':
    case 'new_node':
    case 'error':
    case 'success':
      return {
        type: parsed.type,
        data: parsed.data,
      } as KnownWsEvent;
    case 'pong':
      return { type: 'pong', data: parsed.data as null | undefined };
    default:
      return {
        type: 'unknown',
        rawType: parsed.type,
        data: parsed.data,
      };
  }
}
