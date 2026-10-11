import { useSyncExternalStore } from 'react';
import { BUDDY_TOUR_KEY } from './buddyTourBoot';
import { BUDDY_TOUR_STEPS, type BuddyTourStep } from './buddyTourSteps';

/**
 * State of the guided walkthrough (per browser, like the other buddy prefs).
 *
 * - `offer`: a fresh install that has not answered the first-run card yet.
 * - `running`: on screen. Kept in memory only, so a reload during a tour comes
 *   back `paused` at the same stop instead of moving the page around unasked.
 * - `paused`: stopped at `stepId`; the guide and the buddy menu resume it.
 * - `idle`: never started, ended, declined, or an existing user.
 */
export type BuddyTourPhase = 'idle' | 'offer' | 'running' | 'paused';

export interface BuddyTourState {
  phase: BuddyTourPhase;
  /** The stop the tour is at (running or paused), else null. */
  stepId: string | null;
}

type StoredStatus = 'offer' | 'paused' | 'done' | 'declined' | 'existing';

interface Stored {
  status: StoredStatus;
  step?: string;
}

const STATUSES: readonly StoredStatus[] = ['offer', 'paused', 'done', 'declined', 'existing'];
const FIRST_STEP = BUDDY_TOUR_STEPS[0].id;

let running = false;
// "Not now" on the first-run card: asked again on the next load.
let offerSnoozed = false;
let state: BuddyTourState | null = null;
const listeners = new Set<() => void>();

function load(): Stored | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(BUDDY_TOUR_KEY) ?? 'null') as Partial<Stored>;
    if (!parsed || !STATUSES.includes(parsed.status as StoredStatus)) return null;
    const known = BUDDY_TOUR_STEPS.some((step) => step.id === parsed.step);
    return { status: parsed.status as StoredStatus, step: known ? parsed.step : undefined };
  } catch {
    return null;
  }
}

function save(stored: Stored): void {
  try {
    localStorage.setItem(BUDDY_TOUR_KEY, JSON.stringify(stored));
  } catch {
    // localStorage may be unavailable; the tour then lives for this page only.
  }
}

// The stop of a tour without working storage.
let memoryStep: string = FIRST_STEP;

function compute(): BuddyTourState {
  const stored = load();
  if (running) return { phase: 'running', stepId: stored?.step ?? memoryStep };
  if (stored?.status === 'paused') return { phase: 'paused', stepId: stored.step ?? FIRST_STEP };
  if (stored?.status === 'offer' && !offerSnoozed) return { phase: 'offer', stepId: null };
  return { phase: 'idle', stepId: null };
}

function changed(): void {
  state = compute();
  for (const listener of [...listeners]) listener();
}

export function getBuddyTourState(): BuddyTourState {
  state ??= compute();
  return state;
}

export function subscribeBuddyTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBuddyTour(): BuddyTourState {
  return useSyncExternalStore(subscribeBuddyTour, getBuddyTourState, getBuddyTourState);
}

export function isBuddyTourRunning(): boolean {
  return running;
}

function goTo(stepId: string): void {
  memoryStep = stepId;
  save({ status: 'paused', step: stepId });
}

/** Start at the first stop (also the way to start over). */
export function startBuddyTour(): void {
  running = true;
  goTo(FIRST_STEP);
  changed();
}

/** Carry on at the stop a paused tour was left at. */
export function resumeBuddyTour(): void {
  const stored = load();
  running = true;
  goTo(stored?.status === 'paused' && stored.step ? stored.step : FIRST_STEP);
  changed();
}

export function pauseBuddyTour(): void {
  if (!running) return;
  running = false;
  changed();
}

export function endBuddyTour(): void {
  running = false;
  save({ status: 'done' });
  changed();
}

/**
 * Move `delta` stops along `steps` (the stops of this run). Stepping past the
 * last stop ends the tour; stepping back from the first does nothing. A stop
 * that is not part of this run counts as the one before it.
 */
export function moveBuddyTour(steps: readonly BuddyTourStep[], delta: 1 | -1): void {
  if (!running || steps.length === 0) return;
  const next = buddyTourStepIndex(steps, getBuddyTourState().stepId) + delta;
  if (next >= steps.length) {
    endBuddyTour();
    return;
  }
  if (next < 0) return;
  goTo(steps[next].id);
  changed();
}

/** Where `stepId` sits in `steps`; a stop left out of this run maps to the one before it. */
export function buddyTourStepIndex(steps: readonly BuddyTourStep[], stepId: string | null): number {
  const exact = steps.findIndex((step) => step.id === stepId);
  if (exact >= 0) return exact;
  const position = BUDDY_TOUR_STEPS.findIndex((step) => step.id === stepId);
  for (let i = position - 1; i >= 0; i -= 1) {
    const index = steps.findIndex((step) => step.id === BUDDY_TOUR_STEPS[i].id);
    if (index >= 0) return index;
  }
  return 0;
}

/** First-run card, "Not now": gone for this page load, back on the next. */
export function snoozeBuddyTourOffer(): void {
  offerSnoozed = true;
  changed();
}

/** First-run card, "Don't ask again". */
export function declineBuddyTourOffer(): void {
  save({ status: 'declined' });
  changed();
}

/** Test helper: forget the in-memory part (a reload cannot be simulated). */
export function __resetBuddyTourForTests(): void {
  running = false;
  offerSnoozed = false;
  memoryStep = FIRST_STEP;
  state = null;
}
