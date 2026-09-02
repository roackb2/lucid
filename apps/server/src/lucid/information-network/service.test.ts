import { describe, expect, it, vi } from 'vitest';
import type { InformationNetworkStore } from './store.js';
import {
  InformationNetworkInputError,
  InformationNetworkService,
} from './service.js';

describe('information network service', () => {
  it('owns bounded feed and Profile recent-Post limits', async () => {
    const store = createStore();
    const service = new InformationNetworkService(store);

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
    const service = new InformationNetworkService(store);

    await expect(service.post('missing-post')).resolves.toBeNull();
    await expect(service.profile('missing-profile')).resolves.toBeNull();
  });

  it('rejects malformed identifiers before persistence', async () => {
    const store = createStore();
    const service = new InformationNetworkService(store);

    await expect(service.post('bad id')).rejects
      .toBeInstanceOf(InformationNetworkInputError);
    await expect(service.profile('')).rejects
      .toBeInstanceOf(InformationNetworkInputError);
    expect(store.readPost).not.toHaveBeenCalled();
    expect(store.readProfile).not.toHaveBeenCalled();
  });
});

function createStore() {
  return {
    readFeed: vi.fn(async () => ({
      entries: [],
      postCount: 0,
      profileCount: 0,
    })),
    readPost: vi.fn(async () => undefined),
    readProfile: vi.fn(async () => undefined),
    readFindingPosts: vi.fn(async () => new Map()),
  } satisfies InformationNetworkStore;
}
