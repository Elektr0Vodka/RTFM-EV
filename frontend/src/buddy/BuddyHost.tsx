import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { useUpdateStatus } from '../hooks/useUpdateStatus';
import { mvToPercent } from '../utils/batteryDisplay';
import { requestManualSection } from '../utils/manualNavigation';
import { getEffectiveTheme, THEME_CHANGE_EVENT } from '../utils/theme';
import type { SettingsSection } from '../components/settings/settingsConstants';
import type { Channel, Contact, Conversation, HealthStatus } from '../types';
import { loadBuddyAgent, type BuddyAgent, type BuddyAgentId } from './agents';
import { findAnchorPoint } from './buddyAnchors';
import {
  batteryNodesLine,
  batteryOwnLine,
  describeBuddyEvent,
  quietSummaryLine,
  servicesDownLine,
  snmpFailingLine,
  tipLine,
  updateAppLine,
  updateOpenHopLine,
  type BuddyLine,
  type BuddyPage,
  type BuddyTarget,
} from './buddyCatalog';
import { subscribeBuddyEvents } from './buddyEvents';
import { recordBuddyLine } from './buddyHistory';
import {
  BATTERY_TELEMETRY_MAX_AGE_SECONDS,
  BatteryWatch,
  OutageWatch,
  pageHelpSection,
} from './buddyLogic';
import { BuddyMenu, type BuddyMenuView } from './BuddyMenu';
import { pickAnimation } from './buddyMood';
import {
  BUDDY_PREFS_CHANGE_EVENT,
  BUDDY_THEME_ID,
  getBuddyAgent,
  getBuddyBatteryThreshold,
  getBuddyPosition,
  getWarnedBatteries,
  getWarnedServices,
  isBuddyGroupOn,
  isBuddyQuiet,
  markBuddyDiscovered,
  setBuddyPosition,
  setWarnedBatteries,
  setWarnedServices,
} from './buddyPrefs';
import { HeldBack } from './buddyQuiet';

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
/** An integration is announced once it has been disconnected this long without a break. */
const SERVICE_DOWN_GRACE_MS = 60 * 1000;
const SERVICE_CHECK_MS = 30 * 1000;
const SNMP_POLL_MS = 5 * 60 * 1000;
const FANOUT_KEY = 'fanout:';
const SNMP_KEY = 'snmp:';
/**
 * Below the CRT scanline (9998) and vignette (9997) overlays in themes.css, so
 * those effects cover the buddy like the rest of the screen, yet above every
 * app layer (highest is 1300). The library's own default is 10001.
 */
const BUDDY_Z_INDEX = '9996';
const IDLE_MIN_MS = 3 * 60 * 1000;
const IDLE_MAX_MS = 6 * 60 * 1000;
/** An animation before a line is told to wrap up after this long. */
const MOOD_ANIMATION_MAX_MS = 3000;
const GESTURE_MAX_MS = 2000;
/** Time an animation gets for its exit frames before the line is said anyway. */
const ANIMATION_EXIT_GRACE_MS = 1500;
/** Longest wait for a running idle animation to make way for the next one. */
const IDLE_HANDOVER_MAX_MS = 4000;
const IDLE_HANDOVER_POLL_MS = 100;
/** A click opens the menu after this long, unless a second click made it a double-click. */
const DOUBLE_CLICK_MS = 250;
/** The pointer may move this far between press and release and still count as a click. */
const CLICK_SLOP_PX = 5;
/** How often the end of a mute or of the quiet hours is looked for. */
const QUIET_CHECK_MS = 20 * 1000;
/** clippyjs `Animator.States` (not exported by the library). */
const ANIMATION_EXITED = 0;
const ANIMATION_WAITING = 1;

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
const heldBack = new HeldBack();

/** Test helper: forget which tips/updates were already said this session. */
export function __resetBuddySessionState(): void {
  tipsSaid.clear();
  updatesSaid.clear();
  heldBack.takeSummary();
}

/** Add a line to the history: said (`shown`) or kept back during a quiet period. */
function remember(line: BuddyLine, shown: boolean): void {
  recordBuddyLine({
    at: Date.now(),
    kind: line.kind,
    group: line.group,
    text: line.text,
    target: line.target,
    shown,
  });
}

/**
 * Play one animation, then call `done` (exactly once). An animation that holds
 * its last pose is told to exit right away; one that runs past `maxMs` is told
 * to exit and gets a short grace for its exit frames. `done` is also called
 * straight away when there is nothing to play or the library internals this
 * relies on (`_playInternal`, `_animator.exitAnimation`,
 * `_animator.currentAnimationName`) are gone, so a line is never lost over an
 * animation.
 */
