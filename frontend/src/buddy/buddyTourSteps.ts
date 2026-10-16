import { CONTACT_TYPE_CLIENT, CONTACT_TYPE_SENSOR, type Contact } from '../types';
import { BUDDY_ANCHORS, tabAnchor, toolAnchor } from './buddyAnchors';

/**
 * The tours the buddy can give: the walkthrough of the app, and two add-on
 * tours for what a MeshCore 1.18 companion and the meshcomod firmware add.
 */
export type BuddyTourId = 'main' | 'mc118' | 'meshcomod';

/** In the order their first-run cards are offered. */
export const BUDDY_TOUR_IDS: readonly BuddyTourId[] = ['main', 'mc118', 'meshcomod'];

/**
 * What a stop opens before it points. Nothing here types, clicks or sends.
 * `contact`, `contact-info`, `sensor` and `meshcomod-contact` open the
 * contacts picked by `pickBuddyTourContacts`.
 */
export type BuddyTourPage =
  | 'channel'
  | 'map'
  | 'node'
  | 'settings'
  | 'radio-settings'
  | 'manual'
  | 'contact'
  | 'contact-info'
  | 'sensor'
  | 'meshcomod-contact';

/** What a stop needs to be part of a run; see `BuddyTourContext`. */
export type BuddyTourNeed =
  'channel' | 'cli' | 'cad' | 'filter' | 'contact' | 'sensor' | 'meshcomodContact';

export interface BuddyTourStep {
  /** Also the middle part of its i18n keys: `buddy_tour_<id>_title` / `_text`. Unique over all tours. */
  id: string;
  /** Page opened when the stop is reached; null leaves the page as it is. */
  page: BuddyTourPage | null;
  /**
   * Elements to point at (see buddyAnchors), most wanted first: the first one
   * on screen wins, which is how one stop serves every layout. None on screen
   * (or an empty list): the buddy stays home and only the text shows.
   */
  anchors: string[];
  /** Left out of the run when one of these is missing. */
  needs?: BuddyTourNeed[];
}

/** What this browser knows about the radio and the contacts, for leaving stops out. */
export interface BuddyTourContext {
  hasChannel: boolean;
  /** Companion command line (firmware 1.18+, meshcomod from v1.18.0.1). */
  cli: boolean;
  /** meshcomod CAD toggle reported as supported. */
  cad: boolean;
  /** meshcomod companion receive filter answered. */
  filter: boolean;
  /** A companion contact to open for the remote command line stops. */
  contactKey: string | null;
  sensorKey: string | null;
  /** meshcomod's built-in command contact. */
  meshcomodContactKey: string | null;
}

/**
 * The guided walkthrough, in order. A new stop needs a row here and its two
 * strings in every locale (`buddyTour.test.ts` checks both).
 */
export const BUDDY_TOUR_STEPS: readonly BuddyTourStep[] = [
  { id: 'welcome', page: null, anchors: [] },
  { id: 'radio', page: null, anchors: [BUDDY_ANCHORS.radio] },
  {
    id: 'sidebar',
    page: null,
    anchors: [BUDDY_ANCHORS.sidebarHead, tabAnchor('chats'), BUDDY_ANCHORS.menu],
  },
  {
    id: 'conversations',
    page: null,
    anchors: [BUDDY_ANCHORS.sidebarList, tabAnchor('chats'), BUDDY_ANCHORS.menu],
  },
  { id: 'chat', page: 'channel', anchors: [BUDDY_ANCHORS.composer], needs: ['channel'] },
  { id: 'chat_header', page: 'channel', anchors: [BUDDY_ANCHORS.chatHeader], needs: ['channel'] },
  { id: 'map', page: 'map', anchors: [BUDDY_ANCHORS.mapControls, tabAnchor('map')] },
  {
    id: 'tools',
    page: null,
    anchors: [BUDDY_ANCHORS.sidebarTools, tabAnchor('more'), BUDDY_ANCHORS.menu],
  },
  {
    id: 'my_node',
    page: 'node',
    anchors: [toolAnchor('tool-my-node'), tabAnchor('node'), BUDDY_ANCHORS.menu],
  },
  { id: 'settings', page: 'settings', anchors: [BUDDY_ANCHORS.settingsNav, BUDDY_ANCHORS.update] },
  { id: 'appearance', page: null, anchors: [BUDDY_ANCHORS.theme, tabAnchor('more')] },
  {
    id: 'guide',
    page: 'manual',
    anchors: [toolAnchor('tool-manual'), tabAnchor('more'), BUDDY_ANCHORS.menu],
  },
];

/** What a MeshCore 1.18 companion adds. Offered only with a command line on the radio. */
export const MC118_TOUR_STEPS: readonly BuddyTourStep[] = [
  { id: 'mc118_welcome', page: null, anchors: [] },
  { id: 'mc118_cli', page: 'radio-settings', anchors: [BUDDY_ANCHORS.cliRadio], needs: ['cli'] },
  { id: 'mc118_node_cli', page: 'node', anchors: [BUDDY_ANCHORS.cliRadio], needs: ['cli'] },
  {
    id: 'mc118_dm_cli',
    page: 'contact',
    anchors: [BUDDY_ANCHORS.chatCli, BUDDY_ANCHORS.chatHeader],
    needs: ['cli', 'contact'],
  },
  {
    id: 'mc118_remote_cli',
    page: 'contact-info',
    anchors: [BUDDY_ANCHORS.remoteCli],
    needs: ['cli', 'contact'],
  },
  {
    id: 'mc118_sensor',
    page: 'sensor',
    anchors: [BUDDY_ANCHORS.sensorPanel, BUDDY_ANCHORS.chatHeader],
    needs: ['sensor'],
  },
  { id: 'mc118_done', page: null, anchors: [] },
];

