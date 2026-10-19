import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Channel, Contact, HealthStatus } from '../types';
import { CONTACT_TYPE_CLIENT, CONTACT_TYPE_SENSOR } from '../types';
import en from '../i18n/locales/en.json';
import nl from '../i18n/locales/nl.json';
import de from '../i18n/locales/de.json';

const loadBuddyAgentMock = vi.fn();
vi.mock('../buddy/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../buddy/agents')>()),
  loadBuddyAgent: (...args: unknown[]) => loadBuddyAgentMock(...args),
}));

const apiMock = vi.hoisted(() => ({
  getLatestTelemetry: vi.fn(),
  snmpNodes: vi.fn(),
  getOpenHopStatus: vi.fn(),
  getOpenHopUpdateStatus: vi.fn(),
  getMeshcomodConfig: vi.fn(),
}));
vi.mock('../api', () => ({ api: apiMock }));

vi.mock('../hooks/useUpdateStatus', () => ({
  useUpdateStatus: () => ({ status: null }),
}));

import { BuddyHost, __resetBuddySessionState } from '../buddy/BuddyHost';
import { clearBuddyHistory } from '../buddy/buddyHistory';
import { setBuddyAgent, __resetBuddyMuteForTests } from '../buddy/buddyPrefs';
import {
  buddyTourStepIndex,
  buddyTourStorageKey,
  declineBuddyTourOffer,
  endBuddyTour,
  getBuddyTourFeatures,
  getBuddyTourOffer,
  getBuddyTourState,
  getRunningBuddyTour,
  moveBuddyTour,
  noteBuddyTourRadio,
  pauseBuddyTour,
  resumeBuddyTour,
  snoozeBuddyTourOffer,
  startBuddyTour,
  __resetBuddyTourForTests,
  type BuddyTourFeatures,
} from '../buddy/buddyTour';
import { BUDDY_TOUR_KEY, markBuddyTourInstall } from '../buddy/buddyTourBoot';
import {
  BUDDY_TOURS,
  buddyTourStepsFor,
  buddyTourTextKey,
  buddyTourTitleKey,
  pickBuddyTourContacts,
  type BuddyTourContext,
} from '../buddy/buddyTourSteps';
import { ManualView } from '../components/ManualView';
import { __resetMeshcomodConfigCache } from '../hooks/useMeshcomodConfig';
import { applyTheme } from '../utils/theme';

const ALICE_KEY = 'a1'.repeat(32);
const BOB_KEY = 'b2'.repeat(32);
const SENSOR_KEY = 'c3'.repeat(32);
const MESHCOMOD_KEY = '4d455348434d' + '0'.repeat(52);
const CHANNEL_KEY = 'c1'.repeat(16);

const NONE: BuddyTourFeatures = { cli: false, meshcomod: false, filter: false, cad: false };

function contact(public_key: string, name: string, type: number, last_seen: number | null) {
  return { public_key, name, type, last_seen, last_advert: last_seen } as Contact;
}

const CONTACTS: Contact[] = [
  contact(ALICE_KEY, 'Alice', CONTACT_TYPE_CLIENT, 100),
  contact(BOB_KEY, 'Bob', CONTACT_TYPE_CLIENT, 300),
  contact(SENSOR_KEY, 'Weather', CONTACT_TYPE_SENSOR, 50),
  // Heard most recently, but it is meshcomod's local command contact.
  contact(MESHCOMOD_KEY, 'Meshcomod', CONTACT_TYPE_CLIENT, 900),
];

function context(overrides: Partial<BuddyTourContext> = {}): BuddyTourContext {
  return {
    hasChannel: false,
    cli: false,
    cad: false,
    filter: false,
    contactKey: null,
    sensorKey: null,
    meshcomodContactKey: null,
    ...overrides,
  };
}

function health(info: Partial<NonNullable<HealthStatus['radio_device_info']>>): HealthStatus {
  return {
    radio_connected: true,
    radio_device_info: {
      model: null,
      firmware_build: null,
      firmware_version: null,
      max_contacts: null,
      max_channels: null,
      is_meshcomod: false,
      is_openhop: false,
      ...info,
    },
  } as HealthStatus;
}

