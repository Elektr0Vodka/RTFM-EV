import { BUDDY_ANCHORS, tabAnchor, toolAnchor } from './buddyAnchors';

/** What a stop opens before it points. Nothing here types, clicks or sends. */
export type BuddyTourPage = 'channel' | 'map' | 'node' | 'settings' | 'manual';

export interface BuddyTourStep {
  /** Also the middle part of its i18n keys: `buddy_tour_<id>_title` / `_text`. */
  id: string;
  /** Page opened when the stop is reached; null leaves the page as it is. */
  page: BuddyTourPage | null;
  /**
   * Elements to point at (see buddyAnchors), most wanted first: the first one
   * on screen wins, which is how one stop serves every layout. None on screen
   * (or an empty list): the buddy stays home and only the text shows.
   */
  anchors: string[];
  /** Left out of the tour when there is no channel to open. */
  needsChannel?: boolean;
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
  { id: 'chat', page: 'channel', anchors: [BUDDY_ANCHORS.composer], needsChannel: true },
  { id: 'chat_header', page: 'channel', anchors: [BUDDY_ANCHORS.chatHeader], needsChannel: true },
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

/** The stops of this run: the chat stops need a channel to open. */
export function buddyTourSteps(hasChannel: boolean): BuddyTourStep[] {
  return BUDDY_TOUR_STEPS.filter((step) => hasChannel || !step.needsChannel);
}

export function buddyTourTitleKey(step: BuddyTourStep): string {
  return `buddy_tour_${step.id}_title`;
}

export function buddyTourTextKey(step: BuddyTourStep): string {
  return `buddy_tour_${step.id}_text`;
}
