import type { BuddyAgent } from './agents';
import { findAnchorPoint } from './buddyAnchors';

/** Time an animation gets for its exit frames before its caller moves on anyway. */
const ANIMATION_EXIT_GRACE_MS = 1500;
/** Longest wait for a running idle animation to make way for the next one. */
const IDLE_HANDOVER_MAX_MS = 4000;
const IDLE_HANDOVER_POLL_MS = 100;
/** clippyjs `Animator.States` (not exported by the library). */
const ANIMATION_EXITED = 0;
const ANIMATION_WAITING = 1;
/** The library keeps the buddy this far from the screen edge (`_clampXY`). */
const SCREEN_EDGE_PX = 5;

/**
 * Play one animation, then call `done` (exactly once). An animation that holds
 * its last pose is told to exit right away (or, with `hold`, when `maxMs` is
 * up); one that runs past `maxMs` is told to exit and gets a short grace for
 * its exit frames. `done` is also called straight away when there is nothing
 * to play or the library internals this relies on (`_playInternal`,
 * `_animator.exitAnimation`, `_animator.currentAnimationName`) are gone, so a
 * line is never lost over an animation. Returns a function that drops the
 * animation's timers without calling `done`.
 */
export function playBriefly(
  agent: BuddyAgent,
  name: string | null,
  maxMs: number,
  done: () => void,
  hold = false
): () => void {
  if (!name || typeof agent._playInternal !== 'function') {
    done();
    return () => {};
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
      if (finished) return;
      if (state === ANIMATION_WAITING && !hold) exit();
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
  return () => {
    finished = true;
    window.clearTimeout(timer);
  };
}

/**
 * The animation that points toward a spot on screen (viewport px), or null:
 * no spot, or the character has no gesture that way. clippyjs only knows four
 * directions, so this is a direction, not a precise pointer.
 */
export function gestureAnimationAt(
  agent: BuddyAgent,
  point: { x: number; y: number } | null
): string | null {
  if (!point || typeof agent._getDirection !== 'function') return null;
  try {
    const direction = agent._getDirection(point.x, point.y);
    return (
      [`Gesture${direction}`, `Look${direction}`].find((name) => agent.hasAnimation(name)) ?? null
    );
  } catch {
    return null;
  }
}

/** The animation that points toward an anchor (see buddyAnchors), or null when it is not on screen. */
export function gestureAnimation(agent: BuddyAgent, anchor: string | null): string | null {
  if (!anchor) return null;
  try {
    return gestureAnimationAt(agent, findAnchorPoint(anchor));
  } catch {
    return null;
  }
}

/** Sprite size of the character (px). */
export function buddyFrameSize(agent: BuddyAgent): { width: number; height: number } {
  const [width, height] = (agent._animator._data as { framesize?: [number, number] }).framesize ?? [
    124, 93,
  ];
  return { width, height };
}

/** Top-left corner of the buddy on screen (viewport px), or null before it has one. */
export function buddySpot(agent: BuddyAgent): { x: number; y: number } | null {
  const x = parseFloat(agent._el.style.left);
  const y = parseFloat(agent._el.style.top);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Move the buddy so its top-left corner is at (x, y), kept on screen. Over
 * `ms` it travels there, with the character's own Move animation when it has
 * one; `ms` 0 jumps. `done` is called once it has arrived. Returns a function
 * that stops the bookkeeping (not the buddy: a later glide just takes over).
 *
 * This moves the element with a CSS transition instead of the library's
 * `moveTo()`: that one is queued behind speech and cannot be redirected, which
 * a tour needs when the user clicks on before the buddy has arrived.
 */
export function glideTo(
  agent: BuddyAgent,
  x: number,
  y: number,
  ms: number,
  done: () => void = () => {}
): () => void {
  const el = agent._el;
  const { width, height } = buddyFrameSize(agent);
  const left = Math.max(SCREEN_EDGE_PX, Math.min(x, window.innerWidth - width - SCREEN_EDGE_PX));
  const top = Math.max(SCREEN_EDGE_PX, Math.min(y, window.innerHeight - height - SCREEN_EDGE_PX));
  const from = buddySpot(agent);
  if (ms <= 0 || !from || (Math.abs(from.x - left) < 1 && Math.abs(from.y - top) < 1)) {
    el.style.transition = '';
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    done();
    return () => {};
  }
  let move: string | null = null;
  try {
    const name = `Move${agent._getDirection(left + width / 2, top + height / 2)}`;
    if (agent.hasAnimation(name)) move = name;
  } catch {
    // No travel animation then; the buddy still glides.
  }
  el.style.transition = `left ${ms}ms ease-in-out, top ${ms}ms ease-in-out`;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  let cancelled = false;
  const cancelMove = playBriefly(agent, move, ms, () => {}, true);
  const timer = window.setTimeout(() => {
    cancelled = true;
    el.style.transition = '';
    done();
  }, ms);
  return () => {
    if (cancelled) return;
    cancelled = true;
    window.clearTimeout(timer);
    cancelMove();
    // A held travel pose would otherwise stay until the next animation.
    if (move) {
      try {
        agent._animator.exitAnimation();
      } catch {
        // Nothing to end.
      }
    }
    el.style.transition = '';
  };
}