function playBriefly(
  agent: BuddyAgent,
  name: string | null,
  maxMs: number,
  done: () => void
): void {
  if (!name || typeof agent._playInternal !== 'function') {
    done();
    return;
  }
  let finished = false;
  let timer = 0;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.clearTimeout(timer);
    done();
  };
  const exit = () => {
    try {
      agent._animator.exitAnimation();
    } catch {
      // The grace timer below still ends it.
    }
  };
  /** Start the clock: `maxMs` to play, then the exit grace. */
  const arm = () => {
    timer = window.setTimeout(() => {
      exit();
      timer = window.setTimeout(finish, ANIMATION_EXIT_GRACE_MS);
    }, maxMs);
  };
  try {
    agent._playInternal(name, (_name: string, state: number) => {
      if (state === ANIMATION_WAITING) exit();
      else if (state === ANIMATION_EXITED) finish();
    });
    if (agent._animator.currentAnimationName === name) {
      arm();
    } else {
      // An idle animation is still on and the library plays ours after it (the
      // usual case right after another line). Ask the idle one to wrap up and
      // start the clock when ours begins, so it is not cut to a few frames.
      exit();
      const giveUpAt = Date.now() + IDLE_HANDOVER_MAX_MS;
      const waitForStart = () => {
        if (finished) return;
        if (agent._animator.currentAnimationName === name || Date.now() >= giveUpAt) arm();
        else timer = window.setTimeout(waitForStart, IDLE_HANDOVER_POLL_MS);
      };
      timer = window.setTimeout(waitForStart, IDLE_HANDOVER_POLL_MS);
    }
  } catch {
    finish();
  }
}

/**
 * The animation that points toward an anchor (see buddyAnchors), or null: no
 * anchor, not on screen, or the character has no gesture that way. clippyjs
 * only knows four directions, so this is a direction, not a precise pointer.
 */