function hostProps(overrides: Partial<Parameters<typeof BuddyHost>[0]> = {}) {
  return {
    health: null as HealthStatus | null,
    contacts: CONTACTS,
    channels: [{ key: CHANNEL_KEY, name: 'Public' } as Channel],
    activePage: null,
    onSelectConversation: vi.fn(),
    onOpenSettings: vi.fn(),
    onNavigateMentionToMessage: vi.fn(),
    ...overrides,
  };
}

/** Just enough of a clippyjs Agent for a summoned tour buddy. */
function makeFakeAgent() {
  const el = document.createElement('div');
  const balloonEl = document.createElement('div');
  document.body.append(el, balloonEl);
  const agent = {
    _el: el,
    _animator: {
      _data: { framesize: [124, 93] },
      exitAnimation: vi.fn(),
      currentAnimationName: undefined as string | undefined,
    },
    _balloon: {
      _balloon: balloonEl,
      CLOSE_BALLOON_DELAY: 2000,
      hide: vi.fn(),
      speak: vi.fn((complete: () => void) => complete()),
    },
    hasAnimation: () => false,
    _playInternal: vi.fn(),
    _getDirection: vi.fn(() => 'Left'),
    _addToQueue: vi.fn((fn: (complete: () => void) => void) => fn(() => {})),
    _onQueueEmpty: vi.fn(),
    stop: vi.fn(),
    show: vi.fn(),
    hide: vi.fn((_fast: boolean, cb?: () => void) => cb?.()),
    reposition: vi.fn(),
    animate: vi.fn(),
    dispose: vi.fn(() => {
      el.remove();
      balloonEl.remove();
    }),
  };
  return agent;
}

function panel(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Guided walkthrough' });
}

/**
 * The panel is on screen and its effects have run. The buddy loads outside
 * act(), so React can commit the panel before running its effects (the tour
 * subscription, opening the stop's page); a test that moves the tour then
 * would move it unseen. The panel focuses "Next" in one of those effects.
 */
async function waitForPanel(): Promise<void> {
  await waitFor(() => expect(panel().contains(document.activeElement)).toBe(true));
}

function stored(tour: 'main' | 'mc118' | 'meshcomod') {
  return JSON.parse(localStorage.getItem(buddyTourStorageKey(tour)) ?? 'null');
}

/** A browser that already used the app: the walkthrough is never offered. */
function existingUser() {
  localStorage.setItem('remoteterm-theme', 'light');
  markBuddyTourInstall(localStorage);
  __resetBuddyTourForTests();
}

beforeEach(() => {
  localStorage.clear();
  applyTheme('original');
  __resetBuddyTourForTests();
  __resetBuddySessionState();
  __resetBuddyMuteForTests();
  __resetMeshcomodConfigCache();
  clearBuddyHistory();
  loadBuddyAgentMock.mockReset().mockResolvedValue(makeFakeAgent());
  apiMock.getLatestTelemetry.mockReset().mockResolvedValue({});
  apiMock.snmpNodes.mockReset().mockResolvedValue([]);
  apiMock.getOpenHopStatus.mockReset().mockResolvedValue({ configured: false });
  apiMock.getOpenHopUpdateStatus.mockReset();
  apiMock.getMeshcomodConfig.mockReset().mockResolvedValue({
    cad_supported: true,
    cad_enabled: false,
    gps_supported: false,
    gps_enabled: null,
    gps_interval: null,
  });
});

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  localStorage.clear();
  __resetBuddyTourForTests();
});

