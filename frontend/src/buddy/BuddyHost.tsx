import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useT, type TFn } from '../i18n';
import { useUpdateStatus } from '../hooks/useUpdateStatus';
import { mvToPercent } from '../utils/batteryDisplay';
import { getContactDisplayName } from '../utils/pubkey';
import { getEffectiveTheme, THEME_CHANGE_EVENT } from '../utils/theme';
import type { SettingsSection } from '../components/settings/settingsConstants';
import type { Channel, Contact, Conversation, HealthStatus } from '../types';
import { loadBuddyAgent, type BuddyAgent, type BuddyAgentId } from './agents';
import { subscribeBuddyEvents, type BuddyEvent } from './buddyEvents';
import { BATTERY_TELEMETRY_MAX_AGE_SECONDS, BatteryWatch, pageTipKey } from './buddyLogic';
import {
  BUDDY_PREFS_CHANGE_EVENT,
  BUDDY_THEME_ID,
  getBuddyAgent,
  getBuddyBatteryThreshold,
  getBuddyPosition,
  markBuddyDiscovered,
  setBuddyPosition,
} from './buddyPrefs';

/** Speech waiting in the agent's queue beyond this many lines is dropped. */
const MAX_PENDING_SPEECH = 3;
/** Pause after each line so it can be read (and clicked) before the next. */
const READ_PAUSE_MS = 4000;
/** How long the balloon lingers after the last word (library default: 2 s). */
const BALLOON_LINGER_MS = 6000;
/** Default spot: clear of the right edge and of the composer + send button. */
const DEFAULT_RIGHT_GAP = 40;
const DEFAULT_BOTTOM_GAP = 150;
const NODE_BATTERY_POLL_MS = 10 * 60 * 1000;
/**
 * Below the CRT scanline (9998) and vignette (9997) overlays in themes.css, so
 * those effects cover the buddy like the rest of the screen, yet above every
 * app layer (highest is 1300). The library's own default is 10001.
 */
const BUDDY_Z_INDEX = '9996';
const IDLE_MIN_MS = 3 * 60 * 1000;
const IDLE_MAX_MS = 6 * 60 * 1000;

/** What clicking the speech balloon opens. */
export type BuddyTarget =
  | { kind: 'conversation'; conversation: Conversation }
  | { kind: 'settings'; section: SettingsSection }
  | { kind: 'mention'; channelKey: string; messageId: number };

export type BuddyPage = Conversation['type'] | 'settings';

export interface BuddyHostProps {
  health: HealthStatus | null;
  contacts: Contact[];
  channels: Channel[];
  /** Page currently on screen; drives the once-per-session page tips. */
  activePage: BuddyPage | null;
  onSelectConversation: (conversation: Conversation) => void;
  onOpenSettings: (section: SettingsSection) => void;
  onNavigateMentionToMessage?: (channelKey: string, messageId: number) => void;
}

// Session-wide (survive the host re-mounting or switching buddies).
const tipsSaid = new Set<BuddyPage>();
const updatesSaid = new Set<'app' | 'openhop'>();

/** Test helper: forget which tips/updates were already said this session. */
export function __resetBuddySessionState(): void {
  tipsSaid.clear();
  updatesSaid.clear();
}

function contactName(contacts: Contact[], publicKey: string, fallback?: string | null): string {
  const contact = contacts.find((c) => c.public_key === publicKey);
  if (contact) return getContactDisplayName(contact.name, contact.public_key, contact.last_advert);
  return fallback || publicKey.slice(0, 12);
}

function contactInfoTarget(contacts: Contact[], publicKey: string, name?: string | null) {
  return {
    kind: 'conversation',
    conversation: {
      type: 'contact-info',
      id: publicKey,
      name: contactName(contacts, publicKey, name),
    },
  } satisfies BuddyTarget;
}

