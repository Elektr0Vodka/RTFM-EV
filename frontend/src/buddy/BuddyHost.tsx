import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { useMeshcomodConfig } from '../hooks/useMeshcomodConfig';
import { useUpdateStatus } from '../hooks/useUpdateStatus';
import { mvToPercent } from '../utils/batteryDisplay';
import { requestManualSection } from '../utils/manualNavigation';
import { getEffectiveTheme, THEME_CHANGE_EVENT } from '../utils/theme';
import type { SettingsSection } from '../components/settings/settingsConstants';
import type { Channel, Contact, Conversation, HealthStatus } from '../types';
import { loadBuddyAgent, type BuddyAgent, type BuddyAgentId } from './agents';
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
import { gestureAnimation, playBriefly } from './buddyMotion';
import {
  BUDDY_PREFS_CHANGE_EVENT,
  BUDDY_THEME_ID,
  DEFAULT_BUDDY_AGENT,
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
import { BuddyTourRunner } from './BuddyTourRunner';
import {
  isBuddyTourRunning,
  noteBuddyTourRadio,
  pauseBuddyTour,
  subscribeBuddyTour,
  useBuddyTourOffer,
  useRunningBuddyTour,
} from './buddyTour';
import { BuddyTourOffer } from './BuddyTourOffer';

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
/** A click opens the menu after this long, unless a second click made it a double-click. */
const DOUBLE_CLICK_MS = 250;
/** The pointer may move this far between press and release and still count as a click. */
const CLICK_SLOP_PX = 5;
/** How often the end of a mute or of the quiet hours is looked for. */
const QUIET_CHECK_MS = 20 * 1000;

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

  // The guided walkthrough (buddyTour.ts) needs a buddy to lead it. Without an
  // active one, the default buddy is summoned for the tour only: it says and
  // polls nothing else, and it is gone again when the tour pauses or ends. The
  // preference is not touched. Starting a tour also brings back a buddy that
  // was right-click dismissed.
  const touring = useRunningBuddyTour() !== null;
  useEffect(() => {
    if (touring) setDismissed(false);
  }, [touring]);

  // The add-on tours follow what the connected radio has (buddyTour.ts keeps
  // what it saw for the page load). The CAD state comes from the cache the
  // chat header already fills; it does not read the radio again.
  const info = props.health?.radio_device_info;
  const isMeshcomod = info?.is_meshcomod === true;
  const cliSupported = info?.cli_supported === true;
  const filterSupported = info?.companion_filter_supported === true;
  const { cadSupported } = useMeshcomodConfig(isMeshcomod);
  useEffect(() => {
    noteBuddyTourRadio({
      cli: cliSupported,
      meshcomod: isMeshcomod,
      filter: filterSupported,
      cad: cadSupported,
    });
  }, [cliSupported, isMeshcomod, filterSupported, cadSupported]);

  const offer = useBuddyTourOffer();
  // The walkthrough's card comes on a fresh install, before any buddy is shown.
  if (offer === 'main') return <BuddyTourOffer tour="main" zIndex={BUDDY_Z_INDEX} />;
  const card = offer && <BuddyTourOffer tour={offer} zIndex={BUDDY_Z_INDEX} />;
  const shownId = agentId ?? (touring ? DEFAULT_BUDDY_AGENT : null);
  if (shownId === null || (dismissed && !touring)) return card;
  return (
    <>
      {card}
      <ActiveBuddy
        key={shownId}
        agentId={shownId}
        tourOnly={agentId === null}
        touring={touring}
        onDismiss={onDismiss}
        {...props}
      />
    </>
  );
}

