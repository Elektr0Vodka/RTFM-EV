// Auto-discover: the page's only transmitting function, as rx.mesh-hunter.eu
// runs it (core-hunter app.js autoPingTick and friends). Off until the driver
// switches it on, for the radio it was made for; the page makes a new one
// per connection and never stores the switch.
//
// Each cycle (gate.ts: 10 s or 50 m, never inside the airtime floor, never
// while trace pings are queued):
//   1. a Discover request, zero-hop;
//   2. our own advert, zero-hop, with Introduce my node on and a companion
//      picked (it has to hear us before it answers a request);
//   3. a trace ping to each picked repeater, or a sweep of up to four heard
//      repeaters, 1.5 s apart;
//   4. at most one directed ask: telemetry to a picked companion, or an
//      anonymous request (regions, owner) to a picked repeater, at zero hop
//      (contactPath.ts), taking turns.
// A frame joins the airtime count only when the radio took it.
import type { Sender } from '../decode/reception';
import type { Companion } from '../radio/companion';
import {
  ANON_REQ_BYTES,
  DISCOVER_BYTES,
  TELEMETRY_REQ_BYTES,
  TRACE_BYTES,
  advertBytes,
  minPeriodMs,
} from './airtime';
import {
  announceThisCycle,
  directedAskKind,
  matchAskTarget,
  matchTraceTarget,
  nextAnonAsk,
  nextTelemetryTarget,
  pruneAsks,
  rememberAsk,
  rememberPing,
  type AnonLast,
  type Ask,
  type Ping,
} from './asks';
import {
  askAtZeroHop,
  buildGetContactByKey,
  parseContactReply,
  replayPendingRestores,
  type ContactIo,
} from './contactPath';
import {
  buildAnonRequest,
  buildDiscoverFrame,
  buildSelfAdvertFrame,
  buildTelemetryRequest,
  buildTracePathFrame,
  parseBinaryResponse,
  parseSentAck,
  parseTelemetryResponse,
  readOwnerReply,
  readRegionsReply,
} from './frames';
import { cadenceSeconds, shouldAutoFire, staggerTargets } from './gate';
import { nextSweepBatch, noteAsk, type SweepState } from './sweep';

const TICK_MS = 1000;
const CONTACT_TIMEOUT_MS = 4000;
const FULL_KEY = /^[0-9a-f]{64}$/;

export type SentKind = 'discover' | 'advert' | 'trace' | 'request';

export interface AutoDiscoverOptions {
  companion: Pick<Companion, 'transmit' | 'request' | 'onPush'>;
  /** The connected radio's own key (restore records are kept per radio). */
  selfKey: string;
  sf: number | null;
  /** The radio's name, for the size of its advert. */
  name: string;
  position(): { lat: number; lon: number } | null;
  /** The picked targets, read as rx reads them (targets.ts). */
  targets(): { repeaters: string[]; companions: string[] };
  /** Repeaters heard (sweep candidates) and when each was last heard. */
  heard(): { ids: string[]; heardAt: Map<string, number> };
  introduce(): boolean;
  /** A frame went out (the rail's pulse and the sound). */
  onSent(kind: SentKind): void;
  /** On/off or the cadence changed. */
  onChange(): void;
  random?(n: number): Uint8Array;
}

export interface Attributable {
  packetType: string;
  sender: Sender;
  traceTag: string | null;
  heardUsSnr: number | null;
}

const reply = (kind: Sender['kind'], id: string): Sender => ({ kind, id, label: null, role: null });

export class AutoDiscover {
  enabled = false;
  /** What directed asks answered, per node, for this session. */
  readonly nodeInfo = new Map<string, Record<string, unknown>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFireAt: number | null = null;
  private lastPos: { lat: number; lon: number } | null = null;
  private pending: ReturnType<typeof setTimeout>[] = [];
  private sentBytes: number[] = [];
  private pings: Ping[] = [];
  private telemetryAsks: Ask[] = [];
  private telemetryCursor = 0;
  private anonAsks: Ask[] = [];
  private anonPending: { tag: number; pubkey: string; type: 1 | 2; sentAt: number }[] = [];
  private anonLast: AnonLast = {};
  private directedLast: 'telemetry' | 'anon' | null = null;
  private busy = false;
  private sweep: SweepState = { attempts: new Map(), lastAskedAt: new Map(), cursor: 0 };
  private readonly io: ContactIo;
  private disposed = false;
  /** Off and on again does not buy a fresh cycle inside the floor. */
  private holdUntil = 0;
  private readonly offPush: () => void;

  constructor(private readonly opts: AutoDiscoverOptions) {
    const c = opts.companion;
    this.io = {
      getContact: (pk) =>
        c.request(
          buildGetContactByKey(pk),
          (b, late) => {
            const parsed = parseContactReply(b);
            if (!parsed) return null;
            // A not-found ERR may be a late answer to something else.
            if (!parsed.found) return late ? null : parsed;
            return parsed.pubkey !== pk ? null : parsed;
          },
          CONTACT_TIMEOUT_MS
        ),
      // While a late OK/ERR may come, an ack proves nothing: read as not
      // acked, so no ask goes out and an unacked restore stays owed.
      writeContact: (frame) =>
        c.request(
          frame,
          (b, late) => (b[0] !== 0 && b[0] !== 1 ? null : late ? false : b[0] === 0),
          CONTACT_TIMEOUT_MS
        ),
    };
    this.offPush = c.onPush((f) => this.onPush(f));
  }

