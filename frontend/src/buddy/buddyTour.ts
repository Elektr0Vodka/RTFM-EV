import { useSyncExternalStore } from 'react';
import { BUDDY_TOUR_KEY } from './buddyTourBoot';
import {
  BUDDY_TOUR_IDS,
  BUDDY_TOURS,
  buddyTourOfStep,
  type BuddyTourId,
  type BuddyTourStep,
} from './buddyTourSteps';

/**
 * State of the buddy's tours (per browser, like the other buddy prefs): the
 * guided walkthrough (`main`) and the add-on tours (`mc118`, `meshcomod`).
 * Each tour has its own stored state; one runs at a time.
 *
 * - `offer`: its card has not been answered yet. The walkthrough is offered on
 *   a fresh install, an add-on tour the first time this browser sees a radio
 *   that has what it shows.
 * - `running`: on screen. Kept in memory only, so a reload during a tour comes
 *   back `paused` at the same stop instead of moving the page around unasked.
 * - `paused`: stopped at `stepId`; the guide and the buddy menu resume it.
 * - `idle`: never started, ended, declined, or (walkthrough) an existing user.
 */
export type BuddyTourPhase = 'idle' | 'offer' | 'running' | 'paused';

export interface BuddyTourState {
  phase: BuddyTourPhase;
  /** The stop the tour is at (running or paused), else null. */
  stepId: string | null;
}

/** The radio features the add-on tours are about, as seen so far on this page load. */
export interface BuddyTourFeatures {
  /** Companion command line (firmware 1.18+): the MeshCore 1.18 tour. */
  cli: boolean;
  /** meshcomod firmware: the meshcomod tour. */
  meshcomod: boolean;
  /** meshcomod companion receive filter. */
  filter: boolean;
  /** meshcomod CAD toggle. */
  cad: boolean;
}

type StoredStatus = 'offer' | 'paused' | 'done' | 'declined' | 'existing';

interface Stored {
  status: StoredStatus;
  step?: string;
}

const STATUSES: readonly StoredStatus[] = ['offer', 'paused', 'done', 'declined', 'existing'];

const NO_FEATURES: BuddyTourFeatures = { cli: false, meshcomod: false, filter: false, cad: false };

/** The walkthrough keeps the key it always had; the add-on tours get their own. */
export function buddyTourStorageKey(tour: BuddyTourId): string {
  return tour === 'main' ? BUDDY_TOUR_KEY : `${BUDDY_TOUR_KEY}-${tour}`;
}

function firstStep(tour: BuddyTourId): string {
  return BUDDY_TOURS[tour][0].id;
}

let running: BuddyTourId | null = null;
// A card was answered with "Not now" or "Don't ask again": no more cards on
// this page load, so one answer is not followed straight away by the next card.
let cardsDone = false;
const offerSnoozed = new Set<BuddyTourId>();
// Only ever switched on during a page load: a radio that reconnects does not
// take a tour or its stops away halfway.
let features: BuddyTourFeatures = NO_FEATURES;
let states: Partial<Record<BuddyTourId, BuddyTourState>> = {};
let offerCache: { value: BuddyTourId | null } | null = null;
const listeners = new Set<() => void>();

function load(tour: BuddyTourId): Stored | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(buddyTourStorageKey(tour)) ?? 'null'
    ) as Partial<Stored>;
    if (!parsed || !STATUSES.includes(parsed.status as StoredStatus)) return null;
    const known = BUDDY_TOURS[tour].some((step) => step.id === parsed.step);
    return { status: parsed.status as StoredStatus, step: known ? parsed.step : undefined };
  } catch {
    return null;
  }
}

function save(tour: BuddyTourId, stored: Stored): void {
  try {
    localStorage.setItem(buddyTourStorageKey(tour), JSON.stringify(stored));
  } catch {
    // localStorage may be unavailable; the tour then lives for this page only.
  }
}

// The stop of a tour without working storage.
const memoryStep: Partial<Record<BuddyTourId, string>> = {};

function compute(tour: BuddyTourId): BuddyTourState {
  const stored = load(tour);
  if (running === tour) {
    return { phase: 'running', stepId: stored?.step ?? memoryStep[tour] ?? firstStep(tour) };
  }
  if (stored?.status === 'paused')
    return { phase: 'paused', stepId: stored.step ?? firstStep(tour) };
  if (stored?.status === 'offer' && !offerSnoozed.has(tour))
    return { phase: 'offer', stepId: null };
  return { phase: 'idle', stepId: null };
}

function changed(): void {
  states = {};
  offerCache = null;
  for (const listener of [...listeners]) listener();
}

/** The state of one tour (the walkthrough when none is named). */
export function getBuddyTourState(tour: BuddyTourId = 'main'): BuddyTourState {
  states[tour] ??= compute(tour);
  return states[tour];
}

export function subscribeBuddyTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBuddyTour(tour: BuddyTourId = 'main'): BuddyTourState {
  const get = () => getBuddyTourState(tour);
  return useSyncExternalStore(subscribeBuddyTour, get, get);
}

/** The tour on screen, or null. */
export function getRunningBuddyTour(): BuddyTourId | null {
  return running;
}

export function useRunningBuddyTour(): BuddyTourId | null {
  return useSyncExternalStore(subscribeBuddyTour, getRunningBuddyTour, getRunningBuddyTour);
}