/** The library appends its own fixed-position elements to <body>; this renders the click menu and the walkthrough. */
function ActiveBuddy({
  agentId,
  tourOnly,
  touring,
  onDismiss,
  ...props
}: BuddyHostProps & {
  agentId: BuddyAgentId;
  /** Summoned for the guided walkthrough only: no lines, no polling. */
  tourOnly: boolean;
  touring: boolean;
  onDismiss: () => void;
}) {
  const t = useT();
  const runningTour = useRunningBuddyTour();
  const [threshold, setThreshold] = useState(getBuddyBatteryThreshold);
  const [agent, setAgent] = useState<BuddyAgent | null>(null);
  /** The agent for everything but the walkthrough; null for a summoned buddy. */
  const talker = tourOnly ? null : agent;
  const { status: updateStatus } = useUpdateStatus();

  const propsRef = useRef(props);
  const tRef = useRef(t);
  useEffect(() => {
    propsRef.current = props;
    tRef.current = t;
    menuOpenRef.current = menu !== null;
    tourOnlyRef.current = tourOnly;
  });

  const targetRef = useRef<BuddyTarget | null>(null);
  const pendingRef = useRef(0);
  /** Lines in the agent's queue that have not started; `forget` undoes "was said". */
  const waitingRef = useRef<{ line: BuddyLine; forget?: () => void }[]>([]);
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
  const tourOnlyRef = useRef(tourOnly);
  const closeMenu = useCallback(() => setMenu(null), []);

  // The walkthrough panel takes the place of the menu and of the balloon. Lines
  // still waiting for their turn are kept back like the ones that come in
  // during the tour; the one being said finishes out of sight. clippyjs's
  // `stop()` empties the queue but leaves the running step to complete, which
  // is what keeps the queue usable afterwards.
  useEffect(() => {
    if (!touring) return;
    setMenu(null);
    const a = liveAgentRef.current;
    if (!a) return;
    for (const { line, forget } of waitingRef.current.splice(0)) {
      forget?.();
      if (!line.group || line.kind === 'tip') continue;
      wasQuietRef.current = true;
      heldBack.add(line.group, line.count);
      remember(line, false);
    }
    pendingRef.current = 0;
    targetRef.current = null;
    try {
      a.stop();
      a._balloon.hide(true);
    } catch {
      // Nothing was being said.
    }
  }, [touring]);

  /**
   * Send the buddy away until the page is reloaded. A running walkthrough is
   * paused; a buddy that was only summoned for it leaves with the pause.
   */
  const dismiss = useCallback(
    (a: BuddyAgent) => {
      pauseBuddyTour();
      if (!tourOnlyRef.current) a.hide(false, onDismiss);
    },
    [onDismiss]
  );

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
              // The walkthrough moves the buddy around; its own spot is kept.
              if (isBuddyTourRunning()) return;
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
          if (e.detail > 1 || !press || press.menuWasOpen || isBuddyTourRunning()) return;
          if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP_PX) return;
          clickTimer = window.setTimeout(() => setMenu('menu'), DOUBLE_CLICK_MS);
        });
        el.addEventListener('dblclick', () => window.clearTimeout(clickTimer));

        // Right-click: wave goodbye until the page is reloaded.
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          dismiss(a);
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
      .catch((err) => {
        console.error('buddy: failed to load agent', err);
        // No buddy to lead it: the walkthrough waits for another try.
        pauseBuddyTour();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(clickTimer);
      liveAgentRef.current = null;
      created?.dispose();
      targetRef.current = null;
      pendingRef.current = 0;
      waitingRef.current = [];
      setAgent(null);
    };
  }, [agentId, dismiss, openTarget]);

  /**
   * Say a line, or keep it back while the buddy is quiet or leads the guided
   * walkthrough (its panel is where the balloon would be). Returns false when
   * the line was dropped: its group is switched off, too many lines are waiting,
   * or it is a tip during a quiet period. Tips leave one slot free for warnings
   * and pass `relevant`, checked when their turn comes: a tip for a page the
   * user already left is skipped instead of said late. `forget` is called when
   * a queued line is dropped because a walkthrough started before its turn.
   */
  const say = useCallback(
    (
      line: BuddyLine | null,
      opts: { relevant?: () => boolean; forget?: () => void } = {}
    ): boolean => {
      const agent = talker;
      if (!agent || !line?.text) return false;
      if (line.group && !isBuddyGroupOn(line.group)) return false;
      const isTip = line.kind === 'tip';
      if (line.group && (isBuddyQuiet() || isBuddyTourRunning())) {
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
      const waiting = { line, forget: opts.forget };
      waitingRef.current.push(waiting);
      let skipped = false;
      agent._addToQueue((complete: () => void) => {
        waitingRef.current = waitingRef.current.filter((entry) => entry !== waiting);
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
    [talker]
  );

  // App events (new nodes, radio state, DMs, mentions).
  useEffect(() => {
    if (!talker) return;
    return subscribeBuddyEvents((event) => {
      const p = propsRef.current;
      say(describeBuddyEvent(event, tRef.current, p.contacts, p.channels));
    });
  }, [talker, say]);

  // End of a mute, of the quiet hours or of the walkthrough: one line about
  // what was kept back.
  useEffect(() => {
    if (!talker) return;
    const check = () => {
      const quiet = isBuddyQuiet() || isBuddyTourRunning();
      if (wasQuietRef.current && !quiet) {
        const summary = heldBack.takeSummary();
        if (summary) say(quietSummaryLine(tRef.current, summary));
      }
      wasQuietRef.current = quiet;
    };
    check();
    const timer = window.setInterval(check, QUIET_CHECK_MS);
    window.addEventListener(BUDDY_PREFS_CHANGE_EVENT, check);
    const unsubscribeTour = subscribeBuddyTour(check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(BUDDY_PREFS_CHANGE_EVENT, check);
      unsubscribeTour();
    };
  }, [talker, say]);

  // Page tips, once per page per session.
  const activePage = props.activePage;
  useEffect(() => {
    if (!talker || !activePage || tipsSaid.has(activePage)) return;
    const queued = say(tipLine(tRef.current, activePage), {
      relevant: () => {
        const stillHere = propsRef.current.activePage === activePage;
        // Left before it was said: allow the tip again on the next visit.
        if (!stillHere) tipsSaid.delete(activePage);
        return stillHere;
      },
      forget: () => tipsSaid.delete(activePage),
    });
    if (queued) tipsSaid.add(activePage);
  }, [talker, activePage, say]);

  // Own radio battery.
  const ownBatteryMv = props.health?.radio_stats?.battery_mv ?? null;
  useEffect(() => {
    if (!talker || !ownBatteryMv || ownBatteryMv <= 0) return;
    const pct = mvToPercent(ownBatteryMv);
    if (batteryWatch.observe('self', pct, threshold)) {
      say(batteryOwnLine(tRef.current, pct));
    }
  }, [talker, batteryWatch, ownBatteryMv, threshold, say]);

  // Node batteries from stored telemetry (repeater + contact history).
  useEffect(() => {
    if (!talker) return;
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
  }, [talker, batteryWatch, threshold, say]);

  // Integrations (MQTT and the other fanout modules) that stay disconnected.
  // Checked on every health update and on a timer, so the grace period also
  // runs out while no update arrives. Nothing is tracked while the topic is
  // switched off, so it can still be said once it is back on.
  const fanoutStatuses = props.health?.fanout_statuses;
  useEffect(() => {
    if (!talker) return;
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
  }, [talker, fanoutStatuses, outageWatch, say]);

  // SNMP nodes that stopped answering. Reads stored poll results only
  // (GET /api/snmp/nodes); it never starts a poll or a discovery itself.
  useEffect(() => {
    if (!talker) return;
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
  }, [talker, outageWatch, say]);

  // RTFM-EV update (shared, cached /update-status check).
  useEffect(() => {
    if (!talker || !updateStatus?.update_available || updatesSaid.has('app')) return;
    updatesSaid.add('app');
    say(updateAppLine(tRef.current, updateStatus.commits_behind));
  }, [talker, updateStatus, say]);

  // OpenHop firmware update, only when OpenHop management is configured.
  useEffect(() => {
    if (!talker || updatesSaid.has('openhop')) return;
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
  }, [talker, say]);

  // Idle tricks every few minutes while nothing is being said.
  useEffect(() => {
    if (!agent) return;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          if (pendingRef.current === 0 && !isBuddyTourRunning()) agent.animate();
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

  if (!agent || (!touring && !menu)) return null;
  return createPortal(
    touring && runningTour ? (
      <BuddyTourRunner
        key={runningTour}
        tour={runningTour}
        agent={agent}
        summoned={tourOnly}
        channels={props.channels}
        contacts={props.contacts}
        activePage={activePage}
        zIndex={BUDDY_Z_INDEX}
        onSelectConversation={props.onSelectConversation}
        onOpenSettings={props.onOpenSettings}
      />
    ) : (
      menu && (
        <BuddyMenu
          key={menu}
          anchor={agent._el}
          initialView={menu}
          helpTarget={helpTarget}
          zIndex={BUDDY_Z_INDEX}
          onOpenTarget={openTarget}
          onHide={() => dismiss(agent)}
          onClose={closeMenu}
        />
      )
    ),
    document.body
  );
}