/** Text + click target for an app event, or null when there is nothing to say. */
export function describeBuddyEvent(
  event: BuddyEvent,
  t: TFn,
  contacts: Contact[],
  channels: Channel[]
): { text: string; target: BuddyTarget | null } | null {
  switch (event.kind) {
    case 'new-node': {
      if (event.count === 1 && event.publicKey) {
        const name = contactName(contacts, event.publicKey, event.name);
        return {
          text: t('buddy_new_node', { name }),
          target: contactInfoTarget(contacts, event.publicKey, event.name),
        };
      }
      if (event.count < 1) return null;
      return {
        text: t('buddy_new_nodes', { count: event.count }),
        target: {
          kind: 'conversation',
          conversation: { type: 'mesh-health', id: 'mesh-health', name: t('nav_mesh_health') },
        },
      };
    }
    case 'radio':
      if (event.state === 'connected') return { text: t('buddy_radio_connected'), target: null };
      if (event.state === 'paused') return { text: t('buddy_radio_paused'), target: null };
      return {
        text: t('buddy_radio_disconnected'),
        target: { kind: 'settings', section: 'radio' },
      };
    case 'dm': {
      const name = contactName(contacts, event.publicKey, event.senderName);
      return {
        text: t('buddy_dm', { name }),
        target: {
          kind: 'conversation',
          conversation: { type: 'contact', id: event.publicKey, name },
        },
      };
    }
    case 'mention': {
      const channel = channels.find((c) => c.key === event.channelKey);
      return {
        text: t('buddy_mention', {
          name: event.senderName || '?',
          channel: channel?.name ?? event.channelKey.slice(0, 8),
        }),
        target: { kind: 'mention', channelKey: event.channelKey, messageId: event.messageId },
      };
    }
  }
}

/**
 * The desktop buddy (clippyjs). Mounted once in AppShell, outside the routed
 * content, so it stays on screen while navigating. This gate only tracks the
 * preference and theme (and records that Windows 95 was used, which unlocks
 * the buddy on other themes); everything else (sprite download, polling,
 * update checks) lives in ActiveBuddy and only runs while a buddy is shown.
 */
export function BuddyHost(props: BuddyHostProps) {
  const [agentId, setAgentId] = useState<BuddyAgentId | null>(() => getBuddyAgent());
  const [dismissed, setDismissed] = useState(false);

  const agentIdRef = useRef(agentId);
  useEffect(() => {
    const sync = () => {
      if (getEffectiveTheme() === BUDDY_THEME_ID) markBuddyDiscovered();
      const next = getBuddyAgent();
      // A different buddy (by choice or theme) brings back one that was right-click dismissed.
      if (next !== agentIdRef.current) {
        agentIdRef.current = next;
        setDismissed(false);
        setAgentId(next);
      }
    };
    sync();
    window.addEventListener(BUDDY_PREFS_CHANGE_EVENT, sync);
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener(BUDDY_PREFS_CHANGE_EVENT, sync);
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
    };
  }, []);

  const onDismiss = useCallback(() => setDismissed(true), []);

  if (agentId === null || dismissed) return null;
  return <ActiveBuddy key={agentId} agentId={agentId} onDismiss={onDismiss} {...props} />;
}

