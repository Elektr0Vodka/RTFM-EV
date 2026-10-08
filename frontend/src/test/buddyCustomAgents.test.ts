import { beforeEach, describe, expect, it, vi } from 'vitest';

const initAgentMock = vi.hoisted(() => vi.fn());
vi.mock('clippyjs', () => ({ initAgent: initAgentMock }));

/** Stand-in for a buddy converted from an .acs file (scripts/buddy/acs_to_clippy.py). */
const tester = vi.hoisted(() => ({
  name: 'Tester',
  agent: async () => ({ default: { framesize: [6, 4] } }),
  map: async () => ({ default: 'data:image/png;base64,AAAA' }),
}));
vi.mock('../buddy/customAgents', () => ({ CUSTOM_BUDDY_AGENTS: { tester } }));

const clippyLoaders = vi.hoisted(() => ({
  agent: async () => ({ default: { framesize: [124, 93] } }),
  map: async () => ({ default: 'data:image/png;base64,BBBB' }),
}));
vi.mock('clippyjs/agents/clippy', () => ({ default: clippyLoaders }));

import {
  BUDDY_AGENT_IDS,
  BUDDY_AGENT_NAMES,
  isBuddyAgentId,
  loadBuddyAgent,
  type BuddyAgentId,
} from '../buddy/agents';

const TESTER = 'tester' as BuddyAgentId;

beforeEach(() => {
  initAgentMock.mockReset().mockResolvedValue({ fake: 'agent' });
});

describe('custom buddy agents', () => {
  it('lists a converted buddy after the clippyjs ones', () => {
    expect(BUDDY_AGENT_IDS.slice(0, 2)).toEqual(['clippy', 'merlin']);
    expect(BUDDY_AGENT_IDS[BUDDY_AGENT_IDS.length - 1]).toBe('tester');
    expect(BUDDY_AGENT_NAMES[TESTER]).toBe('Tester');
    expect(BUDDY_AGENT_NAMES.clippy).toBe('Clippy');
    expect(isBuddyAgentId('tester')).toBe(true);
    expect(isBuddyAgentId('nobody')).toBe(false);
  });

  it('hands the converted data and sprite sheet to clippyjs, without sounds', async () => {
    await expect(loadBuddyAgent(TESTER)).resolves.toEqual({ fake: 'agent' });
    const loaders = initAgentMock.mock.calls[0][0];
    expect(loaders.agent).toBe(tester.agent);
    expect(loaders.map).toBe(tester.map);
    await expect(loaders.sound()).resolves.toEqual({ default: {} });
  });

  it('still loads a clippyjs buddy from the library', async () => {
    await loadBuddyAgent('clippy');
    const loaders = initAgentMock.mock.calls[0][0];
    expect(loaders.agent).toBe(clippyLoaders.agent);
    expect(loaders.map).toBe(clippyLoaders.map);
  });
});