export function isBuddyTourRunning(): boolean {
  return running !== null;
}

export function getBuddyTourFeatures(): BuddyTourFeatures {
  return features;
}

export function useBuddyTourFeatures(): BuddyTourFeatures {
  return useSyncExternalStore(subscribeBuddyTour, getBuddyTourFeatures, getBuddyTourFeatures);
}

/** Whether `tour` can be given with the radio seen on this page load. */
export function isBuddyTourAvailable(
  tour: BuddyTourId,
  seen: BuddyTourFeatures = features
): boolean {
  if (tour === 'mc118') return seen.cli;
  if (tour === 'meshcomod') return seen.meshcomod;
  return true;
}

/**
 * The tour whose card to show, or null: the first one in `BUDDY_TOUR_IDS`
 * that is waiting for an answer and can be given. Never while a tour runs.
 */
export function getBuddyTourOffer(): BuddyTourId | null {
  if (!offerCache) {
    let value: BuddyTourId | null = null;
    if (running === null && !cardsDone) {
      value =
        BUDDY_TOUR_IDS.find(
          (tour) => isBuddyTourAvailable(tour) && getBuddyTourState(tour).phase === 'offer'
        ) ?? null;
    }
    offerCache = { value };
  }
  return offerCache.value;
}

export function useBuddyTourOffer(): BuddyTourId | null {
  return useSyncExternalStore(subscribeBuddyTour, getBuddyTourOffer, getBuddyTourOffer);
}

/**
 * Called with what the connected radio reports. A feature seen once stays
 * for this page load. The first time this browser sees a radio with what an
 * add-on tour shows, that tour is offered once (also to existing users).
 */
export function noteBuddyTourRadio(seen: BuddyTourFeatures): void {
  const next: BuddyTourFeatures = {
    cli: features.cli || seen.cli,
    meshcomod: features.meshcomod || seen.meshcomod,
    filter: features.filter || seen.filter,
    cad: features.cad || seen.cad,
  };
  let dirty =
    next.cli !== features.cli ||
    next.meshcomod !== features.meshcomod ||
    next.filter !== features.filter ||
    next.cad !== features.cad;
  if (dirty) features = next;
  for (const tour of ['mc118', 'meshcomod'] as const) {
    if (isBuddyTourAvailable(tour, next) && load(tour) === null) {
      save(tour, { status: 'offer' });
      dirty = true;
    }
  }
  if (dirty) changed();
}

function goTo(tour: BuddyTourId, stepId: string): void {
  memoryStep[tour] = stepId;
  save(tour, { status: 'paused', step: stepId });
}

/** Start `tour` at its first stop (also the way to start over). Another running tour is paused. */
export function startBuddyTour(tour: BuddyTourId = 'main'): void {
  running = tour;
  goTo(tour, firstStep(tour));
  changed();
}

/** Carry on at the stop a paused tour was left at. */
export function resumeBuddyTour(tour: BuddyTourId = 'main'): void {
  const stored = load(tour);
  running = tour;
  goTo(tour, stored?.status === 'paused' && stored.step ? stored.step : firstStep(tour));
  changed();
}

export function pauseBuddyTour(): void {
  if (running === null) return;
  running = null;
  changed();
}

export function endBuddyTour(): void {
  if (running === null) return;
  save(running, { status: 'done' });
  running = null;
  changed();
}

/**
 * Move `delta` stops along `steps` (the stops of this run of the running
 * tour). Stepping past the last stop ends the tour; stepping back from the
 * first does nothing. A stop that is not part of this run counts as the one
 * before it.
 */
export function moveBuddyTour(steps: readonly BuddyTourStep[], delta: 1 | -1): void {
  if (running === null || steps.length === 0) return;
  const tour = running;
  const next = buddyTourStepIndex(steps, getBuddyTourState(tour).stepId) + delta;
  if (next >= steps.length) {
    endBuddyTour();
    return;
  }
  if (next < 0) return;
  goTo(tour, steps[next].id);
  changed();
}

/** Where `stepId` sits in `steps`; a stop left out of this run maps to the one before it. */
export function buddyTourStepIndex(steps: readonly BuddyTourStep[], stepId: string | null): number {
  const exact = steps.findIndex((step) => step.id === stepId);
  if (exact >= 0) return exact;
  const all = BUDDY_TOURS[buddyTourOfStep(stepId)];
  const position = all.findIndex((step) => step.id === stepId);
  for (let i = position - 1; i >= 0; i -= 1) {
    const index = steps.findIndex((step) => step.id === all[i].id);
    if (index >= 0) return index;
  }
  return 0;
}

/** A card's "Not now": gone for this page load, back on the next. */
export function snoozeBuddyTourOffer(tour: BuddyTourId = 'main'): void {
  offerSnoozed.add(tour);
  cardsDone = true;
  changed();
}

/** A card's "Don't ask again". */
export function declineBuddyTourOffer(tour: BuddyTourId = 'main'): void {
  save(tour, { status: 'declined' });
  cardsDone = true;
  changed();
}

/** Test helper: forget the in-memory part (a reload cannot be simulated). */
export function __resetBuddyTourForTests(): void {
  running = null;
  cardsDone = false;
  offerSnoozed.clear();
  features = NO_FEATURES;
  for (const tour of BUDDY_TOUR_IDS) delete memoryStep[tour];
  states = {};
  offerCache = null;
}