/** Renders nothing itself: the library appends its own fixed-position elements to <body>. */
function ActiveBuddy({
  agentId,
  onDismiss,
  ...props
}: BuddyHostProps & { agentId: BuddyAgentId; onDismiss: () => void }) {
  const t = useT();
  const [threshold, setThreshold] = useState(getBuddyBatteryThreshold);
  const [agent, setAgent] = useState<BuddyAgent | null>(null);
  const { status: updateStatus } = useUpdateStatus();

  const propsRef = useRef(props);
  const tRef = useRef(t);
  useEffect(() => {
    propsRef.current = props;
    tRef.current = t;
  });

  const targetRef = useRef<BuddyTarget | null>(null);
  const pendingRef = useRef(0);
  const batteryWatchRef = useRef(new BatteryWatch());

  useEffect(() => {
    const syncThreshold = () => setThreshold(getBuddyBatteryThreshold());
    window.addEventListener(BUDDY_PREFS_CHANGE_EVENT, syncThreshold);
    return () => window.removeEventListener(BUDDY_PREFS_CHANGE_EVENT, syncThreshold);
  }, []);

  const openTarget = useCallback((target: BuddyTarget) => {
    const p = propsRef.current;
    if (target.kind === 'conversation') p.onSelectConversation(target.conversation);
    else if (target.kind === 'settings') p.onOpenSettings(target.section);
    else p.onNavigateMentionToMessage?.(target.channelKey, target.messageId);
  }, []);

  // Agent lifecycle: load on mount, dispose on unmount.
  useEffect(() => {
    let cancelled = false;
    let created: BuddyAgent | null = null;
    loadBuddyAgent(agentId)
      .then((a) => {
        if (cancelled) {
          a.dispose();
          return;
        }
        created = a;
        const el = a._el;
        el.dataset.buddy = agentId;
        el.setAttribute('aria-hidden', 'true');
        a._balloon.CLOSE_BALLOON_DELAY = BALLOON_LINGER_MS;
        el.style.zIndex = BUDDY_Z_INDEX;

        // Saved spot, or bottom-right above the message composer.
        const pos = getBuddyPosition();
        const [frameW, frameH] = (a._animator._data as { framesize?: [number, number] })
          .framesize ?? [124, 93];
        el.style.left = `${pos ? pos.x : window.innerWidth - frameW - DEFAULT_RIGHT_GAP}px`;
        el.style.top = `${pos ? pos.y : window.innerHeight - frameH - DEFAULT_BOTTOM_GAP}px`;

        // The library moves the buddy on mousedown + drag; its own mouseup
        // listener (registered first) clamps the position, then we save it.
        el.addEventListener('mousedown', () => {
          window.addEventListener(
            'mouseup',
            () => {
              const x = parseFloat(el.style.left);
              const y = parseFloat(el.style.top);
              if (Number.isFinite(x) && Number.isFinite(y)) setBuddyPosition({ x, y });
            },
            { once: true }
          );
        });

        // Right-click: wave goodbye until the page is reloaded.
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          a.hide(false, onDismiss);
        });

        // Clicking the balloon opens what the current line is about.
        const balloonEl = a._balloon._balloon;
        balloonEl.dataset.buddyBalloon = '1';
        balloonEl.style.zIndex = BUDDY_Z_INDEX;
        balloonEl.addEventListener('click', () => {
          const target = targetRef.current;
          if (!target) return;
          targetRef.current = null;
          a._balloon.hide(true);
          openTarget(target);
        });

        a.show(false);
        a.reposition();
        setAgent(a);
      })
      .catch((err) => console.error('buddy: failed to load agent', err));
    return () => {
      cancelled = true;
      created?.dispose();
      targetRef.current = null;
      pendingRef.current = 0;
      setAgent(null);
    };
  }, [agentId, onDismiss, openTarget]);

  /**
   * Queue a line; returns false when it was dropped. Tips leave one slot free
   * for warnings and pass `relevant`, checked when their turn comes: a tip for a
   * page the user already left is skipped instead of said late.
   */
  const say = useCallback(
    (
      text: string,
      target: BuddyTarget | null = null,
      opts: { tip?: boolean; relevant?: () => boolean } = {}
    ): boolean => {
      if (!agent || !text) return false;
      if (pendingRef.current >= (opts.tip ? MAX_PENDING_SPEECH - 1 : MAX_PENDING_SPEECH)) {
        return false;
      }
      pendingRef.current += 1;
      let skipped = false;
      agent._addToQueue((complete: () => void) => {
        if (opts.relevant && !opts.relevant()) {
          skipped = true;
          complete();
          return;
        }
        targetRef.current = target;
        // Same as agent.speak(), but decided at play time.
        agent._balloon.speak(complete, text, false);
      });
      agent._addToQueue((complete: () => void) => {
        pendingRef.current = Math.max(0, pendingRef.current - 1);
        if (skipped) {
          complete();
          return;
        }
        // Same as agent.delay(): idle animation while the line is read.
        agent._onQueueEmpty();
        window.setTimeout(complete, READ_PAUSE_MS);
      });
      return true;
    },
    [agent]
  );

  // App events (new nodes, radio state, DMs, mentions).
  useEffect(() => {
    if (!agent) return;
    return subscribeBuddyEvents((event) => {
      const p = propsRef.current;
      const line = describeBuddyEvent(event, tRef.current, p.contacts, p.channels);
      if (line) say(line.text, line.target);
    });
  }, [agent, say]);

  // Page tips, once per page per session.
  const activePage = props.activePage;
  useEffect(() => {
    if (!agent || !activePage || tipsSaid.has(activePage)) return;
    const key = pageTipKey(activePage);
    if (!key) return;
    const queued = say(tRef.current(key), null, {
      tip: true,
      relevant: () => {
        const stillHere = propsRef.current.activePage === activePage;
        // Left before it was said: allow the tip again on the next visit.
        if (!stillHere) tipsSaid.delete(activePage);
        return stillHere;
      },
    });
    if (queued) tipsSaid.add(activePage);
  }, [agent, activePage, say]);

  // Own radio battery.
  const ownBatteryMv = props.health?.radio_stats?.battery_mv ?? null;
  useEffect(() => {
    if (!agent || !ownBatteryMv || ownBatteryMv <= 0) return;
    const pct = mvToPercent(ownBatteryMv);
    if (batteryWatchRef.current.observe('self', pct, threshold)) {
      say(tRef.current('buddy_battery_own', { pct }), {
        kind: 'conversation',
        conversation: { type: 'node', id: 'node', name: tRef.current('nav_my_node') },
      });
    }
  }, [agent, ownBatteryMv, threshold, say]);

  // Node batteries from stored telemetry (repeater + contact history).
  useEffect(() => {
    if (!agent) return;
    const controller = new AbortController();
    const poll = () => {
      api
        .getLatestTelemetry(controller.signal)
        .then((latest) => {
          const contacts = propsRef.current.contacts;
          const nowSec = Date.now() / 1000;
          const low: { publicKey: string; name: string; pct: number }[] = [];
          for (const [publicKey, entry] of Object.entries(latest)) {
            const volts = entry.battery_volts;
            if (!volts || volts <= 0) continue;
            if (nowSec - entry.timestamp > BATTERY_TELEMETRY_MAX_AGE_SECONDS) continue;
            const contact = contacts.find((c) => c.public_key === publicKey);
            if (contact?.power_source === 'mains') continue;
            const pct = mvToPercent(Math.round(volts * 1000), contact?.battery_chemistry);
            if (batteryWatchRef.current.observe(publicKey, pct, threshold)) {
              low.push({ publicKey, name: contactName(contacts, publicKey), pct });
            }
          }
          if (low.length === 1) {
            const [node] = low;
            say(
              tRef.current('buddy_battery_node', { name: node.name, pct: node.pct }),
              contactInfoTarget(contacts, node.publicKey, node.name)
            );
          } else if (low.length > 1) {
            say(
              tRef.current('buddy_battery_nodes', {
                count: low.length,
                names: low
                  .slice(0, 3)
                  .map((n) => n.name)
                  .join(', '),
              }),
              {
                kind: 'conversation',
                conversation: {
                  type: 'mesh-health',
                  id: 'mesh-health',
                  name: tRef.current('nav_mesh_health'),
                },
              }
            );
          }
        })
        .catch((err) => {
          if (!controller.signal.aborted) console.warn('buddy: telemetry poll failed', err);
        });
    };
    poll();
    const timer = window.setInterval(poll, NODE_BATTERY_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [agent, threshold, say]);

  // RTFM-EV update (shared, cached /update-status check).
  useEffect(() => {
    if (!agent || !updateStatus?.update_available || updatesSaid.has('app')) return;
    updatesSaid.add('app');
    say(tRef.current('buddy_update_app', { count: updateStatus.commits_behind }), {
      kind: 'settings',
      section: 'about',
    });
  }, [agent, updateStatus, say]);

  // OpenHop firmware update, only when OpenHop management is configured.
  useEffect(() => {
    if (!agent || updatesSaid.has('openhop')) return;
    let cancelled = false;
    api
      .getOpenHopStatus()
      .then((status) => (status.configured ? api.getOpenHopUpdateStatus() : null))
      .then((update) => {
        if (cancelled || !update?.success || !update.has_update || updatesSaid.has('openhop')) {
          return;
        }
        updatesSaid.add('openhop');
        say(tRef.current('buddy_update_openhop', { version: update.latest_version ?? '' }), {
          kind: 'settings',
          section: 'openhop',
        });
      })
      .catch(() => {
        // OpenHop unreachable or not present: nothing to announce.
      });
    return () => {
      cancelled = true;
    };
  }, [agent, say]);

  // Idle tricks every few minutes while nothing is being said.
  useEffect(() => {
    if (!agent) return;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          if (pendingRef.current === 0) agent.animate();
          schedule();
        },
        IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS)
      );
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [agent]);

  return null;
}