describe('add-on tour stops', () => {
  it('has a title and a text for every stop of every tour in every language', () => {
    const locales = { en, nl, de } as unknown as Record<string, Record<string, string>>;
    const keys = [
      'buddy_tour_offer_mc118_title',
      'buddy_tour_offer_mc118_text',
      'buddy_tour_offer_meshcomod_title',
      'buddy_tour_offer_meshcomod_text',
      'buddy_menu_tour_mc118',
      'buddy_menu_tour_mc118_resume',
      'buddy_menu_tour_meshcomod',
      'buddy_menu_tour_meshcomod_resume',
    ];
    for (const tour of ['mc118', 'meshcomod'] as const) {
      for (const suffix of ['start', 'resume', 'title', 'running']) {
        keys.push(`manual_tour_${tour}_${suffix}`);
      }
      for (const step of BUDDY_TOURS[tour])
        keys.push(buddyTourTitleKey(step), buddyTourTextKey(step));
    }
    for (const [locale, strings] of Object.entries(locales)) {
      for (const key of keys) expect(strings[key], `${locale}: ${key}`).toBeTruthy();
    }
  });

  it('keeps stop ids unique over all tours', () => {
    const ids = Object.values(BUDDY_TOURS).flatMap((steps) => steps.map((step) => step.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves the MeshCore 1.18 stops out that have no contact or sensor to open', () => {
    const bare = buddyTourStepsFor('mc118', context({ cli: true })).map((step) => step.id);
    expect(bare).toEqual(['mc118_welcome', 'mc118_cli', 'mc118_node_cli', 'mc118_done']);
    const full = buddyTourStepsFor(
      'mc118',
      context({ cli: true, contactKey: ALICE_KEY, sensorKey: SENSOR_KEY })
    );
    expect(full).toHaveLength(BUDDY_TOURS.mc118.length);
  });

  it('shows only the meshcomod stops the radio has', () => {
    const bare = buddyTourStepsFor('meshcomod', context()).map((step) => step.id);
    expect(bare).toEqual(['mcm_welcome', 'mcm_panel', 'mcm_done']);
    // CAD needs a channel to open as well.
    const noChannel = buddyTourStepsFor('meshcomod', context({ cad: true })).map((s) => s.id);
    expect(noChannel).not.toContain('mcm_cad');
    const full = buddyTourStepsFor(
      'meshcomod',
      context({
        hasChannel: true,
        cad: true,
        cli: true,
        filter: true,
        meshcomodContactKey: MESHCOMOD_KEY,
      })
    );
    expect(full).toHaveLength(BUDDY_TOURS.meshcomod.length);
  });

  it('picks the most recent companion, never the Meshcomod contact, and skips prefix-only keys', () => {
    expect(pickBuddyTourContacts(CONTACTS)).toEqual({
      contactKey: BOB_KEY,
      sensorKey: SENSOR_KEY,
      meshcomodContactKey: MESHCOMOD_KEY,
    });
    const prefixOnly = contact('d4'.repeat(6), 'Short', CONTACT_TYPE_CLIENT, 999);
    expect(pickBuddyTourContacts([prefixOnly])).toEqual({
      contactKey: null,
      sensorKey: null,
      meshcomodContactKey: null,
    });
  });

  it('carries on from the stop before one that fell out of the run', () => {
    const steps = buddyTourStepsFor('mc118', context({ cli: true }));
    expect(steps[buddyTourStepIndex(steps, 'mc118_remote_cli')].id).toBe('mc118_node_cli');
  });
});

describe('add-on tour state', () => {
  it('offers an add-on tour once when its radio is first seen, also to an existing user', () => {
    existingUser();
    expect(getBuddyTourOffer()).toBeNull();
    noteBuddyTourRadio({ ...NONE, cli: true });
    expect(stored('mc118')).toEqual({ status: 'offer' });
    expect(stored('meshcomod')).toBeNull();
    expect(getBuddyTourOffer()).toBe('mc118');

    startBuddyTour('mc118');
    expect(getBuddyTourOffer()).toBeNull();
    endBuddyTour();
    expect(stored('mc118')).toEqual({ status: 'done' });

    __resetBuddyTourForTests();
    noteBuddyTourRadio({ ...NONE, cli: true });
    expect(getBuddyTourOffer()).toBeNull();
  });

  it('keeps features seen once for the page load', () => {
    noteBuddyTourRadio({ cli: true, meshcomod: true, filter: true, cad: false });
    noteBuddyTourRadio(NONE);
    expect(getBuddyTourFeatures()).toEqual({
      cli: true,
      meshcomod: true,
      filter: true,
      cad: false,
    });
  });

  it('shows one card at a time: the walkthrough first, nothing more after an answer', () => {
    localStorage.clear(); // a fresh install
    markBuddyTourInstall(localStorage);
    __resetBuddyTourForTests();
    noteBuddyTourRadio({ ...NONE, cli: true, meshcomod: true });
    expect(getBuddyTourOffer()).toBe('main');

    declineBuddyTourOffer('main');
    expect(getBuddyTourOffer()).toBeNull();

    __resetBuddyTourForTests();
    noteBuddyTourRadio({ ...NONE, cli: true, meshcomod: true });
    expect(getBuddyTourOffer()).toBe('mc118');
    snoozeBuddyTourOffer('mc118');
    expect(getBuddyTourOffer()).toBeNull();

    __resetBuddyTourForTests();
    noteBuddyTourRadio({ ...NONE, cli: true, meshcomod: true });
    expect(getBuddyTourOffer()).toBe('mc118');
  });

  it('does not offer a stored add-on card while its radio is not there', () => {
    existingUser();
    localStorage.setItem(buddyTourStorageKey('meshcomod'), JSON.stringify({ status: 'offer' }));
    expect(getBuddyTourOffer()).toBeNull();
    noteBuddyTourRadio({ ...NONE, meshcomod: true });
    expect(getBuddyTourOffer()).toBe('meshcomod');
  });

  it('keeps each tour where it was left, under its own key', () => {
    startBuddyTour();
    moveBuddyTour(BUDDY_TOURS.main, 1);
    startBuddyTour('mc118');
    expect(getRunningBuddyTour()).toBe('mc118');
    expect(getBuddyTourState()).toEqual({ phase: 'paused', stepId: 'radio' });
    moveBuddyTour(BUDDY_TOURS.mc118, 1);
    pauseBuddyTour();

    expect(JSON.parse(localStorage.getItem(BUDDY_TOUR_KEY) ?? 'null')).toEqual({
      status: 'paused',
      step: 'radio',
    });
    expect(stored('mc118')).toEqual({ status: 'paused', step: 'mc118_cli' });

    resumeBuddyTour('mc118');
    expect(getBuddyTourState('mc118')).toEqual({ phase: 'running', stepId: 'mc118_cli' });
  });
});

describe('BuddyHost with the add-on tours', () => {
  it('offers the MeshCore 1.18 tour when a 1.18 radio connects, and opens each stop', async () => {
    existingUser();
    const props = hostProps({ health: health({ cli_supported: true }) });
    render(<BuddyHost {...props} />);
    const card = await screen.findByRole('dialog', { name: 'New in MeshCore 1.18' });
    fireEvent.click(within(card).getByRole('button', { name: 'Start walkthrough' }));
    await waitForPanel();
    expect(within(panel()).getByRole('heading', { name: 'MeshCore 1.18' })).toBeInTheDocument();
    expect(within(panel()).getByText('Step 1 of 7')).toBeInTheDocument();

    const steps = buddyTourStepsFor(
      'mc118',
      context({ cli: true, contactKey: BOB_KEY, sensorKey: SENSOR_KEY })
    );
    act(() => moveBuddyTour(steps, 1));
    // The panel mounts once the buddy agent has loaded, outside act(), so the
    // runner's store subscription (a passive effect of useSyncExternalStore)
    // may not be attached yet: this first move can show a tick later. After
    // it every move re-renders inside act().
    await waitFor(() => expect(props.onOpenSettings).toHaveBeenLastCalledWith('radio'));
    act(() => moveBuddyTour(steps, 1));
    expect(props.onSelectConversation).toHaveBeenLastCalledWith({
      type: 'node',
      id: 'node',
      name: 'My Node',
    });
    act(() => moveBuddyTour(steps, 1));
    expect(props.onSelectConversation).toHaveBeenLastCalledWith({
      type: 'contact',
      id: BOB_KEY,
      name: 'Bob',
    });
    act(() => moveBuddyTour(steps, 1));
    expect(props.onSelectConversation).toHaveBeenLastCalledWith({
      type: 'contact-info',
      id: BOB_KEY,
      name: 'Bob',
    });
    act(() => moveBuddyTour(steps, 1));
    expect(props.onSelectConversation).toHaveBeenLastCalledWith({
      type: 'contact',
      id: SENSOR_KEY,
      name: 'Weather',
    });
  });

  it('keeps an active buddy on screen next to an add-on card', async () => {
    existingUser();
    applyTheme('windows-95');
    setBuddyAgent('clippy');
    render(<BuddyHost {...hostProps({ health: health({ cli_supported: true }) })} />);
    expect(await screen.findByRole('dialog', { name: 'New in MeshCore 1.18' })).toBeInTheDocument();
    await waitFor(() => expect(loadBuddyAgentMock).toHaveBeenCalled());
  });

  it('walks a meshcomod radio through CAD, the Meshcomod contact and the filter', async () => {
    existingUser();
    const props = hostProps({
      health: health({ is_meshcomod: true, cli_supported: true, companion_filter_supported: true }),
    });
    render(<BuddyHost {...props} />);
    await waitFor(() => expect(getBuddyTourFeatures().cad).toBe(true));
    act(() => startBuddyTour('meshcomod'));
    await waitForPanel();
    expect(
      within(panel()).getByText(`Step 1 of ${BUDDY_TOURS.meshcomod.length}`)
    ).toBeInTheDocument();

    const steps = BUDDY_TOURS.meshcomod;
    act(() => moveBuddyTour(steps, 1));
    // The first move can show a tick later, as in the MeshCore 1.18 test above.
    await waitFor(() => expect(props.onOpenSettings).toHaveBeenLastCalledWith('radio'));
    act(() => moveBuddyTour(steps, 1));
    expect(getBuddyTourState('meshcomod').stepId).toBe('mcm_cad');
    expect(props.onSelectConversation).toHaveBeenLastCalledWith({
      type: 'channel',
      id: CHANNEL_KEY,
      name: 'Public',
    });
    act(() => moveBuddyTour(steps, 1));
    expect(props.onSelectConversation).toHaveBeenLastCalledWith({
      type: 'contact',
      id: MESHCOMOD_KEY,
      name: 'Meshcomod',
    });
    for (const id of ['mcm_cli', 'mcm_filter', 'mcm_filter_counters', 'mcm_filter_backup']) {
      act(() => moveBuddyTour(steps, 1));
      expect(getBuddyTourState('meshcomod').stepId).toBe(id);
      expect(props.onOpenSettings).toHaveBeenLastCalledWith('radio');
    }
    act(() => moveBuddyTour(steps, 1));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Finish' }));
    expect(stored('meshcomod')).toEqual({ status: 'done' });
    expect(getRunningBuddyTour()).toBeNull();
  });
});

describe('ManualView add-on tour buttons', () => {
  it('shows an add-on tour only when the radio has it', () => {
    const { rerender } = render(<ManualView />);
    expect(screen.queryByRole('button', { name: 'MeshCore 1.18 tour' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'meshcomod tour' })).toBeNull();

    act(() => noteBuddyTourRadio({ ...NONE, cli: true }));
    rerender(<ManualView />);
    expect(screen.queryByRole('button', { name: 'meshcomod tour' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'MeshCore 1.18 tour' }));
    expect(getBuddyTourState('mc118')).toEqual({ phase: 'running', stepId: 'mc118_welcome' });
    expect(screen.getByText('The MeshCore 1.18 tour is running')).toBeInTheDocument();

    act(() => pauseBuddyTour());
    expect(screen.getByRole('button', { name: 'Resume 1.18 tour' })).toBeInTheDocument();
  });
});
