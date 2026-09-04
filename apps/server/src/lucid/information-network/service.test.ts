import { describe, expect, it, vi } from 'vitest';
import type { InformationNetworkStore } from './store.js';
import {
  InformationNetworkInputError,
  InformationNetworkService,
} from './service.js';

describe('information network service', () => {
  it('owns bounded feed and Profile recent-Post limits', async () => {
    const store = createStore();
    const service = new InformationNetworkService(store, createAgentJobs());

    await expect(service.feed()).resolves.toEqual({
      entries: [],
      postCount: 0,
      profileCount: 0,
    });
    await expect(service.profile(' mina-chen ')).resolves.toBeNull();

    expect(store.readFeed).toHaveBeenCalledWith(50);
    expect(store.readProfile).toHaveBeenCalledWith('mina-chen', 12);
  });

  it('returns null for unknown stable identities', async () => {
    const store = createStore();
    const service = new InformationNetworkService(store, createAgentJobs());

    await expect(service.post('missing-post')).resolves.toBeNull();
    await expect(service.profile('missing-profile')).resolves.toBeNull();
  });

  it('normalizes and bounds Network Post search', async () => {
    const store = createStore();
    const service = new InformationNetworkService(store, createAgentJobs());

    await expect(service.searchPosts({
      query: '  durable   agent systems ',
    })).resolves.toEqual({
      query: 'durable agent systems',
      results: [],
    });
    await service.searchPosts({ query: 'architecture', limit: 4 });

    expect(store.searchPosts).toHaveBeenNthCalledWith(
      1,
      'durable agent systems',
      10,
    );
    expect(store.searchPosts).toHaveBeenNthCalledWith(2, 'architecture', 4);
  });

  it.each([
    { query: '', limit: undefined },
    { query: 'x'.repeat(201), limit: undefined },
    { query: 'valid', limit: 0 },
    { query: 'valid', limit: 21 },
    { query: 'valid', limit: 1.5 },
  ])('rejects malformed Post search input %#', async (input) => {
    const store = createStore();
    const service = new InformationNetworkService(store, createAgentJobs());

    await expect(service.searchPosts(input)).rejects
      .toBeInstanceOf(InformationNetworkInputError);
    expect(store.searchPosts).not.toHaveBeenCalled();
  });

  it('rejects malformed identifiers before persistence', async () => {
    const store = createStore();
    const service = new InformationNetworkService(store, createAgentJobs());

    await expect(service.post('bad id')).rejects
      .toBeInstanceOf(InformationNetworkInputError);
    await expect(service.profile('')).rejects
      .toBeInstanceOf(InformationNetworkInputError);
    expect(store.readPost).not.toHaveBeenCalled();
    expect(store.readProfile).not.toHaveBeenCalled();
  });

  it('projects public publishing preferences without private job direction', async () => {
    const store = createStore();
    store.readProfile.mockResolvedValue({
      profile: {
        id: 'mina-chen',
        displayName: 'Mina Chen',
        initials: 'MC',
        publishingFocus: 'Regional fashion',
        representativeAgentId: 'fixture-agent-mina-chen',
        representativeAgentName: "Mina's representative",
        publicDescription: 'Independent fashion researcher.',
        representativeAgentPurpose: 'Prepare source-backed notes.',
        topics: ['Independent fashion'],
      },
      recentPosts: [],
    });
    const agentJobs = createAgentJobs();
    agentJobs.listAgentJobs.mockResolvedValue([{
      id: 'publisher-01-mina-regional-fashion',
      workspaceId: 'lucid',
      agentId: 'fixture-agent-mina-chen',
      kind: 'information-network-publishing',
      name: 'Regional fashion publisher',
      instructions: 'Private job instructions.',
      cadenceMs: 10_800_000,
      enabled: true,
      scheduleMode: 'manual',
      publishingPreferences: {
        topics: ['Independent fashion'],
        region: 'Taiwan and East Asia',
        sourceGuidance: 'Private source-selection guidance.',
        updatedAt: '2026-09-04T00:00:00.000Z',
      },
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
    }]);
    agentJobs.readLatestRunRequest.mockResolvedValue({
      id: 'publisher-run-1',
      agentJobId: 'publisher-01-mina-regional-fashion',
      state: 'claimed',
      currentExecutionId: 'private-execution-fence',
      requestedAt: '2026-09-04T00:05:00.000Z',
      claimedAt: '2026-09-04T00:05:01.000Z',
    });

    const result = await new InformationNetworkService(store, agentJobs)
      .profile('mina-chen');
    const serialized = JSON.stringify(result);

    expect(result?.publishingJobs[0]?.publishingPreferences).toEqual({
      topics: ['Independent fashion'],
      region: 'Taiwan and East Asia',
      updatedAt: '2026-09-04T00:00:00.000Z',
    });
    expect(serialized).not.toContain('Private job instructions');
    expect(serialized).not.toContain('Private source-selection guidance');
    expect(serialized).not.toContain('private-execution-fence');
  });
});

function createStore() {
  return {
    readFeed: vi.fn(async () => ({
      entries: [],
      postCount: 0,
      profileCount: 0,
    })),
    searchPosts: vi.fn(async () => []),
    readPost: vi.fn(async () => undefined),
    readProfile: vi.fn(async () => undefined),
    readFindingPosts: vi.fn(async () => new Map()),
  } satisfies InformationNetworkStore;
}

function createAgentJobs() {
  return {
    listAgentJobs: vi.fn(async () => []),
    readLatestRunRequest: vi.fn(async () => undefined),
  };
}
