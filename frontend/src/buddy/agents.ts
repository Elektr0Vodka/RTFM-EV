import type { initAgent } from 'clippyjs';

/**
 * The desktop buddies shipped by `clippyjs` (MIT library code; the characters
 * and sprite sheets are Microsoft's). Each agent is its own dynamic import, so
 * Vite emits it as a separate chunk and a browser only downloads the sprite
 * sheet (0.9-2.5 MB) of the buddy it picked. Sounds are never loaded.
 */
export const BUDDY_AGENT_IDS = [
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

export type BuddyAgentId = (typeof BUDDY_AGENT_IDS)[number];

/** Character names are proper nouns, identical in every UI language. */
export const BUDDY_AGENT_NAMES: Record<BuddyAgentId, string> = {
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

export type BuddyAgent = Awaited<ReturnType<typeof initAgent>>;

interface AgentModuleLoaders {
  agent: () => Promise<{ default: unknown }>;
  map: () => Promise<{ default: string }>;
}

const AGENT_MODULES: Record<BuddyAgentId, () => Promise<{ default: AgentModuleLoaders }>> = {
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
  const [{ initAgent: init }, { default: loaders }] = await Promise.all([
    import('clippyjs'),
    AGENT_MODULES[id](),
  ]);
  return init({
    agent: loaders.agent,
    map: loaders.map,
    // Silent: an empty sound map means the animator never creates <audio>.
    sound: async () => ({ default: {} }),
  });
}