  private random(n: number): Uint8Array {
    return this.opts.random ? this.opts.random(n) : crypto.getRandomValues(new Uint8Array(n));
  }

  private floorMs(): number {
    return minPeriodMs(this.sentBytes, this.opts.sf);
  }

  cadenceSeconds(): number | null {
    return cadenceSeconds(this.enabled, this.floorMs());
  }

  /** Once per connection, before any ask: put back contacts an earlier
   * session left zero-hop on this radio. */
  replayRestores(): Promise<boolean | null> {
    return replayPendingRestores(this.io, this.opts.selfKey);
  }

  start(): void {
    if (this.enabled || this.disposed) return;
    this.enabled = true;
    if (this.lastFireAt !== null) this.holdUntil = this.lastFireAt + this.floorMs();
    this.lastFireAt = null;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    this.opts.onChange();
  }

  stop(): void {
    const was = this.enabled;
    this.enabled = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const h of this.pending) clearTimeout(h);
    this.pending = [];
    this.telemetryAsks = [];
    this.anonAsks = [];
    this.anonPending = [];
    if (was) this.opts.onChange();
  }

  /** The radio is gone or the page closes. */
  dispose(): void {
    this.disposed = true;
    this.stop();
    this.offPush();
  }

  private async send(frame: Uint8Array, accept: 'ok' | 'sent', bytes: number, kind: SentKind) {
    // Asked again inside the chain: a frame queued while on is dropped once off.
    const r = await this.opts.companion.transmit(
      frame,
      accept,
      undefined,
      () => this.enabled && !this.disposed
    );
    if (!r.sent) return r;
    this.sentBytes.push(bytes);
    this.opts.onSent(kind);
    this.opts.onChange();
    return r;
  }

  private tick(): void {
    if (!this.enabled) return;
    const now = Date.now();
    if (this.lastFireAt === null && now < this.holdUntil) return;
    const pos = this.opts.position();
    const fire = shouldAutoFire({
      lastFireAt: this.lastFireAt,
      lastLat: this.lastPos?.lat ?? null,
      lastLon: this.lastPos?.lon ?? null,
      now,
      lat: pos?.lat ?? null,
      lon: pos?.lon ?? null,
      pendingTargets: this.pending.length,
      minPeriodMs: this.floorMs(),
    });
    if (!fire) return;
    this.lastFireAt = now;
    if (pos) this.lastPos = pos;
    // Counted as frames go out, not as they are planned.
    this.sentBytes = [];
    void this.send(buildDiscoverFrame(this.random(4)), 'ok', DISCOVER_BYTES, 'discover');
    const { repeaters, companions } = this.opts.targets();
    if (
      announceThisCycle({
        introduce: this.opts.introduce(),
        connected: true,
        companionTargets: companions.length,
      })
    ) {
      void this.send(buildSelfAdvertFrame(), 'ok', advertBytes(this.opts.name), 'advert');
    }
    const { ids, sweeping } = this.probeTargets(repeaters, now);
    for (const { id, delayMs } of staggerTargets(ids)) {
      const handle = setTimeout(() => {
        this.pending = this.pending.filter((h) => h !== handle);
        void this.tracePing(id, sweeping);
      }, delayMs);
      this.pending.push(handle);
    }
    const anon = sweeping ? null : nextAnonAsk(ids, this.anonLast, now);
    const kind = directedAskKind({
      telemetryDue: companions.length > 0,
      anonDue: !!anon,
      last: this.directedLast,
    });
    if (kind === 'telemetry') {
      const next = nextTelemetryTarget(companions, this.telemetryCursor);
      if (next) {
        this.telemetryCursor = next.cursor;
        this.directedLast = 'telemetry';
        void this.askTelemetry(next.id.toLowerCase());
      }
    } else if (kind === 'anon' && anon) {
      this.directedLast = 'anon';
      void this.askAnon(anon.id, anon.type);
    }
  }

  private probeTargets(repeaters: string[], now: number): { ids: string[]; sweeping: boolean } {
    if (repeaters.length) return { ids: repeaters, sweeping: false };
    const heard = this.opts.heard();
    const ids = nextSweepBatch(heard.ids, { ...this.sweep, heardAt: heard.heardAt, now });
    if (ids.length) this.sweep = { ...this.sweep, cursor: this.sweep.cursor + ids.length };
    return { ids, sweeping: true };
  }

  private async tracePing(id: string, sweeping: boolean): Promise<void> {
    if (!this.enabled) return;
    const byte = parseInt(id.slice(0, 2), 16);
    if (Number.isNaN(byte)) return;
    const b = this.random(4);
    const tag = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
    // Remembered before it goes: the retransmission echoes the tag, and that
    // is all that ties the reception to the node asked.
    const before = this.pings;
    this.pings = rememberPing(this.pings, tag, id, Date.now());
    const r = await this.send(buildTracePathFrame(tag, 0, [byte]), 'sent', TRACE_BYTES, 'trace');
    if (!r.sent) {
      this.pings = before;
      return;
    }
    if (sweeping) {
      this.sweep = {
        ...this.sweep,
        ...noteAsk(id, { ...this.sweep, heardAt: this.opts.heard().heardAt }, Date.now()),
      };
    }
  }

  private async askTelemetry(pubkey: string): Promise<void> {
    if (!this.enabled || this.busy || !FULL_KEY.test(pubkey)) return;
    this.busy = true;
    try {
      await askAtZeroHop(this.io, this.opts.selfKey, pubkey, async () => {
        if (!this.enabled) return;
        const r = await this.send(
          buildTelemetryRequest(pubkey),
          'sent',
          TELEMETRY_REQ_BYTES,
          'request'
        );
        const ack = r.reply ? parseSentAck(r.reply) : null;
        if (!r.sent || !ack || ack.isFlood) return;
        this.telemetryAsks = rememberAsk(this.telemetryAsks, pubkey, Date.now());
      });
    } finally {
      this.busy = false;
    }
  }

  private async askAnon(pubkey: string, type: 1 | 2): Promise<void> {
    if (!this.enabled || this.busy || !FULL_KEY.test(pubkey)) return;
    this.busy = true;
    try {
      await askAtZeroHop(
        this.io,
        this.opts.selfKey,
        pubkey,
        async () => {
          if (!this.enabled) return;
          const r = await this.send(
            buildAnonRequest(pubkey, type),
            'sent',
            ANON_REQ_BYTES,
            'request'
          );
          const ack = r.reply ? parseSentAck(r.reply) : null;
          if (!r.sent || !ack) return;
          const now = Date.now();
          this.anonLast = { ...this.anonLast, [pubkey]: { at: now, type } };
          // A repeater answers only a direct request: a flood gets no answer.
          if (ack.isFlood) return;
          this.anonPending = [
            ...this.anonPending.filter((a) => now - a.sentAt < 30000),
            { tag: ack.tag, pubkey, type, sentAt: now },
          ];
          this.anonAsks = rememberAsk(this.anonAsks, pubkey, now);
        },
        { askNonContact: true }
      );
    } finally {
      this.busy = false;
    }
  }

  private onPush(frame: Uint8Array): void {
    const b = parseBinaryResponse(frame);
    if (b) {
      const now = Date.now();
      const ask = this.anonPending.find((a) => a.tag === b.tag && now - a.sentAt < 30000);
      if (!ask) return;
      this.anonPending = this.anonPending.filter((a) => a !== ask);
      const at = new Date(now).toISOString();
      const info =
        ask.type === 1
          ? (() => {
              const r = readRegionsReply(b.data);
              return {
                regions: r.regions,
                regions_truncated: r.truncated,
                regions_at: at,
                clock_offset_s: r.repeaterClock - Math.floor(now / 1000),
              };
            })()
          : (() => {
              const o = readOwnerReply(b.data);
              return {
                owner_name: o.name,
                owner_info: o.owner,
                owner_at: at,
                clock_offset_s: o.repeaterClock - Math.floor(now / 1000),
              };
            })();
      this.nodeInfo.set(ask.pubkey, { ...this.nodeInfo.get(ask.pubkey), ...info });
      return;
    }
    const t = parseTelemetryResponse(frame);
    if (!t) return;
    const known = [
      ...pruneAsks(this.telemetryAsks, Date.now()).map((a) => a.pubkey),
      ...this.opts.targets().companions.map((c) => c.toLowerCase()),
    ];
    const pubkey = known.find((id) => id.startsWith(t.prefix));
    if (!pubkey) return;
    this.nodeInfo.set(pubkey, {
      ...this.nodeInfo.get(pubkey),
      ...t.telemetry,
      telemetry_at: new Date().toISOString(),
    });
  }

  /** A reception that answers one of our asks, named after the node asked;
   * null for everything else. */
  attribute(d: Attributable): { sender: Sender; heardUsSnr?: number | null } | null {
    const now = Date.now();
    if (d.sender.id === null && d.traceTag) {
      const target = matchTraceTarget(this.pings, d.traceTag, now);
      return target ? { sender: reply('trace_reply', target), heardUsSnr: d.heardUsSnr } : null;
    }
    if (d.packetType === 'Response' && d.sender.kind === 'direct_hash' && d.sender.id) {
      const t = matchAskTarget(this.telemetryAsks, d.sender.id, now);
      if (t) return { sender: reply('telemetry_reply', t) };
      const a = matchAskTarget(this.anonAsks, d.sender.id, now);
      if (a) return { sender: reply('anon_reply', a) };
    }
    return null;
  }
}