function gestureAnimation(agent: BuddyAgent, anchor: string | null): string | null {
  if (!anchor || typeof agent._getDirection !== 'function') return null;
  try {
    const point = findAnchorPoint(anchor);
    if (!point) return null;
    const direction = agent._getDirection(point.x, point.y);
    return (
      [`Gesture${direction}`, `Look${direction}`].find((name) => agent.hasAnimation(name)) ?? null
    );
  } catch {
    return null;
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

/** The library appends its own fixed-position elements to <body>; this only renders the click menu. */
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
    menuOpenRef.current = menu !== null;
  });

  const targetRef = useRef<BuddyTarget | null>(null);
  const pendingRef = useRef(0);
  /** The agent on screen; null once it is disposed, so late timers do nothing. */
  const liveAgentRef = useRef<BuddyAgent | null>(null);
  /** Seeded from storage, so a reload does not repeat a battery warning. */
  const [batteryWatch] = useState(() => new BatteryWatch(getWarnedBatteries(), setWarnedBatteries));
  /** Integrations and SNMP nodes that are down; seeded from storage like the batteries. */
  const [outageWatch] = useState(
    () => new OutageWatch(SERVICE_DOWN_GRACE_MS, getWarnedServices(), setWarnedServices)
  );
  const wasQuietRef = useRef(false);
  /** The click menu: closed, the menu itself, or the recap of what was said. */
  const [menu, setMenu] = useState<BuddyMenuView | null>(null);
  const menuOpenRef = useRef(false);
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const syncThreshold = () => setThreshold(getBuddyBatteryThreshold());
    window.addEventListener(BUDDY_PREFS_CHANGE_EVENT, syncThreshold);
    return () => window.removeEventListener(BUDDY_PREFS_CHANGE_EVENT, syncThreshold);
  }, []);

  const openTarget = useCallback((target: BuddyTarget) => {
    const p = propsRef.current;
    switch (target.kind) {
      case 'conversation':
        p.onSelectConversation(target.conversation);
        break;
      case 'settings':
        p.onOpenSettings(target.section);
        break;
      case 'mention':
        p.onNavigateMentionToMessage?.(target.channelKey, target.messageId);
        break;
      case 'manual':
        requestManualSection(target.section);
        p.onSelectConversation({
          type: 'manual',
          id: 'manual',
          name: tRef.current('nav_user_guide'),
        });
        break;
      case 'recap':
        setMenu('recap');
        break;
    }
  }, []);

  // Agent lifecycle: load on mount, dispose on unmount.
  useEffect(() => {
    let cancelled = false;
    let created: BuddyAgent | null = null;
    let clickTimer = 0;
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
        let press: { x: number; y: number; menuWasOpen: boolean } | null = null;
        el.addEventListener('mousedown', (e) => {
          press = { x: e.clientX, y: e.clientY, menuWasOpen: menuOpenRef.current };
          setMenu(null);
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

        // A single click opens the menu (or closes an open one). It waits for
        // the double-click window, so the double-click trick stays what it was,
        // and a press that ended elsewhere was a drag.
        el.addEventListener('click', (e) => {
          window.clearTimeout(clickTimer);
          if (e.detail > 1 || !press || press.menuWasOpen) return;
          if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP_PX) return;
          clickTimer = window.setTimeout(() => setMenu('menu'), DOUBLE_CLICK_MS);
        });
        el.addEventListener('dblclick', () => window.clearTimeout(clickTimer));

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
        liveAgentRef.current = a;
        setAgent(a);
      })
      .catch((err) => console.error('buddy: failed to load agent', err));
    return () => {
      cancelled = true;
      window.clearTimeout(clickTimer);
      liveAgentRef.current = null;
      created?.dispose();
      targetRef.current = null;
      pendingRef.current = 0;
      setAgent(null);
    };
  }, [agentId, onDismiss, openTarget]);

  /**
   * Say a line, or keep it back while the buddy is quiet. Returns false when
   * the line was dropped: its group is switched off, too many lines are waiting,
   * or it is a tip during a quiet period. Tips leave one slot free for warnings
   * and pass `relevant`, checked when their turn comes: a tip for a page the
   * user already left is skipped instead of said late.
   */
  const say = useCallback(
    (line: BuddyLine | null, opts: { relevant?: () => boolean } = {}): boolean => {
      if (!agent || !line?.text) return false;
      if (line.group && !isBuddyGroupOn(line.group)) return false;
      const isTip = line.kind === 'tip';
      if (line.group && isBuddyQuiet()) {
        wasQuietRef.current = true;
        // A tip is not kept: it is given on a later visit instead.
        if (isTip) return false;
        heldBack.add(line.group, line.count);
        remember(line, false);
        return true;
      }
      if (pendingRef.current >= (isTip ? MAX_PENDING_SPEECH - 1 : MAX_PENDING_SPEECH)) {
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
        remember(line, true);
        // Mood first. Then the text, said while the buddy gestures toward what
        // the line is about (looked up only now, so it follows the layout of
        // this moment): waiting for the gesture too kept the text back for up
        // to 7 seconds. The queue moves on once both are done.
        const mood = pickAnimation((name) => agent.hasAnimation(name), line.mood);
        playBriefly(agent, mood, MOOD_ANIMATION_MAX_MS, () => {
          if (liveAgentRef.current !== agent) return;
          let open = 2;
          const part = () => {
            open -= 1;
            if (open === 0) complete();
          };
          playBriefly(agent, gestureAnimation(agent, line.anchor), GESTURE_MAX_MS, part);
          targetRef.current = line.target;
          // The balloon and the menu sit in the same spot.
          setMenu(null);
          // Same as agent.speak(), but decided at play time.
          agent._balloon.speak(part, line.text, false);
        });
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
      say(describeBuddyEvent(event, tRef.current, p.contacts, p.channels));
    });
  }, [agent, say]);

  // End of a mute or of the quiet hours: one line about what was kept back.
  useEffect(() => {
    if (!agent) return;
    const check = () => {
      const quiet = isBuddyQuiet();
      if (wasQuietRef.current && !quiet) {
        const summary = heldBack.takeSummary();
        if (summary) say(quietSummaryLine(tRef.current, summary));
      }
      wasQuietRef.current = quiet;
    };
    check();
    const timer = window.setInterval(check, QUIET_CHECK_MS);
    window.addEventListener(BUDDY_PREFS_CHANGE_EVENT, check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(BUDDY_PREFS_CHANGE_EVENT, check);
    };
  }, [agent, say]);

  // Page tips, once per page per session.
  const activePage = props.activePage;
  useEffect(() => {
    if (!agent || !activePage || tipsSaid.has(activePage)) return;
    const queued = say(tipLine(tRef.current, activePage), {
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
    if (batteryWatch.observe('self', pct, threshold)) {
      say(batteryOwnLine(tRef.current, pct));
    }
  }, [agent, batteryWatch, ownBatteryMv, threshold, say]);

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
          const fresh = new Set<string>();
          const low: { publicKey: string; pct: number }[] = [];
          for (const [publicKey, entry] of Object.entries(latest)) {
            const volts = entry.battery_volts;
            if (!volts || volts <= 0) continue;
            if (nowSec - entry.timestamp > BATTERY_TELEMETRY_MAX_AGE_SECONDS) continue;
            fresh.add(publicKey);
            const contact = contacts.find((c) => c.public_key === publicKey);
            if (contact?.power_source === 'mains') continue;
            const pct = mvToPercent(Math.round(volts * 1000), contact?.battery_chemistry);
            if (batteryWatch.observe(publicKey, pct, threshold)) low.push({ publicKey, pct });
          }
          // A node without recent telemetry warns afresh when it reports again.
          batteryWatch.prune((key) => key === 'self' || fresh.has(key));
          say(batteryNodesLine(tRef.current, contacts, low));
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
  }, [agent, batteryWatch, threshold, say]);

  // Integrations (MQTT and the other fanout modules) that stay disconnected.
  // Checked on every health update and on a timer, so the grace period also
  // runs out while no update arrives. Nothing is tracked while the topic is
  // switched off, so it can still be said once it is back on.
  const fanoutStatuses = props.health?.fanout_statuses;
  useEffect(() => {
    if (!agent) return;
    const check = () => {
      const statuses = propsRef.current.health?.fanout_statuses;
      if (!statuses || !isBuddyGroupOn('services')) return;
      const now = Date.now();
      const down: string[] = [];
      for (const [id, entry] of Object.entries(statuses)) {
        if (outageWatch.observe(FANOUT_KEY + id, entry.status === 'connected', now)) {
          down.push(entry.name);
        }
      }
      outageWatch.prune(
        (key) => !key.startsWith(FANOUT_KEY) || key.slice(FANOUT_KEY.length) in statuses
      );
      say(servicesDownLine(tRef.current, down));
    };
    check();
    const timer = window.setInterval(check, SERVICE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [agent, fanoutStatuses, outageWatch, say]);

  // SNMP nodes that stopped answering. Reads stored poll results only
  // (GET /api/snmp/nodes); it never starts a poll or a discovery itself.
  useEffect(() => {
    if (!agent) return;
    const controller = new AbortController();
    const poll = () => {
      if (!isBuddyGroupOn('services')) return;
      api
        .snmpNodes(controller.signal)
        .then((nodes) => {
          const now = Date.now();
          const polled = new Set<string>();
          const failing: { publicKey: string; name: string }[] = [];
          for (const node of nodes) {
            if (!node.poll_enabled) continue;
            polled.add(node.public_key);
            // The server polls every few minutes, so one failed poll counts.
            if (outageWatch.observe(SNMP_KEY + node.public_key, !node.last_error, now, 0)) {
              failing.push({
                publicKey: node.public_key,
                name: node.name || node.public_key.slice(0, 12),
              });
            }
          }
          outageWatch.prune(
            (key) => !key.startsWith(SNMP_KEY) || polled.has(key.slice(SNMP_KEY.length))
          );
          say(snmpFailingLine(tRef.current, failing));
        })
        .catch((err) => {
          if (!controller.signal.aborted) console.warn('buddy: SNMP check failed', err);
        });
    };
    poll();
    const timer = window.setInterval(poll, SNMP_POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [agent, outageWatch, say]);

  // RTFM-EV update (shared, cached /update-status check).
  useEffect(() => {
    if (!agent || !updateStatus?.update_available || updatesSaid.has('app')) return;
    updatesSaid.add('app');
    say(updateAppLine(tRef.current, updateStatus.commits_behind));
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
        say(updateOpenHopLine(tRef.current, update.latest_version ?? ''));
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

  const helpSection = pageHelpSection(activePage);
  const helpTarget = useMemo<BuddyTarget | null>(
    () => (helpSection ? { kind: 'manual', section: helpSection } : null),
    [helpSection]
  );

  if (!agent || !menu) return null;
  return createPortal(
    <BuddyMenu
      key={menu}
      anchor={agent._el}
      initialView={menu}
      helpTarget={helpTarget}
      zIndex={BUDDY_Z_INDEX}
      onOpenTarget={openTarget}
      onHide={() => agent.hide(false, onDismiss)}
      onClose={closeMenu}
    />,
    document.body
  );
}
