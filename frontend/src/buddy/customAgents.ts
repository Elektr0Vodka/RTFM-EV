/**
 * Extra desktop buddies converted from Microsoft Agent `.acs` files with
 * `scripts/buddy/acs_to_clippy.py` (see `scripts/buddy/README.md`). Each buddy
 * is one folder `./custom/<id>/` holding the converter's `agent.json` and
 * `map.png`, plus one entry below. Like the clippyjs agents, every entry is a
 * dynamic import, so a browser only downloads the buddy it picked.
 *
 * The characters and sprite sheets are not ours: Microsoft's Office and Search
 * assistants, and third-party Microsoft Agent characters.
 */
export interface CustomBuddyAgent {
  /** Proper noun shown in the picker, identical in every UI language. */
  name: string;
  agent: () => Promise<{ default: unknown }>;
  map: () => Promise<{ default: string }>;
}

export const CUSTOM_BUDDY_AGENTS = {
  // Office assistants
  dot: {
    name: 'The Dot',
    agent: () => import('./custom/dot/agent.json'),
    map: () => import('./custom/dot/map.png?url'),
  },
  logo: {
    name: 'Office Logo',
    agent: () => import('./custom/logo/agent.json'),
    map: () => import('./custom/logo/map.png?url'),
  },
  mothernature: {
    name: 'Mother Nature',
    agent: () => import('./custom/mothernature/agent.json'),
    map: () => import('./custom/mothernature/map.png?url'),
  },
  // Windows XP search assistants
  courtney: {
    name: 'Courtney',
    agent: () => import('./custom/courtney/agent.json'),
    map: () => import('./custom/courtney/map.png?url'),
  },
  earl: {
    name: 'Earl',
    agent: () => import('./custom/earl/agent.json'),
    map: () => import('./custom/earl/map.png?url'),
  },
  // Microsoft Agent characters
  birdie: {
    name: 'Birdie',
    agent: () => import('./custom/birdie/agent.json'),
    map: () => import('./custom/birdie/map.png?url'),
  },
  cami: {
    name: 'Cami',
    agent: () => import('./custom/cami/agent.json'),
    map: () => import('./custom/cami/map.png?url'),
  },
  charlie: {
    name: 'Charlie',
    agent: () => import('./custom/charlie/agent.json'),
    map: () => import('./custom/charlie/map.png?url'),
  },
  eman: {
    name: 'E-Man',
    agent: () => import('./custom/eman/agent.json'),
    map: () => import('./custom/eman/map.png?url'),
  },
  ewoman: {
    name: 'E-Woman',
    agent: () => import('./custom/ewoman/agent.json'),
    map: () => import('./custom/ewoman/map.png?url'),
  },
  electra: {
    name: 'Electra',
    agent: () => import('./custom/electra/agent.json'),
    map: () => import('./custom/electra/map.png?url'),
  },
  gar: {
    name: 'Gar',
    agent: () => import('./custom/gar/agent.json'),
    map: () => import('./custom/gar/map.png?url'),
  },
  hanz: {
    name: 'Hanz',
    agent: () => import('./custom/hanz/agent.json'),
    map: () => import('./custom/hanz/map.png?url'),
  },
  milton: {
    name: 'Milton',
    agent: () => import('./custom/milton/agent.json'),
    map: () => import('./custom/milton/map.png?url'),
  },
  oscar: {
    name: 'Oscar',
    agent: () => import('./custom/oscar/agent.json'),
    map: () => import('./custom/oscar/map.png?url'),
  },
  plany: {
    name: 'Plany',
    agent: () => import('./custom/plany/agent.json'),
    map: () => import('./custom/plany/map.png?url'),
  },
  santa: {
    name: 'Santa',
    agent: () => import('./custom/santa/agent.json'),
    map: () => import('./custom/santa/map.png?url'),
  },
  vrgirl: {
    name: 'VRGirl',
    agent: () => import('./custom/vrgirl/agent.json'),
    map: () => import('./custom/vrgirl/map.png?url'),
  },
  wabbit: {
    name: 'Wabbit',
    agent: () => import('./custom/wabbit/agent.json'),
    map: () => import('./custom/wabbit/map.png?url'),
  },
  wartnose: {
    name: 'WartNose',
    agent: () => import('./custom/wartnose/agent.json'),
    map: () => import('./custom/wartnose/map.png?url'),
  },
  // Microsoft Agent 1.5 characters (the older OLE file format)
  al: {
    name: 'Al',
    agent: () => import('./custom/al/agent.json'),
    map: () => import('./custom/al/map.png?url'),
  },
  checkmate: {
    name: 'Checkmate',
    agent: () => import('./custom/checkmate/agent.json'),
    map: () => import('./custom/checkmate/map.png?url'),
  },
  gourdy: {
    name: 'Gourdy',
    agent: () => import('./custom/gourdy/agent.json'),
    map: () => import('./custom/gourdy/map.png?url'),
  },
  max: {
    name: 'Max',
    agent: () => import('./custom/max/agent.json'),
    map: () => import('./custom/max/map.png?url'),
  },
  ozzar: {
    name: 'Ozzar',
    agent: () => import('./custom/ozzar/agent.json'),
    map: () => import('./custom/ozzar/map.png?url'),
  },
  sharky: {
    name: 'Sharky',
    agent: () => import('./custom/sharky/agent.json'),
    map: () => import('./custom/sharky/map.png?url'),
  },
  spaceman: {
    name: 'Spaceman',
    agent: () => import('./custom/spaceman/agent.json'),
    map: () => import('./custom/spaceman/map.png?url'),
  },
  totem: {
    name: 'Totem',
    agent: () => import('./custom/totem/agent.json'),
    map: () => import('./custom/totem/map.png?url'),
  },
} satisfies Record<string, CustomBuddyAgent>;