/** What the meshcomod (DMC-EV) companion firmware adds. Offered only on a meshcomod radio. */
export const MESHCOMOD_TOUR_STEPS: readonly BuddyTourStep[] = [
  { id: 'mcm_welcome', page: null, anchors: [] },
  { id: 'mcm_panel', page: 'radio-settings', anchors: [BUDDY_ANCHORS.meshcomod] },
  { id: 'mcm_cad', page: 'channel', anchors: [BUDDY_ANCHORS.chatCad], needs: ['channel', 'cad'] },
  {
    id: 'mcm_contact',
    page: 'meshcomod-contact',
    anchors: [BUDDY_ANCHORS.chatHeader],
    needs: ['meshcomodContact'],
  },
  { id: 'mcm_cli', page: 'radio-settings', anchors: [BUDDY_ANCHORS.cliRadio], needs: ['cli'] },
  { id: 'mcm_filter', page: 'radio-settings', anchors: [BUDDY_ANCHORS.cfilter], needs: ['filter'] },
  {
    id: 'mcm_filter_counters',
    page: 'radio-settings',
    anchors: [BUDDY_ANCHORS.cfilterCounters, BUDDY_ANCHORS.cfilter],
    needs: ['filter'],
  },
  {
    id: 'mcm_filter_backup',
    page: 'radio-settings',
    anchors: [BUDDY_ANCHORS.cfilterBackup, BUDDY_ANCHORS.cfilter],
    needs: ['filter'],
  },
  { id: 'mcm_done', page: null, anchors: [] },
];

export const BUDDY_TOURS: Readonly<Record<BuddyTourId, readonly BuddyTourStep[]>> = {
  main: BUDDY_TOUR_STEPS,
  mc118: MC118_TOUR_STEPS,
  meshcomod: MESHCOMOD_TOUR_STEPS,
};

/** The tour a stop belongs to (stop ids are unique over all tours). */
export function buddyTourOfStep(stepId: string | null): BuddyTourId {
  for (const tour of BUDDY_TOUR_IDS) {
    if (BUDDY_TOURS[tour].some((step) => step.id === stepId)) return tour;
  }
  return 'main';
}

function hasNeed(need: BuddyTourNeed, context: BuddyTourContext): boolean {
  switch (need) {
    case 'channel':
      return context.hasChannel;
    case 'cli':
      return context.cli;
    case 'cad':
      return context.cad;
    case 'filter':
      return context.filter;
    case 'contact':
      return context.contactKey !== null;
    case 'sensor':
      return context.sensorKey !== null;
    case 'meshcomodContact':
      return context.meshcomodContactKey !== null;
  }
}

/** The stops of a run of `tour`: a stop is left out when something it needs is missing. */
export function buddyTourStepsFor(tour: BuddyTourId, context: BuddyTourContext): BuddyTourStep[] {
  return BUDDY_TOURS[tour].filter((step) =>
    (step.needs ?? []).every((need) => hasNeed(need, context))
  );
}

/** The stops of a run of the walkthrough: the chat stops need a channel to open. */
export function buddyTourSteps(hasChannel: boolean): BuddyTourStep[] {
  return BUDDY_TOUR_STEPS.filter((step) => hasChannel || !(step.needs ?? []).includes('channel'));
}

export function buddyTourTitleKey(step: BuddyTourStep): string {
  return `buddy_tour_${step.id}_title`;
}

export function buddyTourTextKey(step: BuddyTourStep): string {
  return `buddy_tour_${step.id}_text`;
}

/** Public key prefix of meshcomod's built-in command contact ("MESHCM"). */
const MESHCOMOD_CONTACT_PREFIX = '4d455348434d';

export function isMeshcomodCommandContact(publicKey: string): boolean {
  return publicKey.toLowerCase().startsWith(MESHCOMOD_CONTACT_PREFIX);
}

function heardAt(contact: Contact): number {
  return contact.last_seen ?? contact.last_advert ?? 0;
}

function mostRecent(contacts: Contact[]): string | null {
  let best: Contact | null = null;
  for (const contact of contacts) {
    if (!best || heardAt(contact) > heardAt(best)) best = contact;
  }
  return best?.public_key ?? null;
}

/**
 * The contacts the add-on tours open: the most recently heard companion with
 * a full key (never meshcomod's command contact, which runs on the radio
 * itself), the most recently heard sensor, and meshcomod's command contact.
 */
export function pickBuddyTourContacts(
  contacts: Contact[]
): Pick<BuddyTourContext, 'contactKey' | 'sensorKey' | 'meshcomodContactKey'> {
  // Prefix-only contacts (shorter key) hide the Remote CLI switch and the console.
  const full = contacts.filter((contact) => contact.public_key.length === 64);
  const meshcomod = full.find((contact) => isMeshcomodCommandContact(contact.public_key));
  return {
    contactKey: mostRecent(
      full.filter(
        (contact) =>
          contact.type === CONTACT_TYPE_CLIENT && !isMeshcomodCommandContact(contact.public_key)
      )
    ),
    sensorKey: mostRecent(full.filter((contact) => contact.type === CONTACT_TYPE_SENSOR)),
    meshcomodContactKey: meshcomod?.public_key ?? null,
  };
}
