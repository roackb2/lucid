import type { McpInvocationScope } from '@heddleagent/execution-host-client/mcp';
import { describe, expect, it, vi } from 'vitest';
import {
  CapabilityScopedInformationNetworkReader,
  InformationNetworkReaderScopeError,
} from './information-network-reader.js';

describe('CapabilityScopedInformationNetworkReader', () => {
  it('reads only through verified heartbeat scope', async () => {
    const searchPosts = vi.fn(async () => ({
      query: 'durable agents',
      results: [],
    }));
    const post = vi.fn(async () => null);
    const reader = new CapabilityScopedInformationNetworkReader({
      tenantId: 'tenant-a',
      productSessionId: 'session-a',
    }, { searchPosts, post });
    const signal = new AbortController().signal;

    await reader.searchPosts({
      scope: invocationScope(),
      query: 'durable agents',
      limit: 4,
      signal,
    });
    await reader.readPost({
      scope: invocationScope(),
      postId: 'post-1',
      signal,
    });

    expect(searchPosts).toHaveBeenCalledWith({
      query: 'durable agents',
      limit: 4,
    });
    expect(post).toHaveBeenCalledWith('post-1');
  });

  it.each([
    { tenantId: 'another-tenant' },
    { productSessionId: 'another-session' },
    { workflow: 'conversation-turn' as const },
  ])('rejects mismatched scope $tenantId$productSessionId$workflow', async (
    override,
  ) => {
    const searchPosts = vi.fn();
    const reader = new CapabilityScopedInformationNetworkReader({
      tenantId: 'tenant-a',
      productSessionId: 'session-a',
    }, { searchPosts, post: vi.fn() });

    await expect(reader.searchPosts({
      scope: invocationScope(override),
      query: 'durable agents',
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(InformationNetworkReaderScopeError);
    expect(searchPosts).not.toHaveBeenCalled();
  });
});

function invocationScope(
  override: Partial<McpInvocationScope> = {},
): McpInvocationScope {
  return {
    adopterId: 'lucid',
    tenantId: 'tenant-a',
    subjectId: 'user-a',
    productSessionId: 'session-a',
    runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
    invocationId: 'execution-a',
    workflow: 'heartbeat-task',
    ...override,
  };
}
