import type { initAgent } from 'clippyjs';
import { CUSTOM_BUDDY_AGENTS, type CustomBuddyAgent } from './customAgents';

/**
 * The desktop buddies shipped by `clippyjs` (MIT library code; the characters
 * and sprite sheets are Microsoft's). Each agent is its own dynamic import, so
 * Vite emits it as a separate chunk and a browser only downloads the sprite
 * sheet (0.9-2.5 MB) of the buddy it picked. Sounds are never loaded.
 */
const CLIPPYJS_AGENT_IDS = [
  'clippy',
  'merlin',
  'bonzi',
  'f1',
  'genie',
  'genius',
  'links',
  'peedy',
  'rocky',
  'rover',
] as const;

type ClippyjsAgentId = (typeof CLIPPYJS_AGENT_IDS)[number];
type CustomAgentId = keyof typeof CUSTOM_BUDDY_AGENTS;

export type BuddyAgentId = ClippyjsAgentId | CustomAgentId;

/** Buddies converted from `.acs` files (see `customAgents.ts`), keyed by id. */
const CUSTOM_AGENTS: Record<string, CustomBuddyAgent> = CUSTOM_BUDDY_AGENTS;

export const BUDDY_AGENT_IDS: readonly BuddyAgentId[] = [
  ...CLIPPYJS_AGENT_IDS,
  ...(Object.keys(CUSTOM_AGENTS) as CustomAgentId[]),
];

/** Character names are proper nouns, identical in every UI language. */
const CLIPPYJS_AGENT_NAMES: Record<ClippyjsAgentId, string> = {
  clippy: 'Clippy',
  merlin: 'Merlin',
  bonzi: 'Bonzi',
  f1: 'F1',
  genie: 'Genie',
  genius: 'Genius',
  links: 'Links',
  peedy: 'Peedy',
  rocky: 'Rocky',
  rover: 'Rover',
};

export const BUDDY_AGENT_NAMES = {
  ...CLIPPYJS_AGENT_NAMES,
  ...Object.fromEntries(Object.entries(CUSTOM_AGENTS).map(([id, custom]) => [id, custom.name])),
} as Record<BuddyAgentId, string>;

export type BuddyAgent = Awaited<ReturnType<typeof initAgent>>;

interface AgentModuleLoaders {
  agent: () => Promise<{ default: unknown }>;
  map: () => Promise<{ default: string }>;
}

const AGENT_MODULES: Record<ClippyjsAgentId, () => Promise<{ default: AgentModuleLoaders }>> = {
  clippy: () => import('clippyjs/agents/clippy'),
  merlin: () => import('clippyjs/agents/merlin'),
  bonzi: () => import('clippyjs/agents/bonzi'),
  f1: () => import('clippyjs/agents/f1'),
  genie: () => import('clippyjs/agents/genie'),
  genius: () => import('clippyjs/agents/genius'),
  links: () => import('clippyjs/agents/links'),
  peedy: () => import('clippyjs/agents/peedy'),
  rocky: () => import('clippyjs/agents/rocky'),
  rover: () => import('clippyjs/agents/rover'),
};

export function isBuddyAgentId(value: unknown): value is BuddyAgentId {
  return typeof value === 'string' && (BUDDY_AGENT_IDS as readonly string[]).includes(value);
}

/** Load the agent's data + sprite sheet and create it (hidden, appended to body). */
export async function loadBuddyAgent(id: BuddyAgentId): Promise<BuddyAgent> {
  const custom: AgentModuleLoaders | undefined = CUSTOM_AGENTS[id];
  const [{ initAgent: init }, loaders] = await Promise.all([
    import('clippyjs'),
    custom ?? AGENT_MODULES[id as ClippyjsAgentId]().then((module) => module.default),
  ]);
  return init({
    agent: loaders.agent,
    map: loaders.map,
    // Silent: an empty sound map means the animator never creates <audio>.
    sound: async () => ({ default: {} }),
  });
}
